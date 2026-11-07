using System.Text.Json;

namespace Kagaz.ShopAgent.Core.Realtime;

/// <summary>One live connection to the <c>/shop</c> namespace (Socket.IO in production, a fake in tests).</summary>
public interface IRealtimeConnection : IAsyncDisposable
{
    /// <summary>Connect with the device token in the handshake <c>auth</c>. Throws on failure.</summary>
    Task ConnectAsync(Uri namespaceUri, string deviceToken, CancellationToken ct);

    /// <summary>Raised for every server event: name + first argument as JSON (may be <c>null</c>).</summary>
    event Action<string, JsonElement?>? EventReceived;

    /// <summary>Raised once when an established connection drops.</summary>
    event Action<string>? Disconnected;
}

/// <summary>Exponential reconnect backoff with jitter (P2.9). Pure.</summary>
public static class ReconnectBackoff
{
    public static readonly TimeSpan Initial = TimeSpan.FromSeconds(1);
    public static readonly TimeSpan Max = TimeSpan.FromSeconds(60);

    /// <param name="attempt">0 for the first retry.</param>
    /// <param name="jitter">A random value in [0, 1); 0.5 means no jitter.</param>
    public static TimeSpan Delay(int attempt, double jitter)
    {
        double baseSeconds = Math.Min(Max.TotalSeconds, Initial.TotalSeconds * Math.Pow(2, Math.Clamp(attempt, 0, 16)));
        double factor = 0.8 + 0.4 * Math.Clamp(jitter, 0, 1); // ±20 %
        return TimeSpan.FromSeconds(Math.Min(Max.TotalSeconds, baseSeconds * factor));
    }
}

/// <summary>
/// Realtime hints for the shop app (P2.9, contract §5): connects to <c>/shop</c> with the device token
/// and turns events into wake-ups. <b>Hints only</b> (invariant 13): <c>job.created</c>/<c>job.updated</c>
/// wake the REST refresh, <c>device.revoked</c> triggers an immediate heartbeat (the REST
/// <c>401 DEVICE_REVOKED</c> is what wipes the token), <c>shop.mode_changed</c> updates the mode control
/// (the next heartbeat confirms it). Everything keeps working through the REST safety polls if the
/// socket never connects. Reconnects with <see cref="ReconnectBackoff"/>; the library's own
/// reconnection is off so a rotated token is picked up on every attempt.
/// </summary>
public sealed class RealtimeClient
{
    private readonly Func<IRealtimeConnection> _connectionFactory;
    private readonly Func<string?> _tokenProvider;
    private readonly AgentSignals _signals;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly Func<double> _random;
    private CancellationTokenSource? _reconnectNow;

    public RealtimeClient(Func<IRealtimeConnection> connectionFactory, Func<string?> tokenProvider, AgentSignals signals,
        Func<TimeSpan, CancellationToken, Task>? delay = null, Func<double>? random = null)
    {
        _connectionFactory = connectionFactory;
        _tokenProvider = tokenProvider;
        _signals = signals;
        _delay = delay ?? Task.Delay;
        _random = random ?? Random.Shared.NextDouble;
    }

    /// <summary>Connected / disconnected (drives the poll intervals and the status indicator).</summary>
    public event Action<bool>? ConnectionChanged;

    /// <summary><c>shop.mode_changed</c>: approval mode + autoPaused.</summary>
    public event Action<string?, bool>? ModeChanged;

    /// <summary>Drop the current connection and reconnect now (e.g. after token rotation).</summary>
    public void ReconnectNow() => _reconnectNow?.Cancel();

    /// <summary>Runs until <paramref name="ct"/> is cancelled. <paramref name="namespaceUri"/> is re-read every attempt.</summary>
    public async Task RunAsync(Func<Uri?> namespaceUri, CancellationToken ct)
    {
        int failures = 0;
        while (!ct.IsCancellationRequested)
        {
            var uri = namespaceUri();
            var token = _tokenProvider();
            if (uri is null || string.IsNullOrEmpty(token))
            {
                await SafeDelay(TimeSpan.FromSeconds(5), ct);
                continue;
            }

            using var session = CancellationTokenSource.CreateLinkedTokenSource(ct);
            _reconnectNow = session;
            var dropped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            await using var connection = _connectionFactory();
            connection.EventReceived += Dispatch;
            connection.Disconnected += _ => dropped.TrySetResult();
            try
            {
                await connection.ConnectAsync(uri, token, session.Token);
                failures = 0;
                SetConnected(true);
                _signals.Jobs.Pulse(); // catch up on anything missed while disconnected (REST is the truth)
                await Task.WhenAny(dropped.Task, Task.Delay(Timeout.Infinite, session.Token));
                SetConnected(false);
            }
            catch (OperationCanceledException) when (session.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                SetConnected(false);
                continue; // ReconnectNow()
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                // Connect failed (server down, no realtime module yet, auth rejected): back off.
            }
            finally
            {
                connection.EventReceived -= Dispatch;
                _reconnectNow = null;
            }

            if (ct.IsCancellationRequested) break;
            await SafeDelay(ReconnectBackoff.Delay(failures++, _random()), ct);
        }
        SetConnected(false);
    }

    /// <summary>Map one server event to a wake-up. Public for tests.</summary>
    public void Dispatch(string name, JsonElement? payload)
    {
        switch (name)
        {
            case "job.created":
            case "job.updated":
                _signals.Jobs.Pulse();
                break;
            case "device.revoked":
                _signals.Heartbeat.Pulse();
                break;
            case "shop.mode_changed":
                if (payload is { ValueKind: JsonValueKind.Object } p)
                {
                    string? mode = p.TryGetProperty("approvalMode", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
                    bool paused = p.TryGetProperty("autoPaused", out var a) && a.ValueKind == JsonValueKind.True;
                    ModeChanged?.Invoke(mode, paused);
                }
                _signals.Heartbeat.Pulse();
                break;
        }
    }

    private bool _connected;

    private void SetConnected(bool connected)
    {
        if (_connected == connected) return;
        _connected = connected;
        ConnectionChanged?.Invoke(connected);
    }

    private async Task SafeDelay(TimeSpan delay, CancellationToken ct)
    {
        try { await _delay(delay, ct); }
        catch (OperationCanceledException) { }
    }

    /// <summary><c>http://host:4000/api</c> → <c>http://host:4000/shop</c> (same origin, path <c>/socket.io</c>).</summary>
    public static Uri? NamespaceUri(string apiBaseUrl)
    {
        if (!Uri.TryCreate(apiBaseUrl.Trim(), UriKind.Absolute, out var api)) return null;
        return new Uri(new Uri(api.GetLeftPart(UriPartial.Authority)), "/shop");
    }
}

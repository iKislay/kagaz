using System.Text.Json;
using SocketIOClient;

namespace Kagaz.ShopAgent.Core.Realtime;

/// <summary>
/// <see cref="IRealtimeConnection"/> over SocketIOClient (Socket.IO v4, path <c>/socket.io</c>).
/// Outbound connection only. The device token travels in the handshake <c>auth</c> payload and is
/// never logged.
/// </summary>
public sealed class SocketIoRealtimeConnection : IRealtimeConnection
{
    private static readonly string[] Events = ["job.created", "job.updated", "shop.mode_changed", "device.revoked"];
    private SocketIO? _socket;

    public event Action<string, JsonElement?>? EventReceived;
    public event Action<string>? Disconnected;

    public async Task ConnectAsync(Uri namespaceUri, string deviceToken, CancellationToken ct)
    {
        var socket = new SocketIO(namespaceUri, new SocketIOOptions
        {
            Path = "/socket.io",
            Auth = new Dictionary<string, string> { ["token"] = deviceToken },
            Reconnection = false, // RealtimeClient owns backoff and re-reads the token each attempt
            ConnectionTimeout = TimeSpan.FromSeconds(10),
        });
        foreach (var name in Events)
        {
            socket.On(name, ctx =>
            {
                JsonElement? payload = null;
                try { payload = ctx.GetValue<JsonElement>(0); }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException or ArgumentException or IndexOutOfRangeException) { }
                EventReceived?.Invoke(name, payload);
                return Task.CompletedTask;
            });
        }
        socket.OnDisconnected += (_, reason) => Disconnected?.Invoke(reason ?? "disconnected");
        _socket = socket;

        await socket.ConnectAsync(ct);
        if (!socket.Connected)
        {
            throw new InvalidOperationException("Realtime connection was not established");
        }
    }

    public async ValueTask DisposeAsync()
    {
        var socket = _socket;
        _socket = null;
        if (socket is null) return;
        try
        {
            if (socket.Connected) await socket.DisconnectAsync();
        }
        catch (Exception)
        {
            // Closing anyway.
        }
        socket.Dispose();
    }
}

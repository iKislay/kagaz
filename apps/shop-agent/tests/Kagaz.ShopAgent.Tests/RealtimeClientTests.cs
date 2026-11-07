using System.Text.Json;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Realtime;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.9: socket events are hints that wake REST; backoff; works without a socket.</summary>
public class RealtimeClientTests
{
    private sealed class FakeConnection : IRealtimeConnection
    {
        public Func<Uri, string, Task> OnConnect { get; set; } = (_, _) => Task.CompletedTask;
        public Uri? Uri { get; private set; }
        public string? Token { get; private set; }
        public event Action<string, JsonElement?>? EventReceived;
        public event Action<string>? Disconnected;

        public async Task ConnectAsync(Uri namespaceUri, string deviceToken, CancellationToken ct)
        {
            Uri = namespaceUri;
            Token = deviceToken;
            await OnConnect(namespaceUri, deviceToken);
        }

        public void Emit(string name, string? json = null) =>
            EventReceived?.Invoke(name, json is null ? null : JsonDocument.Parse(json).RootElement.Clone());

        public void Drop() => Disconnected?.Invoke("transport close");

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Fact]
    public async Task Job_events_pulse_the_jobs_signal()
    {
        var signals = new AgentSignals();
        var client = new RealtimeClient(() => new FakeConnection(), () => "t", signals);
        var wait = signals.Jobs.WaitAsync(TimeSpan.FromSeconds(5), CancellationToken.None);

        client.Dispatch("job.created", null);

        Assert.True(await wait);
    }

    [Fact]
    public async Task Device_revoked_hint_only_triggers_a_heartbeat()
    {
        var signals = new AgentSignals();
        var client = new RealtimeClient(() => new FakeConnection(), () => "t", signals);
        var heartbeat = signals.Heartbeat.WaitAsync(TimeSpan.FromSeconds(5), CancellationToken.None);

        client.Dispatch("device.revoked", null);

        Assert.True(await heartbeat); // the REST 401 DEVICE_REVOKED decides, not the hint
    }

    [Fact]
    public void Mode_changed_payload_is_forwarded()
    {
        var client = new RealtimeClient(() => new FakeConnection(), () => "t", new AgentSignals());
        (string? Mode, bool Paused)? got = null;
        client.ModeChanged += (m, p) => got = (m, p);

        client.Dispatch("shop.mode_changed", JsonDocument.Parse("""{ "approvalMode": "AUTO", "autoPaused": true }""").RootElement);

        Assert.Equal(("AUTO", true), got);
    }

    [Fact]
    public async Task Connects_with_device_token_and_reconnects_with_backoff_after_drop()
    {
        var signals = new AgentSignals();
        var connections = new List<FakeConnection>();
        var delays = new List<TimeSpan>();
        var states = new List<bool>();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        int attempt = 0;

        var client = new RealtimeClient(() =>
        {
            var c = new FakeConnection();
            int n = attempt++;
            c.OnConnect = (_, _) => n switch
            {
                0 => Task.CompletedTask,                                   // connects, then drops
                1 or 2 => Task.FromException(new IOException("refused")), // two failures
                _ => Task.CompletedTask,                                   // connects again
            };
            connections.Add(c);
            return c;
        }, () => "device-token", signals, delay: (d, _) => { delays.Add(d); return Task.CompletedTask; }, random: () => 0.5);
        client.ConnectionChanged += connected =>
        {
            states.Add(connected);
            if (connected && states.Count(s => s) == 1) _ = Task.Run(() => connections[0].Drop());
            if (connected && states.Count(s => s) == 2) cts.Cancel();
        };

        await client.RunAsync(() => RealtimeClient.NamespaceUri("http://localhost:4000/api"), cts.Token);

        Assert.Equal("device-token", connections[0].Token);
        Assert.Equal(new Uri("http://localhost:4000/shop"), connections[0].Uri);
        Assert.Equal(4, connections.Count);
        Assert.Equal([1.0, 2.0, 4.0], delays.Select(d => d.TotalSeconds)); // from 1 s after a drop, doubling per failure
        Assert.Equal([true, false, true, false], states);
    }

    [Fact]
    public async Task Without_pairing_it_idles_and_never_connects()
    {
        int created = 0;
        using var cts = new CancellationTokenSource();
        int delays = 0;
        var client = new RealtimeClient(() => { created++; return new FakeConnection(); }, () => null, new AgentSignals(),
            delay: (_, _) => { if (++delays == 3) cts.Cancel(); return Task.CompletedTask; });

        await client.RunAsync(() => null, cts.Token);

        Assert.Equal(0, created);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 2)]
    [InlineData(3, 8)]
    [InlineData(10, 60)]
    public void Backoff_doubles_up_to_a_minute(int attempt, double seconds)
    {
        Assert.Equal(seconds, ReconnectBackoff.Delay(attempt, 0.5).TotalSeconds, 3);
        Assert.InRange(ReconnectBackoff.Delay(attempt, 0).TotalSeconds, seconds * 0.8 - 0.001, 60);
    }

    [Theory]
    [InlineData("http://localhost:4000/api", "http://localhost:4000/shop")]
    [InlineData("https://api.kagaz.example/api/", "https://api.kagaz.example/shop")]
    public void Namespace_uri_is_same_origin(string api, string expected)
    {
        Assert.Equal(new Uri(expected), RealtimeClient.NamespaceUri(api));
    }
}

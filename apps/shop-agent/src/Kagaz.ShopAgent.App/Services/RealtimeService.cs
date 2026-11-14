using System.IO;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Realtime;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Hosts <see cref="RealtimeClient"/> (P2.9): Socket.IO <c>/shop</c> with the device token, hints only.
/// Reconnects after a token rotation; idles while unpaired. Disabled with <c>RealtimeEnabled=false</c>.
/// </summary>
public sealed class RealtimeService : BackgroundService
{
    private readonly AgentSettings _settings;
    private readonly AppStatus _status;
    private readonly ISecureStore _store;
    private readonly RealtimeClient _client;
    private readonly ILogger<RealtimeService> _log;

    public RealtimeService(AgentSettings settings, AppStatus status, ISecureStore store, AgentSignals signals,
        ILogger<RealtimeService> log)
    {
        _settings = settings;
        _status = status;
        _store = store;
        _log = log;
        _client = new RealtimeClient(() => new SocketIoRealtimeConnection(), LoadToken, signals);
        _client.ConnectionChanged += connected =>
        {
            _status.SetRealtimeConnected(connected);
            _log.LogInformation(connected ? "Realtime connected" : "Realtime disconnected");
        };
        _client.ModeChanged += (mode, paused, open) => _status.ApplyShopState(mode, paused, open);
        status.Session.DeviceTokenRotated += _client.ReconnectNow;
        status.Unpaired += _client.ReconnectNow;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.RealtimeEnabled)
        {
            _log.LogInformation("Realtime disabled; using REST polling only");
            return;
        }
        await Task.Yield();
        await _client.RunAsync(() => _status.IsPaired ? RealtimeClient.NamespaceUri(_settings.ApiBaseUrl) : null, stoppingToken);
    }

    private string? LoadToken()
    {
        try { return _status.IsPaired ? _store.Load() : null; }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or IOException or FormatException)
        {
            return null;
        }
    }
}

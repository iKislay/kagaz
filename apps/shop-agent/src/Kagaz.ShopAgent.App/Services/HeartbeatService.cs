using System.Diagnostics;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Spooler;
using Kagaz.ShopAgent.Printing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Heartbeat (P2.7 / P4.4, contract §1) and connection indicator.
/// Paired: <c>POST /shop/heartbeat</c> every <see cref="AgentSettings.HeartbeatSeconds"/> (15 s) with app
/// version, OS, uptime, local queue depth, <c>activePrintJobIds</c> (renews the leases of attempts this PC
/// is printing/monitoring) and the health of this shop's printers installed here (P2.10). The response
/// drives the approval-mode control (P2.6) and the "Update required" banner (P4.4).
/// Not paired: <c>GET /health</c>. A <c>device.revoked</c> socket hint triggers a beat immediately — the
/// REST answer (<c>401 DEVICE_REVOKED</c>) is what actually wipes the token.
/// </summary>
public sealed class HeartbeatService : BackgroundService
{
    private static readonly DateTimeOffset ProcessStart = GetProcessStart();

    private readonly ShopApiClient _api;
    private readonly KagazApiClient _health;
    private readonly AgentSettings _settings;
    private readonly AppStatus _status;
    private readonly AgentStateStore _state;
    private readonly ISpoolerProbe _spooler;
    private readonly PrinterReachability _reachability;
    private readonly AgentSignals _signals;
    private readonly ILogger<HeartbeatService> _log;
    private readonly string _os = HeartbeatBuilder.DescribeOs(Environment.OSVersion.Version);
    private bool _wasConnected;

    public HeartbeatService(ShopApiClient api, KagazApiClient health, AgentSettings settings, AppStatus status,
        AgentStateStore state, ISpoolerProbe spooler, PrinterReachability reachability, AgentSignals signals,
        ILogger<HeartbeatService> log)
    {
        _api = api;
        _health = health;
        _settings = settings;
        _status = status;
        _state = state;
        _spooler = spooler;
        _reachability = reachability;
        _signals = signals;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            // Operator tokens are 12 h JWTs: back to the sign-in screen when it lapses (P2.3).
            _status.Session.ExpireIfDue();
            bool healthy = _status.IsPaired ? await BeatAsync(stoppingToken) : await CheckHealthAsync(stoppingToken);

            // Retry quickly while disconnected or unpaired so the indicator recovers fast.
            int seconds = healthy && _status.IsPaired ? Math.Max(5, _settings.HeartbeatSeconds) : 5;
            try { await _signals.Heartbeat.WaitAsync(TimeSpan.FromSeconds(seconds), stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task<bool> BeatAsync(CancellationToken ct)
    {
        try
        {
            var printers = await _api.GetPrintersAsync(ct);
            var health = new List<(ShopPrinter Printer, PrinterHealthResult Health)>();
            foreach (var p in printers.Where(p => p.Enabled))
            {
                var queue = _spooler.GetQueue(p.PrinterName);
                if (queue is { Exists: false }) continue; // not installed on this PC (another counter's printer)
                health.Add((p, PrinterHealth.Map(queue, _reachability.UnreachableReason(p.PrinterName))));
            }

            var request = HeartbeatBuilder.Build(_settings.AppVersion, _os, DateTimeOffset.Now - ProcessStart, _state.Load(),
                health.Select(h => new PrinterStatus(h.Printer.Id, h.Health.Status, h.Health.LastError)));
            var response = await _api.HeartbeatAsync(request, ct);

            if (response.Shop is { } shop)
            {
                _status.ApplyShopState(shop.ApprovalMode, shop.AutoPaused, shop.Status);
            }
            var problems = health.Where(h => h.Health.IsProblem).Select(h => $"{h.Printer.DisplayName}: {h.Health.LastError}").ToList();
            _status.SetPrinterAlert(problems.Count == 0 ? null : string.Join(" · ", problems));

            _status.SetConnection(ConnectionState.Connected, $"Connected · {_status.ShopName ?? "Kaggaz"}");
            MarkConnected(true);
            return true;
        }
        catch (ApiException ex) when (ex.Code == ApiErrorCodes.DeviceRevoked)
        {
            // AppStatus already wiped the token via AgentSession.DeviceRevoked (P2.4).
            MarkConnected(false);
            return false;
        }
        catch (ApiException ex) when (ex.Code == ApiErrorCodes.DeviceUnauthorized)
        {
            _status.SetConnection(ConnectionState.Unauthorized, "This PC was disconnected — connect it again");
            MarkConnected(false);
            return false;
        }
        catch (ApiException ex) when (ex.Code == ApiErrorCodes.AgentUpgradeRequired)
        {
            // printers GET answered 426: AgentSession already raised the banner (P4.4).
            _status.SetConnection(ConnectionState.Offline, "Update required");
            MarkConnected(false);
            return false;
        }
        catch (ApiException ex)
        {
            _log.LogWarning("Heartbeat failed: {Code}", ex.Code);
            _status.SetConnection(ConnectionState.Offline, ex.Code == ApiErrorCodes.NetworkError ? "Offline — retrying" : $"Server error ({ex.Code})");
            MarkConnected(false);
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>Offline → online: tell the print worker to reconcile before printing (plan A.3).</summary>
    private void MarkConnected(bool connected)
    {
        if (connected && !_wasConnected) _signals.MarkReconnected();
        _wasConnected = connected;
    }

    private async Task<bool> CheckHealthAsync(CancellationToken ct)
    {
        MarkConnected(false);
        try
        {
            var result = await _health.GetHealthAsync(ct);
            if (_status.RevokedNotice is null)
            {
                _status.SetConnection(ConnectionState.NotPaired, result.IsSuccess ? "Not connected to a shop yet" : "Offline · not connected to a shop");
            }
            return result.IsSuccess;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private static DateTimeOffset GetProcessStart()
    {
        try
        {
            using var p = Process.GetCurrentProcess();
            return new DateTimeOffset(p.StartTime);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException)
        {
            return DateTimeOffset.Now;
        }
    }
}

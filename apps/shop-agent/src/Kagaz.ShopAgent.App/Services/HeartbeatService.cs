using System.Printing;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Printing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Keeps the connection indicator honest and reports this PC's printers to the API.
/// Paired: <c>POST /devices/heartbeat</c> every <see cref="AgentSettings.HeartbeatSeconds"/> with the
/// server ids of this shop's printers that are installed here. Not paired: <c>GET /health</c>.
/// </summary>
public sealed class HeartbeatService : BackgroundService
{
    private readonly ShopApiClient _api;
    private readonly KagazApiClient _health;
    private readonly AgentSettings _settings;
    private readonly AppStatus _status;
    private readonly PrinterReachability _reachability;
    private readonly ILogger<HeartbeatService> _log;

    public HeartbeatService(ShopApiClient api, KagazApiClient health, AgentSettings settings, AppStatus status,
        PrinterReachability reachability, ILogger<HeartbeatService> log)
    {
        _reachability = reachability;
        _api = api;
        _health = health;
        _settings = settings;
        _status = status;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            bool healthy = _status.IsPaired ? await BeatAsync(stoppingToken) : await CheckHealthAsync(stoppingToken);

            // Retry quickly while disconnected or unpaired so the indicator recovers fast.
            int seconds = healthy && _status.IsPaired ? Math.Max(5, _settings.HeartbeatSeconds) : 5;
            try { await Task.Delay(TimeSpan.FromSeconds(seconds), stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task<bool> BeatAsync(CancellationToken ct)
    {
        try
        {
            var printers = await _api.GetPrintersAsync(ct);
            var statuses = printers
                .Where(p => p.Enabled)
                .Select(p => (Printer: p, Status: MapPrinterStatus(p.PrinterName), Unreachable: _reachability.UnreachableReason(p.PrinterName)))
                .Where(x => x.Status is not null)
                .Take(20)
                // Installed but the driver can't open it: the Windows queue may still say "Ready".
                .Select(x => x.Unreachable is not null && x.Status == "READY"
                    ? new PrinterStatus(x.Printer.Id, "OFFLINE", x.Unreachable)
                    : new PrinterStatus(x.Printer.Id, x.Status!, null))
                .ToList();

            await _api.HeartbeatAsync(new HeartbeatRequest(
                AppVersion: typeof(App).Assembly.GetName().Version?.ToString(3),
                Printers: statuses), ct);

            _status.SetConnection(ConnectionState.Connected, $"Connected · {_status.ShopName ?? "Kagaz"}");
            return true;
        }
        catch (ApiException ex) when (ex.Code == "DEVICE_UNAUTHORIZED")
        {
            _status.SetConnection(ConnectionState.Unauthorized, "This PC is no longer paired — pair again");
            return false;
        }
        catch (ApiException ex)
        {
            _log.LogWarning("Heartbeat failed: {Code}", ex.Code);
            _status.SetConnection(ConnectionState.Offline, ex.Code == "NETWORK_ERROR" ? "Offline — retrying" : $"Server error ({ex.Code})");
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task<bool> CheckHealthAsync(CancellationToken ct)
    {
        try
        {
            var result = await _health.GetHealthAsync(ct);
            _status.SetConnection(ConnectionState.NotPaired, result.IsSuccess ? "Server reachable · not paired" : "Not paired · server unreachable");
            return result.IsSuccess;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>Windows queue state for a printer installed here; null if it isn't on this PC.</summary>
    private static string? MapPrinterStatus(string printerName)
    {
        try
        {
            using var server = new LocalPrintServer();
            using var queue = server.GetPrintQueue(printerName);
            queue.Refresh();
            if (queue.IsOffline || queue.IsNotAvailable) return "OFFLINE";
            if (queue.IsOutOfPaper || queue.IsPaperJammed) return "PAPER_OUT";
            if (queue.IsInError || queue.HasPaperProblem || queue.IsOutOfMemory) return "ERROR";
            return "READY";
        }
        catch
        {
            return null;
        }
    }
}

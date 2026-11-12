using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Logging;
using Velopack;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Self-update through Velopack (P5.4). The feed (<see cref="AgentSettings.UpdateFeedUrl"/>) is the
/// <c>releases</c> folder produced by <c>scripts/build-shop-agent-installer.ps1</c>, served over https or
/// shared as a folder. Only an installed copy can update; a dev build reports why not.
/// </summary>
public sealed class VelopackUpdateService : IUpdateService
{
    private readonly UpdateManager? _manager;
    private readonly ILogger<VelopackUpdateService> _log;
    private UpdateInfo? _pending;

    public VelopackUpdateService(AgentSettings settings, ILogger<VelopackUpdateService> log)
    {
        _log = log;
        if (string.IsNullOrWhiteSpace(settings.UpdateFeedUrl))
        {
            UnavailableReason = "No update feed is configured (UpdateFeedUrl in appsettings.json).";
            return;
        }
        try
        {
            var manager = new UpdateManager(settings.UpdateFeedUrl.Trim());
            if (!manager.IsInstalled)
            {
                UnavailableReason = "This copy of Kaggaz Shop was not installed with the installer, so it can't update itself.";
                return;
            }
            _manager = manager;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Update manager unavailable");
            UnavailableReason = $"Updates are unavailable ({ex.Message}).";
        }
    }

    public bool IsAvailable => _manager is not null;

    public string? UnavailableReason { get; }

    public async Task<UpdateCheck> CheckAsync(CancellationToken ct = default)
    {
        if (_manager is null) return new UpdateCheck(false, null, UnavailableReason ?? "Updates are unavailable.");
        _pending = await _manager.CheckForUpdatesAsync();
        if (_pending is null)
        {
            return new UpdateCheck(false, null, $"Kaggaz Shop {_manager.CurrentVersion} is up to date.");
        }
        var version = _pending.TargetFullRelease.Version.ToString();
        return new UpdateCheck(true, version, $"Version {version} is available.");
    }

    public async Task<bool> DownloadAndRestartAsync(IProgress<int>? progress = null, CancellationToken ct = default)
    {
        if (_manager is null) return false;
        _pending ??= await _manager.CheckForUpdatesAsync();
        if (_pending is null) return false;

        await _manager.DownloadUpdatesAsync(_pending, p => progress?.Report(p), ct);
        _log.LogInformation("Applying update {Version} and restarting", _pending.TargetFullRelease.Version);
        // Print attempts in flight are safe: state.json keeps their phase and reconciliation on the
        // next start resumes monitoring or reports UNCERTAIN — never reprints (invariant 8).
        _manager.ApplyUpdatesAndRestart(_pending.TargetFullRelease);
        return true;
    }
}

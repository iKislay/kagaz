using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Keeps every shop on the latest Kaggaz Shop without anyone clicking anything: checks the update
/// feed shortly after start and then every few hours, downloads in the background, and restarts into
/// the new version only while this PC has no print attempt in flight (so a print is never cut off).
/// The operator stays signed in across the restart (saved session), and the app starts straight back.
/// </summary>
public sealed class AutoUpdateService : BackgroundService
{
    private static readonly TimeSpan FirstCheck = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan CheckEvery = TimeSpan.FromHours(3);
    private static readonly TimeSpan IdleRetry = TimeSpan.FromSeconds(30);

    private readonly IUpdateService _updates;
    private readonly AgentStateStore _state;
    private readonly AppStatus _status;
    private readonly ILogger<AutoUpdateService> _log;

    public AutoUpdateService(IUpdateService updates, AgentStateStore state, AppStatus status, ILogger<AutoUpdateService> log)
    {
        _updates = updates;
        _state = state;
        _status = status;
        _log = log;
    }

    /// <summary>No lease held or print being submitted / monitored on this PC (pure; unit tested).</summary>
    public static bool IsIdle(AgentState state) => !state.Jobs.Values.Any(LocalQueue.IsActive);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_updates.IsAvailable) return; // dev build or no feed configured
        try
        {
            await Task.Delay(FirstCheck, stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (await _updates.DownloadAsync(stoppingToken))
                    {
                        while (!IsIdle(_state.Load())) await Task.Delay(IdleRetry, stoppingToken);
                        _status.ShowToast("Updating Kaggaz Shop", "The app restarts by itself in a few seconds.");
                        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                        if (IsIdle(_state.Load())) _updates.ApplyDownloadedAndRestart();
                        else continue; // a print started during the countdown: wait for it, then retry
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _log.LogWarning(ex, "Auto-update check failed; retrying later");
                }
                await Task.Delay(CheckEvery, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // app closing
        }
    }
}

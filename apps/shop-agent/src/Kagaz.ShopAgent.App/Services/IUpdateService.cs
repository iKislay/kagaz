namespace Kagaz.ShopAgent.App.Services;

/// <summary>Result of an update check.</summary>
public sealed record UpdateCheck(bool Available, string? Version, string Message);

/// <summary>App self-update (P5.4). Implemented with Velopack; disabled when not installed or no feed is set.</summary>
public interface IUpdateService
{
    /// <summary>True when updates can be checked (installed via the Velopack installer and a feed is configured).</summary>
    bool IsAvailable { get; }

    /// <summary>Why updates are unavailable (for Settings / the banner).</summary>
    string? UnavailableReason { get; }

    Task<UpdateCheck> CheckAsync(CancellationToken ct = default);

    /// <summary>Downloads the pending update and restarts into it. Returns false if there was nothing to apply.</summary>
    Task<bool> DownloadAndRestartAsync(IProgress<int>? progress = null, CancellationToken ct = default);

    /// <summary>Background auto-update step 1: download the pending update. False if there is none.</summary>
    Task<bool> DownloadAsync(CancellationToken ct = default);

    /// <summary>Background auto-update step 2: restart into the downloaded update (call only when idle).</summary>
    void ApplyDownloadedAndRestart();
}

/// <summary>Used when the app is not installed through the installer (e.g. a dev build).</summary>
public sealed class NoUpdateService : IUpdateService
{
    public bool IsAvailable => false;
    public string? UnavailableReason => "Updates are installed by the Kaggaz Shop installer; this copy was not installed with it.";
    public Task<UpdateCheck> CheckAsync(CancellationToken ct = default) =>
        Task.FromResult(new UpdateCheck(false, null, UnavailableReason!));
    public Task<bool> DownloadAndRestartAsync(IProgress<int>? progress = null, CancellationToken ct = default) =>
        Task.FromResult(false);
    public Task<bool> DownloadAsync(CancellationToken ct = default) => Task.FromResult(false);
    public void ApplyDownloadedAndRestart() { }
}

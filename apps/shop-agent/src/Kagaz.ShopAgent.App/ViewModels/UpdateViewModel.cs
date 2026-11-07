using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// The blocking "Update required" banner (P4.4) and update checks (P5.4). Shown when the heartbeat says
/// <c>upgradeRequired</c> or any call answered <c>426 AGENT_UPGRADE_REQUIRED</c>; it clears itself when the
/// server stops saying so. While it shows, the print worker starts no new prints.
/// </summary>
public sealed partial class UpdateViewModel : ObservableObject
{
    private readonly IUpdateService _updates;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(InstallUpdateCommand), nameof(CheckForUpdatesCommand))]
    private bool _isWorking;

    [ObservableProperty]
    private string? _message;

    public UpdateViewModel(IUpdateService updates, AppStatus status, AgentSettings settings)
    {
        _updates = updates;
        Status = status;
        CurrentVersion = settings.AppVersion;
    }

    public AppStatus Status { get; }
    public string CurrentVersion { get; }
    public bool CanSelfUpdate => _updates.IsAvailable;
    public string? UnavailableReason => _updates.UnavailableReason;

    private bool CanRun() => !IsWorking && _updates.IsAvailable;

    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task CheckForUpdatesAsync()
    {
        IsWorking = true;
        try
        {
            var check = await _updates.CheckAsync();
            Message = check.Message;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Message = $"Could not check for updates ({ex.Message}).";
        }
        finally
        {
            IsWorking = false;
        }
    }

    [RelayCommand(CanExecute = nameof(CanRun))]
    private async Task InstallUpdateAsync()
    {
        IsWorking = true;
        Message = "Downloading the update…";
        try
        {
            var progress = new Progress<int>(p => Message = $"Downloading the update… {p}%");
            if (!await _updates.DownloadAndRestartAsync(progress))
            {
                Message = "No newer version is available yet. Ask the Kagaz team to publish the update.";
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Message = $"The update failed ({ex.Message}).";
        }
        finally
        {
            IsWorking = false;
        }
    }
}

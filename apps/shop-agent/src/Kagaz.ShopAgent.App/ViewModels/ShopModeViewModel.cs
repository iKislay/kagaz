using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Approval mode (P2.6, ADR-002): a shop setting on the Settings page — Manual | Auto segmented control plus a
/// "Pause auto-accept" switch — and a small read-only indicator in the sidebar. Changes call <c>PATCH /api/shop/mode</c> (operator action, audited server-side);
/// the displayed state always comes back from the server — the heartbeat's <c>shop</c> block every 15 s
/// and the <c>shop.mode_changed</c> socket hint — so a change made elsewhere (admin, another counter)
/// shows up here. Server updates never trigger a PATCH.
/// </summary>
public sealed partial class ShopModeViewModel : ObservableObject
{
    public const string ManualLabel = "Manual";
    public const string AutoLabel = "Auto";

    private readonly ShopApiClient _api;
    private bool _applyingServerState;

    [ObservableProperty]
    private string? _selectedMode;

    [ObservableProperty]
    private bool _autoPaused;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanChange))]
    private bool _isBusy;

    public ShopModeViewModel(ShopApiClient api, AppStatus status)
    {
        _api = api;
        Status = status;
        ApplyServerState();
        status.PropertyChanged += OnStatusChanged;
    }

    public AppStatus Status { get; }

    public IReadOnlyList<string> Modes { get; } = [ManualLabel, AutoLabel];

    /// <summary>Known server state + a signed-in operator + nothing in flight.</summary>
    public bool CanChange => !IsBusy && Status.IsPaired && Status.IsOperatorSignedIn && Status.ApprovalMode is not null;

    public bool IsVisible => Status.IsPaired;

    public bool IsAuto => SelectedMode == AutoLabel;

    public string Hint => Status.ApprovalMode is null
        ? "Waiting for the server…"
        : !Status.IsOperatorSignedIn
            ? "Sign in to change"
            : Status.ApprovalMode == ApprovalMode.Auto
                ? Status.AutoPaused ? "Auto-accept paused — new orders wait for you to accept them" : "Paid orders print automatically when the printer can do them"
                : "Every order waits for you to accept it";

    /// <summary>Read-only sidebar indicator: "Auto", "Auto · paused", "Manual" or "—" before the server answers.</summary>
    public string Indicator => Status.ApprovalMode switch
    {
        ApprovalMode.Auto => Status.AutoPaused ? "Auto · paused" : "Auto",
        ApprovalMode.Manual => "Manual",
        _ => "—",
    };

    /// <summary>
    /// <c>GET /shop/mode</c> when the Settings page opens, so it shows the server's state right away (the
    /// heartbeat refreshes it every 15 s anyway). Applied as server state: it never triggers a PATCH.
    /// </summary>
    public async Task LoadAsync()
    {
        if (!Status.IsPaired || IsBusy) return;
        try
        {
            var mode = await _api.GetModeAsync();
            if (!IsBusy) Status.ApplyShopState(mode.ApprovalMode, mode.AutoPaused);
        }
        catch (Exception ex) when (ex is ApiException or System.Text.Json.JsonException)
        {
            // Older API, offline or an unexpected body: the heartbeat keeps the state current.
        }
    }

    partial void OnSelectedModeChanged(string? oldValue, string? newValue)
    {
        OnPropertyChanged(nameof(IsAuto));
        if (_applyingServerState || newValue is null || oldValue is null) return;
        _ = SendAsync(new ShopModeRequest(newValue == AutoLabel ? ApprovalMode.Auto : ApprovalMode.Manual, null));
    }

    partial void OnAutoPausedChanged(bool value)
    {
        if (_applyingServerState) return;
        _ = SendAsync(new ShopModeRequest(null, value));
    }

    /// <summary>PATCH the mode; on failure snap back to the last server state.</summary>
    public async Task SendAsync(ShopModeRequest request)
    {
        if (!CanChange)
        {
            ApplyServerState();
            return;
        }
        IsBusy = true;
        try
        {
            var result = await _api.SetModeAsync(request, idempotencyKey: Guid.NewGuid().ToString());
            Status.ApplyShopState(result.ApprovalMode, result.AutoPaused);
            Status.ShowToast(result.ApprovalMode == ApprovalMode.Auto
                ? result.AutoPaused ? "Auto-accept paused" : "Auto mode on"
                : "Manual mode on");
        }
        catch (ApiException ex)
        {
            Status.ShowToast("Could not change the approval mode",
                ex.Code == ApiErrorCodes.OperatorLoginRequired ? "Sign in again and retry." : ex.Message, warning: true);
        }
        finally
        {
            IsBusy = false;
            ApplyServerState();
        }
    }

    private void OnStatusChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppStatus.ApprovalMode):
            case nameof(AppStatus.AutoPaused):
                if (!IsBusy) ApplyServerState();
                OnPropertyChanged(nameof(CanChange));
                OnPropertyChanged(nameof(Hint));
                OnPropertyChanged(nameof(Indicator));
                break;
            case nameof(AppStatus.IsPaired):
            case nameof(AppStatus.OperatorName):
                OnPropertyChanged(nameof(CanChange));
                OnPropertyChanged(nameof(IsVisible));
                OnPropertyChanged(nameof(Hint));
                break;
        }
    }

    private void ApplyServerState()
    {
        _applyingServerState = true;
        try
        {
            SelectedMode = Status.ApprovalMode switch
            {
                ApprovalMode.Auto => AutoLabel,
                ApprovalMode.Manual => ManualLabel,
                _ => null,
            };
            AutoPaused = Status.AutoPaused;
        }
        finally
        {
            _applyingServerState = false;
        }
        OnPropertyChanged(nameof(Hint));
    }
}

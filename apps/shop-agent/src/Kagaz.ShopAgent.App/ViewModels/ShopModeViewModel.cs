using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// The shop's two daily switches on the Settings page, with read-only indicators in the sidebar:
/// whether it takes orders (Open | Closed | Maintenance) and how (Manual | Auto approval, ADR-002).
/// Changes call <c>PATCH /api/shop/mode</c> (operator action, audited server-side); the displayed state
/// always comes back from the server — the heartbeat's <c>shop</c> block every 15 s and the
/// <c>shop.mode_changed</c> socket hint — so a change made elsewhere shows up here. Server updates never
/// trigger a PATCH. The server's "auto paused" flag is shown as Manual (it behaves the same), and choosing
/// Auto clears it.
/// </summary>
public sealed partial class ShopModeViewModel : ObservableObject
{
    public const string ManualLabel = "Manual";
    public const string AutoLabel = "Auto";
    public const string OpenLabel = "Open";
    public const string ClosedLabel = "Closed";
    public const string MaintenanceLabel = "Maintenance";

    private readonly ShopApiClient _api;
    private bool _applyingServerState;

    [ObservableProperty]
    private string? _selectedMode;

    [ObservableProperty]
    private string? _selectedStatus;

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

    public IReadOnlyList<string> Statuses { get; } = [OpenLabel, ClosedLabel, MaintenanceLabel];

    /// <summary>Known server state + a signed-in operator + nothing in flight.</summary>
    public bool CanChange => !IsBusy && Status.IsPaired && Status.IsOperatorSignedIn && Status.ApprovalMode is not null;

    public bool IsVisible => Status.IsPaired;

    private bool EffectiveAuto => Status.ApprovalMode == ApprovalMode.Auto && !Status.AutoPaused;

    public string Hint => Status.ApprovalMode is null
        ? "Waiting for the server…"
        : !Status.IsOperatorSignedIn
            ? "Sign in to change"
            : EffectiveAuto
                ? "Paid orders print automatically when the printer can do them. Orders it can't do (colour on a black & white printer, too large, printer offline) still wait for you."
                : "Every order waits for you to accept it.";

    public string StatusHint => Status.ShopOpenStatus switch
    {
        "OPEN" => "Customers can send you orders.",
        "MAINTENANCE" => "Customers see that the shop is under maintenance and can't order.",
        "CLOSED" => "Customers can't send new orders. Orders already placed still print.",
        _ => "Waiting for the server…",
    };

    /// <summary>Read-only sidebar indicator: "Auto", "Manual" or "—" before the server answers.</summary>
    public string Indicator => Status.ApprovalMode is null ? "—" : EffectiveAuto ? AutoLabel : ManualLabel;

    /// <summary>Read-only sidebar indicator: "Open", "Closed", "Maintenance" or "—".</summary>
    public string StatusIndicator => StatusLabel(Status.ShopOpenStatus) ?? "—";

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
            if (!IsBusy) Status.ApplyShopState(mode.ApprovalMode, mode.AutoPaused, mode.Status);
        }
        catch (Exception ex) when (ex is ApiException or System.Text.Json.JsonException)
        {
            // Older API, offline or an unexpected body: the heartbeat keeps the state current.
        }
    }

    partial void OnSelectedModeChanged(string? oldValue, string? newValue)
    {
        if (_applyingServerState || newValue is null || oldValue is null) return;
        _ = SendAsync(newValue == AutoLabel
            ? new ShopModeRequest(ApprovalMode.Auto, false)
            : new ShopModeRequest(ApprovalMode.Manual, false));
    }

    partial void OnSelectedStatusChanged(string? oldValue, string? newValue)
    {
        if (_applyingServerState || newValue is null || oldValue is null) return;
        _ = SendAsync(new ShopModeRequest(null, null, newValue switch
        {
            OpenLabel => "OPEN",
            MaintenanceLabel => "MAINTENANCE",
            _ => "CLOSED",
        }));
    }

    /// <summary>PATCH the mode or status; on failure snap back to the last server state.</summary>
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
            Status.ApplyShopState(result.ApprovalMode, result.AutoPaused, result.Status);
            Status.ShowToast(request.Status is not null
                ? (result.Status ?? request.Status) switch
                {
                    "OPEN" => "Shop is open",
                    "MAINTENANCE" => "Shop is under maintenance",
                    _ => "Shop is closed",
                }
                : result.ApprovalMode == ApprovalMode.Auto && !result.AutoPaused ? "Auto mode on" : "Manual mode on");
        }
        catch (ApiException ex)
        {
            Status.ShowToast(request.Status is not null ? "Could not change the shop status" : "Could not change the approval mode",
                ex.Code == ApiErrorCodes.OperatorLoginRequired ? "Sign in again and retry." : ex.Message, warning: true);
        }
        finally
        {
            IsBusy = false;
            ApplyServerState();
        }
    }

    private static string? StatusLabel(string? status) => status switch
    {
        "OPEN" => OpenLabel,
        "CLOSED" => ClosedLabel,
        "MAINTENANCE" => MaintenanceLabel,
        _ => null,
    };

    private void OnStatusChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppStatus.ApprovalMode):
            case nameof(AppStatus.AutoPaused):
            case nameof(AppStatus.ShopOpenStatus):
                if (!IsBusy) ApplyServerState();
                OnPropertyChanged(nameof(CanChange));
                OnPropertyChanged(nameof(Indicator));
                OnPropertyChanged(nameof(StatusIndicator));
                OnPropertyChanged(nameof(StatusHint));
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
            SelectedMode = Status.ApprovalMode is null ? null : EffectiveAuto ? AutoLabel : ManualLabel;
            SelectedStatus = StatusLabel(Status.ShopOpenStatus);
        }
        finally
        {
            _applyingServerState = false;
        }
        OnPropertyChanged(nameof(Hint));
    }
}

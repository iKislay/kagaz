using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Source-list sidebar entry. <paramref name="icon"/> is a Segoe Fluent Icons line glyph;
/// <paramref name="page"/> is the page view model shown in the content area.
/// <paramref name="requiresOperator"/> pages show the operator sign-in until someone signs in (P2.3).
/// <see cref="Badge"/> is a count pill on the right (e.g. payment checks waiting).
/// </summary>
public sealed partial class NavigationItem : ObservableObject
{
    public NavigationItem(string title, string icon, string subtitle, object page, bool requiresOperator = false)
    {
        Title = title;
        Icon = icon;
        Subtitle = subtitle;
        Page = page;
        RequiresOperator = requiresOperator;
    }

    public string Title { get; }
    public string Icon { get; }
    public string Subtitle { get; }
    public object Page { get; }
    public bool RequiresOperator { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(BadgeText))]
    private int _badge;

    /// <summary>"3", "99+", or null (no pill) when zero.</summary>
    public string? BadgeText => Badge <= 0 ? null : Badge > 99 ? "99+" : Badge.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Used as the accessible name of the sidebar row.</summary>
    public override string ToString() => Badge > 0 ? $"{Title}, {Badge} waiting" : Title;
}

/// <summary>
/// Window shell: sidebar navigation, connection indicator, signed-in operator, read-only
/// approval-mode indicator (changed in Settings, ADR-002), update-required banner (P4.4), toasts.
/// </summary>
public sealed partial class ShellViewModel : ObservableObject
{
    private readonly ShopApiClient _api;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CurrentPage))]
    private NavigationItem? _selectedNavigation;

    public ShellViewModel(
        AppStatus status,
        ShopApiClient api,
        PairingViewModel pairing,
        OperatorLoginViewModel login,
        PrintersViewModel printers,
        JobsViewModel jobs,
        TodaysPickupsViewModel pickups,
        SettingsViewModel settings,
        PaymentsViewModel payments,
        ShopModeViewModel mode,
        UpdateViewModel update)
    {
        _api = api;
        Status = status;
        Login = login;
        Mode = mode;
        Update = update;
        Payments = payments;
        Version = typeof(ShellViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        WindowTitle = "Kagaz Shop";

        NavigationItems =
        [
            new NavigationItem("Jobs", "", "Paid orders to accept, print and hand over.", jobs, requiresOperator: true),
            new NavigationItem("Today's pickups", "", "Today's paid orders by pickup number.", pickups, requiresOperator: true),
            new NavigationItem("Payments", "", "UPI setup, customers who say they paid, refunds to send.", payments, requiresOperator: true),
            new NavigationItem("Printers", "", "Printers on this PC and what they can do.", printers, requiresOperator: true),
            new NavigationItem("Pairing", "", "Connect this PC to your Kagaz shop.", pairing),
            new NavigationItem("Settings", "", "Order approval, connection and app details.", settings),
        ];
        Jobs = NavigationItems[0];
        PaymentsItem = NavigationItems[2];
        Printers = NavigationItems[3];
        Pairing = NavigationItems[4];
        Settings = NavigationItems[5];

        SelectedNavigation = status.IsPaired ? Jobs : Pairing;

        // After pairing, set up printers first (behind the sign-in); after unpairing/revoke, back to pairing.
        status.Paired += () => SelectedNavigation = Printers;
        status.Unpaired += () => SelectedNavigation = Pairing;
        status.PropertyChanged += OnStatusChanged;
        payments.PropertyChanged += OnPaymentsChanged;
    }

    public AppStatus Status { get; }
    public OperatorLoginViewModel Login { get; }
    public ShopModeViewModel Mode { get; }
    public UpdateViewModel Update { get; }
    public PaymentsViewModel Payments { get; }
    public string Version { get; }
    public string WindowTitle { get; }
    public IReadOnlyList<NavigationItem> NavigationItems { get; }

    private NavigationItem Jobs { get; }
    private NavigationItem Printers { get; }
    private NavigationItem Pairing { get; }
    private NavigationItem Settings { get; }
    private NavigationItem PaymentsItem { get; }

    /// <summary>
    /// Window notice when customers say they paid or refunds are waiting (ADR-003); hidden on the
    /// Payments page itself.
    /// </summary>
    public string? PaymentsAttention => IsPaymentsShown ? null : Payments.AttentionText;

    private bool IsPaymentsShown => ReferenceEquals(CurrentPage, Payments);

    [RelayCommand]
    private void OpenPayments() => SelectedNavigation = PaymentsItem;

    partial void OnSelectedNavigationChanged(NavigationItem? value)
    {
        // Show the server's approval mode as soon as Settings opens (never PATCHes).
        if (value is not null && ReferenceEquals(value, Settings)) _ = Mode.LoadAsync();
        SyncPaymentsPage();
    }

    /// <summary>Tell the Payments page whether it is on screen (setup refresh) and update the notice.</summary>
    private void SyncPaymentsPage()
    {
        Payments.IsActive = IsPaymentsShown;
        OnPropertyChanged(nameof(PaymentsAttention));
    }

    private void OnPaymentsChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(PaymentsViewModel.BadgeCount) or nameof(PaymentsViewModel.AttentionText))
        {
            PaymentsItem.Badge = Payments.BadgeCount;
            OnPropertyChanged(nameof(PaymentsAttention));
        }
    }

    /// <summary>
    /// The page to show. Operator pages need a paired PC and a signed-in operator: otherwise the
    /// pairing screen or the operator sign-in is shown in their place.
    /// </summary>
    public object? CurrentPage => SelectedNavigation switch
    {
        null => null,
        { RequiresOperator: true } when !Status.IsPaired => Pairing.Page,
        { RequiresOperator: true } when !Status.IsOperatorSignedIn => Login,
        var item => item.Page,
    };

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _api.OperatorLogoutAsync();
        Status.ShowToast("Signed out", "Printing of accepted jobs continues.");
    }

    private void OnStatusChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppStatus.IsPaired) or nameof(AppStatus.OperatorName))
        {
            OnPropertyChanged(nameof(CurrentPage));
            SyncPaymentsPage();
        }
    }
}

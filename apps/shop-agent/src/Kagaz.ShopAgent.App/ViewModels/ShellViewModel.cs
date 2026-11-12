using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Source-list sidebar entry. <paramref name="Icon"/> is a Segoe Fluent Icons line glyph;
/// <paramref name="Page"/> is the page view model shown in the content area.
/// <paramref name="RequiresOperator"/> pages show the operator sign-in until someone signs in (P2.3);
/// <paramref name="OwnerOnly"/> pages are listed only while the shop owner is signed in.
/// </summary>
public sealed record NavigationItem(string Title, string Icon, string Subtitle, object Page, bool RequiresOperator = false,
    bool OwnerOnly = false)
{
    /// <summary>Used as the accessible name of the sidebar row.</summary>
    public override string ToString() => Title;
}

/// <summary>
/// Window shell: sidebar navigation, connection indicator, signed-in operator, read-only
/// approval-mode indicator (changed in Settings, ADR-002), billing notice + subscription sheet,
/// update-required banner (P4.4), toasts.
/// </summary>
public sealed partial class ShellViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly ShopQrViewModel _qr;
    private readonly StaffViewModel _staff;
    private readonly PricesViewModel _prices;
    private readonly SupportViewModel _support;

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
        ShopQrViewModel qr,
        SettingsViewModel settings,
        ShopModeViewModel mode,
        UpdateViewModel update,
        SupportViewModel support,
        StaffViewModel staff,
        PricesViewModel prices)
    {
        _ = support.LoadAsync();
        status.Paired += () => _ = support.LoadAsync();
        _api = api;
        _qr = qr;
        _staff = staff;
        _prices = prices;
        _support = support;
        Status = status;
        Login = login;
        Mode = mode;
        Update = update;
        Subscription = new SubscriptionPromptViewModel(support);
        Version = typeof(ShellViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        WindowTitle = "Kaggaz Shop";

        NavigationItems =
        [
            new NavigationItem("Jobs", "", "Paid orders to accept, print and hand over.", jobs, RequiresOperator: true),
            new NavigationItem("Today's pickups", "", "Today's paid orders by pickup number.", pickups, RequiresOperator: true),
            new NavigationItem("Printers", "", "Printers on this PC and what they can do.", printers, RequiresOperator: true),
            new NavigationItem("Shop QR code", "", "The scan-to-print poster for your counter.", qr),
            new NavigationItem("Staff", "", "Who can sign in to this shop.", staff, RequiresOperator: true, OwnerOnly: true),
            new NavigationItem("Prices", "", "What customers pay per printed side.", prices, RequiresOperator: true, OwnerOnly: true),
            new NavigationItem("This PC", "", "Connect this PC to your Kaggaz shop.", pairing),
            new NavigationItem("Settings", "", "Order approval, connection and app details.", settings),
        ];
        Jobs = NavigationItems[0];
        Printers = NavigationItems[2];
        Pairing = NavigationItems[6];
        Settings = NavigationItems[7];

        SelectedNavigation = status.IsPaired ? Jobs : Pairing;

        // After pairing, set up printers first (behind the sign-in); after unpairing/revoke, back to pairing.
        status.Paired += () => SelectedNavigation = Printers;
        status.Unpaired += () => SelectedNavigation = Pairing;
        status.PropertyChanged += OnStatusChanged;
        support.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SupportViewModel.ContactLine)) OnPropertyChanged(nameof(BillingNotice));
        };
        // A call refused for billing opens the subscription sheet, whatever page it came from.
        status.Session.SubscriptionInactive += () => status.RunOnUi(Subscription.ForceOpen);
    }

    public AppStatus Status { get; }
    public OperatorLoginViewModel Login { get; }
    public ShopModeViewModel Mode { get; }
    public UpdateViewModel Update { get; }
    public string Version { get; }
    public string WindowTitle { get; }
    public IReadOnlyList<NavigationItem> NavigationItems { get; }

    /// <summary>"Get a Kaggaz subscription" sheet.</summary>
    public SubscriptionPromptViewModel Subscription { get; }

    /// <summary>Calm notice bar while the shop can't take orders (activation pending, expired, ending soon).</summary>
    public string? BillingNotice =>
        BillingText.Notice(Status.IsPaired, Status.ShopOpenStatus, Status.Subscription, _support.ContactLine);

    /// <summary>Sidebar rows: owner-only pages appear only while the owner is signed in.</summary>
    public IReadOnlyList<NavigationItem> VisibleNavigationItems =>
        NavigationItems.Where(i => !i.OwnerOnly || Status.IsOwner).ToList();

    private NavigationItem Jobs { get; }
    private NavigationItem Printers { get; }
    private NavigationItem Pairing { get; }
    private NavigationItem Settings { get; }

    partial void OnSelectedNavigationChanged(NavigationItem? value)
    {
        // Show the server's approval mode as soon as Settings opens (never PATCHes).
        if (value is not null && ReferenceEquals(value, Settings)) _ = Mode.LoadAsync();
        LoadPage(value);
    }

    private void LoadPage(NavigationItem? item)
    {
        if (item is null) return;
        if (ReferenceEquals(item.Page, _qr)) _ = _qr.LoadAsync();
        // Owner pages need the owner signed in; they load again once someone signs in.
        if (!Status.IsOwner) return;
        if (ReferenceEquals(item.Page, _staff)) _ = _staff.LoadAsync();
        if (ReferenceEquals(item.Page, _prices)) _ = _prices.LoadAsync();
    }

    /// <summary>
    /// The page to show. Operator pages need a paired PC and a signed-in operator: otherwise the
    /// pairing screen or the operator sign-in is shown in their place. Owner pages need the owner.
    /// </summary>
    public object? CurrentPage => SelectedNavigation switch
    {
        null => null,
        { RequiresOperator: true } when !Status.IsPaired => Pairing.Page,
        { RequiresOperator: true } when !Status.IsOperatorSignedIn => Login,
        { OwnerOnly: true } when !Status.IsOwner => Login,
        var item => item.Page,
    };

    [RelayCommand]
    private void OpenSubscription() => Subscription.ForceOpen();

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _api.OperatorLogoutAsync();
        Status.ShowToast("Signed out", "Printing of accepted jobs continues.");
    }

    private void OnStatusChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppStatus.IsPaired) or nameof(AppStatus.OperatorName) or nameof(AppStatus.OperatorRole))
        {
            OnPropertyChanged(nameof(CurrentPage));
            OnPropertyChanged(nameof(VisibleNavigationItems));
            if (e.PropertyName != nameof(AppStatus.IsPaired)) LoadPage(SelectedNavigation);
        }
        if (e.PropertyName is nameof(AppStatus.IsPaired) or nameof(AppStatus.ShopOpenStatus) or nameof(AppStatus.Subscription))
        {
            OnPropertyChanged(nameof(BillingNotice));
            if (Status.IsPaired) Subscription.Observe(Status.Subscription);
        }
    }
}

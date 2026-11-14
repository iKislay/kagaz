using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Source-list sidebar entry. <paramref name="Icon"/> is a Segoe Fluent Icons line glyph;
/// <paramref name="Page"/> is the page view model shown in the content area.
/// <paramref name="OwnerOnly"/> pages are listed only while the shop owner is signed in.
/// </summary>
public sealed record NavigationItem(string Title, string Icon, string Subtitle, object Page, bool OwnerOnly = false)
{
    /// <summary>Used as the accessible name of the sidebar row.</summary>
    public override string ToString() => Title;
}

/// <summary>
/// Window shell. Until the shop is ready (<see cref="AppGates"/>: connected, someone signed in, setup
/// finished, subscription active) a single full-window screen is shown and no page is reachable.
/// Then: sidebar navigation, connection indicator, signed-in operator, approval-mode indicator,
/// billing notice, update-required banner (P4.4), toasts. Printing of accepted jobs runs in the
/// background whatever is on screen.
/// </summary>
public sealed partial class ShellViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly ShopQrViewModel _qr;
    private readonly StaffViewModel _staff;
    private readonly PricesViewModel _prices;
    private readonly SupportViewModel _support;

    [ObservableProperty]
    private NavigationItem? _selectedNavigation;

    public ShellViewModel(
        AppStatus status,
        ShopApiClient api,
        PairingViewModel pairing,
        OperatorLoginViewModel login,
        SetupViewModel setup,
        SubscriptionViewModel subscription,
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
        _api = api;
        _qr = qr;
        _staff = staff;
        _prices = prices;
        _support = support;
        Status = status;
        Pairing = pairing;
        Login = login;
        Setup = setup;
        Subscription = subscription;
        Mode = mode;
        Update = update;
        Version = typeof(ShellViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        NavigationItems =
        [
            new NavigationItem("Jobs", "", "Paid orders to accept, print and hand over.", jobs),
            new NavigationItem("Today's pickups", "", "Today's paid orders by pickup number.", pickups),
            new NavigationItem("Printers", "", "Printers on this PC and what they can do.", printers),
            new NavigationItem("Shop QR code", "", "The scan-to-print poster for your counter.", qr),
            new NavigationItem("Staff", "", "Who can sign in to this shop.", staff, OwnerOnly: true),
            new NavigationItem("Prices", "", "What customers pay per printed side.", prices, OwnerOnly: true),
            new NavigationItem("This PC", "", "This PC's connection to your Kaggaz shop.", pairing),
            new NavigationItem("Settings", "", "Order approval, connection and app details.", settings),
        ];
        _jobs = NavigationItems[0];
        _printersItem = NavigationItems[2];
        _settingsItem = NavigationItems[7];
        _selectedNavigation = _jobs;

        _ = support.LoadAsync();
        status.Paired += () =>
        {
            _ = support.LoadAsync();
            SelectedNavigation = _printersItem; // a new PC sets up its printers first
        };
        status.PropertyChanged += OnStatusChanged;
        support.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SupportViewModel.ContactLine)) OnPropertyChanged(nameof(BillingNotice));
        };
        if (status.IsOperatorSignedIn) _ = setup.LoadAsync(); // session restored from disk
    }

    private readonly NavigationItem _jobs;
    private readonly NavigationItem _printersItem;
    private readonly NavigationItem _settingsItem;

    public AppStatus Status { get; }
    public PairingViewModel Pairing { get; }
    public OperatorLoginViewModel Login { get; }
    public SetupViewModel Setup { get; }
    public SubscriptionViewModel Subscription { get; }
    public ShopModeViewModel Mode { get; }
    public UpdateViewModel Update { get; }
    public string Version { get; }
    public string WindowTitle => "Kaggaz Shop";
    public IReadOnlyList<NavigationItem> NavigationItems { get; }

    public AppGate Gate => AppGates.Resolve(Status.IsPaired, Status.IsOperatorSignedIn, Status.ShopSetupComplete,
        Status.Subscription?.Status);

    public bool IsReady => Gate == AppGate.Ready;

    /// <summary>The full-window screen while the shop isn't ready; null once it is.</summary>
    public object? GatePage => Gate switch
    {
        AppGate.Connect => Pairing,
        AppGate.SignIn => Login,
        AppGate.Setup => Setup,
        AppGate.Subscription => Subscription,
        _ => null,
    };

    /// <summary>Calm notice bar inside the app (subscription ending soon, shop closed).</summary>
    public string? BillingNotice => BillingText.Notice(Status.ShopOpenStatus, Status.Subscription, _support.ContactLine);

    /// <summary>Sidebar rows: owner-only pages appear only while the owner is signed in.</summary>
    public IReadOnlyList<NavigationItem> VisibleNavigationItems =>
        NavigationItems.Where(i => !i.OwnerOnly || Status.IsOwner).ToList();

    public object? CurrentPage => SelectedNavigation?.Page;

    partial void OnSelectedNavigationChanged(NavigationItem? value)
    {
        OnPropertyChanged(nameof(CurrentPage));
        if (value is null) return;
        if (ReferenceEquals(value, _settingsItem)) _ = Mode.LoadAsync(); // the server's approval mode, never PATCHes
        if (ReferenceEquals(value.Page, _qr)) _ = _qr.LoadAsync();
        if (ReferenceEquals(value.Page, _staff)) _ = _staff.LoadAsync();
        if (ReferenceEquals(value.Page, _prices)) _ = _prices.LoadAsync();
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _api.OperatorLogoutAsync();
        Status.ShowToast("Signed out", "Printing of accepted jobs continues.");
    }

    private void OnStatusChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(AppStatus.OperatorName):
                // Someone else may sign in next: start them on Jobs, and refresh the shop's setup state.
                SelectedNavigation = _jobs;
                if (Status.IsOperatorSignedIn) _ = Setup.LoadAsync();
                break;
            case nameof(AppStatus.OperatorRole):
                OnPropertyChanged(nameof(VisibleNavigationItems));
                break;
            case nameof(AppStatus.ShopOpenStatus):
                OnPropertyChanged(nameof(BillingNotice));
                return;
        }
        if (e.PropertyName is nameof(AppStatus.IsPaired) or nameof(AppStatus.OperatorName) or nameof(AppStatus.ShopSetupComplete)
            or nameof(AppStatus.Subscription))
        {
            OnPropertyChanged(nameof(Gate));
            OnPropertyChanged(nameof(IsReady));
            OnPropertyChanged(nameof(GatePage));
            OnPropertyChanged(nameof(BillingNotice));
        }
    }
}

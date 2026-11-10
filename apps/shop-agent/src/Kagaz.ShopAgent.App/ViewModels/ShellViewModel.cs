using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Source-list sidebar entry. <paramref name="Icon"/> is a Segoe Fluent Icons line glyph;
/// <paramref name="Page"/> is the page view model shown in the content area.
/// <paramref name="RequiresOperator"/> pages show the operator sign-in until someone signs in (P2.3).
/// </summary>
public sealed record NavigationItem(string Title, string Icon, string Subtitle, object Page, bool RequiresOperator = false)
{
    /// <summary>Used as the accessible name of the sidebar row.</summary>
    public override string ToString() => Title;
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
        ShopModeViewModel mode,
        UpdateViewModel update)
    {
        _api = api;
        Status = status;
        Login = login;
        Mode = mode;
        Update = update;
        Version = typeof(ShellViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        WindowTitle = "Kagaz Shop";

        NavigationItems =
        [
            new NavigationItem("Jobs", "", "Paid orders to accept, print and hand over.", jobs, RequiresOperator: true),
            new NavigationItem("Today's pickups", "", "Today's paid orders by pickup number.", pickups, RequiresOperator: true),
            new NavigationItem("Printers", "", "Printers on this PC and what they can do.", printers, RequiresOperator: true),
            new NavigationItem("Pairing", "", "Connect this PC to your Kagaz shop.", pairing),
            new NavigationItem("Settings", "", "Order approval, connection and app details.", settings),
        ];
        Jobs = NavigationItems[0];
        Printers = NavigationItems[2];
        Pairing = NavigationItems[3];
        Settings = NavigationItems[4];

        SelectedNavigation = status.IsPaired ? Jobs : Pairing;

        // After pairing, set up printers first (behind the sign-in); after unpairing/revoke, back to pairing.
        status.Paired += () => SelectedNavigation = Printers;
        status.Unpaired += () => SelectedNavigation = Pairing;
        status.PropertyChanged += OnStatusChanged;
    }

    public AppStatus Status { get; }
    public OperatorLoginViewModel Login { get; }
    public ShopModeViewModel Mode { get; }
    public UpdateViewModel Update { get; }
    public string Version { get; }
    public string WindowTitle { get; }
    public IReadOnlyList<NavigationItem> NavigationItems { get; }

    private NavigationItem Jobs { get; }
    private NavigationItem Printers { get; }
    private NavigationItem Pairing { get; }
    private NavigationItem Settings { get; }

    partial void OnSelectedNavigationChanged(NavigationItem? value)
    {
        // Show the server's approval mode as soon as Settings opens (never PATCHes).
        if (value is not null && ReferenceEquals(value, Settings)) _ = Mode.LoadAsync();
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
        }
    }
}

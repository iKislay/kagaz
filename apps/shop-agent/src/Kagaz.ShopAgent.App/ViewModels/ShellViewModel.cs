using CommunityToolkit.Mvvm.ComponentModel;
using Kagaz.ShopAgent.App.Services;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Source-list sidebar entry. <paramref name="Icon"/> is a Segoe Fluent Icons line glyph;
/// <paramref name="Page"/> is the page view model shown in the content area.
/// </summary>
public sealed record NavigationItem(string Title, string Icon, string Subtitle, object Page)
{
    /// <summary>Used as the accessible name of the sidebar row.</summary>
    public override string ToString() => Title;
}

/// <summary>Window shell: sidebar navigation, connection indicator, toasts.</summary>
public sealed partial class ShellViewModel : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CurrentPage))]
    private NavigationItem? _selectedNavigation;

    public ShellViewModel(
        AppStatus status,
        PairingViewModel pairing,
        PrintersViewModel printers,
        JobsViewModel jobs,
        PickupViewModel pickup,
        SettingsViewModel settings)
    {
        Status = status;
        Version = typeof(ShellViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        WindowTitle = "Kagaz Shop";

        NavigationItems =
        [
            new NavigationItem("Jobs", "", "Paid orders to accept, print and hand over.", jobs),
            new NavigationItem("Pickup", "", "Verify a customer's pickup code.", pickup),
            new NavigationItem("Printers", "", "Printers on this PC and what they can do.", printers),
            new NavigationItem("Pairing", "", "Connect this PC to your Kagaz shop.", pairing),
            new NavigationItem("Settings", "", "Connection and app details.", settings),
        ];
        Jobs = NavigationItems[0];
        Printers = NavigationItems[2];
        Pairing = NavigationItems[3];

        SelectedNavigation = status.IsPaired ? Jobs : Pairing;

        // After pairing, set up printers first; after unpairing, back to pairing.
        status.Paired += () => SelectedNavigation = Printers;
        status.Unpaired += () => SelectedNavigation = Pairing;
    }

    public AppStatus Status { get; }
    public string Version { get; }
    public string WindowTitle { get; }
    public IReadOnlyList<NavigationItem> NavigationItems { get; }

    private NavigationItem Jobs { get; }
    private NavigationItem Printers { get; }
    private NavigationItem Pairing { get; }

    public object? CurrentPage => SelectedNavigation?.Page;
}

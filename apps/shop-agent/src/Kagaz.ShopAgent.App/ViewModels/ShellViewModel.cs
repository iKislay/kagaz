using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

public sealed class ShellViewModel : ObservableObject
{
    private static readonly Brush ConnectedBrush = new SolidColorBrush(Color.FromRgb(0x22, 0xC5, 0x5E));
    private static readonly Brush DisconnectedBrush = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush CheckingBrush = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B));

    private string _connectionText = "Checking connection...";
    private Brush _connectionBrush = CheckingBrush;
    private NavigationItem? _selectedNavigation;

    public ShellViewModel()
    {
        Version = GetVersion();
        WindowTitle = $"Kagaz Shop v{Version}";
        NavigationItems =
        [
            new NavigationItem("Pairing"),
            new NavigationItem("Jobs"),
            new NavigationItem("Pickup"),
            new NavigationItem("Printers"),
            new NavigationItem("Settings"),
        ];
        SelectedNavigation = NavigationItems[0];
    }

    public string Version { get; }
    public string WindowTitle { get; }
    public List<NavigationItem> NavigationItems { get; }

    public NavigationItem SelectedNavigation
    {
        get => _selectedNavigation!;
        set => SetProperty(ref _selectedNavigation, value);
    }

    public string ConnectionText
    {
        get => _connectionText;
        private set => SetProperty(ref _connectionText, value);
    }

    public Brush ConnectionBrush
    {
        get => _connectionBrush;
        private set => SetProperty(ref _connectionBrush, value);
    }

    public Task UpdateConnectionAsync(HealthResult result)
    {
        Dispatcher? dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            Apply(result);
            return Task.CompletedTask;
        }

        return dispatcher.InvokeAsync(() => Apply(result)).Task;
    }

    private void Apply(HealthResult result)
    {
        if (result.IsSuccess)
        {
            ConnectionText = "Connected";
            ConnectionBrush = ConnectedBrush;
        }
        else
        {
            ConnectionText = $"Disconnected: {result.FailureReason ?? "unknown error"}";
            ConnectionBrush = DisconnectedBrush;
        }
    }

    private static string GetVersion()
    {
        Version? version = typeof(ShellViewModel).Assembly.GetName().Version;
        return version is null ? "0.0.0" : version.ToString(3);
    }
}

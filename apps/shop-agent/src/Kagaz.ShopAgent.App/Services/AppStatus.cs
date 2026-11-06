using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.Services;

public enum ConnectionState
{
    Checking,
    Connected,
    NotPaired,
    Unauthorized,
    Offline,
}

public sealed record Toast(string Title, string? Detail, bool IsWarning);

/// <summary>
/// App-wide status shared by the shell, the pages and the background services (connection,
/// pairing, toasts). Exists so view models and hosted services never depend on each other.
/// Every mutation is marshalled to the UI thread.
/// </summary>
public sealed partial class AppStatus : ObservableObject
{
    private readonly ISecureStore _secureStore;
    private readonly AgentStateStore _stateStore;

    [ObservableProperty]
    private ConnectionState _connection = ConnectionState.Checking;

    [ObservableProperty]
    private string _connectionText = "Checking connection…";

    [ObservableProperty]
    private bool _isPaired;

    [ObservableProperty]
    private string? _shopName;

    [ObservableProperty]
    private bool _shopIsDemo;

    public AppStatus(ISecureStore secureStore, AgentStateStore stateStore)
    {
        _secureStore = secureStore;
        _stateStore = stateStore;
        var state = stateStore.Load();
        _isPaired = !string.IsNullOrEmpty(secureStore.Load());
        _shopName = _isPaired ? state.ShopName : null;
        _shopIsDemo = state.ShopIsDemo;
    }

    public ObservableCollection<Toast> Toasts { get; } = new();

    /// <summary>Raised on the UI thread after a successful pairing.</summary>
    public event Action? Paired;

    /// <summary>Raised on the UI thread after the operator unpairs this PC.</summary>
    public event Action? Unpaired;

    public void SetConnection(ConnectionState state, string text) => OnUi(() =>
    {
        Connection = state;
        ConnectionText = text;
    });

    public void ShowToast(string title, string? detail = null, bool warning = false) => OnUi(() =>
    {
        var toast = new Toast(title, detail, warning);
        Toasts.Add(toast);
        while (Toasts.Count > 4) Toasts.RemoveAt(0);
        _ = RemoveLaterAsync(toast);
    });

    public void MarkPaired(EnrollDeviceResponse response, string apiBaseUrl)
    {
        _secureStore.Save(response.DeviceToken);
        _stateStore.Update(s =>
        {
            s.ApiBaseUrl = apiBaseUrl;
            s.ShopName = response.Shop.Name;
            s.ShopIsDemo = response.Shop.IsDemo;
            s.DeviceName = response.Device.Name;
            // A new pairing starts clean: printers are re-registered for this shop.
            s.RegisteredPrinterNames.Clear();
        });
        OnUi(() =>
        {
            IsPaired = true;
            ShopName = response.Shop.Name;
            ShopIsDemo = response.Shop.IsDemo;
            Connection = ConnectionState.Checking;
            ConnectionText = "Connecting…";
            Paired?.Invoke();
        });
    }

    public void Unpair()
    {
        _secureStore.Delete();
        _stateStore.Update(s =>
        {
            s.ShopName = null;
            s.DeviceName = null;
            s.RegisteredPrinterNames.Clear();
        });
        OnUi(() =>
        {
            IsPaired = false;
            ShopName = null;
            Connection = ConnectionState.NotPaired;
            ConnectionText = "Not paired";
            Unpaired?.Invoke();
        });
    }

    private async Task RemoveLaterAsync(Toast toast)
    {
        await Task.Delay(TimeSpan.FromSeconds(6));
        Toasts.Remove(toast);
    }

    private static void OnUi(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            dispatcher.BeginInvoke(action);
        }
    }
}

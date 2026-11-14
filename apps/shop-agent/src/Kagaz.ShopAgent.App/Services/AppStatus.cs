using System.Collections.ObjectModel;
using System.IO;
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
/// pairing, operator, shop mode, upgrade state, toasts). Exists so view models and hosted services
/// never depend on each other. Every mutation is marshalled to the UI thread.
/// </summary>
public sealed partial class AppStatus : ObservableObject
{
    public const string RevokedText = "Device revoked, re-pair required";

    private readonly ISecureStore _secureStore;
    private readonly AgentStateStore _stateStore;
    private readonly AgentSession _session;

    [ObservableProperty]
    private ConnectionState _connection = ConnectionState.Checking;

    [ObservableProperty]
    private string _connectionText = "Checking connection…";

    /// <summary>Why the server can't be reached ("api.kaggaz.in: No such host is known"); null while it can.</summary>
    [ObservableProperty]
    private string? _connectionProblem;

    [ObservableProperty]
    private bool _isPaired;

    [ObservableProperty]
    private string? _shopName;

    [ObservableProperty]
    private bool _shopIsDemo;

    /// <summary>The owner finished first-run setup (shop details, location, prices) for the paired shop.</summary>
    [ObservableProperty]
    private bool _shopSetupComplete;

    /// <summary>Set when the server revoked this device (P2.4); shown on the pairing screen.</summary>
    [ObservableProperty]
    private string? _revokedNotice;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOperatorSignedIn))]
    private string? _operatorName;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOwner))]
    private string? _operatorRole;

    /// <summary>Heartbeat <c>shop</c> state (P2.6): <c>MANUAL|AUTO</c>; null until the first heartbeat.</summary>
    [ObservableProperty]
    private string? _approvalMode;

    [ObservableProperty]
    private bool _autoPaused;

    [ObservableProperty]
    private string? _shopOpenStatus;

    /// <summary>Heartbeat <c>subscription</c> (billing): null on servers that don't send it.</summary>
    [ObservableProperty]
    private HeartbeatSubscription? _subscription;

    public void ApplySubscription(HeartbeatSubscription? subscription) => OnUi(() => Subscription = subscription);

    /// <summary>Signed-in operator is the shop owner: owner-only pages (Staff, Prices) are shown.</summary>
    public bool IsOwner => OperatorRole == "Owner";

    /// <summary>P4.4: heartbeat <c>upgradeRequired</c> or any 426 — blocks the window with an update banner.</summary>
    [ObservableProperty]
    private bool _upgradeRequired;

    [ObservableProperty]
    private string? _minAgentVersion;

    /// <summary>True while the realtime socket is connected (P2.9) — polls relax to the safety interval.</summary>
    [ObservableProperty]
    private bool _realtimeConnected;

    public AppStatus(ISecureStore secureStore, AgentStateStore stateStore, AgentSession session)
    {
        _secureStore = secureStore;
        _stateStore = stateStore;
        _session = session;
        var state = stateStore.Load();
        _isPaired = !string.IsNullOrEmpty(SafeLoadToken());
        _shopName = _isPaired ? state.ShopName : null;
        _shopIsDemo = state.ShopIsDemo;
        _shopSetupComplete = _isPaired && state.ShopSetupComplete;
        _revokedNotice = !_isPaired && state.DeviceRevoked ? RevokedText : null;

        session.OperatorChanged += () => OnUi(SyncOperator);
        session.OperatorLoginRequired += () => ShowToast("Please sign in again", "Your operator session has ended.", warning: true);
        session.DeviceRevoked += HandleDeviceRevoked;
        session.UpgradeStateChanged += () => OnUi(() =>
        {
            UpgradeRequired = session.IsUpgradeRequired;
            MinAgentVersion = session.MinAgentVersion;
        });
        SyncOperator(); // an operator session restored from disk shows as signed in right away
    }

    public AgentSession Session => _session;

    public bool IsOperatorSignedIn => OperatorName is not null;

    public ObservableCollection<Toast> Toasts { get; } = new();

    /// <summary>Live spooler status per order id ("Printing page 2 of 5", "Printer is out of paper").</summary>
    public System.Collections.Concurrent.ConcurrentDictionary<string, string> LiveStatus { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Printer problems on this PC (P2.10), shown as a notice bar; null when all are READY.</summary>
    [ObservableProperty]
    private string? _printerAlert;

    /// <summary>Raised when a live spooler status changes (any thread).</summary>
    public event Action<string>? LiveStatusChanged;

    public void SetLiveStatus(string orderId, string? text)
    {
        bool changed;
        if (text is null)
        {
            changed = LiveStatus.TryRemove(orderId, out _);
        }
        else
        {
            changed = !LiveStatus.TryGetValue(orderId, out var old) || old != text;
            LiveStatus[orderId] = text;
        }
        if (changed) LiveStatusChanged?.Invoke(orderId);
    }

    public void SetPrinterAlert(string? alert) => OnUi(() => PrinterAlert = alert);

    /// <summary>Apply the server's shop profile: its name and whether first-run setup is done (persisted).</summary>
    public void ApplyShopProfile(ShopProfile profile)
    {
        _stateStore.Update(s =>
        {
            s.ShopName = profile.Name;
            s.ShopSetupComplete = profile.SetupComplete;
        });
        OnUi(() =>
        {
            ShopName = profile.Name;
            ShopSetupComplete = profile.SetupComplete;
        });
    }

    /// <summary>Raised on the UI thread after a successful pairing.</summary>
    public event Action? Paired;

    /// <summary>Raised on the UI thread after the operator unpairs this PC or it was revoked.</summary>
    public event Action? Unpaired;

    public void SetConnection(ConnectionState state, string text, string? problem = null) => OnUi(() =>
    {
        Connection = state;
        ConnectionText = text;
        ConnectionProblem = problem;
    });

    /// <summary>Apply the heartbeat's <c>shop</c> block (or a <c>shop.mode_changed</c> hint).</summary>
    public void ApplyShopState(string? approvalMode, bool autoPaused, string? openStatus = null) => OnUi(() =>
    {
        if (approvalMode is not null) ApprovalMode = approvalMode;
        AutoPaused = autoPaused;
        if (openStatus is not null) ShopOpenStatus = openStatus;
    });

    public void SetRealtimeConnected(bool connected) => OnUi(() => RealtimeConnected = connected);

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
        _session.SignOut();
        _stateStore.Update(s =>
        {
            s.ApiBaseUrl = apiBaseUrl;
            s.ShopName = response.Shop.Name;
            s.ShopIsDemo = response.Shop.IsDemo;
            s.ShopSetupComplete = false;
            s.DeviceName = response.Device.Name;
            s.DeviceRevoked = false;
            s.TokenRotatedAt = DateTimeOffset.UtcNow;
            // A new pairing starts clean: printers are re-registered for this shop, and attempts
            // leased by a previous device identity are not ours to report on.
            s.RegisteredPrinterNames.Clear();
            s.Jobs.Clear();
            s.Queues.Clear();
        });
        OnUi(() =>
        {
            IsPaired = true;
            RevokedNotice = null;
            ShopName = response.Shop.Name;
            ShopIsDemo = response.Shop.IsDemo;
            ShopSetupComplete = false;
            ApprovalMode = null;
            Connection = ConnectionState.Checking;
            ConnectionText = "Connecting…";
            Paired?.Invoke();
        });
    }

    public void Unpair() => Forget(revoked: false);

    /// <summary>
    /// <c>401 DEVICE_REVOKED</c> anywhere (P2.4): wipe the DPAPI token and local pairing state, sign the
    /// operator out and send the window back to the pairing screen with the revoked notice.
    /// </summary>
    public void HandleDeviceRevoked()
    {
        if (!IsPaired && SafeLoadToken() is null) return; // already handled
        Forget(revoked: true);
        ShowToast(RevokedText, "An administrator revoked this PC. Ask for a new pairing code.", warning: true);
    }

    private void Forget(bool revoked)
    {
        _secureStore.Delete();
        _session.SignOut();
        _stateStore.Update(s =>
        {
            s.ShopName = null;
            s.ShopSetupComplete = false;
            s.DeviceName = revoked ? s.DeviceName : null;
            s.DeviceRevoked = revoked;
            s.RegisteredPrinterNames.Clear();
            s.Queues.Clear();
            s.Jobs.Clear();
        });
        OnUi(() =>
        {
            IsPaired = false;
            ShopName = null;
            ShopSetupComplete = false;
            ApprovalMode = null;
            RevokedNotice = revoked ? RevokedText : null;
            Connection = revoked ? ConnectionState.Unauthorized : ConnectionState.NotPaired;
            ConnectionText = revoked ? RevokedText : "Not paired";
            Unpaired?.Invoke();
        });
    }

    private void SyncOperator()
    {
        var op = _session.Operator;
        OperatorName = op?.Name;
        OperatorRole = op?.Role switch
        {
            "SHOP_OWNER" => "Owner",
            "SHOP_OPERATOR" => "Operator",
            null => null,
            var other => other,
        };
    }

    private string? SafeLoadToken()
    {
        try { return _secureStore.Load(); }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or FormatException or IOException)
        {
            return null; // unreadable token = not paired
        }
    }

    private async Task RemoveLaterAsync(Toast toast)
    {
        await Task.Delay(TimeSpan.FromSeconds(6));
        Toasts.Remove(toast);
    }

    /// <summary>Run on the UI thread (events from the API client arrive on any thread).</summary>
    public void RunOnUi(Action action) => OnUi(action);

    private static void OnUi(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        // After the UI thread has shut down nothing would ever run a queued action: run it here.
        if (dispatcher is null || dispatcher.HasShutdownStarted || dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            dispatcher.BeginInvoke(action);
        }
    }
}

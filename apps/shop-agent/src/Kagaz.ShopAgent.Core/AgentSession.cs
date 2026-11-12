using System.Security.Cryptography;
using System.Text.Json;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// In-memory session state shared by every API client instance (typed HTTP clients are transient,
/// so signals can't live on the client): the signed-in operator (P2.3) and the server signals the
/// app must react to wherever they surface — device revoked (P2.4), operator login required,
/// agent upgrade required (P4.4).
/// <para>The operator stays signed in across restarts: the session is kept DPAPI-encrypted in the
/// optional operator store (<c>%LOCALAPPDATA%Kagazoperator.token</c>) and ends only on sign-out, on
/// <c>401 OPERATOR_LOGIN_REQUIRED</c> (server-side expiry, logout elsewhere, member removed) or device
/// revocation. There is no local expiry: the server slides the session on use.</para>
/// Events may be raised on any thread; subscribers marshal to the UI themselves.
/// </summary>
public sealed class AgentSession
{
    private readonly object _gate = new();
    private readonly ISecureStore? _operatorStore;
    private string? _operatorToken;
    private OperatorInfo? _operator;
    private bool _upgradeRequired;
    private string? _minAgentVersion;

    /// <param name="operatorStore">Where the signed-in operator survives restarts; null = memory only (tests).</param>
    public AgentSession(ISecureStore? operatorStore = null)
    {
        _operatorStore = operatorStore;
        if (TryRestore() is { } saved)
        {
            _operatorToken = saved.OperatorToken;
            _operator = saved.Operator;
        }
    }

    /// <summary>Raised after sign-in or sign-out (including forced sign-out).</summary>
    public event Action? OperatorChanged;

    /// <summary>Raised when the server rejected a human action with <c>401 OPERATOR_LOGIN_REQUIRED</c>.</summary>
    public event Action? OperatorLoginRequired;

    /// <summary>Raised when any device-auth call returned <c>401 DEVICE_REVOKED</c>.</summary>
    public event Action? DeviceRevoked;

    /// <summary>Raised when the upgrade-required state changes (heartbeat flag or a 426).</summary>
    public event Action? UpgradeStateChanged;

    /// <summary>Raised when any call answered <c>409 SUBSCRIPTION_INACTIVE</c> (the shop isn't subscribed).</summary>
    public event Action? SubscriptionInactive;

    public void NotifySubscriptionInactive() => SubscriptionInactive?.Invoke();

    // ─── Operator ───

    /// <summary>The signed-in operator, or null.</summary>
    public OperatorInfo? Operator
    {
        get
        {
            lock (_gate) return IsValidLocked() ? _operator : null;
        }
    }

    /// <summary>Token for <c>X-Operator-Token</c>, or null when nobody is signed in.</summary>
    public string? OperatorToken
    {
        get
        {
            lock (_gate) return IsValidLocked() ? _operatorToken : null;
        }
    }

    public bool IsOperatorSignedIn => OperatorToken is not null;

    public void SignIn(OperatorLoginResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        if (string.IsNullOrWhiteSpace(response.OperatorToken))
        {
            throw new ArgumentException("Operator token is required.", nameof(response));
        }

        lock (_gate)
        {
            _operatorToken = response.OperatorToken;
            _operator = response.Operator;
        }
        Persist(() => _operatorStore?.Save(JsonSerializer.Serialize(response, JsonOptions.Request)));
        OperatorChanged?.Invoke();
    }

    /// <summary>Forget the operator token (logout, app exit, re-pair, revoke).</summary>
    public void SignOut()
    {
        bool changed;
        lock (_gate)
        {
            changed = _operatorToken is not null;
            _operatorToken = null;
            _operator = null;
        }
        Persist(() => _operatorStore?.Delete());
        if (changed) OperatorChanged?.Invoke();
    }

    /// <summary>The server rejected a human action: back to the login screen.</summary>
    public void NotifyOperatorLoginRequired()
    {
        SignOut();
        OperatorLoginRequired?.Invoke();
    }

    // ─── Device ───

    /// <summary>Raised after the device token was rotated and stored (realtime reconnects with it).</summary>
    public event Action? DeviceTokenRotated;

    public void NotifyDeviceTokenRotated() => DeviceTokenRotated?.Invoke();

    public void NotifyDeviceRevoked()
    {
        SignOut();
        DeviceRevoked?.Invoke();
    }

    // ─── Upgrade ───

    public bool IsUpgradeRequired
    {
        get { lock (_gate) return _upgradeRequired; }
    }

    public string? MinAgentVersion
    {
        get { lock (_gate) return _minAgentVersion; }
    }

    /// <summary>Record the server's verdict (heartbeat <c>upgradeRequired</c>, or a 426 → true).</summary>
    public void SetUpgradeRequired(bool required, string? minAgentVersion)
    {
        bool changed;
        lock (_gate)
        {
            changed = _upgradeRequired != required || (minAgentVersion is not null && _minAgentVersion != minAgentVersion);
            _upgradeRequired = required;
            if (minAgentVersion is not null || !required) _minAgentVersion = minAgentVersion;
        }
        if (changed) UpgradeStateChanged?.Invoke();
    }

    private bool IsValidLocked() => _operatorToken is not null;

    private OperatorLoginResponse? TryRestore()
    {
        try
        {
            var json = _operatorStore?.Load();
            var saved = json is null ? null : JsonSerializer.Deserialize<OperatorLoginResponse>(json, JsonOptions.Response);
            return string.IsNullOrWhiteSpace(saved?.OperatorToken) || saved.Operator is null ? null : saved;
        }
        catch (Exception ex) when (ex is JsonException or CryptographicException or FormatException or IOException)
        {
            Persist(() => _operatorStore?.Delete()); // unreadable (other Windows user, corrupt): sign in again
            return null;
        }
    }

    /// <summary>Disk trouble never breaks sign-in; the worst case is signing in again after a restart.</summary>
    private static void Persist(Action write)
    {
        try { write(); }
        catch (Exception ex) when (ex is CryptographicException or IOException or UnauthorizedAccessException) { }
    }
}

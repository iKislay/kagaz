using System.Globalization;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// In-memory session state shared by every API client instance (typed HTTP clients are transient,
/// so signals can't live on the client): the signed-in operator (P2.3) and the server signals the
/// app must react to wherever they surface — device revoked (P2.4), operator login required,
/// agent upgrade required (P4.4).
/// <para>The operator token is <b>never persisted</b>: it lives only in this object and is cleared on
/// sign-out, on <c>401 OPERATOR_LOGIN_REQUIRED</c>, on expiry and when the process exits.</para>
/// Events may be raised on any thread; subscribers marshal to the UI themselves.
/// </summary>
public sealed class AgentSession
{
    private readonly object _gate = new();
    private readonly Func<DateTimeOffset> _clock;
    private string? _operatorToken;
    private DateTimeOffset _operatorExpiresAt;
    private OperatorInfo? _operator;
    private bool _upgradeRequired;
    private string? _minAgentVersion;

    public AgentSession(Func<DateTimeOffset>? clock = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>Raised after sign-in or sign-out (including forced sign-out).</summary>
    public event Action? OperatorChanged;

    /// <summary>Raised when the server rejected a human action with <c>401 OPERATOR_LOGIN_REQUIRED</c>.</summary>
    public event Action? OperatorLoginRequired;

    /// <summary>Raised when any device-auth call returned <c>401 DEVICE_REVOKED</c>.</summary>
    public event Action? DeviceRevoked;

    /// <summary>Raised when the upgrade-required state changes (heartbeat flag or a 426).</summary>
    public event Action? UpgradeStateChanged;

    // ─── Operator ───

    /// <summary>The signed-in operator, or null (also null once the token has expired).</summary>
    public OperatorInfo? Operator
    {
        get
        {
            lock (_gate) return IsValidLocked() ? _operator : null;
        }
    }

    /// <summary>Token for <c>X-Operator-Token</c>, or null when nobody is signed in / it expired.</summary>
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

        var expires = DateTimeOffset.TryParse(response.ExpiresAt, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : _clock().AddHours(12); // contract: 12 h JWT

        lock (_gate)
        {
            _operatorToken = response.OperatorToken;
            _operatorExpiresAt = expires;
            _operator = response.Operator;
        }
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
            _operatorExpiresAt = default;
        }
        if (changed) OperatorChanged?.Invoke();
    }

    /// <summary>Signs out if the token has expired. Returns true if that happened.</summary>
    public bool ExpireIfDue()
    {
        lock (_gate)
        {
            if (_operatorToken is null || IsValidLocked()) return false;
        }
        SignOut();
        return true;
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

    private bool IsValidLocked() => _operatorToken is not null && _clock() < _operatorExpiresAt;
}

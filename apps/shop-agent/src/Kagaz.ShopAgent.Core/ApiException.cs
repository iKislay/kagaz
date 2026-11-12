namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Thrown by the shop API client when the server responds with an error status.
/// Carries the stable error code from the <c>{ error: { code, message } }</c> envelope.
/// </summary>
public sealed class ApiException : Exception
{
    public string Code { get; }

    /// <summary>HTTP status of the response, or null for network errors.</summary>
    public int? HttpStatus { get; }

    /// <summary>The envelope's <c>details</c> (e.g. <c>shops</c> for <c>409 MULTIPLE_SHOPS</c>), if any.</summary>
    public System.Text.Json.JsonElement? Details { get; }

    public ApiException(string code, string message, int? httpStatus = null, System.Text.Json.JsonElement? details = null)
        : base(message)
    {
        Code = code;
        HttpStatus = httpStatus;
        Details = details;
    }

    /// <summary><c>details.shops</c> of <c>409 MULTIPLE_SHOPS</c>: the shops this login manages.</summary>
    public List<ShopChoice> DetailShops()
    {
        var shops = new List<ShopChoice>();
        if (Details is { ValueKind: System.Text.Json.JsonValueKind.Object } d
            && d.TryGetProperty("shops", out var list) && list.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var s in list.EnumerateArray())
            {
                if (s.ValueKind == System.Text.Json.JsonValueKind.Object
                    && s.TryGetProperty("id", out var id) && id.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    string name = s.TryGetProperty("name", out var n) && n.ValueKind == System.Text.Json.JsonValueKind.String
                        ? n.GetString()! : id.GetString()!;
                    shops.Add(new ShopChoice(id.GetString()!, name));
                }
            }
        }
        return shops;
    }
}

/// <summary>Stable server error codes the agent reacts to (docs/contracts/PHASE2_5_CONTRACTS.md).</summary>
public static class ApiErrorCodes
{
    public const string NetworkError = "NETWORK_ERROR";
    /// <summary>Any other 401 on a device-auth call (unknown / missing token).</summary>
    public const string DeviceUnauthorized = "DEVICE_UNAUTHORIZED";
    /// <summary>401: this device was revoked by an admin — wipe the token, re-pair (P2.4).</summary>
    public const string DeviceRevoked = "DEVICE_REVOKED";
    /// <summary>401: a human action without a valid operator token (P2.3).</summary>
    public const string OperatorLoginRequired = "OPERATOR_LOGIN_REQUIRED";
    /// <summary>401 from operator login: wrong password or not a member of this device's shop.</summary>
    public const string InvalidCredentials = "INVALID_CREDENTIALS";
    /// <summary>426: this agent is older than MIN_AGENT_VERSION (P4.4 / P5.4).</summary>
    public const string AgentUpgradeRequired = "AGENT_UPGRADE_REQUIRED";
    /// <summary>409 lease: the printer has another active lease — wait, never retry a submitted attempt.</summary>
    public const string PrinterBusy = "PRINTER_BUSY";
    /// <summary>409 lease: an older READY job exists for that printer — wait for it.</summary>
    public const string NotNextInQueue = "NOT_NEXT_IN_QUEUE";
    /// <summary>409 lease: the job is no longer READY (cancelled, superseded, leased elsewhere).</summary>
    public const string JobNotLeasable = "JOB_NOT_LEASABLE";
    public const string InvalidTransition = "INVALID_TRANSITION";
    public const string ReprintConfirmRequired = "REPRINT_CONFIRM_REQUIRED";
    public const string RateLimited = "RATE_LIMITED";
    /// <summary>401 from sign-in / enroll-with-login: wrong mobile number or password.</summary>
    public const string LoginFailed = "LOGIN_FAILED";
    /// <summary>409 enroll-with-login: the login manages several shops — pick one (details.shops).</summary>
    public const string MultipleShops = "MULTIPLE_SHOPS";
    /// <summary>409 sign-up: this mobile number already has an account.</summary>
    public const string PhoneInUse = "PHONE_IN_USE";
    /// <summary>409 PUT /shop/printers: more printers than the plan's seats.</summary>
    public const string PrinterLimitReached = "PRINTER_LIMIT_REACHED";
    /// <summary>409 on order/printer calls: the shop has no active subscription.</summary>
    public const string SubscriptionInactive = "SUBSCRIPTION_INACTIVE";
}

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

    public ApiException(string code, string message, int? httpStatus = null) : base(message)
    {
        Code = code;
        HttpStatus = httpStatus;
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
    public const string ValidationFailed = "VALIDATION_FAILED";
    /// <summary>502: the payment service (YouPI) could not be reached — retry (ADR-003).</summary>
    public const string PaymentProviderUnavailable = "PAYMENT_PROVIDER_UNAVAILABLE";
    /// <summary>409 pairing: save the UPI ID (step 1) first.</summary>
    public const string PaymentSetupRequired = "PAYMENT_SETUP_REQUIRED";
    /// <summary>409 approve/decline: the report was already decided or superseded.</summary>
    public const string PaymentReportNotOpen = "PAYMENT_REPORT_NOT_OPEN";
}

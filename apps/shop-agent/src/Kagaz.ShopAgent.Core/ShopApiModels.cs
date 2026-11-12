namespace Kagaz.ShopAgent.Core;

// ─── Devices ───

public record EnrollDeviceRequest(string Code, string Name, string? AppVersion);

public record EnrollDeviceResponse(string DeviceToken, ApiDevice Device, ApiShop Shop);

public record ApiDevice(string Id, string Name);

public record ApiShop(string Id, string Name, bool IsDemo);

/// <summary><c>GET /shop/poster</c>: what the in-shop QR poster shows.</summary>
public record ShopPosterInfo(string ShopName, string Url);

/// <summary>
/// <c>POST /api/shop/heartbeat</c> every 15 s (contract §1). All fields beyond the first two are
/// optional for back-compat with the P1 <c>/devices/heartbeat</c> schema.
/// </summary>
public record HeartbeatRequest(
    string? AppVersion,
    List<PrinterStatus>? Printers,
    string? Os = null,
    long? UptimeSeconds = null,
    int? QueueDepth = null,
    List<string>? ActivePrintJobIds = null);

/// <summary>Printer health: <c>READY|OFFLINE|PAPER_OUT|ERROR|UNKNOWN</c> (see <see cref="PrinterHealth"/>).</summary>
public record PrinterStatus(string PrinterId, string Status, string? LastError);

/// <summary>Shop state echoed by the heartbeat: <c>OPEN|CLOSED|MAINTENANCE</c>, <c>MANUAL|AUTO</c>.</summary>
public record HeartbeatShop(string Status, string ApprovalMode, bool AutoPaused);

public record HeartbeatResponse(
    string? ServerTime,
    int? LeaseTtlSeconds,
    string? MinAgentVersion,
    bool UpgradeRequired,
    HeartbeatShop? Shop);

// ─── Approval mode (contract §3) ───

public static class ApprovalMode
{
    public const string Manual = "MANUAL";
    public const string Auto = "AUTO";
}

public record ShopModeRequest(string? ApprovalMode, bool? AutoPaused);

public record ShopModeResponse(string ApprovalMode, bool AutoPaused);

// ─── Needs-check resolution (contract §2) ───

public static class ResolveAction
{
    public const string ConfirmPrinted = "CONFIRM_PRINTED";
    public const string Reprint = "REPRINT";
    public const string MarkFailed = "MARK_FAILED";
}

public record ResolveJobRequest(string Action, bool? Confirm, string? Note);

// ─── Printers ───

public record RegisterPrintersRequest(List<PrinterRegistration> Printers);

public record PrinterRegistration(
    string PrinterName,
    string? DisplayName,
    bool ColourCapable,
    bool DuplexCapable,
    bool CapabilitiesConfirmed,
    bool? IsDefault);

public record ShopPrinter(
    string Id,
    string PrinterName,
    string DisplayName,
    bool ColourCapable,
    bool DuplexCapable,
    bool CapabilitiesConfirmed,
    bool Enabled,
    bool IsDefault,
    string Status);

// ─── Jobs ───

public record ShopPrintOptions(string? PageRange, int Copies, bool Colour, bool Duplex, string PaperSize);

public record ShopPrintJob(string Id, int Attempt, string Status, string PrinterId, int? SpoolerJobId, string? Error);

public record ShopRejection(string Code, string? Note);

/// <summary>
/// One order for the shop. ADR-002: <see cref="PickupNumber"/> is the shop's daily pickup number (#1, #2 …,
/// restarting every day in Asia/Kolkata), assigned when payment is verified; <see cref="PickupDate"/> is that
/// business date (<c>YYYY-MM-DD</c>). Both are null on older APIs and on unpaid orders.
/// </summary>
public record ShopJob(
    string OrderId,
    string PublicRef,
    string Status,
    ShopPrintOptions Options,
    int? PageCount,
    int? PrintedSides,
    int? AmountPaise,
    bool SimulatedPayment,
    string CreatedAt,
    string? PaidAt,
    ShopPrintJob? PrintJob,
    ShopRejection? Rejection,
    string? PreviewUrl,
    int? PickupNumber = null,
    string? PickupDate = null);

// ─── Actions ───

public record AcceptJobRequest(string? PrinterId);

public record RejectJobRequest(string ReasonCode, string? Note);

public record LeaseSettings(bool Colour, bool Duplex, string PaperSize);

public record LeaseResponse(
    string PrintJobId,
    string OrderId,
    string PublicRef,
    int Attempt,
    string DocumentName,
    string PrinterName,
    LeaseSettings Settings,
    string DownloadUrl,
    string DownloadExpiresAt,
    string Sha256,
    int PageCount,
    string LeaseUntil);

// ─── Print status reports (wire DTO) ───

/// <summary>
/// <c>POST /api/shop/print-jobs/:id/status</c>: <c>SUBMITTED {spoolerJobId?}</c>, <c>SPOOLER_COMPLETE</c>,
/// <c>FAILED {error}</c> or <c>UNCERTAIN {reason}</c> (contract §1). Null fields are not sent.
/// </summary>
public sealed class PrintStatusReportDto
{
    public string Status { get; init; } = string.Empty;
    public int? SpoolerJobId { get; init; }
    public string? Error { get; init; }
    public string? Reason { get; init; }

    public static PrintStatusReportDto Submitted(int? spoolerJobId) => new() { Status = PrintReportStatus.Submitted, SpoolerJobId = spoolerJobId };
    public static PrintStatusReportDto SpoolerComplete() => new() { Status = PrintReportStatus.SpoolerComplete };
    public static PrintStatusReportDto Failed(string error) => new() { Status = PrintReportStatus.Failed, Error = Trim(error) };
    public static PrintStatusReportDto Uncertain(string reason) => new() { Status = PrintReportStatus.Uncertain, Reason = Trim(reason) };

    private static string Trim(string s) => s.Length > 500 ? s[..500] : s;
}

public static class PrintReportStatus
{
    public const string Submitted = "SUBMITTED";
    public const string SpoolerComplete = "SPOOLER_COMPLETE";
    public const string Failed = "FAILED";
    public const string Uncertain = "UNCERTAIN";
}

// ─── Operator session (contract §4) ───

public record OperatorLoginRequest(string Login, string Password);

public record OperatorInfo(string Id, string Name, string Role);

public record OperatorLoginResponse(string OperatorToken, string ExpiresAt, OperatorInfo Operator);

public record RotateTokenResponse(string DeviceToken);

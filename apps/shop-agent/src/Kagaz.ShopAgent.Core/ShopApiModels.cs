namespace Kagaz.ShopAgent.Core;

// ─── Devices ───

public record EnrollDeviceRequest(string Code, string Name, string? AppVersion);

public record EnrollDeviceResponse(string DeviceToken, ApiDevice Device, ApiShop Shop);

public record ApiDevice(string Id, string Name);

public record ApiShop(string Id, string Name, bool IsDemo);

/// <summary>Kaggaz support contact from <c>GET /config</c>; a null field is not configured.</summary>
public record SupportContact(string? Phone, string? Whatsapp, string? Email)
{
    /// <summary>A wa.me chat link from any typed number ("+91 98765 43210" → https://wa.me/919876543210).</summary>
    public static string? WhatsAppUrl(string? number)
    {
        var digits = new string((number ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
        return digits.Length >= 8 ? $"https://wa.me/{digits}" : null;
    }
}

/// <summary>The part of <c>GET /config</c> the shop app reads.</summary>
public record PublicConfigResponse(SupportContact? Support);

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
    HeartbeatShop? Shop,
    HeartbeatSubscription? Subscription = null);

/// <summary>Billing state echoed by the heartbeat: <c>ACTIVE|EXPIRED|NONE</c>; seats = connected printers allowed.</summary>
public record HeartbeatSubscription(string Status, int? PrinterSeats, string? PeriodEnd, int? DaysLeft);

// ─── Account: sign in / sign up from the app (no website dashboard for shops) ───

/// <summary><c>POST /shop/enroll-with-login</c>: pair this PC with the owner's mobile number + password.</summary>
public record EnrollWithLoginRequest(string Login, string Password, string DeviceName, string? AppVersion, string? ShopId = null);

/// <summary><c>POST /shop/signup</c>: create the shop + owner login and pair this PC in one go.</summary>
public record ShopSignupRequest(string ShopName, string OwnerName, string Phone, string Password, string DeviceName, string? AppVersion);

/// <summary>One choice from <c>409 MULTIPLE_SHOPS</c> <c>details.shops</c>.</summary>
public record ShopChoice(string Id, string Name)
{
    public override string ToString() => Name;
}

// ─── Owner pages: staff + prices ───

public record ShopMember(string UserId, string? Name, string? Phone, string Role);

/// <summary><c>GET /shop/members</c> body.</summary>
public record ShopMemberList(List<ShopMember> Members);

public record AddShopMemberRequest(string Phone, string Name, string Password);

/// <summary>The shop's current prices, integer paise (never floats).</summary>
public record ShopPricing(
    int MonoRatePaise,
    int ColourRatePaise,
    int? MonoDuplexRatePaise,
    int? ColourDuplexRatePaise,
    string DuplexRule,
    int MinimumChargePaise,
    string? EffectiveFrom = null);

public record UpdateShopPricingRequest(
    int MonoRatePaise,
    int ColourRatePaise,
    int? MonoDuplexRatePaise,
    int? ColourDuplexRatePaise,
    string DuplexRule,
    int MinimumChargePaise);

// ─── Shop profile + first-run setup (owner) ───

public record GeoPoint(double Lat, double Lng);

/// <summary><c>GET /shop/profile</c>. The address is what customers read; the location pins the shop.</summary>
public record ShopProfile(string Name, string? ContactPhone, string? Address, GeoPoint? Location, bool SetupComplete);

public record UpdateShopProfileRequest(string? Name = null, string? ContactPhone = null);

/// <summary>A place from address search (OpenStreetMap, via the Kaggaz API).</summary>
public record Place(string Name, string Address, double Lat, double Lng);

public record PlaceSearchResponse(List<Place> Places);

public record ReversePlaceResponse(string? Address);

/// <summary><c>PUT /shop/location</c>: the pin and the address as the owner confirmed it.</summary>
public record ShopLocationRequest(double Lat, double Lng, string Address);

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
    string? PickupDate = null,
    bool PayAtCounter = false);

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

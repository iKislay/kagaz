namespace Kagaz.ShopAgent.Core;

// ─── Devices ───

public record EnrollDeviceRequest(string Code, string Name, string? AppVersion);

public record EnrollDeviceResponse(string DeviceToken, ApiDevice Device, ApiShop Shop);

public record ApiDevice(string Id, string Name);

public record ApiShop(string Id, string Name, bool IsDemo);

public record HeartbeatRequest(string? AppVersion, List<PrinterStatus>? Printers);

public record PrinterStatus(string PrinterId, string Status, string? LastError);

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
    string? PreviewUrl);

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

public sealed class PrintStatusReportDto
{
    public string Status { get; init; } = string.Empty;
    public int? SpoolerJobId { get; init; }
    public string? Error { get; init; }
}

// ─── Pickup ───

public record VerifyPickupRequest(string Code);

public record VerifyPickupResponse(
    string OrderId,
    string PublicRef,
    string Status,
    ShopPrintOptions Options,
    int? PageCount,
    string? CollectedAt);

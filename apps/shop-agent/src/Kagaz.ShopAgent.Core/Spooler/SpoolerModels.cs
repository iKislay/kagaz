namespace Kagaz.ShopAgent.Core.Spooler;

/// <summary>
/// One Windows spooler job as plain flags (mirrors <c>System.Printing.PrintSystemJobInfo</c>), so the
/// mapping logic stays pure and unit-testable without a printer.
/// </summary>
public sealed record SpoolerJobSnapshot(
    int JobId,
    string Name,
    bool IsSpooling = false,
    bool IsPrinting = false,
    bool IsPrinted = false,
    bool IsCompleted = false,
    bool IsDeleting = false,
    bool IsDeleted = false,
    bool IsInError = false,
    bool IsOffline = false,
    bool IsPaperOut = false,
    bool IsPaused = false,
    bool IsBlocked = false,
    bool IsUserInterventionRequired = false,
    int PagesPrinted = 0,
    int TotalPages = 0);

/// <summary>A printer queue's state as plain flags (mirrors <c>System.Printing.PrintQueue</c>).</summary>
public sealed record PrinterQueueSnapshot(
    bool Exists = true,
    bool IsOffline = false,
    bool IsNotAvailable = false,
    bool IsOutOfPaper = false,
    bool IsPaperJammed = false,
    bool HasPaperProblem = false,
    bool IsInError = false,
    bool IsOutOfMemory = false,
    bool IsDoorOpened = false,
    bool IsOutputBinFull = false,
    bool NeedUserIntervention = false,
    bool IsPaused = false,
    bool IsTonerOut = false)
{
    public static readonly PrinterQueueSnapshot Missing = new(Exists: false);
}

/// <summary>
/// Read side of the Windows spooler (implemented with <c>System.Printing</c> in the Printing project;
/// faked in tests). Implementations never throw: unreadable → null.
/// </summary>
public interface ISpoolerProbe
{
    /// <summary>The printer queue, <see cref="PrinterQueueSnapshot.Missing"/> if no such printer, null if unreadable.</summary>
    PrinterQueueSnapshot? GetQueue(string printerName);

    /// <summary>All jobs in the printer's queue; null if the queue can't be read (or doesn't exist).</summary>
    IReadOnlyList<SpoolerJobSnapshot>? GetJobs(string printerName);
}

/// <summary>Heartbeat printer status values (contract §1).</summary>
public static class PrinterHealthStatus
{
    public const string Ready = "READY";
    public const string Offline = "OFFLINE";
    public const string PaperOut = "PAPER_OUT";
    public const string Error = "ERROR";
    public const string Unknown = "UNKNOWN";
}

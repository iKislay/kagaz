namespace Kagaz.ShopAgent.Core.Spooler;

/// <summary>Printer status for the heartbeat and the app (P2.10 / P4.4).</summary>
public sealed record PrinterHealthResult(string Status, string? LastError)
{
    public bool IsReady => Status == PrinterHealthStatus.Ready;

    /// <summary>A state that stops printing (as opposed to READY / UNKNOWN).</summary>
    public bool IsProblem => Status is PrinterHealthStatus.Offline or PrinterHealthStatus.PaperOut or PrinterHealthStatus.Error;
}

/// <summary>Pure mapping from the Windows queue state to <c>READY|OFFLINE|PAPER_OUT|ERROR|UNKNOWN</c>.</summary>
public static class PrinterHealth
{
    /// <param name="queue">Queue snapshot; null = could not read it.</param>
    /// <param name="unreachableReason">
    /// Set when the driver could not open the device even though Windows lists it (e.g. IPP class driver,
    /// printer asleep): the queue often still claims "Ready", so this wins over READY.
    /// </param>
    public static PrinterHealthResult Map(PrinterQueueSnapshot? queue, string? unreachableReason = null)
    {
        if (queue is null) return new(PrinterHealthStatus.Unknown, "Printer queue could not be read");
        if (!queue.Exists) return new(PrinterHealthStatus.Offline, "Printer is not installed on this PC");

        if (queue.IsOffline || queue.IsNotAvailable) return new(PrinterHealthStatus.Offline, "Printer is offline");
        if (queue.IsOutOfPaper) return new(PrinterHealthStatus.PaperOut, "Printer is out of paper");
        if (queue.HasPaperProblem) return new(PrinterHealthStatus.PaperOut, "Paper problem — check the paper tray");
        if (queue.IsPaperJammed) return new(PrinterHealthStatus.Error, "Paper jam");
        if (queue.IsDoorOpened) return new(PrinterHealthStatus.Error, "A printer door is open");
        // IsTonerOut is deliberately not a blocking state: ink-tank printers on generic (IPP class)
        // drivers report toner flags unreliably, and a false ERROR would hold every order.
        if (queue.IsOutputBinFull) return new(PrinterHealthStatus.Error, "Output tray is full");
        if (queue.IsOutOfMemory) return new(PrinterHealthStatus.Error, "Printer is out of memory");
        if (queue.IsPaused) return new(PrinterHealthStatus.Error, "Printer queue is paused in Windows");
        if (queue.IsInError || queue.NeedUserIntervention) return new(PrinterHealthStatus.Error, "Printer needs attention");
        if (unreachableReason is not null) return new(PrinterHealthStatus.Offline, unreachableReason);
        return new(PrinterHealthStatus.Ready, null);
    }
}

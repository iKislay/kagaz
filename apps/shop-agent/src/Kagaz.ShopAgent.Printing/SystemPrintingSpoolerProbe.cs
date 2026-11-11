using System.Printing;
using Kagaz.ShopAgent.Core.Spooler;

namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// <see cref="ISpoolerProbe"/> over <c>System.Printing</c> (<see cref="PrintQueue"/>,
/// <see cref="PrintSystemJobInfo"/>). The only place the agent reads the Windows spooler; all the
/// decisions live in the pure <see cref="SpoolerMonitor"/> / <see cref="PrinterHealth"/>.
/// Never throws: an unreadable queue is reported as null.
/// </summary>
public sealed class SystemPrintingSpoolerProbe : ISpoolerProbe
{
    public PrinterQueueSnapshot? GetQueue(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName)) return PrinterQueueSnapshot.Missing;
        if (!PdfiumPrintEngine.IsInstalled(printerName)) return PrinterQueueSnapshot.Missing;
        try
        {
            using var server = new LocalPrintServer();
            using var queue = server.GetPrintQueue(printerName);
            queue.Refresh();
            return new PrinterQueueSnapshot(
                Exists: true,
                IsOffline: queue.IsOffline,
                IsNotAvailable: queue.IsNotAvailable,
                IsOutOfPaper: queue.IsOutOfPaper,
                IsPaperJammed: queue.IsPaperJammed,
                HasPaperProblem: queue.HasPaperProblem,
                IsInError: queue.IsInError,
                IsOutOfMemory: queue.IsOutOfMemory,
                IsDoorOpened: queue.IsDoorOpened,
                IsOutputBinFull: queue.IsOutputBinFull,
                NeedUserIntervention: queue.NeedUserIntervention,
                IsPaused: queue.IsPaused,
                IsTonerOut: !queue.HasToner);
        }
        catch (Exception ex) when (ex is PrintQueueException or PrintSystemException or InvalidOperationException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public IReadOnlyList<SpoolerJobSnapshot>? GetJobs(string printerName)
    {
        if (string.IsNullOrWhiteSpace(printerName) || !PdfiumPrintEngine.IsInstalled(printerName)) return null;
        try
        {
            using var server = new LocalPrintServer();
            using var queue = server.GetPrintQueue(printerName);
            var jobs = new List<SpoolerJobSnapshot>();
            foreach (var job in queue.GetPrintJobInfoCollection())
            {
                using (job)
                {
                    job.Refresh();
                    jobs.Add(new SpoolerJobSnapshot(
                        JobId: job.JobIdentifier,
                        Name: job.Name ?? string.Empty,
                        IsSpooling: job.IsSpooling,
                        IsPrinting: job.IsPrinting,
                        IsPrinted: job.IsPrinted,
                        IsCompleted: job.IsCompleted,
                        IsDeleting: job.IsDeleting,
                        IsDeleted: job.IsDeleted,
                        IsInError: job.IsInError,
                        IsOffline: job.IsOffline,
                        IsPaperOut: job.IsPaperOut,
                        IsPaused: job.IsPaused,
                        IsBlocked: job.IsBlocked,
                        IsUserInterventionRequired: job.IsUserInterventionRequired,
                        PagesPrinted: job.NumberOfPagesPrinted,
                        TotalPages: job.NumberOfPages));
                }
            }
            return jobs;
        }
        catch (Exception ex) when (ex is PrintQueueException or PrintSystemException or PrintJobException or InvalidOperationException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}

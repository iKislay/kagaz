using System.Printing;

namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Locates a submitted spooler job by its document name (<c>KAGAZ-&lt;publicRef&gt;-A&lt;attempt&gt;</c>).
/// </summary>
public static class SpoolerJobFinder
{
    /// <summary>
    /// Returns the spooler job identifier if a job named <paramref name="documentName"/>
    /// is currently in the Windows print queue, else null.
    /// </summary>
    public static int? Find(string printerName, string documentName, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(10));
        LocalPrintServer? server = null;
        PrintQueue? queue = null;

        try
        {
            server = new LocalPrintServer();
            queue = server.GetPrintQueue(printerName);

            while (DateTime.UtcNow < deadline)
            {
                foreach (var job in queue.GetPrintJobInfoCollection())
                {
                    if (string.Equals(job.Name, documentName, StringComparison.OrdinalIgnoreCase))
                    {
                        return job.JobIdentifier;
                    }
                }

                System.Threading.Thread.Sleep(250);
            }

            return null;
        }
        catch
        {
            return null;
        }
        finally
        {
            queue?.Dispose();
            server?.Dispose();
        }
    }

    /// <summary>
    /// Document names of all jobs currently in <paramref name="printerName"/>'s queue
    /// (used by reconciliation). Empty if the queue cannot be read.
    /// </summary>
    public static ISet<string> ListDocumentNames(string printerName)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var server = new LocalPrintServer();
            using var queue = server.GetPrintQueue(printerName);
            foreach (var job in queue.GetPrintJobInfoCollection())
            {
                names.Add(job.Name);
            }
        }
        catch
        {
            // Printer removed or spooler unavailable: nothing to resume.
        }
        return names;
    }

    /// <summary>
    /// Waits until a job named <paramref name="documentName"/> is no longer in the queue
    /// (i.e. it has completed or been removed).
    /// </summary>
    public static async Task<bool> WaitUntilGoneAsync(string printerName, string documentName, TimeSpan? timeout = null, CancellationToken ct = default)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromMinutes(10));
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            bool present;
            LocalPrintServer? server = null;
            PrintQueue? queue = null;
            try
            {
                server = new LocalPrintServer();
                queue = server.GetPrintQueue(printerName);
                present = queue.GetPrintJobInfoCollection()
                    .Any(j => string.Equals(j.Name, documentName, StringComparison.OrdinalIgnoreCase));
            }
            catch
            {
                // Cannot reach the queue; treat as gone.
                return true;
            }
            finally
            {
                queue?.Dispose();
                server?.Dispose();
            }

            if (!present) return true;
            await Task.Delay(1000, ct);
        }
        return false;
    }
}

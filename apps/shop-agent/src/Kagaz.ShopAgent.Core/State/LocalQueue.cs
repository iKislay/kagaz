namespace Kagaz.ShopAgent.Core;

/// <summary>What the worker does after a lease is refused (P2.7).</summary>
public enum LeaseConflictAction
{
    /// <summary>Leave the job queued and stop trying this printer for a while (PRINTER_BUSY, NOT_NEXT_IN_QUEUE).</summary>
    WaitForPrinter,
    /// <summary>The job is no longer leasable (cancelled, superseded, leased elsewhere): drop it locally.</summary>
    DropFromQueue,
    /// <summary>Not a lease conflict: surface the error.</summary>
    Rethrow,
}

/// <summary>
/// Pure operations on the per-printer local queue persisted in <c>state.json</c> (P2.7). The server's
/// lease is still the only thing that decides who prints; the local queue is what this PC intends to
/// lease next, per printer, oldest first. An attempt that this PC has touched (it has a
/// <see cref="LocalJobState"/>) is never queued again — the agent never re-submits an attempt.
/// </summary>
public static class LocalQueue
{
    /// <summary>Local phases in which this PC holds (or is about to hold) the printer lease.</summary>
    private static readonly HashSet<string> ActivePhases = new(StringComparer.OrdinalIgnoreCase)
    {
        LocalPhase.NotStarted,
        LocalPhase.Downloaded,
        LocalPhase.Submitting,
        LocalPhase.Submitted,
    };

    public static bool IsActive(LocalJobState job) => ActivePhases.Contains(job.Phase);

    /// <summary>
    /// Rebuild every printer queue from the server's job list: <c>QUEUED</c> orders whose attempt is
    /// <c>READY</c> on a printer installed and enabled on this PC, minus attempts already touched here.
    /// </summary>
    /// <param name="localPrinterNamesById">Server printer id → Windows printer name, for printers on this PC.</param>
    public static void Sync(AgentState state, IEnumerable<ShopJob> serverJobs, IReadOnlyDictionary<string, string> localPrinterNamesById)
    {
        var previous = state.Queues.Values.SelectMany(q => q).ToDictionary(q => q.PrintJobId, StringComparer.OrdinalIgnoreCase);
        var queues = new Dictionary<string, List<QueuedJob>>(StringComparer.OrdinalIgnoreCase);

        foreach (var job in serverJobs)
        {
            var pj = job.PrintJob;
            if (job.Status != "QUEUED" || pj is null || pj.Status != "READY") continue;
            if (!localPrinterNamesById.TryGetValue(pj.PrinterId, out var printerName)) continue;
            if (state.Jobs.ContainsKey(pj.Id)) continue; // touched here once: never again

            if (!queues.TryGetValue(printerName, out var list)) queues[printerName] = list = new();
            list.Add(new QueuedJob
            {
                PrintJobId = pj.Id,
                OrderId = job.OrderId,
                PublicRef = job.PublicRef,
                Attempt = pj.Attempt,
                PrinterId = pj.PrinterId,
                SortKey = job.PaidAt ?? job.CreatedAt,
                EnqueuedAt = previous.TryGetValue(pj.Id, out var old) ? old.EnqueuedAt : DateTimeOffset.UtcNow,
            });
        }

        foreach (var list in queues.Values)
        {
            list.Sort((a, b) =>
            {
                int c = string.CompareOrdinal(a.SortKey, b.SortKey);
                return c != 0 ? c : string.CompareOrdinal(a.PrintJobId, b.PrintJobId);
            });
        }
        state.Queues = queues;
    }

    /// <summary>
    /// The oldest queued job of each printer that is free to lease now: no active local attempt on that
    /// printer (one active lease per printer) and not in a lease back-off.
    /// </summary>
    public static IReadOnlyList<(string PrinterName, QueuedJob Job)> Heads(AgentState state, ISet<string> waitingPrinters)
    {
        var busy = state.Jobs.Values.Where(IsActive).Select(j => j.PrinterName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return state.Queues
            .Where(kv => kv.Value.Count > 0 && !busy.Contains(kv.Key) && !waitingPrinters.Contains(kv.Key))
            .Select(kv => (kv.Key, kv.Value[0]))
            .OrderBy(x => x.Item2.SortKey, StringComparer.Ordinal)
            .ToList();
    }

    public static void Remove(AgentState state, string printJobId)
    {
        foreach (var list in state.Queues.Values) list.RemoveAll(q => string.Equals(q.PrintJobId, printJobId, StringComparison.OrdinalIgnoreCase));
        foreach (var key in state.Queues.Where(kv => kv.Value.Count == 0).Select(kv => kv.Key).ToList()) state.Queues.Remove(key);
    }

    /// <summary>Heartbeat <c>queueDepth</c>: jobs waiting in the local queues plus attempts in progress.</summary>
    public static int Depth(AgentState state) =>
        state.Queues.Values.Sum(q => q.Count) + state.Jobs.Values.Count(IsActive);

    /// <summary>Heartbeat <c>activePrintJobIds</c>: attempts this PC is printing or monitoring (leases renewed).</summary>
    public static List<string> ActivePrintJobIds(AgentState state) =>
        state.Jobs.Values.Where(IsActive).Select(j => j.PrintJobId).OrderBy(id => id, StringComparer.Ordinal).ToList();

    /// <summary>409 handling: wait, never retry a submitted attempt (the attempt here was never submitted).</summary>
    public static LeaseConflictAction OnLeaseRefused(string code) => code switch
    {
        ApiErrorCodes.PrinterBusy or ApiErrorCodes.NotNextInQueue => LeaseConflictAction.WaitForPrinter,
        ApiErrorCodes.JobNotLeasable or "JOB_NOT_READY" or "INVALID_TRANSITION" or "NOT_FOUND" or "NotFound" => LeaseConflictAction.DropFromQueue,
        // P1 API: packet not built yet — try again later.
        "PACKET_MISSING" => LeaseConflictAction.WaitForPrinter,
        _ => LeaseConflictAction.Rethrow,
    };
}

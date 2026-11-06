using System.Collections.Immutable;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Pure reconciliation decision engine (Appendix A.3).
/// Never resubmits an attempt; anything ambiguous goes to the operator via NEEDS_OPERATOR_CHECK.
/// </summary>
public static class Reconciliation
{
    /// <summary>Minimal view of a server job needed for reconciliation.</summary>
    public sealed record ServerJob(
        string PrintJobId,
        string OrderId,
        string Status,
        string DocumentName,
        bool LeasedByThisDevice,
        string PrinterName,
        string? PrintJobStatus = null);

    /// <summary>Print-job states in which the attempt is still in flight on this device.</summary>
    private static readonly HashSet<string> InFlightPrintJobStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "LEASED",
        "SUBMITTED",
    };

    public enum Decision
    {
        /// <summary>The spooler still has the job; resume monitoring it.</summary>
        ResumeMonitor,
        /// <summary>Never reached the spooler; report FAILED "Not confirmed after restart".</summary>
        ReportFailedNotSubmitted,
        /// <summary>Ambiguous outcome; report UNCERTAIN.</summary>
        ReportUncertain,
        /// <summary>A QUEUED job; enqueue locally so normal leasing handles it.</summary>
        Enqueue,
        /// <summary>No server action; local-only cleanup.</summary>
        None,
    }

    /// <summary>Outcome of reconciling one server job.</summary>
    public sealed record Outcome(string PrintJobId, string? OrderId, Decision Decision, string? Reason);

    private static readonly HashSet<string> PhasesNeverSubmitted = new(StringComparer.OrdinalIgnoreCase)
    {
        LocalPhase.NotStarted,
        LocalPhase.Downloaded,
    };

    /// <summary>
    /// Decide reconciliation actions for all relevant server jobs.
    /// <paramref name="spooledDocumentNames"/> are document names currently present in the Windows spooler.
    /// </summary>
    public static IReadOnlyList<Outcome> Decide(
        IReadOnlyList<ServerJob> serverJobs,
        IReadOnlyDictionary<string, string> localPhases,
        ISet<string> spooledDocumentNames)
    {
        var outcomes = new List<Outcome>();
        var serverJobIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var job in serverJobs)
        {
            serverJobIds.Add(job.PrintJobId);

            if (job.Status == "PRINTING" && job.LeasedByThisDevice
                && (job.PrintJobStatus is null || InFlightPrintJobStatuses.Contains(job.PrintJobStatus)))
            {
                bool hasSpooler = spooledDocumentNames.Contains(job.DocumentName);
                string? phase = localPhases.TryGetValue(job.PrintJobId, out var p) ? p : null;

                if (hasSpooler)
                {
                    outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ResumeMonitor, null));
                }
                else if (phase is not null && PhasesNeverSubmitted.Contains(phase))
                {
                    outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ReportFailedNotSubmitted,
                        "Print job never reached the spooler after restart"));
                }
                else
                {
                    outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ReportUncertain,
                        "Print outcome could not be confirmed after restart"));
                }
            }
            else if (job.Status == "QUEUED")
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.Enqueue, null));
            }
        }

        // Local entries the server no longer lists are cleared locally.
        foreach (var localId in localPhases.Keys)
        {
            if (!serverJobIds.Contains(localId))
            {
                outcomes.Add(new Outcome(localId, null, Decision.None, "Removed from server"));
            }
        }

        return outcomes.ToImmutableList();
    }
}

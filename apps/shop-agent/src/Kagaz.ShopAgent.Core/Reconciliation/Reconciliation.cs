using System.Collections.Immutable;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Pure reconciliation decision engine (P2.8, plan Appendix A.3), run on startup and on every reconnect.
/// Compares the server's jobs, this PC's <c>state.json</c> and the Windows spooler (by document name
/// <c>KAGAZ-&lt;ref&gt;-A&lt;attempt&gt;</c>).
/// <para><b>Never resubmits an attempt.</b> The only decisions are: keep monitoring what is still in the
/// spooler, report what is provable (never reached the spooler → FAILED; observed outcome whose report
/// was lost → re-send it), and report <c>UNCERTAIN</c> for everything else so the operator checks the
/// tray (order → NEEDS_OPERATOR_CHECK).</para>
/// </summary>
public static class Reconciliation
{
    /// <summary>Minimal view of a server job (from <c>GET /shop/jobs?status=PRINTING,QUEUED,NEEDS_OPERATOR_CHECK</c>).</summary>
    public sealed record ServerJob(
        string PrintJobId,
        string OrderId,
        string Status,
        string? PrintJobStatus,
        string PublicRef = "",
        int Attempt = 1);

    public enum Decision
    {
        /// <summary>The spooler still has the job: resume monitoring it (report SUBMITTED first if the server only saw LEASED).</summary>
        ResumeMonitor,
        /// <summary>Phase NOT_STARTED/DOWNLOADED and not in the spooler: report FAILED "NOT_SUBMITTED" (never auto-retried in v1).</summary>
        ReportFailedNotSubmitted,
        /// <summary>Outcome unprovable: report UNCERTAIN.</summary>
        ReportUncertain,
        /// <summary>The agent observed SPOOLER_COMPLETE but the server never got the report: send it again.</summary>
        ResendSpoolerComplete,
        /// <summary>The agent decided FAILED/UNCERTAIN but the report was lost: send it again with the stored reason.</summary>
        ResendOutcome,
        /// <summary>The spooler can't be read right now (e.g. spooler service still starting after a reboot): reconcile again shortly.</summary>
        Defer,
        /// <summary>A QUEUED job: enqueue locally (normal path; the lease decides who prints).</summary>
        Enqueue,
        /// <summary>Already being monitored by this process (reconnect without restart): nothing to do.</summary>
        AlreadyMonitoring,
        /// <summary>The server no longer lists this attempt: drop the local entry.</summary>
        Forget,
        /// <summary>No action.</summary>
        None,
    }

    /// <summary>Outcome of reconciling one attempt.</summary>
    public sealed record Outcome(string PrintJobId, string? OrderId, Decision Decision, string? Reason, bool ReportSubmittedFirst = false);

    /// <summary>Server print-job states in which the attempt is still in flight (leased to some device).</summary>
    private static readonly HashSet<string> InFlight = new(StringComparer.OrdinalIgnoreCase) { "LEASED", "SUBMITTED" };

    private static readonly HashSet<string> NeverSubmitted = new(StringComparer.OrdinalIgnoreCase)
    {
        LocalPhase.NotStarted,
        LocalPhase.Downloaded,
    };

    public const string NotSubmittedReason = "NOT_SUBMITTED: the app stopped before this attempt reached the printer; nothing was printed";
    public const string UncertainReason = "UNCERTAIN: the app restarted or lost connection and could not confirm this print; check the output tray";
    public const string SpoolerUnavailableReason = "SPOOLER_UNAVAILABLE: the Windows print queue could not be read after restart; check the output tray";

    /// <param name="serverJobs">Active server jobs.</param>
    /// <param name="local">This PC's attempts from <c>state.json</c>, keyed by print-job id.</param>
    /// <param name="spooledByPrinter">
    /// Document names in each printer's Windows queue; a null value means that queue could not be read.
    /// Printers missing from the map are treated as unreadable.
    /// </param>
    /// <param name="monitoredInProcess">Attempts this process is already monitoring.</param>
    /// <param name="deferIfSpoolerUnreadable">
    /// True on the first passes after startup: an unreadable spooler defers instead of going UNCERTAIN.
    /// </param>
    public static IReadOnlyList<Outcome> Decide(
        IReadOnlyList<ServerJob> serverJobs,
        IReadOnlyDictionary<string, LocalJobState> local,
        IReadOnlyDictionary<string, ISet<string>?> spooledByPrinter,
        ISet<string>? monitoredInProcess = null,
        bool deferIfSpoolerUnreadable = false)
    {
        monitoredInProcess ??= new HashSet<string>();
        var outcomes = new List<Outcome>();
        var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var job in serverJobs)
        {
            listed.Add(job.PrintJobId);
            local.TryGetValue(job.PrintJobId, out var mine);

            if (job.Status == "QUEUED")
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.Enqueue, null));
                continue;
            }

            bool inFlight = job.Status == "PRINTING" && job.PrintJobStatus is not null && InFlight.Contains(job.PrintJobStatus);
            if (!inFlight || mine is null)
            {
                // Spooler complete (server moves it to Ready), in NEEDS_OPERATOR_CHECK, or leased by another device: not ours to act on.
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.None, null));
                continue;
            }

            if (monitoredInProcess.Contains(job.PrintJobId))
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.AlreadyMonitoring, null));
                continue;
            }

            // An outcome we already decided but whose report never landed: re-send it (provable).
            if (mine.Phase == LocalPhase.Done)
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ResendSpoolerComplete, null));
                continue;
            }
            if (mine.Phase is LocalPhase.Failed or LocalPhase.Uncertain)
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ResendOutcome,
                    mine.Reason ?? UncertainReason));
                continue;
            }

            spooledByPrinter.TryGetValue(mine.PrinterName, out var spooled);
            bool inSpooler = spooled is not null && spooled.Contains(mine.DocumentName);

            if (inSpooler)
            {
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ResumeMonitor, null,
                    ReportSubmittedFirst: string.Equals(job.PrintJobStatus, "LEASED", StringComparison.OrdinalIgnoreCase)));
            }
            else if (NeverSubmitted.Contains(mine.Phase))
            {
                // The print engine was never called for this attempt (phase is persisted before it is).
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ReportFailedNotSubmitted, NotSubmittedReason));
            }
            else if (spooled is null)
            {
                outcomes.Add(deferIfSpoolerUnreadable
                    ? new Outcome(job.PrintJobId, job.OrderId, Decision.Defer, "Windows print queue not readable yet")
                    : new Outcome(job.PrintJobId, job.OrderId, Decision.ReportUncertain, SpoolerUnavailableReason));
            }
            else
            {
                // SUBMITTING / SUBMITTED and gone from the spooler: printed, partly printed or lost — can't tell.
                outcomes.Add(new Outcome(job.PrintJobId, job.OrderId, Decision.ReportUncertain, UncertainReason));
            }
        }

        foreach (var (id, _) in local)
        {
            if (!listed.Contains(id) && !monitoredInProcess.Contains(id))
            {
                outcomes.Add(new Outcome(id, null, Decision.Forget, "No longer active on the server"));
            }
        }

        return outcomes.ToImmutableList();
    }
}

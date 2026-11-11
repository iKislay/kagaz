using Kagaz.ShopAgent.Core;
using D = Kagaz.ShopAgent.Core.Reconciliation.Decision;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.8 / plan A.3: one test per branch. Nothing here ever decides to print.</summary>
public class ReconciliationTests
{
    private const string Doc = "KAGAZ-KGZ-AAAA-A1";
    private const string Printer = "EPSON";

    private static Reconciliation.ServerJob Printing(string printJobStatus = "SUBMITTED", string id = "pj-1") =>
        new(id, "o-1", "PRINTING", printJobStatus, "KGZ-AAAA", 1);

    private static Dictionary<string, LocalJobState> Local(string phase, string id = "pj-1", string? reason = null) => new()
    {
        [id] = new LocalJobState
        {
            PrintJobId = id, OrderId = "o-1", Phase = phase, DocumentName = Doc, PrinterName = Printer,
            PublicRef = "KGZ-AAAA", Attempt = 1, Reason = reason,
        },
    };

    private static Dictionary<string, ISet<string>?> Spooled(params string[] docs) =>
        new() { [Printer] = new HashSet<string>(docs, StringComparer.OrdinalIgnoreCase) };

    private static Dictionary<string, ISet<string>?> Unreadable() => new() { [Printer] = null };

    private static Reconciliation.Outcome Single(IReadOnlyList<Reconciliation.Outcome> outcomes)
    {
        Assert.Single(outcomes);
        return outcomes[0];
    }

    [Theory]
    [InlineData(LocalPhase.Submitting)]
    [InlineData(LocalPhase.Submitted)]
    [InlineData(LocalPhase.Downloaded)] // paranoia: present in the spooler wins over the local phase
    public void Still_in_spooler_resumes_monitoring(string phase)
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(phase), Spooled(Doc)));

        Assert.Equal(D.ResumeMonitor, o.Decision);
        Assert.False(o.ReportSubmittedFirst);
    }

    [Fact]
    public void Still_in_spooler_but_server_only_saw_lease_reports_submitted_first()
    {
        var o = Single(Reconciliation.Decide([Printing("LEASED")], Local(LocalPhase.Submitting), Spooled(Doc)));

        Assert.Equal(D.ResumeMonitor, o.Decision);
        Assert.True(o.ReportSubmittedFirst);
    }

    [Theory]
    [InlineData(LocalPhase.NotStarted)]
    [InlineData(LocalPhase.Downloaded)]
    public void Never_reached_spooler_reports_failed_not_submitted(string phase)
    {
        var o = Single(Reconciliation.Decide([Printing("LEASED")], Local(phase), Spooled()));

        Assert.Equal(D.ReportFailedNotSubmitted, o.Decision);
        Assert.StartsWith("NOT_SUBMITTED", o.Reason);
    }

    [Theory]
    [InlineData(LocalPhase.Submitting)]
    [InlineData(LocalPhase.Submitted)]
    public void Submitted_and_gone_from_spooler_reports_uncertain(string phase)
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(phase), Spooled("KAGAZ-OTHER-A1")));

        Assert.Equal(D.ReportUncertain, o.Decision);
        Assert.StartsWith("UNCERTAIN", o.Reason);
    }

    [Fact]
    public void Unreadable_spooler_defers_during_startup_window()
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(LocalPhase.Submitted), Unreadable(), deferIfSpoolerUnreadable: true));

        Assert.Equal(D.Defer, o.Decision);
    }

    [Fact]
    public void Unreadable_spooler_after_startup_window_reports_uncertain()
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(LocalPhase.Submitted), Unreadable(), deferIfSpoolerUnreadable: false));

        Assert.Equal(D.ReportUncertain, o.Decision);
        Assert.StartsWith("SPOOLER_UNAVAILABLE", o.Reason);
    }

    [Fact]
    public void Unreadable_spooler_does_not_block_proving_never_submitted()
    {
        var o = Single(Reconciliation.Decide([Printing("LEASED")], Local(LocalPhase.Downloaded), Unreadable(), deferIfSpoolerUnreadable: true));

        Assert.Equal(D.ReportFailedNotSubmitted, o.Decision);
    }

    [Fact]
    public void Observed_complete_but_report_lost_resends_spooler_complete()
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(LocalPhase.Done), Spooled()));

        Assert.Equal(D.ResendSpoolerComplete, o.Decision);
    }

    [Theory]
    [InlineData(LocalPhase.Failed, "PAPER_OUT: Printer is out of paper")]
    [InlineData(LocalPhase.Uncertain, "DELETED: removed after printing started")]
    public void Decided_outcome_but_report_lost_resends_it_verbatim(string phase, string reason)
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(phase, reason: reason), Spooled(Doc)));

        Assert.Equal(D.ResendOutcome, o.Decision);
        Assert.Equal(reason, o.Reason);
    }

    [Fact]
    public void Already_monitored_in_process_is_left_alone()
    {
        var o = Single(Reconciliation.Decide([Printing()], Local(LocalPhase.Submitted), Spooled(),
            monitoredInProcess: new HashSet<string> { "pj-1" }));

        Assert.Equal(D.AlreadyMonitoring, o.Decision);
    }

    [Fact]
    public void Printing_job_leased_by_another_device_is_ignored()
    {
        var o = Single(Reconciliation.Decide([Printing()], new Dictionary<string, LocalJobState>(), Spooled(Doc)));

        Assert.Equal(D.None, o.Decision);
    }

    [Fact]
    public void Spooler_complete_waiting_for_mark_ready_is_left_alone()
    {
        var o = Single(Reconciliation.Decide([Printing("SPOOLER_COMPLETE")], Local(LocalPhase.Done), Spooled()));

        Assert.Equal(D.None, o.Decision);
    }

    [Fact]
    public void Needs_operator_check_is_left_to_the_operator()
    {
        var job = new Reconciliation.ServerJob("pj-1", "o-1", "NEEDS_OPERATOR_CHECK", "UNCERTAIN");

        var o = Single(Reconciliation.Decide([job], Local(LocalPhase.Submitted), Spooled(Doc)));

        Assert.Equal(D.None, o.Decision);
    }

    [Fact]
    public void Queued_job_is_enqueued()
    {
        var job = new Reconciliation.ServerJob("pj-2", "o-2", "QUEUED", "READY");

        var o = Single(Reconciliation.Decide([job], new Dictionary<string, LocalJobState>(), Spooled()));

        Assert.Equal(D.Enqueue, o.Decision);
    }

    [Fact]
    public void Local_entries_the_server_no_longer_lists_are_forgotten_unless_monitored()
    {
        var local = Local(LocalPhase.Done, "pj-old");
        local["pj-live"] = new LocalJobState { PrintJobId = "pj-live", Phase = LocalPhase.Submitted, PrinterName = Printer, DocumentName = "X" };

        var outcomes = Reconciliation.Decide([], local, Spooled(), monitoredInProcess: new HashSet<string> { "pj-live" });

        var o = Single(outcomes);
        Assert.Equal("pj-old", o.PrintJobId);
        Assert.Equal(D.Forget, o.Decision);
    }

    [Fact]
    public void Superseded_attempt_is_forgotten_and_new_attempt_enqueued()
    {
        // REPRINT created attempt 2 (READY, order QUEUED); attempt 1 is no longer listed.
        var job = new Reconciliation.ServerJob("pj-2", "o-1", "QUEUED", "READY", "KGZ-AAAA", 2);

        var outcomes = Reconciliation.Decide([job], Local(LocalPhase.Uncertain, "pj-1"), Spooled());

        Assert.Contains(outcomes, o => o.PrintJobId == "pj-2" && o.Decision == D.Enqueue);
        Assert.Contains(outcomes, o => o.PrintJobId == "pj-1" && o.Decision == D.Forget);
    }

    [Fact]
    public void No_decision_ever_resubmits()
    {
        // Exhaustive over phases × spooler states × server print-job states.
        string[] phases = [LocalPhase.NotStarted, LocalPhase.Downloaded, LocalPhase.Submitting, LocalPhase.Submitted,
            LocalPhase.Done, LocalPhase.Failed, LocalPhase.Uncertain];
        string[] pjStatuses = ["LEASED", "SUBMITTED", "SPOOLER_COMPLETE", "FAILED", "UNCERTAIN"];
        var spoolerStates = new[] { Spooled(Doc), Spooled(), Unreadable() };
        var allowed = Enum.GetValues<D>().Except([D.Enqueue]).ToHashSet();

        foreach (var phase in phases)
        foreach (var pj in pjStatuses)
        foreach (var spooled in spoolerStates)
        foreach (bool defer in new[] { true, false })
        {
            var outcomes = Reconciliation.Decide([Printing(pj)], Local(phase), spooled, deferIfSpoolerUnreadable: defer);
            Assert.All(outcomes, o => Assert.Contains(o.Decision, allowed));
        }
    }
}

using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class ReconciliationTests
{
    private static Reconciliation.ServerJob PrintingJob(string printJobId, string orderId, string documentName,
        bool leasedByThisDevice = true, string printerName = "EPSON") =>
        new(printJobId, orderId, "PRINTING", documentName, leasedByThisDevice, printerName);

    private static readonly HashSet<string> EmptySpooled = new();

    [Fact]
    public void Printing_leased_and_spooled_job_resumes_monitoring()
    {
        var jobs = new List<Reconciliation.ServerJob> { PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1") };
        var local = new Dictionary<string, string> { ["pj-1"] = "DOWNLOADED" };

        var outcomes = Reconciliation.Decide(jobs, local, new HashSet<string> { "KAGAZ-KGZ-AAAA-A1" });

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ResumeMonitor, outcomes[0].Decision);
        Assert.Null(outcomes[0].Reason);
    }

    [Fact]
    public void Printing_leased_never_reached_spooler_with_local_not_started_reports_failed()
    {
        var jobs = new List<Reconciliation.ServerJob> { PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1") };
        var local = new Dictionary<string, string> { ["pj-1"] = "NOT_STARTED" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ReportFailedNotSubmitted, outcomes[0].Decision);
        Assert.Contains("never reached the spooler", outcomes[0].Reason);
    }

    [Fact]
    public void Printing_leased_never_reached_spooler_with_local_downloaded_reports_failed()
    {
        var jobs = new List<Reconciliation.ServerJob> { PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1") };
        var local = new Dictionary<string, string> { ["pj-1"] = "DOWNLOADED" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ReportFailedNotSubmitted, outcomes[0].Decision);
    }

    [Fact]
    public void Printing_leased_never_reached_spooler_with_local_submitted_reports_uncertain()
    {
        var jobs = new List<Reconciliation.ServerJob> { PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1") };
        var local = new Dictionary<string, string> { ["pj-1"] = "SUBMITTED" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ReportUncertain, outcomes[0].Decision);
    }

    [Fact]
    public void Printing_leased_with_no_local_entry_reports_uncertain()
    {
        var jobs = new List<Reconciliation.ServerJob> { PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1") };

        var outcomes = Reconciliation.Decide(jobs, new Dictionary<string, string>(), EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ReportUncertain, outcomes[0].Decision);
    }

    [Fact]
    public void Printing_not_leased_by_this_device_is_ignored()
    {
        var jobs = new List<Reconciliation.ServerJob>
        {
            new("pj-1", "o-1", "PRINTING", "KAGAZ-KGZ-AAAA-A1", false, "EPSON")
        };

        var outcomes = Reconciliation.Decide(jobs, new Dictionary<string, string>(), EmptySpooled);

        Assert.Empty(outcomes);
    }

    [Fact]
    public void Queued_job_is_enqueued()
    {
        var jobs = new List<Reconciliation.ServerJob>
        {
            new("pj-1", "o-1", "QUEUED", "KAGAZ-KGZ-AAAA-A1", true, "EPSON")
        };

        var outcomes = Reconciliation.Decide(jobs, new Dictionary<string, string>(), EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.Enqueue, outcomes[0].Decision);
    }

    [Fact]
    public void Local_entry_no_longer_on_server_is_marked_for_cleanup()
    {
        var jobs = new List<Reconciliation.ServerJob>();
        var local = new Dictionary<string, string> { ["pj-stale"] = "SUBMITTED" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.None, outcomes[0].Decision);
        Assert.Equal("Removed from server", outcomes[0].Reason);
    }

    [Fact]
    public void Multiple_jobs_produce_one_outcome_each()
    {
        var jobs = new List<Reconciliation.ServerJob>
        {
            PrintingJob("pj-1", "o-1", "KAGAZ-KGZ-AAAA-A1"),
            new("pj-2", "o-2", "QUEUED", "KAGAZ-KGZ-BBBB-A1", true, "EPSON")
        };
        var local = new Dictionary<string, string> { ["pj-1"] = "SUBMITTED" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Equal(2, outcomes.Count);
        Assert.Contains(outcomes, o => o.PrintJobId == "pj-1" && o.Decision == Reconciliation.Decision.ReportUncertain);
        Assert.Contains(outcomes, o => o.PrintJobId == "pj-2" && o.Decision == Reconciliation.Decision.Enqueue);
    }

    [Fact]
    public void Printing_job_already_spooler_complete_is_left_for_mark_ready()
    {
        // Printed and reported before the restart: the order waits for the operator, no report.
        var jobs = new List<Reconciliation.ServerJob>
        {
            new("pj-1", "o-1", "PRINTING", "KAGAZ-KGZ-AAAA-A1", true, "EPSON", "SPOOLER_COMPLETE"),
        };
        var local = new Dictionary<string, string> { ["pj-1"] = "DONE" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Empty(outcomes);
    }

    [Fact]
    public void Crash_while_submitting_is_uncertain_never_reprinted()
    {
        var jobs = new List<Reconciliation.ServerJob>
        {
            new("pj-1", "o-1", "PRINTING", "KAGAZ-KGZ-AAAA-A1", true, "EPSON", "LEASED"),
        };
        var local = new Dictionary<string, string> { ["pj-1"] = "SUBMITTING" };

        var outcomes = Reconciliation.Decide(jobs, local, EmptySpooled);

        Assert.Single(outcomes);
        Assert.Equal(Reconciliation.Decision.ReportUncertain, outcomes[0].Decision);
    }
}

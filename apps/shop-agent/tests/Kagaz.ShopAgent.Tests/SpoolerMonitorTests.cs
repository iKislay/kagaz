using Kagaz.ShopAgent.Core.Spooler;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.10: spooler states → SPOOLER_COMPLETE / FAILED(reason) / UNCERTAIN, and printer health.</summary>
public class SpoolerMonitorTests
{
    private const string Doc = "KAGAZ-KGZ-AAAA-A1";
    private static readonly DateTimeOffset T0 = DateTimeOffset.Parse("2026-11-07T10:00:00Z");
    private static readonly PrinterQueueSnapshot Ready = new();

    private static SpoolerMonitor Monitor() => new(Doc, T0);

    private static SpoolerObservation With(SpoolerJobSnapshot? job, PrinterQueueSnapshot? queue = null) =>
        new(queue ?? Ready, job is null ? [] : [job]);

    private static SpoolerJobSnapshot Job(bool spooling = false, bool printing = false, int printed = 0, int total = 5,
        bool completed = false, bool printedFlag = false, bool deleting = false, bool error = false, bool offline = false,
        bool paperOut = false, bool intervention = false) =>
        new(7, Doc, IsSpooling: spooling, IsPrinting: printing, PagesPrinted: printed, TotalPages: total, IsCompleted: completed,
            IsPrinted: printedFlag, IsDeleting: deleting, IsInError: error, IsOffline: offline, IsPaperOut: paperOut,
            IsUserInterventionRequired: intervention);

    [Fact]
    public void Spooling_then_printing_is_pending_with_progress()
    {
        var m = Monitor();

        var a = m.Observe(With(Job(spooling: true)), T0.AddSeconds(1));
        var b = m.Observe(With(Job(printing: true, printed: 1)), T0.AddSeconds(2));

        Assert.Equal(SpoolerOutcome.Pending, a.Outcome);
        Assert.Equal("Sending to the printer", a.StatusText);
        Assert.Equal(SpoolerOutcome.Pending, b.Outcome);
        Assert.Equal("Printing page 2 of 5", b.StatusText);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void Completed_or_printed_flag_is_spooler_complete(bool completed, bool printed)
    {
        var v = Monitor().Observe(With(Job(completed: completed, printedFlag: printed)), T0.AddSeconds(3));

        Assert.Equal(SpoolerOutcome.SpoolerComplete, v.Outcome);
    }

    [Fact]
    public void Job_leaving_queue_after_printing_normally_is_spooler_complete()
    {
        var m = Monitor();
        m.Observe(With(Job(printing: true, printed: 4)), T0.AddSeconds(1));

        var v = m.Observe(With(null), T0.AddSeconds(2));

        Assert.Equal(SpoolerOutcome.SpoolerComplete, v.Outcome);
    }

    [Fact]
    public void Job_never_seen_counts_as_spooled_and_despooled()
    {
        Assert.Equal(SpoolerOutcome.SpoolerComplete, Monitor().Observe(With(null), T0.AddSeconds(1)).Outcome);
    }

    [Fact]
    public void Deleted_before_printing_is_failed()
    {
        var v = Monitor().Observe(With(Job(spooling: true, deleting: true)), T0.AddSeconds(1));

        Assert.Equal(SpoolerOutcome.Failed, v.Outcome);
        Assert.StartsWith("DELETED", v.Reason);
    }

    [Fact]
    public void Deleted_after_printing_started_is_uncertain()
    {
        var m = Monitor();
        m.Observe(With(Job(printing: true, printed: 2)), T0.AddSeconds(1));

        var v = m.Observe(With(Job(deleting: true, printed: 2)), T0.AddSeconds(2));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
        Assert.StartsWith("DELETED", v.Reason);
    }

    [Fact]
    public void Deleting_then_gone_is_still_treated_as_deleted()
    {
        var m = Monitor();
        m.Observe(With(Job(deleting: true)), T0.AddSeconds(1)); // would already be final; a caller that keeps polling…
        var v = m.Observe(With(null), T0.AddSeconds(2));

        Assert.Equal(SpoolerOutcome.Failed, v.Outcome);
    }

    [Fact]
    public void Paper_out_within_grace_is_pending_with_problem()
    {
        var v = Monitor().Observe(With(Job(paperOut: true)), T0.AddSeconds(5));

        Assert.Equal(SpoolerOutcome.Pending, v.Outcome);
        Assert.Equal("Printer is out of paper", v.Problem);
    }

    [Fact]
    public void Paper_out_before_printing_past_grace_is_failed_and_says_it_may_print_later()
    {
        var m = Monitor();
        m.Observe(With(Job(paperOut: true)), T0.AddSeconds(1));

        var v = m.Observe(With(Job(paperOut: true)), T0.AddSeconds(40));

        Assert.Equal(SpoolerOutcome.Failed, v.Outcome);
        Assert.StartsWith("PAPER_OUT", v.Reason);
        Assert.Contains("may print when fixed", v.Reason);
    }

    [Fact]
    public void Offline_after_printing_started_past_grace_is_uncertain()
    {
        var m = Monitor();
        m.Observe(With(Job(printing: true, printed: 1)), T0.AddSeconds(1));
        m.Observe(With(Job(offline: true, printed: 1)), T0.AddSeconds(2));

        var v = m.Observe(With(Job(offline: true, printed: 1)), T0.AddSeconds(40));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
        Assert.StartsWith("PRINTER_OFFLINE", v.Reason);
    }

    [Fact]
    public void Queue_level_error_counts_as_a_problem()
    {
        var m = Monitor();
        var queue = new PrinterQueueSnapshot(IsPaperJammed: true);
        m.Observe(With(Job(spooling: true), queue), T0.AddSeconds(1));

        var v = m.Observe(With(Job(spooling: true), queue), T0.AddSeconds(35));

        Assert.Equal(SpoolerOutcome.Failed, v.Outcome);
        Assert.StartsWith("PRINTER_ERROR", v.Reason);
    }

    [Fact]
    public void Transient_problem_that_clears_resets_the_grace()
    {
        var m = Monitor();
        m.Observe(With(Job(error: true)), T0.AddSeconds(1));
        m.Observe(With(Job(printing: true)), T0.AddSeconds(20));
        var v = m.Observe(With(Job(error: true, printed: 1)), T0.AddSeconds(40));

        Assert.Equal(SpoolerOutcome.Pending, v.Outcome);
    }

    [Fact]
    public void Job_vanishing_while_printer_reports_problem_is_uncertain()
    {
        var m = Monitor();
        m.Observe(With(Job(intervention: true)), T0.AddSeconds(1));

        var v = m.Observe(With(null), T0.AddSeconds(2));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
    }

    [Fact]
    public void Printer_removed_is_uncertain()
    {
        var v = Monitor().Observe(new SpoolerObservation(PrinterQueueSnapshot.Missing, null), T0.AddSeconds(1));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
        Assert.StartsWith("PRINTER_REMOVED", v.Reason);
    }

    [Fact]
    public void Unreadable_queue_is_pending_then_uncertain_after_grace()
    {
        var m = Monitor();
        var unreadable = new SpoolerObservation(null, null);

        Assert.Equal(SpoolerOutcome.Pending, m.Observe(unreadable, T0.AddSeconds(30)).Outcome);
        var v = m.Observe(unreadable, T0.AddSeconds(61));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
        Assert.StartsWith("SPOOLER_UNAVAILABLE", v.Reason);
    }

    [Fact]
    public void Stuck_in_queue_without_problem_is_uncertain_after_timeout()
    {
        var m = new SpoolerMonitor(Doc, T0, new SpoolerMonitorOptions { StuckTimeout = TimeSpan.FromMinutes(30) });

        Assert.Equal(SpoolerOutcome.Pending, m.Observe(With(Job()), T0.AddMinutes(29)).Outcome);
        var v = m.Observe(With(Job()), T0.AddMinutes(30));

        Assert.Equal(SpoolerOutcome.Uncertain, v.Outcome);
        Assert.StartsWith("STUCK", v.Reason);
    }

    [Fact]
    public void Other_documents_in_the_queue_are_ignored()
    {
        var other = new SpoolerJobSnapshot(9, "KAGAZ-KGZ-BBBB-A1", IsPaperOut: true);
        var v = Monitor().Observe(new SpoolerObservation(Ready, [other, Job(printing: true)]), T0.AddSeconds(40));

        Assert.Equal(SpoolerOutcome.Pending, v.Outcome);
        Assert.Null(v.Problem);
    }

    // ─── Printer health (heartbeat) ───

    [Fact]
    public void Printer_health_maps_queue_states()
    {
        Assert.Equal(PrinterHealthStatus.Ready, PrinterHealth.Map(new PrinterQueueSnapshot()).Status);
        Assert.Equal(PrinterHealthStatus.Offline, PrinterHealth.Map(new PrinterQueueSnapshot(IsOffline: true)).Status);
        Assert.Equal(PrinterHealthStatus.Offline, PrinterHealth.Map(new PrinterQueueSnapshot(IsNotAvailable: true)).Status);
        Assert.Equal(PrinterHealthStatus.PaperOut, PrinterHealth.Map(new PrinterQueueSnapshot(IsOutOfPaper: true)).Status);
        Assert.Equal(PrinterHealthStatus.PaperOut, PrinterHealth.Map(new PrinterQueueSnapshot(HasPaperProblem: true)).Status);
        Assert.Equal(PrinterHealthStatus.Error, PrinterHealth.Map(new PrinterQueueSnapshot(IsPaperJammed: true)).Status);
        Assert.Equal(PrinterHealthStatus.Error, PrinterHealth.Map(new PrinterQueueSnapshot(IsInError: true)).Status);
        Assert.Equal(PrinterHealthStatus.Error, PrinterHealth.Map(new PrinterQueueSnapshot(IsDoorOpened: true)).Status);
        Assert.Equal(PrinterHealthStatus.Error, PrinterHealth.Map(new PrinterQueueSnapshot(IsPaused: true)).Status);
        Assert.Equal(PrinterHealthStatus.Unknown, PrinterHealth.Map(null).Status);
        Assert.Equal(PrinterHealthStatus.Offline, PrinterHealth.Map(PrinterQueueSnapshot.Missing).Status);
    }

    [Fact]
    public void Toner_flags_never_block_the_printer()
    {
        Assert.Equal(PrinterHealthStatus.Ready, PrinterHealth.Map(new PrinterQueueSnapshot(IsTonerOut: true)).Status);
    }

    [Fact]
    public void Installed_but_unreachable_printer_is_offline_even_when_queue_says_ready()
    {
        var h = PrinterHealth.Map(new PrinterQueueSnapshot(), "Printer is installed but not responding — check it is on, awake and connected");

        Assert.Equal(PrinterHealthStatus.Offline, h.Status);
        Assert.Contains("not responding", h.LastError);
    }
}

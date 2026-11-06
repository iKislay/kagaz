using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class JobTabMappingTests
{
    private static ShopJob Job(string status) =>
        new(
            OrderId: "o-1", PublicRef: "KGZ-ABCD12", Status: status,
            Options: new ShopPrintOptions(null, 1, false, false, "A4"),
            PageCount: 3, PrintedSides: null, AmountPaise: 200, SimulatedPayment: true,
            CreatedAt: "2026-11-05T10:00:00Z", PaidAt: null, PrintJob: null, Rejection: null, PreviewUrl: null);

    [Fact]
    public void Pending_review_maps_to_pending_tab()
    {
        var item = new JobItem(Job("PENDING_REVIEW"));
        Assert.Equal("Pending", item.TabCategory);
        Assert.True(item.CanAccept);
        Assert.True(item.CanReject);
        Assert.False(item.CanMarkReady);
    }

    [Fact]
    public void Queued_maps_to_queue_tab()
    {
        var item = new JobItem(Job("QUEUED"));
        Assert.Equal("Queue", item.TabCategory);
        Assert.False(item.CanAccept);
        Assert.True(item.CanReject);
        Assert.False(item.CanMarkReady);
    }

    [Fact]
    public void Printing_maps_to_printing_tab()
    {
        var item = new JobItem(Job("PRINTING"));
        Assert.Equal("Printing", item.TabCategory);
    }

    [Fact]
    public void Needs_operator_check_maps_to_needs_check_tab()
    {
        var item = new JobItem(Job("NEEDS_OPERATOR_CHECK"));
        Assert.Equal("Needs check", item.TabCategory);
    }

    [Fact]
    public void Ready_for_pickup_maps_to_ready_tab()
    {
        var item = new JobItem(Job("READY_FOR_PICKUP"));
        Assert.Equal("Ready", item.TabCategory);
    }

    [Fact]
    public void Unknown_status_maps_to_other_tab()
    {
        var item = new JobItem(Job("CANCELLED"));
        Assert.Equal("Other", item.TabCategory);
    }

    [Fact]
    public void Mark_ready_requires_submitted_or_spooler_complete()
    {
        var submitted = new JobItem(new ShopJob(
            "o-1", "KGZ-ABCD12", "PRINTING",
            new ShopPrintOptions(null, 1, false, false, "A4"), 3, null, 200, true,
            "2026-11-05T10:00:00Z", null,
            new ShopPrintJob("pj-1", 1, "SUBMITTED", "pr-1", 42, null), null, null));
        Assert.True(submitted.CanMarkReady);

        var complete = new JobItem(new ShopJob(
            "o-1", "KGZ-ABCD12", "PRINTING",
            new ShopPrintOptions(null, 1, false, false, "A4"), 3, null, 200, true,
            "2026-11-05T10:00:00Z", null,
            new ShopPrintJob("pj-1", 1, "SPOOLER_COMPLETE", "pr-1", 42, null), null, null));
        Assert.True(complete.CanMarkReady);

        var leased = new JobItem(new ShopJob(
            "o-1", "KGZ-ABCD12", "PRINTING",
            new ShopPrintOptions(null, 1, false, false, "A4"), 3, null, 200, true,
            "2026-11-05T10:00:00Z", null,
            new ShopPrintJob("pj-1", 1, "LEASED", "pr-1", null, null), null, null));
        Assert.False(leased.CanMarkReady);
    }
}

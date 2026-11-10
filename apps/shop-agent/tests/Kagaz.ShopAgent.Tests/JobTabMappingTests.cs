using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class JobTabMappingTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);

    private static ShopJob Job(string status, int? pickupNumber = null, string? pickupDate = null, string orderId = "o-1",
        ShopPrintJob? printJob = null) =>
        new(
            OrderId: orderId, PublicRef: "KGZ-ABCD12", Status: status,
            Options: new ShopPrintOptions(null, 1, false, false, "A4"),
            PageCount: 3, PrintedSides: null, AmountPaise: 200, SimulatedPayment: true,
            CreatedAt: "2026-11-05T10:00:00Z", PaidAt: null, PrintJob: printJob, Rejection: null, PreviewUrl: null,
            PickupNumber: pickupNumber, PickupDate: pickupDate);

    [Fact]
    public void Pending_review_maps_to_pending_tab()
    {
        var item = new JobItem(Job("PENDING_REVIEW"));
        Assert.Equal("Pending", item.TabCategory);
        Assert.True(item.CanAccept);
        Assert.True(item.CanReject);
    }

    [Fact]
    public void Queued_maps_to_queue_tab()
    {
        var item = new JobItem(Job("QUEUED"));
        Assert.Equal("Queue", item.TabCategory);
        Assert.False(item.CanAccept);
        Assert.True(item.CanReject);
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
        Assert.True(item.NeedsCheck);
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
    public void Spooler_complete_says_it_moves_to_ready_by_itself()
    {
        // ADR-002: no Mark Ready; the server moves the order to READY_FOR_PICKUP on SPOOLER_COMPLETE.
        var item = new JobItem(Job("PRINTING", printJob: new ShopPrintJob("pj-1", 1, "SPOOLER_COMPLETE", "pr-1", 42, null)));
        Assert.Equal("Printed — moving to Ready", item.StatusLabel);
        Assert.Null(typeof(JobItem).GetProperty("CanMarkReady"));
        Assert.Null(typeof(JobsViewModel).GetProperty("OpenMarkReadyCommand"));
    }

    // ─── Pickup number (ADR-002) ───

    [Fact]
    public void Todays_pickup_number_shows_without_a_date()
    {
        var item = new JobItem(Job("READY_FOR_PICKUP", 7, "2026-11-10"), Today);

        Assert.True(item.HasPickupNumber);
        Assert.True(item.IsToday);
        Assert.Equal("#7", item.DisplayPickupNumber);
        Assert.Null(item.DisplayPickupDate);
        Assert.Equal("#7", item.DisplayPickup);
    }

    [Fact]
    public void Older_pickup_number_shows_its_date()
    {
        var item = new JobItem(Job("READY_FOR_PICKUP", 7, "2026-11-07"), Today);

        Assert.False(item.IsToday);
        Assert.Equal("7 Nov", item.DisplayPickupDate);
        Assert.Equal("#7 · 7 Nov", item.DisplayPickup);
    }

    [Fact]
    public void Without_pickup_number_nothing_is_shown()
    {
        var item = new JobItem(Job("PENDING_REVIEW"), Today);

        Assert.False(item.HasPickupNumber);
        Assert.Equal("—", item.DisplayPickupNumber);
        Assert.Null(item.DisplayPickupDate);
    }

    [Fact]
    public void Missing_pickup_date_falls_back_to_the_paid_date_in_kolkata()
    {
        // 2026-11-09T19:00Z is 10 Nov 00:30 in Asia/Kolkata.
        var job = Job("READY_FOR_PICKUP", 3) with { PaidAt = "2026-11-09T19:00:00Z" };
        var item = new JobItem(job, Today);

        Assert.Equal(Today, item.PickupDate);
        Assert.True(item.IsToday);
    }

    [Fact]
    public void Ready_tab_is_sorted_by_pickup_number_descending()
    {
        var jobs = new[]
        {
            new JobItem(Job("READY_FOR_PICKUP", 2, "2026-11-10", "a"), Today),
            new JobItem(Job("READY_FOR_PICKUP", 11, "2026-11-10", "b"), Today),
            new JobItem(Job("READY_FOR_PICKUP", 30, "2026-11-09", "c"), Today), // yesterday: below today's
            new JobItem(Job("READY_FOR_PICKUP", 9, "2026-11-10", "d"), Today),
            new JobItem(Job("PRINTING", 12, "2026-11-10", "e"), Today),
        };

        var ready = JobsViewModel.ForTab(jobs, "Ready").Select(j => j.OrderId).ToList();

        Assert.Equal(["b", "d", "a", "c"], ready);
    }

    [Fact]
    public void Other_tabs_keep_the_server_order()
    {
        var jobs = new[]
        {
            new JobItem(Job("QUEUED", 2, "2026-11-10", "a"), Today),
            new JobItem(Job("QUEUED", 5, "2026-11-10", "b"), Today),
        };

        Assert.Equal(["a", "b"], JobsViewModel.ForTab(jobs, "Queue").Select(j => j.OrderId));
    }
}

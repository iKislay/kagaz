using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

/// <summary>ADR-002: Today's pickups list — today's paid orders by daily number, quick number filter, no verification call.</summary>
public class TodaysPickupsTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);

    private static ShopJob Job(string orderId, string status, int? number, string? date = "2026-11-10", string publicRef = "KGZ-AAAA11") =>
        new(orderId, publicRef, status, new ShopPrintOptions(null, 2, false, true, "A4"), 3, 12, 400, true,
            "2026-11-10T04:00:00Z", "2026-11-10T04:01:00Z", null, null, null, number, date);

    private static TodaysPickupsViewModel Loaded(params ShopJob[] jobs)
    {
        var vm = new TodaysPickupsViewModel();
        vm.Load(jobs, Today);
        return vm;
    }

    private static List<int?> Numbers(TodaysPickupsViewModel vm) => vm.Pickups.Select(p => p.PickupNumber).ToList();

    [Fact]
    public void Lists_only_todays_numbered_orders_highest_number_first()
    {
        var vm = Loaded(
            Job("a", "READY_FOR_PICKUP", 1),
            Job("b", "PRINTING", 3),
            Job("c", "QUEUED", 2),
            Job("d", "READY_FOR_PICKUP", 9, "2026-11-09"), // yesterday
            Job("e", "PENDING_REVIEW", null, null),         // no number (older API / unpaid)
            Job("f", "REJECTED", 4));                        // not for pickup

        Assert.Equal([3, 2, 1], Numbers(vm));
        Assert.Equal(3, vm.TotalToday);
        Assert.Equal(1, vm.ReadyCount);
        Assert.Equal("3 today · 1 ready", vm.CountsText);
        Assert.Null(vm.Selected);
    }

    [Theory]
    [InlineData("PENDING_REVIEW", "Waiting")]
    [InlineData("QUEUED", "Waiting")]
    [InlineData("PRINTING", "Printing")]
    [InlineData("READY_FOR_PICKUP", "Ready")]
    [InlineData("NEEDS_OPERATOR_CHECK", "Needs check")]
    public void Status_is_shown_in_plain_words(string status, string expected)
    {
        var vm = Loaded(Job("a", status, 1));
        Assert.Equal(expected, Assert.Single(vm.Pickups).PickupStatus);
    }

    [Theory]
    [InlineData("7")]
    [InlineData("#7")]
    [InlineData(" # 7 ")]
    [InlineData("07")]
    public void Typing_a_number_puts_it_first_and_selects_it(string filter)
    {
        var vm = Loaded(Job("a", "READY_FOR_PICKUP", 7), Job("b", "READY_FOR_PICKUP", 71),
            Job("c", "PRINTING", 75), Job("d", "READY_FOR_PICKUP", 17), Job("e", "QUEUED", 8));

        vm.Filter = filter;

        Assert.Equal([7, 75, 71], Numbers(vm));
        Assert.Equal("a", vm.Selected!.OrderId);
    }

    [Fact]
    public void Number_with_no_exact_match_lists_prefix_matches()
    {
        var vm = Loaded(Job("a", "READY_FOR_PICKUP", 12), Job("b", "READY_FOR_PICKUP", 13), Job("c", "READY_FOR_PICKUP", 2));

        vm.Filter = "1";

        Assert.Equal([13, 12], Numbers(vm));
        Assert.Equal("b", vm.Selected!.OrderId);
    }

    [Fact]
    public void Unknown_number_shows_an_empty_state()
    {
        var vm = Loaded(Job("a", "READY_FOR_PICKUP", 3));

        vm.Filter = "9";

        Assert.True(vm.IsEmpty);
        Assert.Null(vm.Selected);
        Assert.Equal("No order 9 today.", vm.EmptyText);
    }

    [Fact]
    public void Text_filters_by_ref()
    {
        var vm = Loaded(Job("a", "READY_FOR_PICKUP", 1, publicRef: "KGZ-ABCD12"), Job("b", "READY_FOR_PICKUP", 2, publicRef: "KGZ-XYZ999"));

        vm.Filter = "abcd";

        Assert.Equal("a", Assert.Single(vm.Pickups).OrderId);
    }

    [Fact]
    public void Clearing_the_filter_shows_everything_again()
    {
        var vm = Loaded(Job("a", "READY_FOR_PICKUP", 1), Job("b", "READY_FOR_PICKUP", 2));
        vm.Filter = "1";
        Assert.Single(vm.Pickups);

        vm.ClearFilterCommand.Execute(null);

        Assert.Equal([2, 1], Numbers(vm));
    }

    [Fact]
    public void Refresh_keeps_the_filter_and_updates_statuses()
    {
        var vm = Loaded(Job("a", "PRINTING", 7), Job("b", "QUEUED", 8));
        vm.Filter = "7";
        Assert.Equal("Printing", vm.Selected!.PickupStatus);

        vm.Load([Job("a", "READY_FOR_PICKUP", 7), Job("b", "QUEUED", 8)], Today);

        Assert.Equal("a", vm.Selected!.OrderId);
        Assert.Equal("Ready", vm.Selected.PickupStatus);
        Assert.Equal(1, vm.ReadyCount);
    }

    [Fact]
    public void Exact_number_parsing()
    {
        Assert.Equal(7, TodaysPickupsViewModel.ExactNumber("#7"));
        Assert.Equal(12, TodaysPickupsViewModel.ExactNumber(" 12 "));
        Assert.Null(TodaysPickupsViewModel.ExactNumber("KGZ"));
        Assert.Null(TodaysPickupsViewModel.ExactNumber(""));
        Assert.Null(TodaysPickupsViewModel.ExactNumber(null));
    }
}

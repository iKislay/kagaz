using System.Text.Json;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>Which orders trigger the "new order" notification.</summary>
public class NewOrderNotificationTests
{
    private static JobItem Job(string status, string id) =>
        new(JsonSerializer.Deserialize<ShopJob>(TestApi.JobJson(status, id, $"KGZ-{id}"), JsonOptions.Response)!);

    [Fact]
    public void First_load_announces_nothing() =>
        Assert.Empty(JobsViewModel.NewOrders([Job("PENDING_REVIEW", "a")], known: null));

    [Fact]
    public void New_pending_and_queued_orders_are_announced_once()
    {
        var all = new[] { Job("PENDING_REVIEW", "a"), Job("QUEUED", "b"), Job("READY_FOR_PICKUP", "c"), Job("PENDING_REVIEW", "d") };

        var fresh = JobsViewModel.NewOrders(all, known: new HashSet<string> { "d" });

        Assert.Equal(["a", "b"], fresh.Select(j => j.OrderId));
    }
}

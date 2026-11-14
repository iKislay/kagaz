using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class BillingTextTests
{
    private const string Contact = "Kaggaz support";

    [Fact]
    public void Healthy_open_shops_get_no_notice()
    {
        Assert.Null(BillingText.Notice("OPEN", null, Contact));
        Assert.Null(BillingText.Notice("OPEN", new HeartbeatSubscription("ACTIVE", 2, "2026-12-31T18:30:00Z", 30), Contact));
    }

    [Fact]
    public void Ending_soon_and_closed_shops_get_calm_wording()
    {
        Assert.Equal("Your subscription ends in 1 day.",
            BillingText.Notice("OPEN", new HeartbeatSubscription("ACTIVE", 1, null, 1), Contact));
        Assert.Equal("Your subscription ends today — contact Kaggaz support to renew.",
            BillingText.Notice("OPEN", new HeartbeatSubscription("ACTIVE", 1, null, 0), Contact));
        Assert.Equal("Your shop is closed to new orders — contact Kaggaz support to open it.",
            BillingText.Notice("CLOSED", new HeartbeatSubscription("ACTIVE", 1, null, 30), Contact));
    }

    [Fact]
    public void Plan_line_shows_seats_and_end_date()
    {
        Assert.Equal("Active · 2 printers · until 1 Jan 2027",
            BillingText.Plan(new HeartbeatSubscription("ACTIVE", 2, "2026-12-31T18:30:00Z", 30)));
        Assert.Equal("Not active yet", BillingText.Plan(new HeartbeatSubscription("NONE", null, null, null)));
    }
}

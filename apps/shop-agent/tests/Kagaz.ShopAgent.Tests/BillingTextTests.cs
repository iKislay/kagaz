using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class BillingTextTests
{
    private const string Contact = "Kaggaz support";

    [Fact]
    public void Unpaired_or_healthy_shops_get_no_notice()
    {
        Assert.Null(BillingText.Notice(false, "CLOSED", null, Contact));
        Assert.Null(BillingText.Notice(true, "OPEN", null, Contact));
        Assert.Null(BillingText.Notice(true, "OPEN", new HeartbeatSubscription("ACTIVE", 2, "2026-12-31T18:30:00Z", 30), Contact));
    }

    [Fact]
    public void New_closed_shop_without_billing_info_is_told_activation_is_pending()
    {
        Assert.Equal("Your shop is set up. Kaggaz will activate your subscription — contact Kaggaz support.",
            BillingText.Notice(true, "CLOSED", null, Contact));
    }

    [Fact]
    public void Subscription_states_have_calm_wording()
    {
        Assert.StartsWith("Your shop isn't taking orders yet.",
            BillingText.Notice(true, "CLOSED", new HeartbeatSubscription("NONE", null, null, null), Contact));
        Assert.Equal("Your subscription ended on 1 Jan 2027. New orders are paused until it's renewed — contact Kaggaz support.",
            BillingText.Notice(true, "OPEN", new HeartbeatSubscription("EXPIRED", 1, "2026-12-31T18:30:00Z", 0), Contact));
        Assert.Equal("Your subscription ends in 1 day.",
            BillingText.Notice(true, "OPEN", new HeartbeatSubscription("ACTIVE", 1, null, 1), Contact));
        Assert.Equal("Your subscription ends today.",
            BillingText.Notice(true, "OPEN", new HeartbeatSubscription("ACTIVE", 1, null, 0), Contact));
    }

    [Fact]
    public void Plan_line_shows_seats_and_end_date()
    {
        Assert.Equal("Active · 2 printers · until 1 Jan 2027",
            BillingText.Plan(new HeartbeatSubscription("ACTIVE", 2, "2026-12-31T18:30:00Z", 30)));
        Assert.Equal("Not active yet", BillingText.Plan(new HeartbeatSubscription("NONE", null, null, null)));
    }
}

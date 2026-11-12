using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class SubscriptionPromptTests
{
    [Fact]
    public void Active_to_expired_opens_the_sheet()
    {
        var s = new SubscriptionPromptState();
        s.Observe("ACTIVE");
        Assert.False(s.IsOpen);
        s.Observe("EXPIRED");
        Assert.True(s.IsOpen);
    }

    [Fact]
    public void Dismissed_sheet_stays_closed_for_the_same_state()
    {
        var s = new SubscriptionPromptState();
        s.Observe("EXPIRED");
        s.Dismiss();
        s.Observe("EXPIRED");
        Assert.False(s.IsOpen);
    }

    [Fact]
    public void A_new_inactive_state_or_a_failed_call_asks_again()
    {
        var s = new SubscriptionPromptState();
        s.Observe("NONE");
        s.Dismiss();
        s.Observe("EXPIRED");
        Assert.True(s.IsOpen);

        s.Dismiss();
        s.ForceOpen(); // SUBSCRIPTION_INACTIVE from an order call
        Assert.True(s.IsOpen);
    }

    [Fact]
    public void Becoming_active_closes_it_and_resets_the_dismissal()
    {
        var s = new SubscriptionPromptState();
        s.Observe("NONE");
        Assert.True(s.IsOpen);
        s.Observe("ACTIVE");
        Assert.False(s.IsOpen);
        s.Observe("EXPIRED");
        Assert.True(s.IsOpen);
    }

    [Fact]
    public void Servers_without_billing_never_open_it()
    {
        var s = new SubscriptionPromptState();
        s.Observe(null);
        Assert.False(s.IsOpen);
    }

    [Theory]
    [InlineData("+918987263735", "89872 63735")]
    [InlineData("8987263735", "89872 63735")]
    [InlineData("+44 20 7946 0958", "+44 20 7946 0958")]
    public void Indian_numbers_are_shown_the_way_people_say_them(string raw, string expected) =>
        Assert.Equal(expected, SupportViewModel.FormatPhone(raw));
}

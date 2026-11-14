using Kagaz.ShopAgent.App.Services;

namespace Kagaz.ShopAgent.Tests;

/// <summary>A single failed heartbeat must not flash "Offline" on the shop's screen.</summary>
public class HeartbeatBlipTests
{
    [Theory]
    [InlineData(true, 1, true)]   // first failure after being connected: ride it out
    [InlineData(true, 2, false)]  // second in a row: show offline
    [InlineData(false, 1, false)] // never connected: show the problem right away
    public void Rides_out_one_failure_after_a_good_beat(bool wasConnected, int failures, bool rideOut) =>
        Assert.Equal(rideOut, HeartbeatService.RideOutBlip(wasConnected, failures));
}

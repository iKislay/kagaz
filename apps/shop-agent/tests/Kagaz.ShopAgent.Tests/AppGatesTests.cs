using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

/// <summary>The app opens up in order: connect → sign in → setup → subscription → app.</summary>
public class AppGatesTests
{
    [Theory]
    [InlineData(false, false, false, null, AppGate.Connect)]
    [InlineData(false, true, true, "ACTIVE", AppGate.Connect)]
    [InlineData(true, false, true, "ACTIVE", AppGate.SignIn)]
    [InlineData(true, true, false, "ACTIVE", AppGate.Setup)]
    [InlineData(true, true, false, "NONE", AppGate.Setup)] // set up the shop while waiting for activation
    [InlineData(true, true, true, "NONE", AppGate.Subscription)]
    [InlineData(true, true, true, "EXPIRED", AppGate.Subscription)]
    [InlineData(true, true, true, "ACTIVE", AppGate.Ready)]
    [InlineData(true, true, true, null, AppGate.Ready)] // first heartbeat not answered yet: don't block
    public void Resolve(bool paired, bool signedIn, bool setupComplete, string? subscription, AppGate expected) =>
        Assert.Equal(expected, AppGates.Resolve(paired, signedIn, setupComplete, subscription));
}

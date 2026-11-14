namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>What fills the window. Everything but <see cref="Ready"/> hides the sidebar and every page.</summary>
public enum AppGate
{
    /// <summary>This PC isn't connected to a shop: sign in / create the shop account.</summary>
    Connect,
    /// <summary>Connected, nobody signed in.</summary>
    SignIn,
    /// <summary>The owner hasn't finished first-run setup (operators wait for the owner).</summary>
    Setup,
    /// <summary>No active subscription: contact Kaggaz.</summary>
    Subscription,
    Ready,
}

/// <summary>The order the app opens up in (pure; unit tested): connect → sign in → setup → subscription → app.</summary>
public static class AppGates
{
    /// <param name="subscriptionStatus">From the heartbeat; null until the first one answers.</param>
    public static AppGate Resolve(bool paired, bool signedIn, bool setupComplete, string? subscriptionStatus) =>
        !paired ? AppGate.Connect
        : !signedIn ? AppGate.SignIn
        : !setupComplete ? AppGate.Setup
        : subscriptionStatus is "NONE" or "EXPIRED" ? AppGate.Subscription
        : AppGate.Ready;
}

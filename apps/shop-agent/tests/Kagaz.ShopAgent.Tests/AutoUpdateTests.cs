using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class AutoUpdateTests
{
    private static AgentState WithJob(string phase)
    {
        var state = new AgentState();
        state.Jobs["pj1"] = new LocalJobState { PrintJobId = "pj1", Phase = phase };
        return state;
    }

    [Fact]
    public void Restarts_only_when_no_print_is_in_flight()
    {
        Assert.True(AutoUpdateService.IsIdle(new AgentState()));
        Assert.True(AutoUpdateService.IsIdle(WithJob(LocalPhase.Done)));

        // Never restart while a lease is held or a print is being submitted / monitored (invariant 8).
        Assert.False(AutoUpdateService.IsIdle(WithJob(LocalPhase.NotStarted)));
        Assert.False(AutoUpdateService.IsIdle(WithJob(LocalPhase.Downloaded)));
        Assert.False(AutoUpdateService.IsIdle(WithJob(LocalPhase.Submitting)));
        Assert.False(AutoUpdateService.IsIdle(WithJob(LocalPhase.Submitted)));
    }
}

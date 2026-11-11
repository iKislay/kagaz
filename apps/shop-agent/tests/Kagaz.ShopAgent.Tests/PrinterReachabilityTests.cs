using Kagaz.ShopAgent.Printing;

namespace Kagaz.ShopAgent.Tests;

public class PrinterReachabilityTests
{
    [Fact]
    public void Marked_unreachable_printer_reports_reason_until_a_print_succeeds()
    {
        var now = DateTimeOffset.UtcNow;
        var reachability = new PrinterReachability(probe: _ => true, clock: () => now);

        reachability.MarkUnreachable("HP Smart Tank");
        Assert.Contains("not responding", reachability.UnreachableReason("HP Smart Tank"));

        reachability.MarkReachable("HP Smart Tank");
        Assert.Null(reachability.UnreachableReason("HP Smart Tank"));
    }

    [Fact]
    public async Task Background_probe_detects_unreachable_printer_without_blocking()
    {
        var now = DateTimeOffset.UtcNow;
        var probed = new TaskCompletionSource();
        var reachability = new PrinterReachability(probe: _ => { probed.TrySetResult(); return false; }, clock: () => now);

        // First call returns the (unknown → reachable) cached value immediately and probes in the background.
        Assert.Null(reachability.UnreachableReason("HP Smart Tank"));
        await probed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        for (int i = 0; i < 50 && reachability.UnreachableReason("HP Smart Tank") is null; i++) await Task.Delay(20);

        Assert.Equal(PrintEngineException.PrinterUnreachableMessage, reachability.UnreachableReason("HP Smart Tank"));
    }

    [Fact]
    public void Unreachable_code_is_distinct_from_not_installed()
    {
        Assert.NotEqual(PrintEngineException.PrinterNotFound, PrintEngineException.PrinterUnreachable);
        Assert.Equal("PRINTER_UNREACHABLE", PrintEngineException.PrinterUnreachable);
    }
}

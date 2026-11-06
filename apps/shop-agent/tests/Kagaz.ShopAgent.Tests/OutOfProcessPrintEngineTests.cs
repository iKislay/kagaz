using Kagaz.ShopAgent.Printing;

namespace Kagaz.ShopAgent.Tests;

public class OutOfProcessPrintEngineTests
{
    [Fact]
    public async Task Missing_print_helper_refuses_before_printing()
    {
        var engine = new OutOfProcessPrintEngine(Path.Combine(Path.GetTempPath(), "does-not-exist", "Kagaz.ShopAgent.PrintHost.exe"),
            300, null, Path.GetTempPath());

        var ex = await Assert.ThrowsAsync<PrintEngineException>(() => engine.PrintAsync("packet.pdf",
            new PrintRequest("Any", false, false, "A4", "KAGAZ-KGZ-TEST-A1"), CancellationToken.None));

        Assert.Equal(PrintEngineException.PrinterNotFound, ex.Code);
    }
}

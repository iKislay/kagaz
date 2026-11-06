using System.IO;
using System.Text.Json;
using Kagaz.ShopAgent.Printing;

namespace Kagaz.ShopAgent.PrintHost;

/// <summary>
/// Prints one packet with <see cref="PdfiumPrintEngine"/> and writes one JSON line to stdout.
/// Exit 0 = submitted, 2 = refused before printing (nothing printed), anything else = outcome unknown.
/// Started only by <see cref="OutOfProcessPrintEngine"/>; never listens on any port.
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var request = JsonSerializer.Deserialize<PrintHostRequest>(File.ReadAllText(args[0]), PrintHostProtocol.Json)
                ?? throw new InvalidOperationException("Empty print request");
            var engine = new PdfiumPrintEngine(request.MaxRenderDpi, request.PrintToFileFolder, request.VirtualPdfFolder);
            var result = engine.PrintAsync(request.PdfPath, request.Request, CancellationToken.None).GetAwaiter().GetResult();
            Write(new PrintHostResult(true, result.SpoolerJobId, result.PagesSent, null, null));
            return 0;
        }
        catch (PrintEngineException ex)
        {
            Write(new PrintHostResult(false, null, 0, ex.Code, ex.Message));
            return PrintHostProtocol.ExitRefused;
        }
        catch (Exception ex)
        {
            Write(new PrintHostResult(false, null, 0, "PRINT_HOST_ERROR", ex.Message));
            return 3;
        }
    }

    private static void Write(PrintHostResult result) =>
        Console.Out.WriteLine(JsonSerializer.Serialize(result, PrintHostProtocol.Json));
}

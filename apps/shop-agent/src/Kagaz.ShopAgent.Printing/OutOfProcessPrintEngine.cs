using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace Kagaz.ShopAgent.Printing;

/// <summary>Request handed to the print host (written to a temp JSON file).</summary>
public sealed record PrintHostRequest(string PdfPath, PrintRequest Request, int MaxRenderDpi, string? PrintToFileFolder, string VirtualPdfFolder);

/// <summary>One JSON line the print host writes to stdout.</summary>
public sealed record PrintHostResult(bool Ok, int? SpoolerJobId, int PagesSent, string? Code, string? Message);

public static class PrintHostProtocol
{
    /// <summary>The engine refused before calling the spooler: nothing was printed.</summary>
    public const int ExitRefused = 2;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
}

/// <summary>
/// Runs <see cref="PdfiumPrintEngine"/> in <c>Kagaz.ShopAgent.PrintHost.exe</c>. GDI printing,
/// printer drivers and PDFium share a process with WPF's renderer otherwise, and a native fault
/// there kills the whole shop app mid-print. Out of process, a crash only fails this attempt:
/// it surfaces as a non-<see cref="PrintEngineException"/> error, which the worker reports as
/// UNCERTAIN (never reprinted — invariant 8).
/// </summary>
public sealed class OutOfProcessPrintEngine : IPrintEngine
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(10);

    private readonly string _hostPath;
    private readonly int _maxRenderDpi;
    private readonly string? _printToFileFolder;
    private readonly string _virtualPdfFolder;

    public OutOfProcessPrintEngine(string hostPath, int maxRenderDpi, string? printToFileFolder, string virtualPdfFolder)
    {
        _hostPath = hostPath;
        _maxRenderDpi = maxRenderDpi;
        _printToFileFolder = printToFileFolder;
        _virtualPdfFolder = virtualPdfFolder;
    }

    public async Task<PrintSubmission> PrintAsync(string pdfPath, PrintRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!File.Exists(_hostPath))
        {
            throw new PrintEngineException(PrintEngineException.PrinterNotFound, "The Kagaz print helper is missing; reinstall Kagaz Shop.");
        }

        var requestPath = Path.ChangeExtension(pdfPath, ".request.json");
        await File.WriteAllTextAsync(requestPath,
            JsonSerializer.Serialize(new PrintHostRequest(pdfPath, request, _maxRenderDpi, _printToFileFolder, _virtualPdfFolder), PrintHostProtocol.Json),
            CancellationToken.None);
        try
        {
            var start = new ProcessStartInfo(_hostPath)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            start.ArgumentList.Add(requestPath);

            using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start the print helper");
            var stdout = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
            _ = process.StandardError.ReadToEndAsync(CancellationToken.None);

            // Not cancellable: once the spooler may have the job, we wait for the real outcome.
            using var timeout = new CancellationTokenSource(Timeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                throw new IOException("The print helper did not finish in time; the print outcome is unknown.");
            }

            PrintHostResult? result = null;
            var line = (await stdout).Trim();
            if (line.Length > 0)
            {
                try { result = JsonSerializer.Deserialize<PrintHostResult>(line, PrintHostProtocol.Json); }
                catch (JsonException) { result = null; }
            }

            if (process.ExitCode == 0 && result is { Ok: true })
            {
                return new PrintSubmission(result.SpoolerJobId, request.DocumentName, result.PagesSent);
            }
            if (process.ExitCode == PrintHostProtocol.ExitRefused && result?.Code is not null)
            {
                throw new PrintEngineException(result.Code, result.Message ?? result.Code);
            }
            throw new IOException(result?.Message is { } message
                ? $"Print helper failed: {message}"
                : $"Print helper stopped unexpectedly (exit 0x{process.ExitCode:X8}); the print outcome is unknown.");
        }
        finally
        {
            try { File.Delete(requestPath); } catch (IOException) { }
        }
    }
}

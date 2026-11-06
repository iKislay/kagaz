using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using Docnet.Core;
using Docnet.Core.Models;
using Docnet.Core.Readers;

namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// PDFium (Docnet) print engine (Appendix A.4). Renders the packet PDF page by page through
/// exactly one <see cref="PrintDocument"/> — one <c>Print()</c> call = one spooler job — with
/// <c>Copies = 1</c>, explicit duplex/colour/A4 and <c>DocumentName = KAGAZ-&lt;ref&gt;-A&lt;attempt&gt;</c>.
/// Copies and the pickup slip are already inside the packet (invariant 7).
/// </summary>
public sealed class PdfiumPrintEngine : IPrintEngine
{
    /// <summary>The Windows virtual PDF printer; it opens a Save dialog unless printing to a file.</summary>
    public const string MicrosoftPrintToPdf = "Microsoft Print to PDF";

    private readonly int _maxRenderDpi;
    private readonly string? _printToFileFolder;
    private readonly string _virtualPdfFolder;

    /// <param name="maxRenderDpi">Render resolution cap (A.4: 300 dpi).</param>
    /// <param name="printToFileFolder">If set, every job is printed to a file in this folder (testing only).</param>
    /// <param name="virtualPdfFolder">Where "Microsoft Print to PDF" output goes so it never opens a Save dialog.</param>
    public PdfiumPrintEngine(int maxRenderDpi, string? printToFileFolder, string virtualPdfFolder)
    {
        _maxRenderDpi = Math.Clamp(maxRenderDpi, 72, 600);
        _printToFileFolder = string.IsNullOrWhiteSpace(printToFileFolder) ? null : printToFileFolder;
        _virtualPdfFolder = virtualPdfFolder;
    }

    public Task<PrintSubmission> PrintAsync(string pdfPath, PrintRequest request, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Not cancellable once started: a half-cancelled spooler job is exactly the ambiguity we avoid.
        return Task.Run(() => PrintSync(pdfPath, request), CancellationToken.None);
    }

    private PrintSubmission PrintSync(string pdfPath, PrintRequest request)
    {
        if (!string.Equals(request.PaperSize, "A4", StringComparison.OrdinalIgnoreCase))
        {
            throw new PrintEngineException(PrintEngineException.UnsupportedSetting, $"Paper size {request.PaperSize} is not supported (A4 only).");
        }

        var printerSettings = new PrinterSettings { PrinterName = request.PrinterName };
        if (!printerSettings.IsValid)
        {
            throw new PrintEngineException(PrintEngineException.PrinterNotFound, $"Printer '{request.PrinterName}' is not installed on this PC.");
        }

        // Capability check before printing (A.4): mismatch → FAILED, nothing printed.
        if (request.Colour && !printerSettings.SupportsColor)
        {
            throw new PrintEngineException(PrintEngineException.UnsupportedSetting, "Colour was ordered but this printer cannot print colour.");
        }
        if (request.Duplex && !printerSettings.CanDuplex)
        {
            throw new PrintEngineException(PrintEngineException.UnsupportedSetting, "Double-sided was ordered but this printer cannot print duplex.");
        }

        string? outputFolder = _printToFileFolder
            ?? (string.Equals(request.PrinterName, MicrosoftPrintToPdf, StringComparison.OrdinalIgnoreCase) ? _virtualPdfFolder : null);
        if (outputFolder is not null)
        {
            Directory.CreateDirectory(outputFolder);
            printerSettings.PrintToFile = true;
            printerSettings.PrintFileName = Path.Combine(outputFolder, $"{request.DocumentName}.pdf");
        }

        printerSettings.Copies = 1; // invariant 7: copies are pages inside the packet, never driver copies
        printerSettings.Collate = false;
        printerSettings.Duplex = request.Duplex ? Duplex.Vertical : Duplex.Simplex; // Vertical = long-edge flip for portrait

        using var printDoc = new PrintDocument
        {
            DocumentName = request.DocumentName,
            PrinterSettings = printerSettings,
            OriginAtMargins = false,
            PrintController = new StandardPrintController(), // no "Printing page n" dialog
        };
        printDoc.DefaultPageSettings.PaperSize = FindA4(printerSettings);
        printDoc.DefaultPageSettings.Landscape = false;
        printDoc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        printDoc.DefaultPageSettings.Color = request.Colour;

        using var docReader = DocLib.Instance.GetDocReader(pdfPath, new PageDimensions(_maxRenderDpi / 72.0));
        int pageCount = docReader.GetPageCount();
        if (pageCount < 1)
        {
            throw new PrintEngineException(PrintEngineException.InvalidPacket, "The print packet has no pages.");
        }

        int pageIndex = 0;
        printDoc.PrintPage += (_, args) =>
        {
            RenderPage(args, docReader, pageIndex, request.Colour);
            pageIndex++;
            args.HasMorePages = pageIndex < pageCount;
        };
        printDoc.Print();

        if (pageIndex != pageCount)
        {
            throw new PrintEngineException(PrintEngineException.Incomplete, $"Only {pageIndex} of {pageCount} pages were sent to the printer.");
        }

        int? spoolerJobId = SpoolerJobFinder.Find(request.PrinterName, request.DocumentName, TimeSpan.FromSeconds(5));
        return new PrintSubmission(spoolerJobId, request.DocumentName, pageCount);
    }

    private static PaperSize FindA4(PrinterSettings settings)
    {
        foreach (PaperSize size in settings.PaperSizes)
        {
            if (size.Kind == PaperKind.A4) return size;
        }
        return new PaperSize("A4", 827, 1169); // hundredths of an inch
    }

    private static void RenderPage(PrintPageEventArgs args, IDocReader docReader, int index, bool colour)
    {
        using var page = docReader.GetPageReader(index);
        int width = page.GetPageWidth();
        int height = page.GetPageHeight();
        byte[] bgra = page.GetImage(RenderFlags.RenderAnnotations | (colour ? 0 : RenderFlags.Grayscale));
        using var bitmap = ToOpaqueBitmap(bgra, width, height);

        // Full-bleed onto the physical page: the graphics origin is the printable-area corner,
        // so shift by the hard margins. Fit preserving aspect ratio (packets are A4 already).
        Graphics g = args.Graphics!;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        RectangleF pageRect = new(-args.PageSettings.HardMarginX, -args.PageSettings.HardMarginY,
            args.PageBounds.Width, args.PageBounds.Height);
        float scale = Math.Min(pageRect.Width / width, pageRect.Height / height);
        float drawW = width * scale;
        float drawH = height * scale;
        g.DrawImage(bitmap, new RectangleF(
            pageRect.X + (pageRect.Width - drawW) / 2,
            pageRect.Y + (pageRect.Height - drawH) / 2,
            drawW, drawH));
    }

    /// <summary>PDFium renders BGRA with a transparent background; flatten onto white paper.</summary>
    private static Bitmap ToOpaqueBitmap(byte[] bgra, int width, int height)
    {
        using var argb = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        var data = argb.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, argb.PixelFormat);
        try
        {
            int rowBytes = width * 4;
            for (int y = 0; y < height; y++)
            {
                Marshal.Copy(bgra, y * rowBytes, data.Scan0 + y * data.Stride, rowBytes);
            }
        }
        finally
        {
            argb.UnlockBits(data);
        }

        var opaque = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(opaque))
        {
            g.Clear(Color.White);
            g.DrawImageUnscaled(argb, 0, 0);
        }
        return opaque;
    }
}

using System.IO;
using System.Net.Http;
using System.Windows.Media.Imaging;
using Windows.Data.Pdf;
using Windows.Storage.Streams;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// The customer's PDF for the Jobs preview, rendered with Windows' own PDF renderer (<c>Windows.Data.Pdf</c>).
/// PDFium stays in the print host process (a native fault there must not take the app down); this
/// renderer is part of Windows and only draws on screen. Downloaded from the short-lived signed preview
/// URL, kept in memory only, never logged.
/// </summary>
public sealed class PdfPreview
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(2) };

    private readonly PdfDocument _document;

    private PdfPreview(PdfDocument document) => _document = document;

    public int PageCount => (int)_document.PageCount;

    public static async Task<PdfPreview> LoadAsync(string signedUrl, CancellationToken ct = default)
    {
        byte[] pdf = await Http.GetByteArrayAsync(signedUrl, ct);
        return await FromBytesAsync(pdf);
    }

    public static async Task<PdfPreview> FromBytesAsync(byte[] pdf) =>
        new(await PdfDocument.LoadFromStreamAsync(new MemoryStream(pdf).AsRandomAccessStream()));

    /// <summary>One page as a frozen bitmap, <paramref name="width"/> pixels wide (sharp enough for full screen at 1200).</summary>
    public async Task<BitmapSource> RenderAsync(int pageIndex, uint width = 1200)
    {
        using var page = _document.GetPage((uint)pageIndex);
        using var png = new InMemoryRandomAccessStream();
        await page.RenderToStreamAsync(png, new PdfPageRenderOptions { DestinationWidth = width });
        png.Seek(0);
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = png.AsStreamForRead();
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }
}

using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using QRCoder;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Renders QR codes on this PC with QRCoder (ADR-003). The pairing text contains a short-lived
/// enrollment secret, so it is never sent to an online QR service and never logged.
/// </summary>
public static class QrCodeRenderer
{
    /// <summary>PNG bytes (black on white, quiet zone included); medium error correction for phone cameras.</summary>
    public static byte[] PngBytes(string text, int pixelsPerModule = 8) =>
        PngByteQRCodeHelper.GetQRCode(text, QRCodeGenerator.ECCLevel.M, pixelsPerModule, drawQuietZones: true);

    /// <summary>A frozen image for binding; null for empty text.</summary>
    public static ImageSource? Render(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var bytes = PngBytes(text);
        var image = new BitmapImage();
        using var stream = new MemoryStream(bytes);
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = stream;
        image.EndInit();
        image.Freeze();
        return image;
    }
}

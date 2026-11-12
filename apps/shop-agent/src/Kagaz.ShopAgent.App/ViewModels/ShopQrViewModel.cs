using System.Windows;
using System.Windows.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;
using QRCoder;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// "Scan to print" poster: the shop's QR code (kaggaz.in/s/&lt;slug&gt;) that customers scan at the
/// counter to start an order here. Shown in the app and printed as a one-page poster.
/// </summary>
public sealed partial class ShopQrViewModel : ObservableObject
{
    private readonly ShopApiClient? _api;
    private readonly AppStatus? _status;

    [ObservableProperty]
    private string? _shopName;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DisplayUrl))]
    private string? _url;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasQr))]
    private Geometry? _qr;

    [ObservableProperty]
    private string? _error;

    /// <param name="api">Null in tests.</param>
    public ShopQrViewModel(ShopApiClient? api = null, AppStatus? status = null)
    {
        _api = api;
        _status = status;
    }

    public bool HasQr => Qr is not null;

    /// <summary>The link without the scheme, printed under the code for people who type it.</summary>
    public string? DisplayUrl => Url?.Replace("https://", "").Replace("http://", "");

    [RelayCommand]
    public async Task LoadAsync()
    {
        if (_api is null) return;
        if (_status is { IsPaired: false })
        {
            Error = "Pair this PC with your shop first. The QR code belongs to the paired shop.";
            return;
        }
        try
        {
            ShopPosterInfo info = await _api.GetPosterAsync();
            ShopName = info.ShopName;
            Url = info.Url;
            Qr = CreateQrGeometry(info.Url);
            Error = null;
        }
        catch (Exception)
        {
            Error = "Couldn't load your shop's QR code. Check the internet connection and try again.";
        }
    }

    [RelayCommand]
    private void CopyLink()
    {
        if (Url is null) return;
        Clipboard.SetText(Url);
        _status?.ShowToast("Link copied", Url);
    }

    /// <summary>
    /// QR code as vector geometry (one square per dark module) so it stays sharp at any print size. Error correction Q survives a scuffed or taped-over poster.
    /// </summary>
    public static Geometry CreateQrGeometry(string text)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.Q);
        var matrix = data.ModuleMatrix;
        var geometry = new StreamGeometry { FillRule = FillRule.Nonzero };
        using (StreamGeometryContext ctx = geometry.Open())
        {
            for (int y = 0; y < matrix.Count; y++)
            {
                for (int x = 0; x < matrix[y].Count; x++)
                {
                    if (!matrix[y][x]) continue;
                    ctx.BeginFigure(new Point(x, y), isFilled: true, isClosed: true);
                    ctx.PolyLineTo([new Point(x + 1, y), new Point(x + 1, y + 1), new Point(x, y + 1)], isStroked: false, isSmoothJoin: false);
                }
            }
        }
        // Bounds = the symbol without its quiet zone; the poster's white padding provides that.
        geometry.Freeze();
        return geometry;
    }

    /// <summary>Dark-module count of the code, for tests.</summary>
    public static int DarkModules(string text)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.Q);
        return data.ModuleMatrix.Sum(row => row.Cast<bool>().Count(b => b));
    }
}

using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class ShopQrTests
{
    private const string Url = "https://kaggaz.in/s/demo-shop-a";

    [Fact]
    public void Qr_code_has_dark_modules_and_a_square_symbol()
    {
        Assert.True(ShopQrViewModel.DarkModules(Url) > 100);
        var bounds = ShopQrViewModel.CreateQrGeometry(Url).Bounds;
        Assert.True(bounds.Width > 20);
        Assert.Equal(bounds.Width, bounds.Height);
    }

    [Fact]
    public void Display_url_drops_the_scheme()
    {
        var vm = new ShopQrViewModel { Url = Url };
        Assert.Equal("kaggaz.in/s/demo-shop-a", vm.DisplayUrl);
        Assert.False(vm.HasQr);
    }
}

using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class SupportContactTests
{
    [Theory]
    [InlineData("+91 98765 43210", "https://wa.me/919876543210")]
    [InlineData("919876543210", "https://wa.me/919876543210")]
    [InlineData("(+91) 98765-43210", "https://wa.me/919876543210")]
    public void WhatsApp_link_keeps_only_digits(string number, string expected) =>
        Assert.Equal(expected, SupportContact.WhatsAppUrl(number));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("call us")]
    [InlineData("12345")]
    public void WhatsApp_link_is_null_without_a_real_number(string? number) =>
        Assert.Null(SupportContact.WhatsAppUrl(number));

    [Fact]
    public void No_contact_configured_shows_only_the_website()
    {
        var vm = new SupportViewModel();
        Assert.False(vm.HasContact);

        vm.Contact = new SupportContact("  ", null, null);
        Assert.False(vm.HasContact);
        Assert.Null(vm.Phone);

        vm.Contact = new SupportContact("+91 98765 43210", "+91 98765 43210", "help@kaggaz.in");
        Assert.True(vm.HasContact);
        Assert.Equal("https://wa.me/919876543210", vm.WhatsAppUrl);
        Assert.Equal("help@kaggaz.in", vm.Email);
    }
}

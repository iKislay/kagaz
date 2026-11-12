using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class RupeesTests
{
    [Theory]
    [InlineData("2", 200)]
    [InlineData("2.5", 250)]
    [InlineData("2.50", 250)]
    [InlineData(" ₹ 1,200 ", 120000)]
    [InlineData("0", 0)]
    [InlineData("0.1", 10)]
    public void Typed_rupees_become_exact_paise(string text, int expected)
    {
        Assert.True(Rupees.TryToPaise(text, out var paise));
        Assert.Equal(expected, paise);
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("-2")]
    [InlineData("2.555")]
    [InlineData("1e3")]
    [InlineData("999999999")]
    public void Invalid_prices_are_rejected(string text) => Assert.False(Rupees.TryToPaise(text, out _));

    [Theory]
    [InlineData(200, "2")]
    [InlineData(250, "2.50")]
    [InlineData(5, "0.05")]
    public void Paise_display_as_rupees(int paise, string expected) => Assert.Equal(expected, Rupees.FromPaise(paise));
}

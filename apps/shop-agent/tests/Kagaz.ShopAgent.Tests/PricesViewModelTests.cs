using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class PricesViewModelTests
{
    [Fact]
    public void Rupees_become_integer_paise_and_no_duplex_rates_means_same_as_single_sided()
    {
        var r = PricesViewModel.BuildRequest("2", "10", "", "", "5", out var error);
        Assert.Null(error);
        Assert.NotNull(r);
        Assert.Equal(200, r!.MonoRatePaise);
        Assert.Equal(1000, r.ColourRatePaise);
        Assert.Null(r.MonoDuplexRatePaise);
        Assert.Equal("SAME_AS_SIMPLEX", r.DuplexRule);
        Assert.Equal(500, r.MinimumChargePaise);
    }

    [Fact]
    public void Duplex_rates_switch_to_discounted_side_rate()
    {
        var r = PricesViewModel.BuildRequest("1.50", "8", "1.20", "7", "", out _);
        Assert.Equal(150, r!.MonoRatePaise);
        Assert.Equal(120, r.MonoDuplexRatePaise);
        Assert.Equal(700, r.ColourDuplexRatePaise);
        Assert.Equal("DISCOUNTED_SIDE_RATE", r.DuplexRule);
        Assert.Equal(0, r.MinimumChargePaise);
    }

    [Theory]
    [InlineData("", "10")]
    [InlineData("0", "10")]
    [InlineData("2", "abc")]
    [InlineData("2.555", "10")]
    public void Bad_prices_are_refused_with_a_message(string mono, string colour)
    {
        Assert.Null(PricesViewModel.BuildRequest(mono, colour, "", "", "", out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }
}

using Kagaz.ShopAgent.Printing;

namespace Kagaz.ShopAgent.Tests;

public class PrintRequestTests
{
    [Fact]
    public void Greyscale_pages_render_black_and_white_on_a_colour_job()
    {
        var request = new PrintRequest("P", Colour: true, Duplex: false, "A4", "KAGAZ-KGZ-TEST-A1", GreyscalePages: [0, 2]);
        Assert.False(request.PrintsInColour(0));
        Assert.True(request.PrintsInColour(1));
        Assert.False(request.PrintsInColour(2));
    }

    [Fact]
    public void Single_mode_jobs_follow_the_colour_setting()
    {
        Assert.True(new PrintRequest("P", true, false, "A4", "D").PrintsInColour(5));
        Assert.False(new PrintRequest("P", false, false, "A4", "D", [1]).PrintsInColour(0));
    }
}

using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.Tests;

public class AgentSettingsTests
{
    [Fact]
    public void Defaults_have_expected_values()
    {
        AgentSettings settings = new();

        Assert.Equal("http://localhost:4000/api", settings.ApiBaseUrl);
        Assert.Equal(5, settings.PollIntervalSeconds);
        Assert.Equal(15, settings.HeartbeatSeconds);
        Assert.Equal("Pdfium", settings.PrintEngine);
        Assert.Equal(300, settings.MaxRenderDpi);
    }
}

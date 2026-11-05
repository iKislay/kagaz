using System.Net;
using System.Text;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.Tests;

public class KagazApiClientTests
{
    private static AgentSettings Settings(string baseUrl = "http://localhost:4000/api")
        => new() { ApiBaseUrl = baseUrl };

    private static KagazApiClient CreateClient(StubHttpMessageHandler handler, string baseUrl = "http://localhost:4000/api")
    {
        HttpClient httpClient = new(handler) { Timeout = TimeSpan.FromSeconds(5), BaseAddress = new Uri(baseUrl) };
        return new KagazApiClient(httpClient, Options.Create(Settings(baseUrl)));
    }

    [Fact]
    public async Task Ok_health_json_returns_success()
    {
        string json = """
            {
              "status": "ok",
              "db": "ok",
              "storage": "ok",
              "version": "1.0.0",
              "time": "2026-11-05T12:00:00Z"
            }
            """;
        StubHttpMessageHandler handler = new((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        }));
        KagazApiClient client = CreateClient(handler);

        HealthResult result = await client.GetHealthAsync(CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(result.FailureReason);
        Assert.NotNull(result.Report);
        Assert.Equal("ok", result.Report!.Status);
        Assert.Equal("1.0.0", result.Report.Version);
        Assert.Equal(new DateTimeOffset(2026, 11, 5, 12, 0, 0, TimeSpan.Zero), result.Report.Time);
    }

    [Fact]
    public async Task Status_500_returns_failure()
    {
        StubHttpMessageHandler handler = new((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)));
        KagazApiClient client = CreateClient(handler);

        HealthResult result = await client.GetHealthAsync(CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.FailureReason);
        Assert.Contains("500", result.FailureReason);
        Assert.Null(result.Report);
    }

    [Fact]
    public async Task Thrown_http_request_exception_returns_failure_with_reason()
    {
        StubHttpMessageHandler handler = new((_, _) => throw new HttpRequestException("connect failed"));
        KagazApiClient client = CreateClient(handler);

        HealthResult result = await client.GetHealthAsync(CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.FailureReason);
        Assert.Null(result.Report);
    }

    [Fact]
    public async Task Malformed_json_returns_failure()
    {
        StubHttpMessageHandler handler = new((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{ not valid json", Encoding.UTF8, "application/json")
        }));
        KagazApiClient client = CreateClient(handler);

        HealthResult result = await client.GetHealthAsync(CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.FailureReason);
        Assert.Null(result.Report);
    }
}

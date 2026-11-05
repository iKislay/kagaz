using Microsoft.Extensions.Options;
using System.Text.Json;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Typed HTTP client for the Kagaz API. Calls <c>GET {ApiBaseUrl}/health</c> with a 5 second timeout.
/// Network errors and non-2xx responses become a failed <see cref="HealthResult"/>; it never throws to the UI.
/// </summary>
public sealed class KagazApiClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient _httpClient;
    private readonly AgentSettings _settings;

    public KagazApiClient(HttpClient httpClient, IOptions<AgentSettings> settings)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _settings = settings?.Value ?? throw new ArgumentNullException(nameof(settings));
    }

    public async Task<HealthResult> GetHealthAsync(CancellationToken cancellationToken = default)
    {
        string baseUrl = _settings.ApiBaseUrl.TrimEnd('/', ' ');
        string url = $"{baseUrl}/health";

        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? uri))
        {
            return HealthResult.Failure("Invalid API base URL");
        }

        try
        {
            using var response = await _httpClient.GetAsync(uri, cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return HealthResult.Failure($"HTTP {(int)response.StatusCode}");
            }

            string? content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(content))
            {
                return HealthResult.Failure("Empty health response");
            }

            HealthReport report = JsonSerializer.Deserialize<HealthReport>(content, JsonOptions)
                ?? throw new JsonException("Deserialized health report was null");
            return HealthResult.Success(report);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return HealthResult.Failure("Request timed out");
        }
        catch (HttpRequestException)
        {
            return HealthResult.Failure("API unreachable");
        }
        catch (JsonException)
        {
            return HealthResult.Failure("Invalid health response");
        }
        catch (Exception)
        {
            return HealthResult.Failure("Unexpected error");
        }
    }
}

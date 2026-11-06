using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Typed client for the Kagaz shop/device API.
/// Every call except enrollment sends <c>Authorization: Bearer <deviceToken></c>,
/// where the token is loaded from the DPAPI <see cref="ISecureStore"/>.
/// Errors surface as <see cref="ApiException"/> carrying the server error code;
/// the client never throws raw HTTP exceptions to the caller.
/// </summary>
public sealed class ShopApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AgentSettings _settings;
    private readonly ISecureStore _secureStore;

    public ShopApiClient(HttpClient httpClient, IOptions<AgentSettings> settings, ISecureStore secureStore)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _settings = settings?.Value ?? throw new ArgumentNullException(nameof(settings));
        _secureStore = secureStore ?? throw new ArgumentNullException(nameof(secureStore));
    }

    // ─── Devices ───

    public async Task<EnrollDeviceResponse> EnrollAsync(EnrollDeviceRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/devices/enroll", request, ct, authenticated: false);
        return await ReadAsync<EnrollDeviceResponse>(response, ct);
    }

    public async Task HeartbeatAsync(HeartbeatRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/devices/heartbeat", request, ct);
        await EnsureSuccess(response);
    }

    // ─── Printers ───

    public async Task<List<ShopPrinter>> GetPrintersAsync(CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Get, $"{BaseUrl}/shop/printers", null, ct);
        return await ReadAsync<List<ShopPrinter>>(response, ct);
    }

    public async Task<List<ShopPrinter>> RegisterPrintersAsync(RegisterPrintersRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Put, $"{BaseUrl}/shop/printers", request, ct);
        return await ReadAsync<List<ShopPrinter>>(response, ct);
    }

    // ─── Jobs ───

    public async Task<List<ShopJob>> ListJobsAsync(string? status, CancellationToken ct = default)
    {
        var url = $"{BaseUrl}/shop/jobs" + (string.IsNullOrWhiteSpace(status) ? "" : $"?status={Uri.EscapeDataString(status)}");
        using var response = await SendAsync(HttpMethod.Get, url, null, ct);
        var wrapper = await ReadAsync<JobsWrapper>(response, ct);
        return wrapper.Jobs ?? new();
    }

    public async Task<ShopJob> GetJobAsync(string orderId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Get, $"{BaseUrl}/shop/jobs/{Uri.EscapeDataString(orderId)}", null, ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<ShopJob> AcceptJobAsync(string orderId, string? printerId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/jobs/{Uri.EscapeDataString(orderId)}/accept",
            new AcceptJobRequest(printerId), ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<ShopJob> RejectJobAsync(string orderId, RejectJobRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/jobs/{Uri.EscapeDataString(orderId)}/reject", request, ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<LeaseResponse> LeasePrintJobAsync(string printJobId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/print-jobs/{Uri.EscapeDataString(printJobId)}/lease", null, ct);
        return await ReadAsync<LeaseResponse>(response, ct);
    }

    public async Task<ShopJob> ReportPrintStatusAsync(string printJobId, PrintStatusReportDto report, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/print-jobs/{Uri.EscapeDataString(printJobId)}/status", report, ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    /// <summary>Mark Ready (FR-SHOP-12): the operator has confirmed the printed stack and slip.</summary>
    public async Task<ShopJob> MarkReadyAsync(string orderId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/jobs/{Uri.EscapeDataString(orderId)}/ready",
            new { confirmed = true }, ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    // ─── Pickup ───

    public async Task<VerifyPickupResponse> VerifyPickupAsync(string code, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"{BaseUrl}/shop/pickups/verify", new VerifyPickupRequest(code), ct);
        return await ReadAsync<VerifyPickupResponse>(response, ct);
    }

    // ─── Helpers ───

    private string BaseUrl => _settings.ApiBaseUrl.TrimEnd('/', ' ');

    /// <summary>
    /// Sends one request with the device token on the request itself (never on
    /// <c>DefaultRequestHeaders</c>, which is not safe to mutate while other calls are in flight).
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, object? body, CancellationToken ct, bool authenticated = true)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions.Request), Encoding.UTF8, "application/json");
        }
        if (authenticated)
        {
            var token = _secureStore.Load();
            if (!string.IsNullOrEmpty(token))
            {
                request.Headers.Authorization = new("Bearer", token);
            }
        }
        try
        {
            return await _httpClient.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new ApiException("NETWORK_ERROR", $"Cannot reach the Kagaz server ({ex.Message})");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ApiException("NETWORK_ERROR", "The Kagaz server did not respond in time");
        }
        finally
        {
            request.Dispose();
        }
    }

    private async Task<T> ReadAsync<T>(HttpResponseMessage response, CancellationToken ct)
    {
        await EnsureSuccess(response);
        return JsonSerializer.Deserialize<T>(await response.Content.ReadAsStringAsync(ct), JsonOptions.Response)
            ?? throw new ApiException("INVALID_RESPONSE", "Empty response from the server");
    }

    private static async Task EnsureSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;

        string code;
        string message;
        try
        {
            string body = await response.Content.ReadAsStringAsync();
            var error = JsonSerializer.Deserialize<ApiErrorEnvelope>(body, JsonOptions.Response);
            code = error?.Error?.Code ?? response.StatusCode.ToString();
            message = error?.Error?.Message ?? $"HTTP {(int)response.StatusCode}";
        }
        catch
        {
            code = response.StatusCode.ToString();
            message = $"HTTP {(int)response.StatusCode}";
        }

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            code = "DEVICE_UNAUTHORIZED";
        }

        throw new ApiException(code, message);
    }

    private sealed class ApiErrorEnvelope
    {
        public ApiErrorBody? Error { get; init; }
    }

    private sealed class ApiErrorBody
    {
        public string Code { get; init; } = string.Empty;
        public string Message { get; init; } = string.Empty;
    }

    private sealed class JobsWrapper
    {
        public List<ShopJob>? Jobs { get; init; }
    }
}

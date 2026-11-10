using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Typed client for the Kagaz shop/device API.
/// <list type="bullet">
/// <item>Every call except enrollment sends <c>Authorization: Bearer &lt;deviceToken&gt;</c>, loaded from
/// the DPAPI <see cref="ISecureStore"/>, and <c>X-Agent-Version</c>.</item>
/// <item>Human actions (accept, reject, resolve, mode change, printers PUT, logout) also
/// send <c>X-Operator-Token</c> from the in-memory <see cref="AgentSession"/> (P2.3). Agent-only calls
/// (jobs, lease, status, heartbeat) never do.</item>
/// <item>Errors surface as <see cref="ApiException"/> with the server error code; the client never throws
/// raw HTTP exceptions. <c>401 DEVICE_REVOKED</c>, <c>401 OPERATOR_LOGIN_REQUIRED</c> and
/// <c>426 AGENT_UPGRADE_REQUIRED</c> are also signalled on the shared <see cref="AgentSession"/>, so
/// the app reacts the same way wherever they happen.</item>
/// </list>
/// </summary>
public sealed class ShopApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AgentSettings _settings;
    private readonly ISecureStore _secureStore;
    private readonly AgentSession _session;

    public ShopApiClient(HttpClient httpClient, IOptions<AgentSettings> settings, ISecureStore secureStore, AgentSession? session = null)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        _settings = settings?.Value ?? throw new ArgumentNullException(nameof(settings));
        _secureStore = secureStore ?? throw new ArgumentNullException(nameof(secureStore));
        _session = session ?? new AgentSession();
    }

    // ─── Devices ───

    public async Task<EnrollDeviceResponse> EnrollAsync(EnrollDeviceRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, "/devices/enroll", request, ct, auth: Auth.None);
        return await ReadAsync<EnrollDeviceResponse>(response, ct);
    }

    /// <summary>
    /// <c>POST /shop/heartbeat</c> (contract §1). While the API still only has the P1
    /// <c>/devices/heartbeat</c> (404 on the new route) it falls back to that with the legacy payload.
    /// Updates <see cref="AgentSession.IsUpgradeRequired"/> from the response.
    /// </summary>
    public async Task<HeartbeatResponse> HeartbeatAsync(HeartbeatRequest request, CancellationToken ct = default)
    {
        HeartbeatResponse result;
        try
        {
            using var response = await SendAsync(HttpMethod.Post, "/shop/heartbeat", request, ct);
            result = await ReadAsync<HeartbeatResponse>(response, ct, allowEmpty: true)
                ?? new HeartbeatResponse(null, null, null, false, null);
        }
        catch (ApiException ex) when (ex.HttpStatus == 404)
        {
            using var legacy = await SendAsync(HttpMethod.Post, "/devices/heartbeat",
                new HeartbeatRequest(request.AppVersion, request.Printers), ct);
            result = await ReadAsync<HeartbeatResponse>(legacy, ct, allowEmpty: true)
                ?? new HeartbeatResponse(null, null, null, false, null);
        }
        _session.SetUpgradeRequired(result.UpgradeRequired, result.MinAgentVersion);
        return result;
    }

    /// <summary>
    /// <c>POST /devices/rotate-token</c> → stores the new token in the DPAPI store (atomic replace)
    /// before returning. The old token stops working on the server immediately.
    /// </summary>
    public async Task RotateTokenAsync(CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, "/devices/rotate-token", null, ct);
        var rotated = await ReadAsync<RotateTokenResponse>(response, ct);
        if (string.IsNullOrWhiteSpace(rotated.DeviceToken))
        {
            throw new ApiException("INVALID_RESPONSE", "The server returned an empty device token");
        }
        _secureStore.Save(rotated.DeviceToken);
        _session.NotifyDeviceTokenRotated();
    }

    // ─── Operator session ───

    /// <summary><c>POST /shop/operator/login</c>; on success the token is kept in memory only.</summary>
    public async Task<OperatorLoginResponse> OperatorLoginAsync(string login, string password, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shop/operator/login", new OperatorLoginRequest(login, password), ct);
        var result = await ReadAsync<OperatorLoginResponse>(response, ct);
        _session.SignIn(result);
        return result;
    }

    /// <summary>Best-effort <c>POST /shop/operator/logout</c>; the local token is always forgotten.</summary>
    public async Task OperatorLogoutAsync(CancellationToken ct = default)
    {
        try
        {
            if (_session.IsOperatorSignedIn)
            {
                using var response = await SendAsync(HttpMethod.Post, "/shop/operator/logout", null, ct, auth: Auth.Operator);
                await EnsureSuccess(response);
            }
        }
        catch (ApiException)
        {
            // The token expires on its own (12 h); signing out locally is what matters.
        }
        finally
        {
            _session.SignOut();
        }
    }

    // ─── Shop mode ───

    /// <summary><c>GET /shop/mode</c> (device token only): the shop's approval mode as the server has it.</summary>
    public async Task<ShopModeResponse> GetModeAsync(CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Get, "/shop/mode", null, ct);
        return await ReadAsync<ShopModeResponse>(response, ct);
    }

    public async Task<ShopModeResponse> SetModeAsync(ShopModeRequest request, string? idempotencyKey = null, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Patch, "/shop/mode", request, ct, auth: Auth.Operator, idempotencyKey: idempotencyKey);
        return await ReadAsync<ShopModeResponse>(response, ct);
    }

    // ─── Printers ───

    public async Task<List<ShopPrinter>> GetPrintersAsync(CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Get, "/shop/printers", null, ct);
        return await ReadAsync<List<ShopPrinter>>(response, ct);
    }

    public async Task<List<ShopPrinter>> RegisterPrintersAsync(RegisterPrintersRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Put, "/shop/printers", request, ct, auth: Auth.Operator);
        return await ReadAsync<List<ShopPrinter>>(response, ct);
    }

    // ─── Jobs ───

    public async Task<List<ShopJob>> ListJobsAsync(string? status, CancellationToken ct = default)
    {
        var url = "/shop/jobs" + (string.IsNullOrWhiteSpace(status) ? "" : $"?status={Uri.EscapeDataString(status)}");
        using var response = await SendAsync(HttpMethod.Get, url, null, ct);
        var wrapper = await ReadAsync<JobsWrapper>(response, ct);
        return wrapper.Jobs ?? new();
    }

    public async Task<ShopJob> GetJobAsync(string orderId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shop/jobs/{Uri.EscapeDataString(orderId)}", null, ct);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<ShopJob> AcceptJobAsync(string orderId, string? printerId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shop/jobs/{Uri.EscapeDataString(orderId)}/accept",
            new AcceptJobRequest(printerId), ct, auth: Auth.Operator);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<ShopJob> RejectJobAsync(string orderId, RejectJobRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shop/jobs/{Uri.EscapeDataString(orderId)}/reject", request, ct, auth: Auth.Operator);
        return await ReadAsync<ShopJob>(response, ct);
    }

    public async Task<LeaseResponse> LeasePrintJobAsync(string printJobId, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shop/print-jobs/{Uri.EscapeDataString(printJobId)}/lease", null, ct);
        return await ReadAsync<LeaseResponse>(response, ct);
    }

    public async Task<ShopJob?> ReportPrintStatusAsync(string printJobId, PrintStatusReportDto report, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shop/print-jobs/{Uri.EscapeDataString(printJobId)}/status", report, ct);
        return await ReadAsync<ShopJob>(response, ct, allowEmpty: true);
    }

    /// <summary>
    /// Report <c>UNCERTAIN {reason}</c> (contract §1). Against an API that predates the UNCERTAIN variant
    /// (400 validation error) it falls back to <c>FAILED {error: "UNCERTAIN: …"}</c>, which also puts the
    /// order in NEEDS_OPERATOR_CHECK.
    /// </summary>
    public async Task ReportUncertainAsync(string printJobId, string reason, CancellationToken ct = default)
    {
        try
        {
            await ReportPrintStatusAsync(printJobId, PrintStatusReportDto.Uncertain(reason), ct);
        }
        catch (ApiException ex) when (ex.HttpStatus == 400)
        {
            var error = reason.StartsWith("UNCERTAIN", StringComparison.Ordinal) ? reason : $"UNCERTAIN: {reason}";
            await ReportPrintStatusAsync(printJobId, PrintStatusReportDto.Failed(error), ct);
        }
    }

    /// <summary>
    /// <c>POST /shop/jobs/:orderId/resolve</c> (P2.11): <c>CONFIRM_PRINTED</c>, <c>REPRINT</c> (only with
    /// <c>confirm: true</c> after two explicit operator confirmations) or <c>MARK_FAILED</c>.
    /// </summary>
    public async Task<ShopJob> ResolveJobAsync(string orderId, ResolveJobRequest request, string? idempotencyKey = null, CancellationToken ct = default)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shop/jobs/{Uri.EscapeDataString(orderId)}/resolve",
            request, ct, auth: Auth.Operator, idempotencyKey: idempotencyKey);
        return await ReadAsync<ShopJob>(response, ct);
    }

    // ─── Helpers ───

    private enum Auth
    {
        None,
        Device,
        /// <summary>Device token + <c>X-Operator-Token</c>.</summary>
        Operator,
    }

    private string BaseUrl => _settings.ApiBaseUrl.TrimEnd('/', ' ');

    /// <summary>
    /// Sends one request with the credentials on the request itself (never on
    /// <c>DefaultRequestHeaders</c>, which is not safe to mutate while other calls are in flight).
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct,
        Auth auth = Auth.Device, string? idempotencyKey = null)
    {
        var request = new HttpRequestMessage(method, BaseUrl + path);
        if (body is not null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions.Request), Encoding.UTF8, "application/json");
        }
        if (!string.IsNullOrWhiteSpace(_settings.AppVersion))
        {
            request.Headers.TryAddWithoutValidation("X-Agent-Version", _settings.AppVersion);
        }
        if (auth != Auth.None)
        {
            var token = _secureStore.Load();
            if (!string.IsNullOrEmpty(token))
            {
                request.Headers.Authorization = new("Bearer", token);
            }
        }
        if (auth == Auth.Operator && _session.OperatorToken is { } operatorToken)
        {
            request.Headers.TryAddWithoutValidation("X-Operator-Token", operatorToken);
        }
        if (!string.IsNullOrEmpty(idempotencyKey))
        {
            request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        }
        try
        {
            return await _httpClient.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new ApiException(ApiErrorCodes.NetworkError, $"Cannot reach the Kagaz server ({ex.Message})");
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ApiException(ApiErrorCodes.NetworkError, "The Kagaz server did not respond in time");
        }
        finally
        {
            request.Dispose();
        }
    }

    private async Task<T> ReadAsync<T>(HttpResponseMessage response, CancellationToken ct)
    {
        return await ReadAsync<T>(response, ct, allowEmpty: false)
            ?? throw new ApiException("INVALID_RESPONSE", "Empty response from the server");
    }

    private async Task<T?> ReadAsync<T>(HttpResponseMessage response, CancellationToken ct, bool allowEmpty)
    {
        await EnsureSuccess(response);
        var text = await response.Content.ReadAsStringAsync(ct);
        if (string.IsNullOrWhiteSpace(text))
        {
            return allowEmpty ? default : throw new ApiException("INVALID_RESPONSE", "Empty response from the server");
        }
        try
        {
            return JsonSerializer.Deserialize<T>(text, JsonOptions.Response);
        }
        catch (JsonException) when (allowEmpty)
        {
            return default;
        }
    }

    private async Task EnsureSuccess(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;

        int status = (int)response.StatusCode;
        string code;
        string message;
        string? minAgentVersion = null;
        try
        {
            string body = await response.Content.ReadAsStringAsync();
            var error = JsonSerializer.Deserialize<ApiErrorEnvelope>(body, JsonOptions.Response);
            code = string.IsNullOrEmpty(error?.Error?.Code) ? response.StatusCode.ToString() : error.Error.Code;
            message = string.IsNullOrEmpty(error?.Error?.Message) ? $"HTTP {status}" : error.Error.Message;
            if (error?.Error?.Details is { ValueKind: JsonValueKind.Object } details
                && details.TryGetProperty("minAgentVersion", out var min) && min.ValueKind == JsonValueKind.String)
            {
                minAgentVersion = min.GetString();
            }
        }
        catch
        {
            code = response.StatusCode.ToString();
            message = $"HTTP {status}";
        }

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            switch (code)
            {
                case ApiErrorCodes.DeviceRevoked:
                    _session.NotifyDeviceRevoked();
                    break;
                case ApiErrorCodes.OperatorLoginRequired:
                    _session.NotifyOperatorLoginRequired();
                    break;
                case ApiErrorCodes.InvalidCredentials:
                    break;
                default:
                    code = ApiErrorCodes.DeviceUnauthorized;
                    break;
            }
        }
        else if (status == 426)
        {
            code = ApiErrorCodes.AgentUpgradeRequired;
            _session.SetUpgradeRequired(true, minAgentVersion);
        }

        throw new ApiException(code, message, status);
    }

    private sealed class ApiErrorEnvelope
    {
        public ApiErrorBody? Error { get; init; }
    }

    private sealed class ApiErrorBody
    {
        public string Code { get; init; } = string.Empty;
        public string Message { get; init; } = string.Empty;
        public JsonElement? Details { get; init; }
    }

    private sealed class JobsWrapper
    {
        public List<ShopJob>? Jobs { get; init; }
    }
}

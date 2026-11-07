using System.Net;
using System.Text;
using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.Tests.Fakes;

/// <summary>Helpers to build a <see cref="ShopApiClient"/> over a stub handler.</summary>
public static class TestApi
{
    public static ShopApiClient Client(StubHttpMessageHandler handler, ISecureStore? store = null, AgentSession? session = null,
        string appVersion = "0.3.0") =>
        new(new HttpClient(handler),
            Options.Create(new AgentSettings { ApiBaseUrl = "http://localhost/api", AppVersion = appVersion }),
            store ?? new FakeSecureStore("device-token"),
            session ?? new AgentSession());

    public static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    public static HttpResponseMessage Error(HttpStatusCode status, string code, string message = "error") =>
        Json(status, $$"""{ "error": { "code": "{{code}}", "message": "{{message}}" } }""");

    public static HttpResponseMessage Ok(string json = "{}") => Json(HttpStatusCode.OK, json);

    public const string LoginResponse = """
        { "operatorToken": "op-jwt", "expiresAt": "2099-01-01T00:00:00Z",
          "operator": { "id": "u-1", "name": "Asha", "role": "SHOP_OPERATOR" } }
        """;

    /// <summary>A ShopJob / ShopJobDetail JSON body with the given order status and optional print job.</summary>
    public static string JobJson(string status, string orderId = "o-1", string publicRef = "KGZ-ABCD12",
        string? printJobId = null, string printJobStatus = "READY", int attempt = 1, string printerId = "p-1",
        string? paidAt = "2026-11-05T10:00:00Z") =>
        $$"""
        { "orderId": "{{orderId}}", "publicRef": "{{publicRef}}", "status": "{{status}}",
          "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
          "pageCount": 3, "printedSides": 4, "amountPaise": 200, "simulatedPayment": true,
          "createdAt": "2026-11-05T09:59:00Z", "paidAt": {{(paidAt is null ? "null" : $"\"{paidAt}\"")}},
          "printJob": {{(printJobId is null ? "null" : $$"""{ "id": "{{printJobId}}", "attempt": {{attempt}}, "status": "{{printJobStatus}}", "printerId": "{{printerId}}", "spoolerJobId": null, "error": null }""")}},
          "rejection": null, "previewUrl": null }
        """;

    public static string Header(HttpRequestMessage request, string name) =>
        request.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : string.Empty;
}

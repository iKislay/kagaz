using System.Net;
using System.Text;
using System.Text.Json;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.Tests;

public class ShopApiClientTests
{
    private static readonly Guid DeviceId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid ShopId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static ShopApiClient CreateClient(StubHttpMessageHandler handler, string? bearerToken = "test-token")
    {
        var httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://localhost/api"),
        };
        return new ShopApiClient(httpClient, Options.Create(new AgentSettings { ApiBaseUrl = "http://localhost/api" }),
            new FakeSecureStore(bearerToken));
    }

    private static string Serialize(object o) => JsonSerializer.Serialize(o, JsonOptions.Request);

    private static StringContent JsonContent(object o) => new(Serialize(o), Encoding.UTF8, "application/json");

    [Fact]
    public async Task Enroll_success_returns_device_token_and_shop()
    {
        var body = """
            {
              "deviceToken": "dt_abc",
              "device": { "id": "11111111-1111-1111-1111-111111111111", "name": "Counter 1" },
              "shop": { "id": "22222222-2222-2222-2222-222222222222", "name": "Shop A", "isDemo": true }
            }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Null(req.Headers.Authorization);
            Assert.Equal(HttpMethod.Post, req.Method);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler, bearerToken: null);

        var result = await client.EnrollAsync(new EnrollDeviceRequest("ABCD-EFGH", "Counter 1", "0.1.0"));

        Assert.Equal("dt_abc", result.DeviceToken);
        Assert.Equal(DeviceId, Guid.Parse(result.Device.Id));
        Assert.Equal("Shop A", result.Shop.Name);
        Assert.True(result.Shop.IsDemo);
    }

    [Fact]
    public async Task Heartbeat_posts_printer_statuses_with_bearer_token()
    {
        string? authorization = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            authorization = req.Headers.Authorization?.ToString();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        });
        var client = CreateClient(handler);

        await client.HeartbeatAsync(new HeartbeatRequest("0.1.0",
            new List<PrinterStatus> { new("p-1", "READY", null) }));

        Assert.Equal("Bearer test-token", authorization);
    }

    [Fact]
    public async Task GetPrinters_returns_registered_printers()
    {
        var body = """
            [
              { "id": "33333333-3333-3333-3333-333333333333", "printerName": "EPSON", "displayName": "EPSON",
                "colourCapable": true, "duplexCapable": true, "capabilitiesConfirmed": true,
                "enabled": true, "isDefault": true, "status": "READY" }
            ]
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var printers = await client.GetPrintersAsync();

        Assert.Single(printers);
        Assert.Equal("EPSON", printers[0].PrinterName);
        Assert.True(printers[0].CapabilitiesConfirmed);
    }

    [Fact]
    public async Task ListJobs_returns_jobs_for_active_statuses()
    {
        var body = """
            {
              "jobs": [
                { "orderId": "44444444-4444-4444-4444-444444444444", "publicRef": "KGZ-ABCD12", "status": "PENDING_REVIEW",
                  "options": { "copies": 2, "colour": false, "duplex": true, "paperSize": "A4" },
                  "pageCount": 3, "amountPaise": 400, "simulatedPayment": true,
                  "createdAt": "2026-11-05T10:00:00Z", "printJob": null, "rejection": null, "previewUrl": null }
              ]
            }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            Assert.Contains("status=PENDING_REVIEW", req.RequestUri!.Query);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var jobs = await client.ListJobsAsync("PENDING_REVIEW");

        Assert.Single(jobs);
        Assert.Equal("KGZ-ABCD12", jobs[0].PublicRef);
        Assert.True(jobs[0].SimulatedPayment);
    }

    [Fact]
    public async Task Accept_job_returns_queued_job()
    {
        var body = """
            { "orderId": "44444444-4444-4444-4444-444444444444", "publicRef": "KGZ-ABCD12", "status": "QUEUED",
              "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
              "pageCount": 3, "amountPaise": 200, "simulatedPayment": true,
              "createdAt": "2026-11-05T10:00:00Z", "paidAt": null, "printJob": null, "rejection": null, "previewUrl": null }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            Assert.Contains("/accept", req.RequestUri!.LocalPath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var job = await client.AcceptJobAsync("44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333");

        Assert.Equal("QUEUED", job.Status);
        Assert.Equal("KGZ-ABCD12", job.PublicRef);
    }

    [Fact]
    public async Task Reject_job_parses_reason()
    {
        var body = """
            { "orderId": "44444444-4444-4444-4444-444444444444", "publicRef": "KGZ-ABCD12", "status": "REJECTED",
              "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
              "pageCount": null, "amountPaise": null, "simulatedPayment": false,
              "createdAt": "2026-11-05T10:00:00Z", "paidAt": null, "printJob": null,
              "rejection": { "code": "PRINTER_UNAVAILABLE", "note": "Out of paper" }, "previewUrl": null }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            Assert.Contains("/reject", req.RequestUri!.LocalPath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var job = await client.RejectJobAsync("44444444-4444-4444-4444-444444444444",
            new RejectJobRequest("PRINTER_UNAVAILABLE", "Out of paper"));

        Assert.Equal("REJECTED", job.Status);
        Assert.Equal("PRINTER_UNAVAILABLE", job.Rejection!.Code);
        Assert.Equal("Out of paper", job.Rejection.Note);
    }

    [Fact]
    public async Task Lease_returns_print_job_details()
    {
        var body = """
            {
              "printJobId": "55555555-5555-5555-5555-555555555555", "orderId": "44444444-4444-4444-4444-444444444444",
              "publicRef": "KGZ-ABCD12", "attempt": 1, "documentName": "KAGAZ-KGZ-ABCD12-A1",
              "printerName": "EPSON", "settings": { "colour": false, "duplex": true, "paperSize": "A4" },
              "downloadUrl": "http://localhost/api/download/abc", "downloadExpiresAt": "2026-11-05T10:05:00Z",
              "sha256": "deadbeef", "pageCount": 7, "leaseUntil": "2026-11-05T10:10:00Z"
            }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            Assert.Contains("/lease", req.RequestUri!.LocalPath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var lease = await client.LeasePrintJobAsync("55555555-5555-5555-5555-555555555555");

        Assert.Equal("KAGAZ-KGZ-ABCD12-A1", lease.DocumentName);
        Assert.Equal("EPSON", lease.PrinterName);
        Assert.True(lease.Settings.Duplex);
        Assert.Equal("deadbeef", lease.Sha256);
        Assert.Equal(7, lease.PageCount);
    }

    [Fact]
    public async Task Report_status_submitted_sets_spooler_job_id()
    {
        var body = """
            { "orderId": "44444444-4444-4444-4444-444444444444", "publicRef": "KGZ-ABCD12", "status": "PRINTING",
              "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
              "pageCount": 3, "amountPaise": 200, "simulatedPayment": true,
              "createdAt": "2026-11-05T10:00:00Z", "paidAt": null, "printJob": null, "rejection": null, "previewUrl": null }
            """;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal("Bearer test-token", req.Headers.Authorization?.ToString());
            Assert.Contains("/status", req.RequestUri!.LocalPath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        var job = await client.ReportPrintStatusAsync("55555555-5555-5555-5555-555555555555",
            new PrintStatusReportDto { Status = "SUBMITTED", SpoolerJobId = 42 });

        Assert.Equal("PRINTING", job!.Status);
    }

    // ─── ADR-002: daily pickup number on ShopJob ───

    [Fact]
    public async Task Jobs_parse_pickup_number_and_date()
    {
        var body = """
            { "jobs": [
                { "orderId": "o-1", "publicRef": "KGZ-ABCD12", "status": "READY_FOR_PICKUP",
                  "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
                  "pageCount": 3, "amountPaise": 200, "simulatedPayment": true,
                  "createdAt": "2026-11-10T04:00:00Z", "paidAt": "2026-11-10T04:01:00Z", "printJob": null, "rejection": null,
                  "previewUrl": null, "pickupNumber": 7, "pickupDate": "2026-11-10" }
            ] }
            """;
        var client = CreateClient(new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Ok(body))));

        var job = Assert.Single(await client.ListJobsAsync(null));

        Assert.Equal(7, job.PickupNumber);
        Assert.Equal("2026-11-10", job.PickupDate);
    }

    [Fact]
    public async Task Jobs_without_pickup_fields_still_parse()
    {
        // Older API, or an order that is not paid yet: no number.
        var body = """
            { "orderId": "o-1", "publicRef": "KGZ-ABCD12", "status": "PENDING_REVIEW",
              "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
              "pageCount": 3, "amountPaise": 200, "simulatedPayment": true,
              "createdAt": "2026-11-10T04:00:00Z", "paidAt": null, "printJob": null, "rejection": null, "previewUrl": null }
            """;
        var client = CreateClient(new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Ok(body))));

        var job = await client.GetJobAsync("o-1");

        Assert.Null(job.PickupNumber);
        Assert.Null(job.PickupDate);
        Assert.Equal("KGZ-ABCD12", job.PublicRef);
    }

    [Fact]
    public async Task Explicit_null_pickup_fields_parse_as_null()
    {
        var body = TestApi.JobJson("QUEUED").TrimEnd().TrimEnd('}') + """, "pickupNumber": null, "pickupDate": null }""";
        var client = CreateClient(new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Ok(body))));

        var job = await client.GetJobAsync("o-1");

        Assert.Null(job.PickupNumber);
        Assert.Null(job.PickupDate);
    }

    [Fact]
    public async Task Get_mode_uses_the_device_token_only()
    {
        HttpRequestMessage? seen = null;
        var client = CreateClient(new StubHttpMessageHandler((req, _) =>
        {
            seen = req;
            return Task.FromResult(TestApi.Ok("""{ "approvalMode": "AUTO", "autoPaused": false }"""));
        }));

        var mode = await client.GetModeAsync();

        Assert.Equal(ApprovalMode.Auto, mode.ApprovalMode);
        Assert.False(mode.AutoPaused);
        Assert.Equal(HttpMethod.Get, seen!.Method);
        Assert.Equal("/api/shop/mode", seen.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer test-token", seen.Headers.Authorization?.ToString());
        Assert.False(seen.Headers.Contains("X-Operator-Token"));
    }

    [Fact]
    public void Retired_pickup_verify_and_mark_ready_calls_are_gone()
    {
        Assert.Null(typeof(ShopApiClient).GetMethod("MarkReadyAsync"));
        Assert.Null(typeof(ShopApiClient).GetMethod("VerifyPickupAsync"));
    }

    [Fact]
    public async Task Unauthorized_throws_device_unauthorized()
    {
        var handler = new StubHttpMessageHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized)
        {
            Content = new StringContent("""{ "error": { "code": "DEVICE_UNAUTHORIZED", "message": "revoked" } }""", Encoding.UTF8, "application/json")
        }));
        var client = CreateClient(handler);

        var ex = await Assert.ThrowsAsync<ApiException>(() => client.HeartbeatAsync(new HeartbeatRequest(null, null)));

        Assert.Equal("DEVICE_UNAUTHORIZED", ex.Code);
    }

    [Fact]
    public async Task Error_body_parses_error_code()
    {
        var handler = new StubHttpMessageHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("""{ "error": { "code": "PRINTER_UNAVAILABLE", "message": "No suitable printer" } }""", Encoding.UTF8, "application/json")
        }));
        var client = CreateClient(handler);

        var ex = await Assert.ThrowsAsync<ApiException>(() => client.RegisterPrintersAsync(new RegisterPrintersRequest(new List<PrinterRegistration>())));

        Assert.Equal("PRINTER_UNAVAILABLE", ex.Code);
        Assert.Contains("No suitable printer", ex.Message);
    }

    [Fact]
    public async Task Register_printers_sends_confirmed_flags()
    {
        string? body = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            body = req.Content!.ReadAsStringAsync().Result;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[]", Encoding.UTF8, "application/json") });
        });
        var client = CreateClient(handler);

        await client.RegisterPrintersAsync(new RegisterPrintersRequest(new List<PrinterRegistration>
        {
            new("EPSON", "EPSON", true, true, true, true)
        }));

        Assert.Contains("\"capabilitiesConfirmed\":true", body);
        Assert.Contains("\"isDefault\":true", body);
    }
}

using System.Net;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>
/// ADR-003: the shop agent's counter-payment calls — the waiting list (device token only) and the
/// operator actions (lookup, approve, cancel).
/// </summary>
public class CounterPaymentApiTests
{
    private const string RequestJson = """
        { "orderId": "44444444-4444-4444-4444-444444444444", "publicRef": "KGZ-7H3K2Q",
          "pickupNumber": 7, "pickupDate": "2026-11-12", "amountPaise": 2400,
          "options": { "pageRange": null, "copies": 2, "colour": false, "duplex": false, "paperSize": "A4" },
          "pageCount": 3, "printedSides": 6, "requestedAt": "2026-11-11T17:30:00.000Z" }
        """;

    private static ShopApiClient Create(StubHttpMessageHandler handler, AgentSession? session = null)
    {
        session ??= new AgentSession();
        session.SignIn(new OperatorLoginResponse("op-jwt", "2099-01-01T00:00:00Z",
            new OperatorInfo("u-1", "Asha", "SHOP_OPERATOR")));
        return TestApi.Client(handler, session: session);
    }

    [Fact]
    public async Task List_parses_the_waiting_requests()
    {
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            Assert.Equal(HttpMethod.Get, req.Method);
            Assert.Equal("/api/shop/counter-payments", req.RequestUri!.AbsolutePath);
            return Task.FromResult(TestApi.Ok($$"""{ "requests": [ {{RequestJson}} ] }"""));
        });
        var client = Create(handler);

        var requests = await client.ListCounterPaymentsAsync();

        var request = Assert.Single(requests);
        Assert.Equal("KGZ-7H3K2Q", request.PublicRef);
        Assert.Equal(7, request.PickupNumber);
        Assert.Equal("2026-11-12", request.PickupDate);
        Assert.Equal(2400, request.AmountPaise);
        Assert.Equal(2, request.Options.Copies);
        Assert.Equal("A4", request.Options.PaperSize);
        Assert.Equal(3, request.PageCount);
        Assert.Equal(6, request.PrintedSides);
        Assert.Equal("2026-11-11T17:30:00.000Z", request.RequestedAt);
    }

    [Fact]
    public async Task List_uses_the_device_token_only()
    {
        HttpRequestMessage? seen = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            seen = req;
            return Task.FromResult(TestApi.Ok("""{ "requests": [] }"""));
        });
        var client = Create(handler);

        await client.ListCounterPaymentsAsync();

        Assert.Equal("Bearer device-token", seen!.Headers.Authorization?.ToString());
        Assert.False(seen.Headers.Contains("X-Operator-Token"));
    }

    [Fact]
    public async Task Lookup_posts_the_pickup_number_with_the_operator_token()
    {
        HttpRequestMessage? seen = null;
        string? body = null;
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            seen = req;
            body = await req.Content!.ReadAsStringAsync();
            return TestApi.Ok(RequestJson);
        });
        var client = Create(handler);

        var request = await client.LookupCounterPaymentAsync(7);

        Assert.Equal("/api/shop/counter-payments/lookup", seen!.RequestUri!.AbsolutePath);
        Assert.Equal(HttpMethod.Post, seen.Method);
        Assert.Equal("""{"pickupNumber":7}""", body);
        Assert.Equal("op-jwt", TestApi.Header(seen, "X-Operator-Token"));
        Assert.Equal("Bearer device-token", seen.Headers.Authorization?.ToString());
        Assert.Equal("KGZ-7H3K2Q", request.PublicRef);
    }

    [Fact]
    public async Task Approve_posts_the_pickup_number_with_an_idempotency_key_and_the_operator_token()
    {
        HttpRequestMessage? seen = null;
        string? body = null;
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            seen = req;
            body = await req.Content!.ReadAsStringAsync();
            return TestApi.Ok(TestApi.JobJson("PENDING_REVIEW", orderId: "o-1", paidAt: "2026-11-11T18:00:00Z"));
        });
        var client = Create(handler);

        await client.ApproveCounterPaymentAsync("44444444-4444-4444-4444-444444444444", 7, "idem-1");

        Assert.Equal("/api/shop/counter-payments/44444444-4444-4444-4444-444444444444/approve",
            seen!.RequestUri!.AbsolutePath);
        Assert.Equal("""{"pickupNumber":7}""", body);
        Assert.Equal("idem-1", TestApi.Header(seen, "Idempotency-Key"));
        Assert.Equal("op-jwt", TestApi.Header(seen, "X-Operator-Token"));
    }

    [Fact]
    public async Task Approve_returns_the_job_with_its_pickup_number()
    {
        var body = """
            { "orderId": "o-1", "publicRef": "KGZ-7H3K2Q", "status": "PENDING_REVIEW",
              "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
              "pageCount": 3, "amountPaise": 2400, "simulatedPayment": false,
              "createdAt": "2026-11-11T17:30:00Z", "paidAt": "2026-11-11T18:00:00Z", "printJob": null, "rejection": null,
              "previewUrl": null, "pickupNumber": 7, "pickupDate": "2026-11-11", "paymentMethod": "COUNTER" }
            """;
        var client = Create(new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Ok(body))));

        var job = await client.ApproveCounterPaymentAsync("o-1", 7);

        Assert.Equal(7, job.PickupNumber);
        Assert.Equal("2026-11-11", job.PickupDate);
        Assert.Equal("COUNTER", job.PaymentMethod);
    }

    [Fact]
    public async Task Cancel_sends_the_idempotency_key_and_no_body()
    {
        HttpRequestMessage? seen = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            seen = req;
            return Task.FromResult(TestApi.Ok("""{ "ok": true }"""));
        });
        var client = Create(handler);

        await client.CancelCounterPaymentAsync("44444444-4444-4444-4444-444444444444", "idem-2");

        Assert.Equal("/api/shop/counter-payments/44444444-4444-4444-4444-444444444444/cancel",
            seen!.RequestUri!.AbsolutePath);
        Assert.Equal("idem-2", TestApi.Header(seen, "Idempotency-Key"));
        Assert.Equal("op-jwt", TestApi.Header(seen, "X-Operator-Token"));
        Assert.Null(seen.Content);
    }

    [Fact]
    public async Task Unknown_number_becomes_an_api_exception_with_the_server_code()
    {
        var handler = new StubHttpMessageHandler((_, _) =>
            Task.FromResult(TestApi.Error(HttpStatusCode.NotFound, "COUNTER_PAYMENT_NOT_FOUND", "No one is waiting")));
        var client = Create(handler);

        var ex = await Assert.ThrowsAsync<ApiException>(() => client.LookupCounterPaymentAsync(7));

        Assert.Equal("COUNTER_PAYMENT_NOT_FOUND", ex.Code);
        Assert.Equal(404, ex.HttpStatus);
    }
}

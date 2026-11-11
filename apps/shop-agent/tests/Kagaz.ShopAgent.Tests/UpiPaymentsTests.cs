using System.Net;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Realtime;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>ADR-003 direct-to-shop UPI: the shop endpoints of docs/contracts/UPI_PAYMENTS_CONTRACT.md.</summary>
public class UpiPaymentsApiTests
{
    private sealed record Call(string Method, string PathAndQuery, string Body, string Authorization, string OperatorToken, string IdempotencyKey);

    private readonly List<Call> _calls = new();

    private ShopApiClient Client(Func<HttpRequestMessage, HttpResponseMessage> respond, bool signIn = true)
    {
        var session = new AgentSession();
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            var body = req.Content is null ? "" : await req.Content.ReadAsStringAsync();
            if (req.RequestUri!.AbsolutePath.EndsWith("/operator/login")) return TestApi.Ok(TestApi.LoginResponse);
            _calls.Add(new Call(req.Method.Method, req.RequestUri.PathAndQuery, body, req.Headers.Authorization?.ToString() ?? "",
                TestApi.Header(req, "X-Operator-Token"), TestApi.Header(req, "Idempotency-Key")));
            return respond(req);
        });
        var api = TestApi.Client(handler, session: session);
        if (signIn) api.OperatorLoginAsync("owner", "pw").GetAwaiter().GetResult();
        return api;
    }

    public const string SetupJson = """
        { "provider": "youpi", "readiness": "PHONE_OFFLINE", "upiId": "xeroxshop@okicici", "payeeName": "Sri Ganesh Xerox",
          "phones": [ { "id": "ph-1", "name": "Redmi 9", "online": false, "lastSeenAt": "2026-11-11T08:00:00Z", "lastPaymentSeenAt": null } ],
          "appDownloadUrl": "https://pay.example.test/app.apk", "updatedAt": "2026-11-11T07:00:00Z" }
        """;

    public const string ReportJson = """
        { "id": "11111111-1111-4111-8111-111111111111", "orderId": "22222222-2222-4222-8222-222222222222", "publicRef": "KGZ-AB12CD",
          "amountPaise": 2000, "utr": "412345678901", "status": "OPEN", "createdAt": "2026-11-11T09:30:00Z",
          "decidedAt": null, "declineReason": null, "customerPhoneLast4": "4321" }
        """;

    public const string RefundJson = """
        { "refundId": "33333333-3333-4333-8333-333333333333", "orderId": "22222222-2222-4222-8222-222222222222", "publicRef": "KGZ-AB12CD",
          "amountPaise": 1500, "paymentReference": "412345678901", "customerPhoneLast4": "4321", "reason": "Printer broken",
          "createdAt": "2026-11-11T09:40:00Z" }
        """;

    [Fact]
    public async Task GetPaymentSetup_uses_device_token_only_and_parses_the_setup()
    {
        var api = Client(_ => TestApi.Ok(SetupJson));

        var setup = await api.GetPaymentSetupAsync();

        var call = Assert.Single(_calls);
        Assert.Equal("GET", call.Method);
        Assert.Equal("/api/shop/payments/setup", call.PathAndQuery);
        Assert.Equal("Bearer device-token", call.Authorization);
        Assert.Equal("", call.OperatorToken);
        Assert.Equal(ShopPaymentReadiness.PhoneOffline, setup.Readiness);
        Assert.Equal("xeroxshop@okicici", setup.UpiId);
        Assert.Equal("Sri Ganesh Xerox", setup.PayeeName);
        Assert.Equal("https://pay.example.test/app.apk", setup.AppDownloadUrl);
        var phone = Assert.Single(setup.Phones!);
        Assert.False(phone.Online);
        Assert.Equal("Redmi 9", phone.Name);
    }

    [Fact]
    public async Task UpdatePaymentSetup_puts_camelCase_body_with_operator_token_and_idempotency_key()
    {
        var api = Client(_ => TestApi.Ok(SetupJson));

        await api.UpdatePaymentSetupAsync(new UpdateShopPaymentSetupRequest("xeroxshop@okicici", "Sri Ganesh Xerox"), "key-1");

        var call = Assert.Single(_calls);
        Assert.Equal("PUT", call.Method);
        Assert.Equal("/api/shop/payments/setup", call.PathAndQuery);
        Assert.Equal("""{"upiId":"xeroxshop@okicici","payeeName":"Sri Ganesh Xerox"}""", call.Body);
        Assert.Equal("op-jwt", call.OperatorToken);
        Assert.Equal("key-1", call.IdempotencyKey);
    }

    [Fact]
    public async Task CreatePhonePairing_posts_as_operator_and_returns_the_qr_text()
    {
        var api = Client(_ => TestApi.Ok("""{ "qrText": "youpi://enroll?x=1", "expiresAt": "2026-11-11T10:10:00Z" }"""));

        var pairing = await api.CreatePhonePairingAsync("key-2");

        var call = Assert.Single(_calls);
        Assert.Equal("POST", call.Method);
        Assert.Equal("/api/shop/payments/pairing", call.PathAndQuery);
        Assert.Equal("op-jwt", call.OperatorToken);
        Assert.Equal("key-2", call.IdempotencyKey);
        Assert.Equal("youpi://enroll?x=1", pairing.QrText);
        Assert.Equal("2026-11-11T10:10:00Z", pairing.ExpiresAt);
    }

    [Fact]
    public async Task Pairing_before_step_1_surfaces_PAYMENT_SETUP_REQUIRED()
    {
        var api = Client(_ => TestApi.Error(HttpStatusCode.Conflict, ApiErrorCodes.PaymentSetupRequired, "Save the UPI ID first"));

        var ex = await Assert.ThrowsAsync<ApiException>(() => api.CreatePhonePairingAsync());

        Assert.Equal(ApiErrorCodes.PaymentSetupRequired, ex.Code);
        Assert.Equal(409, ex.HttpStatus);
    }

    [Fact]
    public async Task Provider_unreachable_surfaces_PAYMENT_PROVIDER_UNAVAILABLE()
    {
        var api = Client(_ => TestApi.Error(HttpStatusCode.BadGateway, ApiErrorCodes.PaymentProviderUnavailable));

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            api.UpdatePaymentSetupAsync(new UpdateShopPaymentSetupRequest("a@ok", "Shop")));

        Assert.Equal(ApiErrorCodes.PaymentProviderUnavailable, ex.Code);
        Assert.Equal(502, ex.HttpStatus);
    }

    [Fact]
    public async Task ListPaymentReports_asks_for_open_reports_with_device_token()
    {
        var api = Client(_ => TestApi.Ok($$"""{ "reports": [ {{ReportJson}} ] }"""));

        var reports = await api.ListPaymentReportsAsync();

        var call = Assert.Single(_calls);
        Assert.Equal("GET", call.Method);
        Assert.Equal("/api/shop/payment-reports?status=OPEN", call.PathAndQuery);
        Assert.Equal("", call.OperatorToken);
        var report = Assert.Single(reports);
        Assert.Equal("KGZ-AB12CD", report.PublicRef);
        Assert.Equal(2000, report.AmountPaise);
        Assert.Equal("412345678901", report.Utr);
        Assert.Equal("4321", report.CustomerPhoneLast4);
        Assert.Equal(PaymentReportStatus.Open, report.Status);
    }

    [Fact]
    public async Task ListPaymentReports_ALL()
    {
        var api = Client(_ => TestApi.Ok("""{ "reports": [] }"""));

        Assert.Empty(await api.ListPaymentReportsAsync("ALL"));
        Assert.Equal("/api/shop/payment-reports?status=ALL", Assert.Single(_calls).PathAndQuery);
    }

    [Fact]
    public async Task ApprovePaymentReport_posts_as_operator_with_idempotency_key()
    {
        var api = Client(_ => TestApi.Ok(ReportJson.Replace("\"OPEN\"", "\"APPROVED\"")));

        var result = await api.ApprovePaymentReportAsync("11111111-1111-4111-8111-111111111111", "key-3");

        var call = Assert.Single(_calls);
        Assert.Equal("POST", call.Method);
        Assert.Equal("/api/shop/payment-reports/11111111-1111-4111-8111-111111111111/approve", call.PathAndQuery);
        Assert.Equal("", call.Body);
        Assert.Equal("op-jwt", call.OperatorToken);
        Assert.Equal("key-3", call.IdempotencyKey);
        Assert.Equal(PaymentReportStatus.Approved, result.Status);
    }

    [Fact]
    public async Task DeclinePaymentReport_sends_reason_and_note_and_omits_a_null_note()
    {
        var api = Client(_ => TestApi.Ok(ReportJson.Replace("\"OPEN\"", "\"DECLINED\"")));

        await api.DeclinePaymentReportAsync("r-1", new DeclinePaymentReportRequest(DeclineReason.WrongAmount, "got ₹10"), "key-4");
        await api.DeclinePaymentReportAsync("r-1", new DeclinePaymentReportRequest(DeclineReason.NotReceived, null));

        Assert.Equal("/api/shop/payment-reports/r-1/decline", _calls[0].PathAndQuery);
        Assert.Equal("{\"reason\":\"WRONG_AMOUNT\",\"note\":\"got \\u20B910\"}", _calls[0].Body);
        Assert.Equal("op-jwt", _calls[0].OperatorToken);
        Assert.Equal("key-4", _calls[0].IdempotencyKey);
        Assert.Equal("""{"reason":"NOT_RECEIVED"}""", _calls[1].Body);
    }

    [Fact]
    public async Task Approving_a_decided_report_surfaces_PAYMENT_REPORT_NOT_OPEN()
    {
        var api = Client(_ => TestApi.Error(HttpStatusCode.Conflict, ApiErrorCodes.PaymentReportNotOpen));

        var ex = await Assert.ThrowsAsync<ApiException>(() => api.ApprovePaymentReportAsync("r-1"));

        Assert.Equal(ApiErrorCodes.PaymentReportNotOpen, ex.Code);
    }

    [Fact]
    public async Task ListManualRefunds_parses_pending_refunds()
    {
        var api = Client(_ => TestApi.Ok($$"""{ "refunds": [ {{RefundJson}} ] }"""));

        var refunds = await api.ListManualRefundsAsync();

        var call = Assert.Single(_calls);
        Assert.Equal("GET", call.Method);
        Assert.Equal("/api/shop/refunds", call.PathAndQuery);
        var refund = Assert.Single(refunds);
        Assert.Equal(1500, refund.AmountPaise);
        Assert.Equal("412345678901", refund.PaymentReference);
        Assert.Equal("Printer broken", refund.Reason);
    }

    [Fact]
    public async Task ConfirmManualRefund_accepts_204_and_sends_the_optional_utr()
    {
        var api = Client(_ => new HttpResponseMessage(HttpStatusCode.NoContent));

        await api.ConfirmManualRefundAsync("rf-1", new ConfirmManualRefundRequest(null), "key-5");
        await api.ConfirmManualRefundAsync("rf-1", new ConfirmManualRefundRequest("998877665544"));

        Assert.Equal("POST", _calls[0].Method);
        Assert.Equal("/api/shop/refunds/rf-1/confirm", _calls[0].PathAndQuery);
        Assert.Equal("{}", _calls[0].Body);
        Assert.Equal("op-jwt", _calls[0].OperatorToken);
        Assert.Equal("key-5", _calls[0].IdempotencyKey);
        Assert.Equal("""{"utr":"998877665544"}""", _calls[1].Body);
    }

    [Fact]
    public async Task Operator_routes_without_sign_in_get_OPERATOR_LOGIN_REQUIRED()
    {
        var api = Client(req => TestApi.Error(HttpStatusCode.Unauthorized, ApiErrorCodes.OperatorLoginRequired), signIn: false);

        var ex = await Assert.ThrowsAsync<ApiException>(() => api.ApprovePaymentReportAsync("r-1"));

        Assert.Equal(ApiErrorCodes.OperatorLoginRequired, ex.Code);
        Assert.Equal("", Assert.Single(_calls).OperatorToken);
    }
}

public class UpiFormatTests
{
    [Theory]
    [InlineData("xeroxshop@okicici")]
    [InlineData("9876543210@ybl")]
    [InlineData("  Sri.Ganesh_01@OKSBI ")]
    [InlineData("shop-1@paytm")]
    public void Valid_upi_ids(string upiId) => Assert.Null(UpiFormat.ValidateUpiId(upiId));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("xeroxshop")]
    [InlineData("@okicici")]
    [InlineData("a@okicici")] // name needs at least 2 characters
    [InlineData("shop@1bank")] // handle starts with a letter
    [InlineData("shop name@okicici")]
    [InlineData("shop@@okicici")]
    [InlineData("https://pay.me")]
    public void Invalid_upi_ids_get_a_friendly_message(string upiId)
    {
        var message = UpiFormat.ValidateUpiId(upiId);
        Assert.Equal(UpiFormat.UpiIdMessage, message);
        Assert.Contains("name@bank", message);
    }

    [Fact]
    public void UpiId_is_normalized_like_the_server() =>
        Assert.Equal("sri.ganesh@oksbi", UpiFormat.NormalizeUpiId("  Sri.Ganesh@OKSBI "));

    [Theory]
    [InlineData("Sri Ganesh Xerox", true)]
    [InlineData("AB", true)]
    [InlineData(" A ", false)]
    [InlineData("", false)]
    public void Payee_name_is_2_to_60_characters(string name, bool valid) =>
        Assert.Equal(valid, UpiFormat.ValidatePayeeName(name) is null);

    [Fact]
    public void Payee_name_over_60_characters_is_rejected() =>
        Assert.NotNull(UpiFormat.ValidatePayeeName(new string('a', 61)));

    [Theory]
    [InlineData("412345678901", true)]
    [InlineData("4123 4567 8901", true)]
    [InlineData("41234567890", false)]
    [InlineData("4123456789012", false)]
    [InlineData("41234567890A", false)]
    public void Utr_is_12_digits(string utr, bool valid) => Assert.Equal(valid, UpiFormat.IsValidUtr(utr));

    [Fact]
    public void Utr_is_grouped_for_reading() => Assert.Equal("4123 4567 8901", UpiFormat.GroupUtr("412345678901"));
}

public class PaymentReadinessDisplayTests
{
    [Theory]
    [InlineData("NOT_REQUIRED", "Demo payments — nothing to set up", StatusTone.Grey)]
    [InlineData("NEEDS_UPI_ID", "Add your UPI ID so customers can pay you", StatusTone.Red)]
    [InlineData("NEEDS_PHONE", "Connect your phone to confirm payments automatically", StatusTone.Orange)]
    [InlineData("PHONE_OFFLINE", "Your payments phone is offline — check internet / battery", StatusTone.Orange)]
    [InlineData("READY", "Payments are confirmed automatically", StatusTone.Green)]
    public void Readiness_maps_to_the_contract_text_and_colour(string readiness, string text, StatusTone tone)
    {
        var (actualText, actualTone) = PaymentReadinessDisplay.For(readiness);
        Assert.Equal(text, actualText);
        Assert.Equal(tone, actualTone);
    }

    [Fact]
    public void Unknown_readiness_is_grey() => Assert.Equal(StatusTone.Grey, PaymentReadinessDisplay.For("SOMETHING_NEW").Tone);

    [Fact]
    public void Money_is_en_IN_rupees() => Assert.Equal("₹1,234.50", PaymentDisplay.Money(123450));

    [Fact]
    public void Phone_last_seen_text()
    {
        var now = DateTimeOffset.Parse("2026-11-11T10:00:00Z");
        Assert.Equal("Online", PaymentDisplay.LastSeen(new ObserverPhone("p", "P", true, "2026-11-11T09:59:50Z", null), now));
        Assert.Equal("Offline · last seen 5 min ago", PaymentDisplay.LastSeen(new ObserverPhone("p", "P", false, "2026-11-11T09:55:00Z", null), now));
        Assert.Equal("Offline · last seen 3 h ago", PaymentDisplay.LastSeen(new ObserverPhone("p", "P", false, "2026-11-11T07:00:00Z", null), now));
        Assert.Equal("Not connected yet", PaymentDisplay.LastSeen(new ObserverPhone("p", "P", false, null, null), now));
    }

    [Fact]
    public void Qr_codes_are_rendered_locally_as_png()
    {
        var png = QrCodeRenderer.PngBytes("youpi://enroll?secret=abc");
        Assert.True(png.Length > 100);
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png[..4]);
    }

    [Fact]
    public async Task Payment_report_socket_hint_wakes_the_report_refresh()
    {
        var signals = new AgentSignals();
        var client = new RealtimeClient(() => throw new NotSupportedException(), () => "t", signals);
        var wait = signals.PaymentReports.WaitAsync(TimeSpan.FromSeconds(5), CancellationToken.None);

        client.Dispatch("payment_report.changed", null);

        Assert.True(await wait);
    }
}

/// <summary>Payments page: setup steps, pairing QR, approve / decline, refunds.</summary>
public sealed class PaymentsViewModelTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-payments-tests", Guid.NewGuid().ToString("N"));
    private readonly List<(string Method, string Path, string Body, string OperatorToken, string IdempotencyKey)> _calls = new();
    private readonly List<string?> _renderedQr = new();
    private readonly List<string> _copied = new();
    private DateTimeOffset _now = DateTimeOffset.Parse("2026-11-11T10:00:00Z");

    private List<string> _openReports = new() { UpiPaymentsApiTests.ReportJson };
    private List<string> _refunds = new();
    private string _setup = UpiPaymentsApiTests.SetupJson;
    private Func<HttpRequestMessage, HttpResponseMessage?>? _override;

    private (PaymentsViewModel Vm, AppStatus Status, AgentSignals Signals) Create()
    {
        var store = new FakeSecureStore("device-token");
        var session = new AgentSession();
        var status = new AppStatus(store, new AgentStateStore(Path.Combine(_root, "state.json")), session);
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            var body = req.Content is null ? "" : await req.Content.ReadAsStringAsync();
            var path = req.RequestUri!.PathAndQuery;
            if (path.EndsWith("/operator/login")) return TestApi.Ok(TestApi.LoginResponse);
            _calls.Add((req.Method.Method, path, body, TestApi.Header(req, "X-Operator-Token"), TestApi.Header(req, "Idempotency-Key")));
            if (_override?.Invoke(req) is { } custom) return custom;
            if (path.StartsWith("/api/shop/payment-reports?")) return TestApi.Ok($$"""{ "reports": [ {{string.Join(",", _openReports)}} ] }""");
            if (path == "/api/shop/refunds") return TestApi.Ok($$"""{ "refunds": [ {{string.Join(",", _refunds)}} ] }""");
            if (path.EndsWith("/approve"))
            {
                _openReports.Clear();
                return TestApi.Ok(UpiPaymentsApiTests.ReportJson.Replace("\"OPEN\"", "\"APPROVED\""));
            }
            if (path.EndsWith("/decline"))
            {
                _openReports.Clear();
                return TestApi.Ok(UpiPaymentsApiTests.ReportJson.Replace("\"OPEN\"", "\"DECLINED\""));
            }
            if (path.EndsWith("/confirm"))
            {
                _refunds.Clear();
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            if (path == "/api/shop/payments/pairing") return TestApi.Ok("""{ "qrText": "youpi://enroll?code=XYZ", "expiresAt": "2026-11-11T10:10:00Z" }""");
            if (path == "/api/shop/payments/setup") return TestApi.Ok(_setup);
            return TestApi.Error(HttpStatusCode.NotFound, "NOT_FOUND");
        });
        var api = TestApi.Client(handler, store, session);
        api.OperatorLoginAsync("owner", "pw").GetAwaiter().GetResult();
        var signals = new AgentSignals();
        var vm = new PaymentsViewModel(api, status, signals,
            renderQr: text => { _renderedQr.Add(text); return null; },
            clock: () => _now,
            copy: _copied.Add);
        return (vm, status, signals);
    }

    [Fact]
    public async Task Open_reports_drive_the_badge_and_the_attention_text()
    {
        var (vm, _, _) = Create();

        await vm.RefreshReportsAsync();

        var item = Assert.Single(vm.Reports);
        Assert.Equal("KGZ-AB12CD", item.PublicRef);
        Assert.Equal("₹20.00", item.DisplayAmount);
        Assert.Equal("4123 4567 8901", item.DisplayUtr);
        Assert.Equal("Customer phone ••• 4321", item.DisplayPhone);
        Assert.Equal("Approve — I received ₹20.00", item.ApproveLabel);
        Assert.Equal(1, vm.BadgeCount);
        Assert.Equal("1 customer says they paid — check your UPI app", vm.AttentionText);
    }

    [Fact]
    public async Task Approve_flow_posts_approve_as_operator_closes_the_sheet_and_wakes_jobs()
    {
        var (vm, _, signals) = Create();
        await vm.RefreshReportsAsync();
        var jobsWoken = signals.Jobs.WaitAsync(TimeSpan.FromSeconds(5), CancellationToken.None);

        vm.OpenApproveCommand.Execute(vm.Reports[0]);
        Assert.True(vm.IsApproveOpen);
        await vm.ConfirmApproveCommand.ExecuteAsync(null);

        var approve = Assert.Single(_calls, c => c.Path.EndsWith("/approve"));
        Assert.Equal("POST", approve.Method);
        Assert.Equal("/api/shop/payment-reports/11111111-1111-4111-8111-111111111111/approve", approve.Path);
        Assert.Equal("op-jwt", approve.OperatorToken);
        Assert.False(string.IsNullOrEmpty(approve.IdempotencyKey));
        Assert.False(vm.IsApproveOpen);
        Assert.Empty(vm.Reports); // refreshed after the action
        Assert.Equal(0, vm.BadgeCount);
        Assert.True(await jobsWoken);
    }

    [Fact]
    public async Task Retrying_the_same_approve_sheet_reuses_its_idempotency_key()
    {
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();
        _override = req => req.RequestUri!.AbsolutePath.EndsWith("/approve")
            ? TestApi.Error(HttpStatusCode.BadGateway, ApiErrorCodes.PaymentProviderUnavailable, "down")
            : null;

        vm.OpenApproveCommand.Execute(vm.Reports[0]);
        await vm.ConfirmApproveCommand.ExecuteAsync(null);
        Assert.True(vm.IsApproveOpen); // stays open with the error
        Assert.NotNull(vm.SheetError);
        await vm.ConfirmApproveCommand.ExecuteAsync(null);

        var keys = _calls.Where(c => c.Path.EndsWith("/approve")).Select(c => c.IdempotencyKey).Distinct().ToList();
        Assert.Single(keys);
    }

    [Fact]
    public async Task Approving_an_already_decided_report_closes_the_sheet_and_refreshes()
    {
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();
        _override = req =>
        {
            if (!req.RequestUri!.AbsolutePath.EndsWith("/approve")) return null;
            _openReports.Clear();
            return TestApi.Error(HttpStatusCode.Conflict, ApiErrorCodes.PaymentReportNotOpen);
        };

        vm.OpenApproveCommand.Execute(vm.Reports[0]);
        await vm.ConfirmApproveCommand.ExecuteAsync(null);

        Assert.False(vm.IsApproveOpen);
        Assert.Null(vm.SheetError);
        Assert.Empty(vm.Reports);
    }

    [Fact]
    public async Task Decline_needs_a_reason_then_sends_reason_and_note()
    {
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();

        vm.OpenDeclineCommand.Execute(vm.Reports[0]);
        Assert.True(vm.IsDeclineOpen);
        Assert.False(vm.SubmitDeclineCommand.CanExecute(null));

        vm.SelectedDeclineReason = vm.DeclineReasons.Single(r => r.Code == DeclineReason.WrongAmount);
        vm.DeclineNote = "  Only ₹10 came  ";
        Assert.True(vm.SubmitDeclineCommand.CanExecute(null));
        await vm.SubmitDeclineCommand.ExecuteAsync(null);

        var decline = Assert.Single(_calls, c => c.Path.EndsWith("/decline"));
        Assert.Equal("{\"reason\":\"WRONG_AMOUNT\",\"note\":\"Only \\u20B910 came\"}", decline.Body);
        Assert.Equal("op-jwt", decline.OperatorToken);
        Assert.False(vm.IsDeclineOpen);
        Assert.Empty(vm.Reports);
    }

    [Fact]
    public async Task Copy_puts_the_full_utr_on_the_clipboard()
    {
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();

        vm.CopyUtrCommand.Execute(vm.Reports[0]);

        Assert.Equal("412345678901", Assert.Single(_copied));
    }

    [Fact]
    public async Task Setup_prefills_step_1_and_shows_the_status_line()
    {
        var (vm, _, _) = Create();

        await vm.LoadSetupAsync();

        Assert.Equal("xeroxshop@okicici", vm.UpiId);
        Assert.Equal("Sri Ganesh Xerox", vm.PayeeName);
        Assert.True(vm.Step1Done);
        Assert.Equal("Your payments phone is offline — check internet / battery", vm.StatusText);
        Assert.Equal(StatusTone.Orange, vm.StatusTone);
        Assert.True(vm.IsSetupVisible);
        Assert.Contains("https://pay.example.test/app.apk", _renderedQr);
        var phone = Assert.Single(vm.Phones);
        Assert.Equal("Offline · last seen 2 h ago", phone.LastSeenText);
    }

    [Fact]
    public async Task A_refresh_does_not_overwrite_what_the_shopkeeper_is_typing()
    {
        var (vm, _, _) = Create();
        await vm.LoadSetupAsync();

        vm.UpiId = "newshop@ybl";
        await vm.LoadSetupAsync();

        Assert.Equal("newshop@ybl", vm.UpiId);
    }

    [Fact]
    public async Task Demo_payments_hide_the_setup_steps()
    {
        _setup = """{ "provider": "demo", "readiness": "NOT_REQUIRED", "upiId": null, "payeeName": null, "phones": [], "appDownloadUrl": null, "updatedAt": null }""";
        var (vm, _, _) = Create();

        await vm.LoadSetupAsync();

        Assert.False(vm.IsSetupVisible);
        Assert.Equal("Demo payments — nothing to set up", vm.StatusText);
    }

    [Fact]
    public async Task Invalid_upi_id_shows_a_friendly_message_and_does_not_call_the_server()
    {
        var (vm, _, _) = Create();
        vm.UpiId = "xeroxshop";
        vm.PayeeName = "Sri Ganesh Xerox";

        await vm.SaveSetupCommand.ExecuteAsync(null);

        Assert.Equal(UpiFormat.UpiIdMessage, vm.UpiIdError);
        Assert.DoesNotContain(_calls, c => c.Method == "PUT");
    }

    [Fact]
    public async Task Saving_step_1_puts_the_normalized_upi_id_as_operator()
    {
        _setup = UpiPaymentsApiTests.SetupJson.Replace("PHONE_OFFLINE", "NEEDS_PHONE");
        var (vm, _, _) = Create();
        vm.UpiId = "  XeroxShop@OKICICI ";
        vm.PayeeName = " Sri Ganesh Xerox ";

        await vm.SaveSetupCommand.ExecuteAsync(null);

        var put = Assert.Single(_calls, c => c.Method == "PUT");
        Assert.Equal("""{"upiId":"xeroxshop@okicici","payeeName":"Sri Ganesh Xerox"}""", put.Body);
        Assert.Equal("op-jwt", put.OperatorToken);
        Assert.False(string.IsNullOrEmpty(put.IdempotencyKey));
        Assert.Null(vm.UpiIdError);
        Assert.Null(vm.Step1Message);
        Assert.Equal(ShopPaymentReadiness.NeedsPhone, vm.Readiness);
    }

    [Fact]
    public async Task Provider_down_on_save_shows_a_retry_message()
    {
        _override = req => req.Method == HttpMethod.Put
            ? TestApi.Error(HttpStatusCode.BadGateway, ApiErrorCodes.PaymentProviderUnavailable, "YouPI unreachable")
            : null;
        var (vm, _, _) = Create();
        vm.UpiId = "xeroxshop@okicici";
        vm.PayeeName = "Sri Ganesh Xerox";

        await vm.SaveSetupCommand.ExecuteAsync(null);

        Assert.Contains("try again", vm.Step1Message);
    }

    [Fact]
    public async Task Pairing_code_is_rendered_locally_counts_down_and_expires()
    {
        var (vm, _, _) = Create();
        await vm.LoadSetupAsync();
        Assert.True(vm.ShowPairingCommand.CanExecute(null));

        await vm.ShowPairingCommand.ExecuteAsync(null);

        var pairing = Assert.Single(_calls, c => c.Path == "/api/shop/payments/pairing");
        Assert.Equal("op-jwt", pairing.OperatorToken);
        Assert.Contains("youpi://enroll?code=XYZ", _renderedQr);
        Assert.True(vm.IsPairingShown);
        Assert.Equal("Valid for 10:00", vm.PairingCountdown);
        Assert.Equal("New code", vm.PairingButtonText);

        _now = _now.AddMinutes(10).AddSeconds(1);
        vm.Tick();

        Assert.True(vm.PairingExpired);
        Assert.Null(vm.PairingQr);
        Assert.Contains("expired", vm.PairingCountdown);
    }

    [Fact]
    public async Task Pairing_is_unavailable_until_the_upi_id_is_saved()
    {
        _setup = """{ "provider": "youpi", "readiness": "NEEDS_UPI_ID", "upiId": null, "payeeName": null, "phones": [], "appDownloadUrl": "https://x.test/a.apk", "updatedAt": null }""";
        var (vm, _, _) = Create();

        await vm.LoadSetupAsync();

        Assert.False(vm.ShowPairingCommand.CanExecute(null));
        Assert.Equal(StatusTone.Red, vm.StatusTone);
        Assert.Equal("Save your UPI ID first (step 1).", vm.Step2Hint);
    }

    [Fact]
    public async Task A_new_phone_reporting_in_hides_the_pairing_code()
    {
        var (vm, _, _) = Create();
        await vm.LoadSetupAsync();
        await vm.ShowPairingCommand.ExecuteAsync(null);

        _setup = UpiPaymentsApiTests.SetupJson
            .Replace("PHONE_OFFLINE", "READY")
            .Replace("\"phones\": [", "\"phones\": [ { \"id\": \"ph-2\", \"name\": \"Galaxy\", \"online\": true, \"lastSeenAt\": \"2026-11-11T10:00:00Z\", \"lastPaymentSeenAt\": null },");
        await vm.LoadSetupAsync();

        Assert.False(vm.IsPairingShown);
        Assert.Null(vm.PairingCountdown);
        Assert.Equal(StatusTone.Green, vm.StatusTone);
        Assert.Equal(2, vm.Phones.Count);
    }

    [Fact]
    public async Task Refund_confirm_validates_the_optional_utr_then_posts_it()
    {
        _refunds = new() { UpiPaymentsApiTests.RefundJson };
        _openReports.Clear();
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();
        var refund = Assert.Single(vm.Refunds);
        Assert.Equal("₹15.00", refund.DisplayAmount);
        Assert.Equal("1 refund to send", vm.AttentionText);

        vm.OpenRefundCommand.Execute(refund);
        vm.RefundUtr = "12345";
        await vm.SubmitRefundCommand.ExecuteAsync(null);
        Assert.Equal(UpiFormat.UtrMessage, vm.RefundUtrError);
        Assert.DoesNotContain(_calls, c => c.Path.EndsWith("/confirm"));

        vm.RefundUtr = "9988 7766 5544";
        await vm.SubmitRefundCommand.ExecuteAsync(null);

        var confirm = Assert.Single(_calls, c => c.Path.EndsWith("/confirm"));
        Assert.Equal("/api/shop/refunds/33333333-3333-4333-8333-333333333333/confirm", confirm.Path);
        Assert.Equal("""{"utr":"998877665544"}""", confirm.Body);
        Assert.Equal("op-jwt", confirm.OperatorToken);
        Assert.False(vm.IsRefundOpen);
        Assert.Empty(vm.Refunds);
        Assert.Null(vm.AttentionText);
    }

    [Fact]
    public async Task Refund_confirm_without_utr_sends_an_empty_body()
    {
        _refunds = new() { UpiPaymentsApiTests.RefundJson };
        var (vm, _, _) = Create();
        await vm.RefreshReportsAsync();

        vm.OpenRefundCommand.Execute(vm.Refunds[0]);
        await vm.SubmitRefundCommand.ExecuteAsync(null);

        Assert.Equal("{}", Assert.Single(_calls, c => c.Path.EndsWith("/confirm")).Body);
    }

    [Fact]
    public async Task Unpairing_clears_reports_and_badge()
    {
        var (vm, status, _) = Create();
        await vm.RefreshReportsAsync();
        Assert.Equal(1, vm.BadgeCount);

        status.Unpair();

        Assert.Equal(0, vm.BadgeCount);
        Assert.Empty(vm.Reports);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

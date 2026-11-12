using System.Net;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>
/// ADR-003: the counter page — customers waiting by pickup number, what to collect, customers who
/// just arrived, and the approval (by number) that marks the order paid.
/// </summary>
public sealed class CounterPaymentsTests : IDisposable
{
    private static readonly DateOnly Today = new(2026, 11, 12);

    private const string RequestJson = """
        { "orderId": "o-9", "publicRef": "KGZ-NOTLISTED", "pickupNumber": 9, "pickupDate": "2026-11-12", "amountPaise": 1000,
          "options": { "pageRange": null, "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
          "pageCount": 5, "printedSides": 5, "requestedAt": "2026-11-12T05:30:00.000Z" }
        """;

    private const string ApprovedJobJson = """
        { "orderId": "o-1", "publicRef": "KGZ-7H3K2Q", "status": "PENDING_REVIEW",
          "options": { "copies": 1, "colour": false, "duplex": false, "paperSize": "A4" },
          "pageCount": 3, "amountPaise": 2400, "simulatedPayment": false,
          "createdAt": "2026-11-12T05:30:00Z", "paidAt": "2026-11-12T06:00:00Z", "printJob": null, "rejection": null,
          "previewUrl": null, "pickupNumber": 7, "pickupDate": "2026-11-12", "paymentMethod": "COUNTER" }
        """;

    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-counter-tests", Guid.NewGuid().ToString("N"));

    private static CounterPaymentRequest Request(string orderId = "o-1", int number = 7, int amountPaise = 2400,
        string date = "2026-11-12") =>
        new(orderId, $"KGZ-{orderId.ToUpperInvariant()}", number, date, amountPaise,
            new ShopPrintOptions(null, 2, false, false, "A4"), 3, 6, "2026-11-12T05:30:00.000Z");

    private (CounterPaymentsViewModel Vm, AppStatus Status) Create(StubHttpMessageHandler handler)
    {
        var store = new FakeSecureStore("device-token");
        var session = new AgentSession();
        session.SignIn(new OperatorLoginResponse("op-jwt", "2099-01-01T00:00:00Z",
            new OperatorInfo("u-1", "Asha", "SHOP_OPERATOR")));
        var stateStore = new AgentStateStore(Path.Combine(_root, "state.json"));
        var status = new AppStatus(store, stateStore, session);
        var api = TestApi.Client(handler, store, session);
        return (new CounterPaymentsViewModel(api, status) { Today = Today }, status);
    }

    private static StubHttpMessageHandler EmptyList() =>
        new((_, _) => Task.FromResult(TestApi.Ok("""{ "requests": [] }""")));

    /// <summary>Rupees with two decimals — the exact spacing depends on the platform's currency data.</summary>
    private static void AssertMoney(string expected, string actual)
    {
        Assert.StartsWith("₹", actual);
        Assert.Contains(expected, actual);
    }

    [Theory]
    [InlineData("7", 7)]
    [InlineData("#7", 7)]
    [InlineData(" # 12 ", 12)]
    [InlineData("007", 7)]
    public void The_typed_number_is_read_like_the_customer_shows_it(string text, int expected) =>
        Assert.Equal(expected, CounterPaymentsViewModel.ParseNumber(text));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("0")]
    [InlineData("7a")]
    [InlineData("123456")]
    public void Anything_else_is_not_a_pickup_number(string? text) =>
        Assert.Null(CounterPaymentsViewModel.ParseNumber(text));

    [Fact]
    public void Rows_show_the_number_and_what_to_collect_in_paise()
    {
        var item = new CounterRequestItem(Request(amountPaise: 2400), Today);
        Assert.Equal("#7", item.DisplayPickupNumber);
        Assert.Null(item.DisplayPickupDate);
        AssertMoney("24.00", item.DisplayAmount);
        AssertMoney("0.50", new CounterRequestItem(Request(amountPaise: 50), Today).DisplayAmount);
        Assert.Equal("KGZ-O-1 · 3 pages · 2 copies · Black & white · Single-sided", item.Summary);

        // Numbers restart daily: yesterday's #7 carries its date.
        Assert.Equal("11 Nov", new CounterRequestItem(Request(date: "2026-11-11"), Today).DisplayPickupDate);
    }

    [Fact]
    public void The_first_load_never_toasts_but_a_new_customer_does()
    {
        var (vm, status) = Create(EmptyList());

        vm.ApplyWaiting([Request()]);
        Assert.Empty(status.Toasts);
        Assert.Equal("1 waiting", vm.CountsText);

        vm.ApplyWaiting([Request(), Request("o-2", number: 8, amountPaise: 1000)]);

        var toast = Assert.Single(status.Toasts);
        Assert.Equal("Counter payment waiting", toast.Title);
        Assert.Contains("#8 · collect", toast.Detail);
        Assert.Equal("2 waiting", vm.CountsText);
    }

    [Fact]
    public void A_customer_who_left_is_not_announced_again()
    {
        var (vm, status) = Create(EmptyList());

        vm.ApplyWaiting([Request()]);
        vm.ApplyWaiting([]);
        vm.ApplyWaiting([]);

        Assert.Empty(status.Toasts);
        Assert.True(vm.IsEmpty);
    }

    [Fact]
    public void Picking_a_waiting_row_shows_it_ready_to_approve()
    {
        var (vm, _) = Create(EmptyList());
        vm.ApplyWaiting([Request()]);

        vm.SelectedWaiting = vm.Waiting[0];

        Assert.Equal("#7", vm.Result!.DisplayPickupNumber);
        Assert.True(vm.ApproveCommand.CanExecute(null));
    }

    [Fact]
    public async Task Typing_a_listed_number_selects_it_without_a_server_call()
    {
        int calls = 0;
        var (vm, _) = Create(new StubHttpMessageHandler((_, _) => { calls++; return Task.FromResult(TestApi.Ok(RequestJson)); }));
        vm.ApplyWaiting([Request(), Request("o-2", number: 8)]);

        vm.Number = "#8";
        await vm.FindCommand.ExecuteAsync(null);

        Assert.Equal(0, calls);
        Assert.Equal("o-2", vm.Result!.OrderId);
        Assert.Same(vm.Waiting[1], vm.SelectedWaiting);
    }

    [Fact]
    public async Task A_number_not_in_the_list_is_looked_up_on_the_server()
    {
        string? body = null;
        var (vm, _) = Create(new StubHttpMessageHandler(async (req, _) =>
        {
            body = await req.Content!.ReadAsStringAsync();
            return TestApi.Ok(RequestJson);
        }));

        vm.Number = "9";
        await vm.FindCommand.ExecuteAsync(null);

        Assert.Equal("""{"pickupNumber":9}""", body);
        Assert.Equal("KGZ-NOTLISTED", vm.Result!.PublicRef);
        AssertMoney("10.00", vm.Result.DisplayAmount);
    }

    [Fact]
    public async Task An_unknown_number_is_shown_in_plain_words()
    {
        var (vm, _) = Create(new StubHttpMessageHandler((_, _) =>
            Task.FromResult(TestApi.Error(HttpStatusCode.NotFound, "COUNTER_PAYMENT_NOT_FOUND"))));

        vm.Number = "42";
        await vm.FindCommand.ExecuteAsync(null);

        Assert.StartsWith("No one is waiting to pay with that number", vm.Error);
        Assert.Null(vm.Result);
        Assert.False(vm.ApproveCommand.CanExecute(null));
    }

    [Fact]
    public async Task Typing_something_that_is_not_a_number_asks_for_one()
    {
        var (vm, _) = Create(EmptyList());

        vm.Number = "abc";
        await vm.FindCommand.ExecuteAsync(null);

        Assert.Contains("pickup number", vm.Error);
        Assert.Null(vm.Result);
    }

    [Fact]
    public async Task Approving_sends_the_number_and_clears_the_card()
    {
        string? approveBody = null;
        var (vm, status) = Create(new StubHttpMessageHandler(async (req, _) =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith("/approve"))
            {
                approveBody = await req.Content!.ReadAsStringAsync();
                Assert.EndsWith("/counter-payments/o-1/approve", req.RequestUri.AbsolutePath);
                return TestApi.Ok(ApprovedJobJson);
            }
            return TestApi.Ok("""{ "requests": [] }""");
        }));
        vm.ApplyWaiting([Request()]);
        vm.SelectedWaiting = vm.Waiting[0];

        await vm.ApproveCommand.ExecuteAsync(null);

        Assert.Equal("""{"pickupNumber":7}""", approveBody);
        var toast = status.Toasts.Last();
        Assert.Equal("Paid · pickup #7", toast.Title);
        Assert.Equal("KGZ-O-1 is now in Jobs", toast.Detail);
        Assert.Null(vm.Result);
        Assert.Empty(vm.Waiting);
    }

    [Fact]
    public void An_order_paid_or_cancelled_elsewhere_leaves_the_card()
    {
        var (vm, _) = Create(EmptyList());
        vm.ApplyWaiting([Request()]);
        vm.SelectedWaiting = vm.Waiting[0];

        vm.ApplyWaiting([]);

        Assert.Null(vm.Result);
        Assert.False(vm.ApproveCommand.CanExecute(null));
    }

    [Fact]
    public async Task A_cancelled_payment_is_not_charged()
    {
        var (vm, status) = Create(new StubHttpMessageHandler((req, _) => Task.FromResult(
            req.RequestUri!.AbsolutePath.EndsWith("/cancel")
                ? TestApi.Ok("""{ "ok": true }""")
                : TestApi.Ok("""{ "requests": [] }"""))));
        vm.ConfirmCancel = _ => true;

        vm.ApplyWaiting([Request()]);
        await vm.CancelWaitingCommand.ExecuteAsync(vm.Waiting[0]);

        Assert.Contains(status.Toasts, t => t.Title == "Counter payment cancelled");
        Assert.Empty(vm.Waiting);
    }

    [Fact]
    public async Task Cancelling_asks_first()
    {
        var (vm, status) = Create(EmptyList());
        bool asked = false;
        vm.ConfirmCancel = _ => { asked = true; return false; };

        vm.ApplyWaiting([Request()]);
        await vm.CancelWaitingCommand.ExecuteAsync(vm.Waiting[0]);

        Assert.True(asked);
        Assert.Single(vm.Waiting);
        Assert.Empty(status.Toasts);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

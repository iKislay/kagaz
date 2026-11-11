using System.Text.Json;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;
using Step = Kagaz.ShopAgent.App.ViewModels.JobsViewModel.ResolveSheet;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.11 / T14 (app side): needs-check actions; reprint only after two explicit confirmations.</summary>
public sealed class NeedsCheckTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-needscheck-tests", Guid.NewGuid().ToString("N"));
    private readonly List<(string Path, string Body, string IdempotencyKey, string OperatorToken)> _resolves = new();

    private JobsViewModel Create()
    {
        var store = new FakeSecureStore("device-token");
        var session = new AgentSession();
        session.SignIn(new OperatorLoginResponse("op-jwt", "2099-01-01T00:00:00Z", new OperatorInfo("u", "Asha", "SHOP_OPERATOR")));
        var stateStore = new AgentStateStore(Path.Combine(_root, "state.json"));
        var status = new AppStatus(store, stateStore, session);
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            if (req.RequestUri!.AbsolutePath.EndsWith("/resolve"))
            {
                _resolves.Add((req.RequestUri.AbsolutePath, await req.Content!.ReadAsStringAsync(),
                    TestApi.Header(req, "Idempotency-Key"), TestApi.Header(req, "X-Operator-Token")));
                return TestApi.Ok(TestApi.JobJson("QUEUED"));
            }
            return TestApi.Ok("""{ "jobs": [] }""");
        });
        var api = TestApi.Client(handler, store, session);
        var vm = new JobsViewModel(api, stateStore, status, new AgentSettings(), new AgentSignals())
        {
            SelectedJob = new JobItem(JsonSerializer.Deserialize<ShopJob>(
                TestApi.JobJson("NEEDS_OPERATOR_CHECK", "o-1", "KGZ-AAAA", "pj-1", "UNCERTAIN"), JsonOptions.Response)!),
        };
        return vm;
    }

    [Fact]
    public void Warning_copy_is_exact()
    {
        Assert.Equal("Check the printer output tray before reprinting — reprinting may produce duplicate pages",
            JobsViewModel.NeedsCheckWarning);
    }

    [Fact]
    public async Task Reprint_needs_tick_then_a_second_confirmation_and_sends_confirm_true()
    {
        var vm = Create();
        Assert.True(vm.SelectedJob!.NeedsCheck);

        vm.OpenReprintCommand.Execute(null);
        Assert.Equal(Step.ReprintCheck, vm.ResolveStep);
        Assert.False(vm.ContinueReprintCommand.CanExecute(null)); // tray not checked yet
        Assert.False(vm.SubmitResolveCommand.CanExecute(null));   // step 1 can never submit

        vm.ResolveChecked = true;
        vm.ContinueReprintCommand.Execute(null);
        Assert.Equal(Step.ReprintFinal, vm.ResolveStep);
        Assert.Empty(_resolves);

        await vm.SubmitResolveCommand.ExecuteAsync(null);

        var call = Assert.Single(_resolves);
        Assert.Equal("/api/shop/jobs/o-1/resolve", call.Path);
        Assert.Equal("""{"action":"REPRINT","confirm":true}""", call.Body);
        Assert.Equal("op-jwt", call.OperatorToken);
        Assert.False(string.IsNullOrEmpty(call.IdempotencyKey));
        Assert.Equal(Step.None, vm.ResolveStep);
    }

    [Fact]
    public void Cancelling_reprint_sends_nothing()
    {
        var vm = Create();
        vm.OpenReprintCommand.Execute(null);
        vm.ResolveChecked = true;
        vm.ContinueReprintCommand.Execute(null);

        vm.CancelResolveCommand.Execute(null);

        Assert.Equal(Step.None, vm.ResolveStep);
        Assert.Empty(_resolves);
    }

    [Fact]
    public async Task Confirm_printed_requires_the_tick()
    {
        var vm = Create();
        vm.OpenConfirmPrintedCommand.Execute(null);
        Assert.False(vm.SubmitResolveCommand.CanExecute(null));

        vm.ResolveChecked = true;
        await vm.SubmitResolveCommand.ExecuteAsync(null);

        Assert.Equal("""{"action":"CONFIRM_PRINTED"}""", Assert.Single(_resolves).Body);
    }

    [Fact]
    public async Task Mark_failed_sends_note()
    {
        var vm = Create();
        vm.OpenMarkFailedCommand.Execute(null);
        vm.ResolveNote = "  Paper jam shredded it  ";

        await vm.SubmitResolveCommand.ExecuteAsync(null);

        Assert.Equal("""{"action":"MARK_FAILED","note":"Paper jam shredded it"}""", Assert.Single(_resolves).Body);
    }

    [Fact]
    public void Resolve_actions_are_only_offered_for_needs_check()
    {
        var vm = Create();
        vm.SelectedJob = new JobItem(JsonSerializer.Deserialize<ShopJob>(TestApi.JobJson("PRINTING", printJobId: "pj-1", printJobStatus: "SUBMITTED"), JsonOptions.Response)!);

        Assert.False(vm.OpenReprintCommand.CanExecute(null));
        Assert.False(vm.OpenConfirmPrintedCommand.CanExecute(null));
        Assert.False(vm.OpenMarkFailedCommand.CanExecute(null));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

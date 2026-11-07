using System.Net;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.6: approval-mode control reflects the server and PATCHes only on operator changes.</summary>
public sealed class ShopModeViewModelTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-mode-tests", Guid.NewGuid().ToString("N"));
    private readonly List<(string Method, string Body, string OperatorToken)> _calls = new();
    private HttpStatusCode _patchStatus = HttpStatusCode.OK;

    private (ShopModeViewModel Vm, AppStatus Status, AgentSession Session) Create()
    {
        var store = new FakeSecureStore("device-token");
        var session = new AgentSession();
        var status = new AppStatus(store, new AgentStateStore(Path.Combine(_root, "state.json")), session);
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            var body = req.Content is null ? "" : await req.Content.ReadAsStringAsync();
            _calls.Add((req.Method.Method, body, TestApi.Header(req, "X-Operator-Token")));
            if (req.RequestUri!.AbsolutePath.EndsWith("/login")) return TestApi.Ok(TestApi.LoginResponse);
            if (_patchStatus != HttpStatusCode.OK) return TestApi.Error(_patchStatus, "OPERATOR_LOGIN_REQUIRED");
            return TestApi.Ok(body.Contains("AUTO")
                ? """{ "approvalMode": "AUTO", "autoPaused": false }"""
                : body.Contains("autoPaused\":true") ? """{ "approvalMode": "AUTO", "autoPaused": true }""" : """{ "approvalMode": "MANUAL", "autoPaused": false }""");
        });
        var api = TestApi.Client(handler, store, session);
        api.OperatorLoginAsync("a", "b").GetAwaiter().GetResult();
        _calls.Clear();
        return (new ShopModeViewModel(api, status), status, session);
    }

    [Fact]
    public void Heartbeat_state_is_reflected_without_patching()
    {
        var (vm, status, _) = Create();

        status.ApplyShopState("AUTO", autoPaused: true, "OPEN");

        Assert.Equal(ShopModeViewModel.AutoLabel, vm.SelectedMode);
        Assert.True(vm.AutoPaused);
        Assert.Empty(_calls);
    }

    [Fact]
    public async Task Operator_switching_to_auto_patches_with_operator_token()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);

        await vm.SendAsync(new ShopModeRequest(ApprovalMode.Auto, null));

        var call = Assert.Single(_calls);
        Assert.Equal("PATCH", call.Method);
        Assert.Equal("""{"approvalMode":"AUTO"}""", call.Body);
        Assert.Equal("op-jwt", call.OperatorToken);
        Assert.Equal("AUTO", status.ApprovalMode);
        Assert.Equal(ShopModeViewModel.AutoLabel, vm.SelectedMode);
    }

    [Fact]
    public void Selecting_a_segment_sends_the_patch()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);

        vm.SelectedMode = ShopModeViewModel.AutoLabel;

        Assert.Contains(_calls, c => c.Method == "PATCH");
    }

    [Fact]
    public async Task Failed_patch_snaps_back_to_server_state()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);
        _patchStatus = HttpStatusCode.Unauthorized;

        await vm.SendAsync(new ShopModeRequest(ApprovalMode.Auto, null));

        Assert.Equal(ShopModeViewModel.ManualLabel, vm.SelectedMode);
        Assert.Equal("MANUAL", status.ApprovalMode);
    }

    [Fact]
    public void Without_operator_the_control_is_disabled()
    {
        var (vm, status, session) = Create();
        status.ApplyShopState("MANUAL", false);
        Assert.True(vm.CanChange);

        session.SignOut();

        Assert.False(vm.CanChange);
        Assert.Equal("Sign in to change", vm.Hint);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

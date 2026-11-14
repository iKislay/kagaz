using System.Net;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;
using Microsoft.Extensions.Logging.Abstractions;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.6: approval-mode and open-status controls reflect the server and PATCH only on operator changes.</summary>
public sealed class ShopModeViewModelTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-mode-tests", Guid.NewGuid().ToString("N"));
    private readonly List<(string Method, string Body, string OperatorToken)> _calls = new();
    private HttpStatusCode _patchStatus = HttpStatusCode.OK;
    private string _getMode = """{ "approvalMode": "AUTO", "autoPaused": false, "status": "OPEN" }""";

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
            if (req.Method == HttpMethod.Get) return TestApi.Ok(_getMode);
            if (_patchStatus != HttpStatusCode.OK) return TestApi.Error(_patchStatus, "OPERATOR_LOGIN_REQUIRED");
            if (body.Contains("status")) return TestApi.Ok("""{ "approvalMode": "MANUAL", "autoPaused": false, "status": "CLOSED" }""");
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

        status.ApplyShopState("AUTO", autoPaused: false, "OPEN");

        Assert.Equal(ShopModeViewModel.AutoLabel, vm.SelectedMode);
        Assert.Equal(ShopModeViewModel.OpenLabel, vm.SelectedStatus);
        Assert.Empty(_calls);
    }

    [Fact]
    public void Paused_auto_shows_as_manual()
    {
        var (vm, status, _) = Create();

        status.ApplyShopState("AUTO", autoPaused: true, "OPEN");

        Assert.Equal(ShopModeViewModel.ManualLabel, vm.SelectedMode);
        Assert.Equal("Manual", vm.Indicator);
        Assert.Empty(_calls);
    }

    [Fact]
    public async Task Operator_switching_to_auto_patches_with_operator_token()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);

        vm.SelectedMode = ShopModeViewModel.AutoLabel;
        await Task.Yield();

        var call = Assert.Single(_calls);
        Assert.Equal("PATCH", call.Method);
        Assert.Equal("""{"approvalMode":"AUTO","autoPaused":false}""", call.Body);
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

    // ─── ADR-002: approval mode lives in Settings, sidebar shows a read-only indicator ───

    [Fact]
    public void Settings_page_hosts_the_same_mode_view_model()
    {
        var (vm, status, _) = Create();
        var settings = new SettingsViewModel(new AgentSettings(), new AgentPaths(_root), status,
            new TokenRotationService(null!, new AgentStateStore(Path.Combine(_root, "state.json")), new AgentSettings(), status,
                NullLogger<TokenRotationService>.Instance),
            new StartupRegistration(new MemoryRunKey(), @"C:\kagaz\Kagaz.ShopAgent.App.exe"),
            new UpdateViewModel(new NoUpdateService(), status, new AgentSettings()), vm);

        Assert.Same(vm, settings.Mode);
        status.ApplyShopState("AUTO", autoPaused: false);
        Assert.Equal(ShopModeViewModel.AutoLabel, settings.Mode.SelectedMode);
        Assert.Empty(_calls);
    }

    [Theory]
    [InlineData(null, false, "—")]
    [InlineData("MANUAL", false, "Manual")]
    [InlineData("AUTO", false, "Auto")]
    [InlineData("AUTO", true, "Manual")]
    public void Indicator_reflects_server_state(string? mode, bool paused, string expected)
    {
        var (vm, status, _) = Create();
        if (mode is not null) status.ApplyShopState(mode, paused);

        Assert.Equal(expected, vm.Indicator);
    }

    [Fact]
    public void Indicator_updates_when_heartbeat_changes_the_mode()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        status.ApplyShopState("AUTO", autoPaused: false);

        Assert.Contains(nameof(ShopModeViewModel.Indicator), changed);
        Assert.Equal("Auto", vm.Indicator);
        Assert.DoesNotContain(_calls, c => c.Method == "PATCH");
    }

    [Fact]
    public async Task Opening_settings_loads_the_mode_with_a_get_and_never_patches()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);

        await vm.LoadAsync();

        var call = Assert.Single(_calls);
        Assert.Equal("GET", call.Method);
        Assert.Equal("AUTO", status.ApprovalMode);
        Assert.Equal(ShopModeViewModel.AutoLabel, vm.SelectedMode);
        Assert.Equal(ShopModeViewModel.OpenLabel, vm.SelectedStatus);
    }

    [Fact]
    public async Task Load_failure_keeps_the_heartbeat_state()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false);
        _getMode = "not json";

        await vm.LoadAsync();

        Assert.Equal("MANUAL", status.ApprovalMode);
        Assert.Equal(ShopModeViewModel.ManualLabel, vm.SelectedMode);
    }

    [Fact]
    public async Task Closing_the_shop_sends_only_the_status()
    {
        var (vm, status, _) = Create();
        status.ApplyShopState("MANUAL", false, "OPEN");

        vm.SelectedStatus = ShopModeViewModel.ClosedLabel;
        await Task.Yield();

        var call = Assert.Single(_calls);
        Assert.Equal("PATCH", call.Method);
        Assert.Equal("""{"status":"CLOSED"}""", call.Body);
        Assert.Equal("CLOSED", status.ShopOpenStatus);
        Assert.Equal("Closed", vm.StatusIndicator);
    }

    private sealed class MemoryRunKey : IRunKey
    {
        private readonly Dictionary<string, string> _values = new();
        public string? Get(string name) => _values.TryGetValue(name, out var v) ? v : null;
        public void Set(string name, string value) => _values[name] = value;
        public void Delete(string name) => _values.Remove(name);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

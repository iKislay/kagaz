using System.Net;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.3 operator session and P2.4 revoke / rotation, against contract §4.</summary>
public class OperatorSessionTests
{
    [Fact]
    public async Task Login_keeps_operator_token_in_memory_and_sends_it_only_on_human_actions()
    {
        var seen = new List<(string Path, string OperatorHeader, string Auth)>();
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            seen.Add((req.RequestUri!.AbsolutePath, TestApi.Header(req, "X-Operator-Token"), req.Headers.Authorization?.ToString() ?? ""));
            return Task.FromResult(req.RequestUri.AbsolutePath switch
            {
                "/api/shop/operator/login" => TestApi.Ok(TestApi.LoginResponse),
                "/api/shop/jobs" => TestApi.Ok("""{ "jobs": [] }"""),
                _ => TestApi.Ok(TestApi.JobJson("PRINTING")),
            });
        });
        var session = new AgentSession();
        var api = TestApi.Client(handler, session: session);

        var login = await api.OperatorLoginAsync("asha@example.test", "secret");
        await api.ListJobsAsync(null);
        await api.AcceptJobAsync("o-1", null);

        Assert.Equal("Asha", login.Operator.Name);
        Assert.True(session.IsOperatorSignedIn);
        Assert.Equal("Asha", session.Operator!.Name);
        Assert.Equal("", seen[0].OperatorHeader);              // login itself: device token only
        Assert.Equal("Bearer device-token", seen[0].Auth);
        Assert.Equal("", seen[1].OperatorHeader);              // agent-only call
        Assert.Equal("op-jwt", seen[2].OperatorHeader);        // human action
        Assert.Equal("Bearer device-token", seen[2].Auth);
    }

    [Fact]
    public async Task Invalid_credentials_keep_their_code_and_do_not_sign_in()
    {
        var handler = new StubHttpMessageHandler((_, _) =>
            Task.FromResult(TestApi.Error(HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS")));
        var session = new AgentSession();
        var api = TestApi.Client(handler, session: session);

        var ex = await Assert.ThrowsAsync<ApiException>(() => api.OperatorLoginAsync("x", "y"));

        Assert.Equal(ApiErrorCodes.InvalidCredentials, ex.Code);
        Assert.False(session.IsOperatorSignedIn);
    }

    [Fact]
    public async Task Operator_login_required_signs_out_and_raises_event()
    {
        var handler = new StubHttpMessageHandler((req, _) => Task.FromResult(req.RequestUri!.AbsolutePath.EndsWith("/login")
            ? TestApi.Ok(TestApi.LoginResponse)
            : TestApi.Error(HttpStatusCode.Unauthorized, "OPERATOR_LOGIN_REQUIRED")));
        var session = new AgentSession();
        bool raised = false;
        session.OperatorLoginRequired += () => raised = true;
        var api = TestApi.Client(handler, session: session);
        await api.OperatorLoginAsync("a", "b");

        var ex = await Assert.ThrowsAsync<ApiException>(() => api.AcceptJobAsync("o-1", printerId: null));

        Assert.Equal(ApiErrorCodes.OperatorLoginRequired, ex.Code);
        Assert.True(raised);
        Assert.False(session.IsOperatorSignedIn);
    }

    [Fact]
    public async Task Logout_forgets_token_even_when_server_call_fails()
    {
        int calls = 0;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            calls++;
            return Task.FromResult(req.RequestUri!.AbsolutePath.EndsWith("/login")
                ? TestApi.Ok(TestApi.LoginResponse)
                : TestApi.Error(HttpStatusCode.InternalServerError, "INTERNAL"));
        });
        var session = new AgentSession();
        var api = TestApi.Client(handler, session: session);
        await api.OperatorLoginAsync("a", "b");

        await api.OperatorLogoutAsync();

        Assert.Equal(2, calls);
        Assert.False(session.IsOperatorSignedIn);
    }

    [Fact]
    public void Expired_operator_token_is_not_used()
    {
        var now = DateTimeOffset.Parse("2026-11-07T10:00:00Z");
        var session = new AgentSession(() => now);
        session.SignIn(new OperatorLoginResponse("tok", "2026-11-07T22:00:00Z", new OperatorInfo("u", "Asha", "SHOP_OWNER")));
        Assert.Equal("tok", session.OperatorToken);

        now = now.AddHours(13);

        Assert.Null(session.OperatorToken);
        Assert.True(session.ExpireIfDue());
        Assert.Null(session.Operator);
    }

    [Fact]
    public async Task Agent_version_header_is_sent_on_every_call()
    {
        string? version = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            version = TestApi.Header(req, "X-Agent-Version");
            return Task.FromResult(TestApi.Ok("""{ "jobs": [] }"""));
        });

        await TestApi.Client(handler, appVersion: "0.3.0").ListJobsAsync(null);

        Assert.Equal("0.3.0", version);
    }

    // ─── P2.4 ───

    [Fact]
    public async Task Device_revoked_anywhere_wipes_token_and_shows_revoked_notice()
    {
        string root = Path.Combine(Path.GetTempPath(), "kagaz-revoke-tests", Guid.NewGuid().ToString("N"));
        try
        {
            var store = new FakeSecureStore("device-token");
            var stateStore = new AgentStateStore(Path.Combine(root, "state.json"));
            stateStore.Update(s =>
            {
                s.ShopName = "Shop A";
                s.Jobs["pj-1"] = new LocalJobState { PrintJobId = "pj-1", Phase = LocalPhase.Done };
            });
            var session = new AgentSession();
            var status = new AppStatus(store, stateStore, session);
            bool unpaired = false;
            status.Unpaired += () => unpaired = true;
            var handler = new StubHttpMessageHandler((_, _) =>
                Task.FromResult(TestApi.Error(HttpStatusCode.Unauthorized, "DEVICE_REVOKED", "revoked")));
            var api = TestApi.Client(handler, store, session);

            var ex = await Assert.ThrowsAsync<ApiException>(() => api.ListJobsAsync("QUEUED"));

            Assert.Equal(ApiErrorCodes.DeviceRevoked, ex.Code);
            Assert.Null(store.Load());
            Assert.False(status.IsPaired);
            Assert.True(unpaired);
            Assert.Equal("Device revoked, re-pair required", status.RevokedNotice);
            var state = stateStore.Load();
            Assert.True(state.DeviceRevoked);
            Assert.Empty(state.Jobs);

            // Survives a restart until re-paired.
            Assert.Equal(AppStatus.RevokedText, new AppStatus(store, stateStore, new AgentSession()).RevokedNotice);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Unknown_token_401_is_device_unauthorized_not_revoked()
    {
        var store = new FakeSecureStore("device-token");
        var session = new AgentSession();
        bool revoked = false;
        session.DeviceRevoked += () => revoked = true;
        var handler = new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Error(HttpStatusCode.Unauthorized, "UNAUTHORIZED")));

        var ex = await Assert.ThrowsAsync<ApiException>(() => TestApi.Client(handler, store, session).ListJobsAsync(null));

        Assert.Equal(ApiErrorCodes.DeviceUnauthorized, ex.Code);
        Assert.False(revoked);
        Assert.Equal("device-token", store.Load());
    }

    [Fact]
    public async Task Rotate_token_stores_new_token_and_signals_rotation()
    {
        string? auth = null;
        var store = new FakeSecureStore("old-token");
        var session = new AgentSession();
        bool rotated = false;
        session.DeviceTokenRotated += () => rotated = true;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            auth = req.Headers.Authorization?.ToString();
            Assert.Equal("/api/devices/rotate-token", req.RequestUri!.AbsolutePath);
            return Task.FromResult(TestApi.Ok("""{ "deviceToken": "new-token" }"""));
        });

        await TestApi.Client(handler, store, session).RotateTokenAsync();

        Assert.Equal("Bearer old-token", auth);
        Assert.Equal("new-token", store.Load());
        Assert.True(rotated);
    }

    [Fact]
    public void Dpapi_store_replaces_token_atomically()
    {
        string path = Path.Combine(Path.GetTempPath(), "kagaz-dpapi-tests", Guid.NewGuid().ToString("N"), "device.token");
        try
        {
            var store = new DpapiSecureStore(path);
            store.Save("first");
            store.Save("second");

            Assert.Equal("second", store.Load());
            Assert.False(File.Exists(path + ".tmp"));
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(path)!, recursive: true);
        }
    }

    [Theory]
    [InlineData(null, 7, false)]   // unknown baseline: never rotate immediately
    [InlineData(6.9, 7, false)]
    [InlineData(7.0, 7, true)]
    [InlineData(30.0, 0, false)]  // disabled
    public void Token_rotation_policy(double? daysAgo, int everyDays, bool due)
    {
        var now = DateTimeOffset.Parse("2026-11-07T10:00:00Z");
        DateTimeOffset? last = daysAgo is { } d ? now.AddDays(-d) : null;

        Assert.Equal(due, TokenRotationPolicy.IsDue(last, now, everyDays));
    }
}

using System.Net;
using System.Text.Json;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P2.7 local queue + heartbeat payload, P4.4 upgrade signals.</summary>
public class LocalQueueTests
{
    private static ShopJob Job(string orderId, string printJobId, string printerId, string paidAt, string status = "QUEUED", string pjStatus = "READY") =>
        JsonSerializer.Deserialize<ShopJob>(TestApi.JobJson(status, orderId, $"KGZ-{orderId}", printJobId, pjStatus, 1, printerId, paidAt),
            JsonOptions.Response)!;

    private static readonly Dictionary<string, string> LocalPrinters = new() { ["p-a"] = "EPSON", ["p-b"] = "HP" };

    [Fact]
    public void Sync_builds_per_printer_queues_oldest_first_for_local_printers_only()
    {
        var state = new AgentState();

        LocalQueue.Sync(state,
        [
            Job("o3", "pj-3", "p-a", "2026-11-07T10:03:00Z"),
            Job("o1", "pj-1", "p-a", "2026-11-07T10:01:00Z"),
            Job("o2", "pj-2", "p-b", "2026-11-07T10:02:00Z"),
            Job("o4", "pj-4", "p-elsewhere", "2026-11-07T10:00:00Z"),       // another PC's printer
            Job("o5", "pj-5", "p-a", "2026-11-07T10:00:00Z", pjStatus: "LEASED"),
            Job("o6", "pj-6", "p-a", "2026-11-07T10:00:00Z", status: "PENDING_REVIEW"),
        ], LocalPrinters);

        Assert.Equal(["pj-1", "pj-3"], state.Queues["EPSON"].Select(q => q.PrintJobId));
        Assert.Equal(["pj-2"], state.Queues["HP"].Select(q => q.PrintJobId));
        Assert.Equal(3, LocalQueue.Depth(state));
    }

    [Fact]
    public void Attempt_touched_on_this_pc_is_never_queued_again()
    {
        var state = new AgentState();
        state.Jobs["pj-1"] = new LocalJobState { PrintJobId = "pj-1", Phase = LocalPhase.Failed, PrinterName = "EPSON" };

        LocalQueue.Sync(state, [Job("o1", "pj-1", "p-a", "2026-11-07T10:01:00Z")], LocalPrinters);

        Assert.Empty(state.Queues);
    }

    [Fact]
    public void Heads_skip_printers_with_an_active_attempt_or_waiting_after_409()
    {
        var state = new AgentState();
        LocalQueue.Sync(state,
        [
            Job("o1", "pj-1", "p-a", "2026-11-07T10:01:00Z"),
            Job("o2", "pj-2", "p-b", "2026-11-07T10:02:00Z"),
        ], LocalPrinters);

        Assert.Equal(2, LocalQueue.Heads(state, new HashSet<string>()).Count);

        // One active lease per printer: EPSON is busy printing another attempt.
        state.Jobs["pj-0"] = new LocalJobState { PrintJobId = "pj-0", Phase = LocalPhase.Submitted, PrinterName = "EPSON" };
        Assert.Equal(["HP"], LocalQueue.Heads(state, new HashSet<string>()).Select(h => h.PrinterName));

        // HP got 409 PRINTER_BUSY: wait.
        Assert.Empty(LocalQueue.Heads(state, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "hp" }));
    }

    [Theory]
    [InlineData("PRINTER_BUSY", LeaseConflictAction.WaitForPrinter)]
    [InlineData("NOT_NEXT_IN_QUEUE", LeaseConflictAction.WaitForPrinter)]
    [InlineData("JOB_NOT_LEASABLE", LeaseConflictAction.DropFromQueue)]
    [InlineData("NETWORK_ERROR", LeaseConflictAction.Rethrow)]
    public void Lease_refusals_wait_or_drop_never_retry_blindly(string code, LeaseConflictAction expected)
    {
        Assert.Equal(expected, LocalQueue.OnLeaseRefused(code));
    }

    [Fact]
    public void Remove_drops_job_and_empty_queue()
    {
        var state = new AgentState();
        LocalQueue.Sync(state, [Job("o1", "pj-1", "p-a", "2026-11-07T10:01:00Z")], LocalPrinters);

        LocalQueue.Remove(state, "PJ-1");

        Assert.Empty(state.Queues);
    }

    [Fact]
    public void Heartbeat_lists_active_attempts_and_queue_depth()
    {
        var state = new AgentState();
        LocalQueue.Sync(state, [Job("o1", "pj-1", "p-a", "2026-11-07T10:01:00Z")], LocalPrinters);
        state.Jobs["pj-9"] = new LocalJobState { PrintJobId = "pj-9", Phase = LocalPhase.Submitted, PrinterName = "HP" };
        state.Jobs["pj-8"] = new LocalJobState { PrintJobId = "pj-8", Phase = LocalPhase.Done, PrinterName = "HP" };
        state.Jobs["pj-7"] = new LocalJobState { PrintJobId = "pj-7", Phase = LocalPhase.Uncertain, PrinterName = "HP" };

        var req = HeartbeatBuilder.Build("0.3.0", "Windows 11 10.0.26300", TimeSpan.FromSeconds(1234.7), state,
            [new PrinterStatus("p-a", "READY", null)]);

        Assert.Equal(["pj-9"], req.ActivePrintJobIds!);
        Assert.Equal(2, req.QueueDepth);
        Assert.Equal(1234, req.UptimeSeconds);
        Assert.Equal("0.3.0", req.AppVersion);
        Assert.Single(req.Printers!);

        var json = JsonSerializer.Serialize(req, JsonOptions.Request);
        Assert.Contains("\"activePrintJobIds\":[\"pj-9\"]", json);
        Assert.Contains("\"queueDepth\":2", json);
        Assert.Contains("\"os\":\"Windows 11 10.0.26300\"", json);
    }

    [Theory]
    [InlineData(10, 0, 26300, "Windows 11 10.0.26300")]
    [InlineData(10, 0, 19045, "Windows 10 10.0.19045")]
    public void Os_description(int major, int minor, int build, string expected)
    {
        Assert.Equal(expected, HeartbeatBuilder.DescribeOs(new Version(major, minor, build)));
    }

    [Theory]
    [InlineData("0.1.0", "0.2.0", true)]
    [InlineData("0.2.0", "0.2.0", false)]
    [InlineData("0.10.0", "0.9.1", false)]
    [InlineData("0.3.0", null, false)]
    public void Version_comparison(string version, string? min, bool older)
    {
        Assert.Equal(older, HeartbeatBuilder.IsOlderThan(version, min));
    }

    // ─── Client: heartbeat, upgrade (P4.4), UNCERTAIN fallback ───

    [Fact]
    public async Task Heartbeat_posts_to_shop_route_and_reads_shop_state_and_upgrade_flag()
    {
        string? path = null;
        var handler = new StubHttpMessageHandler((req, _) =>
        {
            path = req.RequestUri!.AbsolutePath;
            return Task.FromResult(TestApi.Ok("""
                { "serverTime": "2026-11-07T10:00:00Z", "leaseTtlSeconds": 60, "minAgentVersion": "0.4.0", "upgradeRequired": true,
                  "shop": { "status": "OPEN", "approvalMode": "AUTO", "autoPaused": true } }
                """));
        });
        var session = new AgentSession();

        var resp = await TestApi.Client(handler, session: session).HeartbeatAsync(new HeartbeatRequest("0.3.0", []));

        Assert.Equal("/api/shop/heartbeat", path);
        Assert.Equal("AUTO", resp.Shop!.ApprovalMode);
        Assert.True(resp.Shop.AutoPaused);
        Assert.True(session.IsUpgradeRequired);
        Assert.Equal("0.4.0", session.MinAgentVersion);
    }

    [Fact]
    public async Task Heartbeat_falls_back_to_legacy_route_without_new_fields()
    {
        var calls = new List<(string Path, string Body)>();
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            calls.Add((req.RequestUri!.AbsolutePath, req.Content is null ? "" : await req.Content.ReadAsStringAsync()));
            return req.RequestUri.AbsolutePath == "/api/shop/heartbeat"
                ? TestApi.Error(HttpStatusCode.NotFound, "NOT_FOUND")
                : TestApi.Ok("""{ "serverTime": "2026-11-07T10:00:00Z" }""");
        });

        var resp = await TestApi.Client(handler).HeartbeatAsync(new HeartbeatRequest("0.3.0", [], "Windows 11", 5, 1, ["pj-1"]));

        Assert.Equal("/api/devices/heartbeat", calls[1].Path);
        Assert.DoesNotContain("activePrintJobIds", calls[1].Body); // the P1 schema is strict
        Assert.False(resp.UpgradeRequired);
    }

    [Fact]
    public async Task Status_426_raises_upgrade_required()
    {
        var session = new AgentSession();
        var handler = new StubHttpMessageHandler((_, _) => Task.FromResult(TestApi.Json((HttpStatusCode)426,
            """{ "error": { "code": "AGENT_UPGRADE_REQUIRED", "message": "update", "details": { "minAgentVersion": "0.5.0" } } }""")));

        var ex = await Assert.ThrowsAsync<ApiException>(() => TestApi.Client(handler, session: session).ListJobsAsync("QUEUED"));

        Assert.Equal(ApiErrorCodes.AgentUpgradeRequired, ex.Code);
        Assert.True(session.IsUpgradeRequired);
        Assert.Equal("0.5.0", session.MinAgentVersion);
    }

    [Fact]
    public async Task Uncertain_report_uses_reason_and_falls_back_to_failed_on_old_api()
    {
        var bodies = new List<string>();
        var handler = new StubHttpMessageHandler(async (req, _) =>
        {
            var body = await req.Content!.ReadAsStringAsync();
            bodies.Add(body);
            return body.Contains("\"UNCERTAIN\"")
                ? TestApi.Error(HttpStatusCode.BadRequest, "VALIDATION_FAILED")
                : TestApi.Ok(TestApi.JobJson("NEEDS_OPERATOR_CHECK"));
        });

        await TestApi.Client(handler).ReportUncertainAsync("pj-1", "DELETED: removed after printing started");

        Assert.Equal("""{"status":"UNCERTAIN","reason":"DELETED: removed after printing started"}""", bodies[0]);
        Assert.Equal("""{"status":"FAILED","error":"UNCERTAIN: DELETED: removed after printing started"}""", bodies[1]);
    }
}

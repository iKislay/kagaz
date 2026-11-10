using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Spooler;
using Kagaz.ShopAgent.Printing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// The print worker (P1.10, P2.7, P2.8, P2.10; plan A.2–A.4).
/// <list type="number">
/// <item><b>Reconcile</b> (A.3) on start, after every reconnect and after any API failure — before
/// leasing anything. Never resubmits an attempt.</item>
/// <item><b>Queue</b>: rebuild the per-printer local queue (<c>state.json</c>) from the server's QUEUED jobs.</item>
/// <item><b>Lease</b> the head of each free printer's queue. <c>409 PRINTER_BUSY</c> /
/// <c>NOT_NEXT_IN_QUEUE</c> → wait for that printer (the attempt was never submitted, so waiting is safe).</item>
/// <item><b>Print</b>: download → verify SHA-256 → one spooler job → report SUBMITTED. The local phase is
/// persisted <em>before</em> each irreversible step so a crash is reconciled safely.</item>
/// <item><b>Monitor</b> each submitted attempt in the background with <see cref="SpoolerMonitor"/> and report
/// SPOOLER_COMPLETE (the server then marks the order ready, ADR-002), FAILED or UNCERTAIN. Monitored attempts are listed in the heartbeat's
/// <c>activePrintJobIds</c>, which renews their leases.</item>
/// </list>
/// READY is never set here: the server moves the order to READY_FOR_PICKUP when it receives SPOOLER_COMPLETE (ADR-002).
/// </summary>
public sealed class PrintWorkerService : BackgroundService
{
    private static readonly TimeSpan PrinterWait = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan MonitorPoll = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan DeferredReconcileWindow = TimeSpan.FromMinutes(2);

    private readonly ShopApiClient _api;
    private readonly AgentStateStore _state;
    private readonly IPrintEngine _engine;
    private readonly ISpoolerProbe _spooler;
    private readonly AppStatus _status;
    private readonly AgentSignals _signals;
    private readonly AgentSettings _settings;
    private readonly PrinterReachability _reachability;
    private readonly ILogger<PrintWorkerService> _log;
    private readonly HttpClient _download = new() { Timeout = TimeSpan.FromMinutes(2) };

    private readonly ConcurrentDictionary<string, Task> _monitors = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTimeOffset> _printerWaitUntil = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource _monitorCts = new();
    private DateTimeOffset _startedAt = DateTimeOffset.UtcNow;

    public PrintWorkerService(ShopApiClient api, AgentStateStore state, IPrintEngine engine, ISpoolerProbe spooler,
        AppStatus status, AgentSignals signals, AgentSettings settings, PrinterReachability reachability,
        ILogger<PrintWorkerService> log)
    {
        _api = api;
        _state = state;
        _engine = engine;
        _spooler = spooler;
        _status = status;
        _signals = signals;
        _settings = settings;
        _reachability = reachability;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        _startedAt = DateTimeOffset.UtcNow;
        bool reconciled = false;
        int reconciledEpoch = -1;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_status.IsPaired)
                {
                    reconciled = false;
                    StopMonitors(); // unpaired / revoked: reports would be rejected anyway
                }
                else
                {
                    if (!reconciled || reconciledEpoch != _signals.ConnectionEpoch)
                    {
                        reconciledEpoch = _signals.ConnectionEpoch;
                        reconciled = await ReconcileAsync(stoppingToken);
                    }

                    if (reconciled && CanStartPrints() && await LeaseAndPrintAsync(stoppingToken))
                    {
                        continue; // look for the next job straight away
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (ApiException ex)
            {
                // Network loss etc.: reconcile again once the server is back (A.3).
                reconciled = false;
                _log.LogWarning("Print worker paused: {Code} {Message}", ex.Code, ex.Message);
            }
            catch (Exception ex)
            {
                reconciled = false;
                _log.LogError(ex, "Print worker loop failed");
            }

            // Socket hints (P2.9) wake us early; otherwise poll (faster while the socket is down).
            var wait = TimeSpan.FromSeconds(_status.RealtimeConnected
                ? Math.Max(2, _settings.SafetyPollSeconds)
                : Math.Max(2, Math.Min(_settings.PollIntervalSeconds, 5)));
            try { await _signals.Jobs.WaitAsync(wait, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        StopMonitors();
    }

    private bool CanStartPrints()
    {
        if (_state.Load().PrintingPaused) return false;
        // P4.4: an outdated agent prints nothing new (the API answers 426 anyway).
        return !_status.Session.IsUpgradeRequired;
    }

    // ─── Queue + lease (P2.7) ───

    /// <summary>Sync the local queue, lease the head of each free printer and print it. True if one was printed.</summary>
    private async Task<bool> LeaseAndPrintAsync(CancellationToken ct)
    {
        var jobs = await _api.ListJobsAsync("QUEUED", ct);
        var printers = await _api.GetPrintersAsync(ct);
        var localPrinters = printers
            .Where(p => p.Enabled && PdfiumPrintEngine.IsInstalled(p.PrinterName))
            .ToDictionary(p => p.Id, p => p.PrinterName, StringComparer.OrdinalIgnoreCase);

        var state = _state.Update(s => LocalQueue.Sync(s, jobs, localPrinters));

        var now = DateTimeOffset.UtcNow;
        foreach (var expired in _printerWaitUntil.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList()) _printerWaitUntil.Remove(expired);

        foreach (var (printerName, head) in LocalQueue.Heads(state, _printerWaitUntil.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase)))
        {
            LeaseResponse lease;
            try
            {
                lease = await _api.LeasePrintJobAsync(head.PrintJobId, ct);
            }
            catch (ApiException ex) when (LocalQueue.OnLeaseRefused(ex.Code) == LeaseConflictAction.WaitForPrinter)
            {
                _log.LogInformation("Lease for {PublicRef} on {Printer} refused ({Code}); waiting", head.PublicRef, printerName, ex.Code);
                _printerWaitUntil[printerName] = DateTimeOffset.UtcNow + PrinterWait;
                continue;
            }
            catch (ApiException ex) when (LocalQueue.OnLeaseRefused(ex.Code) == LeaseConflictAction.DropFromQueue)
            {
                _log.LogInformation("Print job {PrintJobId} is no longer leasable ({Code})", head.PrintJobId, ex.Code);
                _state.Update(s => LocalQueue.Remove(s, head.PrintJobId));
                continue;
            }

            _state.Update(s => LocalQueue.Remove(s, head.PrintJobId));
            await PrintLeasedAsync(lease, ct);
            return true;
        }
        return false;
    }

    private async Task PrintLeasedAsync(LeaseResponse lease, CancellationToken ct)
    {
        using var scope = _log.BeginScope(new Dictionary<string, object>
        {
            ["orderId"] = lease.OrderId,
            ["printJobId"] = lease.PrintJobId,
        });

        // Rule (A.3): print only a freshly leased attempt with no local history.
        if (_state.Load().Jobs.ContainsKey(lease.PrintJobId))
        {
            await ReportUncertainSafeAsync(lease.PrintJobId, "UNCERTAIN: this attempt was already started on this PC; not printing it again", ct);
            return;
        }

        var job = new LocalJobState
        {
            OrderId = lease.OrderId,
            PrintJobId = lease.PrintJobId,
            Attempt = lease.Attempt,
            PublicRef = lease.PublicRef,
            DocumentName = lease.DocumentName,
            PrinterName = lease.PrinterName,
        };
        _state.SetPhase(job, LocalPhase.NotStarted);
        _log.LogInformation("Leased {PublicRef} attempt {Attempt} for {PrinterName}", lease.PublicRef, lease.Attempt, lease.PrinterName);

        var spoolDir = Path.Combine(_state.RootDirectory, "spool");
        var pdfPath = Path.Combine(spoolDir, $"{lease.PrintJobId}.pdf");
        try
        {
            // 1. Download the packet (signed URL — never logged).
            Directory.CreateDirectory(spoolDir);
            byte[] packet;
            try
            {
                packet = await _download.GetByteArrayAsync(lease.DownloadUrl, ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                await FailAsync(job, $"NOT_SUBMITTED: packet download failed ({ex.GetType().Name})", ct);
                return;
            }

            // 2. Verify SHA-256. Mismatch → FAILED, never print.
            var hash = Convert.ToHexString(SHA256.HashData(packet)).ToLowerInvariant();
            if (!string.Equals(hash, lease.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                await FailAsync(job, "CHECKSUM_MISMATCH: the downloaded packet did not match; nothing was printed", ct);
                return;
            }
            await File.WriteAllBytesAsync(pdfPath, packet, ct);
            _state.SetPhase(job, LocalPhase.Downloaded);

            // 3. Print: one spooler job, copies = 1. Phase is persisted first — from here on
            //    a crash means "outcome unknown", never "print again".
            _state.SetPhase(job, LocalPhase.Submitting);
            PrintSubmission submission;
            try
            {
                submission = await _engine.PrintAsync(pdfPath,
                    new PrintRequest(lease.PrinterName, lease.Settings.Colour, lease.Settings.Duplex, lease.Settings.PaperSize, lease.DocumentName),
                    CancellationToken.None);
            }
            catch (PrintEngineException ex)
            {
                // Refused before anything reached the spooler: nothing printed.
                if (ex.Code == PrintEngineException.PrinterUnreachable) _reachability.MarkUnreachable(lease.PrinterName);
                await FailAsync(job, $"{ex.Code}: {ex.Message}", CancellationToken.None);
                _status.ShowToast($"Could not print {lease.PublicRef}", ex.Message, warning: true);
                return;
            }
            catch (Exception ex)
            {
                await MarkUncertainAsync(job, $"UNCERTAIN: printer error during submission ({ex.Message})", CancellationToken.None);
                _status.ShowToast($"Check the printer for {lease.PublicRef}", "The print may be incomplete.", warning: true);
                return;
            }
            job.SpoolerJobId = submission.SpoolerJobId;
            _state.SetPhase(job, LocalPhase.Submitted);
            _reachability.MarkReachable(lease.PrinterName);
            _log.LogInformation("Submitted {Pages} pages as one spooler job {SpoolerJobId}", submission.PagesSent, submission.SpoolerJobId);

            // 4. Report SUBMITTED (retried: the spooler already has it).
            await WithRetryAsync(() => _api.ReportPrintStatusAsync(lease.PrintJobId,
                PrintStatusReportDto.Submitted(submission.SpoolerJobId), CancellationToken.None));
            _status.ShowToast($"Printing {lease.PublicRef}", $"{submission.PagesSent} pages sent to {lease.PrinterName}");

            // 5. Watch the spooler in the background; the next printer can start meanwhile.
            StartMonitor(job, DateTimeOffset.UtcNow);
        }
        finally
        {
            try { if (File.Exists(pdfPath)) File.Delete(pdfPath); }
            catch (IOException ex) { _log.LogWarning(ex, "Could not delete the temporary packet"); }
        }
    }

    // ─── Spooler monitoring (P2.10) ───

    private void StartMonitor(LocalJobState job, DateTimeOffset startedAt)
    {
        var token = _monitorCts.Token;
        _monitors.GetOrAdd(job.PrintJobId, _ => Task.Run(async () =>
        {
            try
            {
                await MonitorAsync(job, startedAt, token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                // App closing or unpaired: state.json keeps SUBMITTED; reconciliation picks it up.
            }
            catch (Exception ex)
            {
                // Never leave an attempt "active" without a watcher: its lease would be renewed forever.
                _log.LogError(ex, "Monitoring {PrintJobId} failed", job.PrintJobId);
                if (LocalQueue.IsActive(job))
                {
                    try { await MarkUncertainAsync(job, "UNCERTAIN: the app stopped watching this print; check the output tray", CancellationToken.None); }
                    catch (Exception inner) { _log.LogError(inner, "Could not mark {PrintJobId} uncertain", job.PrintJobId); }
                }
            }
            finally
            {
                _status.SetLiveStatus(job.OrderId, null);
                _monitors.TryRemove(job.PrintJobId, out Task? _);
            }
        }, CancellationToken.None));
    }

    private async Task MonitorAsync(LocalJobState job, DateTimeOffset startedAt, CancellationToken ct)
    {
        var monitor = new SpoolerMonitor(job.DocumentName, startedAt);
        string? lastProblem = null;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var observation = new SpoolerObservation(_spooler.GetQueue(job.PrinterName), _spooler.GetJobs(job.PrinterName));
            var verdict = monitor.Observe(observation, DateTimeOffset.UtcNow);
            _status.SetLiveStatus(job.OrderId, verdict.StatusText);

            if (verdict.Problem is not null && verdict.Problem != lastProblem && !verdict.IsFinal)
            {
                _status.ShowToast($"{job.PublicRef}: {verdict.Problem}", "Fix the printer; the job stays in the queue.", warning: true);
            }
            lastProblem = verdict.Problem;

            switch (verdict.Outcome)
            {
                case SpoolerOutcome.SpoolerComplete:
                    // Persist the observation first: if the report is lost, reconciliation re-sends it.
                    _state.SetPhase(job, LocalPhase.Done);
                    await WithRetryAsync(() => _api.ReportPrintStatusAsync(job.PrintJobId, PrintStatusReportDto.SpoolerComplete(), CancellationToken.None));
                    _status.ShowToast($"{job.PublicRef} printed", "It moves to Ready for pickup.");
                    _signals.Jobs.Pulse();
                    return;
                case SpoolerOutcome.Failed:
                    await FailAsync(job, verdict.Reason!, CancellationToken.None);
                    _status.ShowToast($"{job.PublicRef} needs checking", verdict.Problem, warning: true);
                    _signals.Jobs.Pulse();
                    return;
                case SpoolerOutcome.Uncertain:
                    await MarkUncertainAsync(job, verdict.Reason!, CancellationToken.None);
                    _status.ShowToast($"{job.PublicRef} needs checking", "Check the printer output tray.", warning: true);
                    _signals.Jobs.Pulse();
                    return;
            }

            await Task.Delay(MonitorPoll, ct);
        }
    }

    private void StopMonitors()
    {
        if (_monitors.IsEmpty) return;
        _monitorCts.Cancel();
        _monitorCts.Dispose();
        _monitorCts = new CancellationTokenSource();
    }

    // ─── Reconciliation on start / reconnect (P2.8, plan A.3) ───

    /// <summary>Returns false when it must run again before printing (deferred or failed).</summary>
    private async Task<bool> ReconcileAsync(CancellationToken ct)
    {
        var serverJobs = await _api.ListJobsAsync("PRINTING,QUEUED,NEEDS_OPERATOR_CHECK", ct);
        var local = _state.Load().Jobs;

        var inputs = serverJobs
            .Where(j => j.PrintJob is not null)
            .Select(j => new Reconciliation.ServerJob(j.PrintJob!.Id, j.OrderId, j.Status, j.PrintJob.Status, j.PublicRef, j.PrintJob.Attempt))
            .ToList();

        var spooled = new Dictionary<string, ISet<string>?>(StringComparer.OrdinalIgnoreCase);
        foreach (var printer in local.Values.Select(l => l.PrinterName).Where(n => n.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            spooled[printer] = _spooler.GetJobs(printer)?.Select(j => j.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        bool deferAllowed = DateTimeOffset.UtcNow - _startedAt < DeferredReconcileWindow;
        var outcomes = Reconciliation.Decide(inputs, local, spooled,
            _monitors.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase), deferAllowed);

        bool complete = true;
        foreach (var outcome in outcomes)
        {
            local.TryGetValue(outcome.PrintJobId, out var job);
            switch (outcome.Decision)
            {
                case Reconciliation.Decision.ResumeMonitor when job is not null:
                    _log.LogInformation("Reconcile {PrintJobId}: still in the spooler, resuming monitoring", outcome.PrintJobId);
                    if (outcome.ReportSubmittedFirst)
                    {
                        await _api.ReportPrintStatusAsync(job.PrintJobId, PrintStatusReportDto.Submitted(job.SpoolerJobId), ct);
                    }
                    _state.SetPhase(job, LocalPhase.Submitted);
                    StartMonitor(job, DateTimeOffset.UtcNow);
                    break;

                case Reconciliation.Decision.ReportFailedNotSubmitted when job is not null:
                    await FailAsync(job, outcome.Reason!, ct);
                    _status.ShowToast($"{job.PublicRef} was not printed", "It needs checking: open Jobs → Needs check.", warning: true);
                    break;

                case Reconciliation.Decision.ReportUncertain when job is not null:
                    await MarkUncertainAsync(job, outcome.Reason!, ct);
                    _status.ShowToast($"{job.PublicRef} needs checking", "Check the printer output tray before reprinting.", warning: true);
                    break;

                case Reconciliation.Decision.ResendSpoolerComplete when job is not null:
                    await _api.ReportPrintStatusAsync(job.PrintJobId, PrintStatusReportDto.SpoolerComplete(), ct);
                    break;

                case Reconciliation.Decision.ResendOutcome when job is not null:
                    if (job.Phase == LocalPhase.Failed)
                        await _api.ReportPrintStatusAsync(job.PrintJobId, PrintStatusReportDto.Failed(outcome.Reason!), ct);
                    else
                        await _api.ReportUncertainAsync(job.PrintJobId, outcome.Reason!, ct);
                    break;

                case Reconciliation.Decision.Defer:
                    _log.LogInformation("Reconcile {PrintJobId}: Windows print queue not readable yet; retrying", outcome.PrintJobId);
                    complete = false;
                    break;

                case Reconciliation.Decision.Forget:
                    _state.Update(s => s.Jobs.Remove(outcome.PrintJobId));
                    break;
            }
        }
        return complete;
    }

    // ─── Helpers ───

    private async Task FailAsync(LocalJobState job, string error, CancellationToken ct)
    {
        job.Reason = error.Length > 500 ? error[..500] : error;
        _state.SetPhase(job, LocalPhase.Failed);
        _log.LogWarning("Reporting print job {PrintJobId} FAILED: {Error}", job.PrintJobId, error);
        try
        {
            await WithRetryAsync(() => _api.ReportPrintStatusAsync(job.PrintJobId, PrintStatusReportDto.Failed(error), ct));
        }
        catch (ApiException ex)
        {
            // Reconciliation re-sends it (ResendOutcome) once the server is reachable.
            _log.LogWarning("Could not report FAILED for {PrintJobId}: {Code}", job.PrintJobId, ex.Code);
        }
    }

    private async Task MarkUncertainAsync(LocalJobState job, string reason, CancellationToken ct)
    {
        job.Reason = reason.Length > 500 ? reason[..500] : reason;
        _state.SetPhase(job, LocalPhase.Uncertain);
        await ReportUncertainSafeAsync(job.PrintJobId, reason, ct);
    }

    private async Task ReportUncertainSafeAsync(string printJobId, string reason, CancellationToken ct)
    {
        _log.LogWarning("Reporting print job {PrintJobId} UNCERTAIN: {Reason}", printJobId, reason);
        try
        {
            await WithRetryAsync(() => _api.ReportUncertainAsync(printJobId, reason, ct));
        }
        catch (ApiException ex)
        {
            _log.LogWarning("Could not report UNCERTAIN for {PrintJobId}: {Code}", printJobId, ex.Code);
        }
    }

    private static async Task WithRetryAsync(Func<Task> action)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                await action();
                return;
            }
            catch (ApiException ex) when (ex.Code == ApiErrorCodes.NetworkError && attempt < 5)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2));
            }
        }
    }

    public override void Dispose()
    {
        _download.Dispose();
        _monitorCts.Dispose();
        base.Dispose();
    }
}

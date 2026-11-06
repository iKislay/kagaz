using System.Drawing.Printing;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Printing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// The print worker (P1.10, Appendix A.2–A.4). One job at a time:
/// lease → download → verify SHA-256 → print one spooler job → report SUBMITTED → watch the
/// spooler → report SPOOLER_COMPLETE (telemetry only) → delete the temp file.
/// The local phase is persisted <em>before</em> each irreversible step so a crash is
/// reconciled safely on the next start. An attempt is never resubmitted: anything ambiguous is
/// reported FAILED, which puts the order in NEEDS_OPERATOR_CHECK (invariant 8). READY is never
/// set here — only the operator's Mark Ready does that (invariant 9).
/// </summary>
public sealed class PrintWorkerService : BackgroundService
{
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan SpoolerWatchTimeout = TimeSpan.FromMinutes(30);

    private readonly ShopApiClient _api;
    private readonly AgentStateStore _state;
    private readonly IPrintEngine _engine;
    private readonly AppStatus _status;
    private readonly ILogger<PrintWorkerService> _log;
    private readonly HttpClient _download = new() { Timeout = TimeSpan.FromMinutes(2) };

    public PrintWorkerService(ShopApiClient api, AgentStateStore state, IPrintEngine engine,
        AppStatus status, ILogger<PrintWorkerService> log)
    {
        _api = api;
        _state = state;
        _engine = engine;
        _status = status;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        bool reconciled = false;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_status.IsPaired)
                {
                    reconciled = false;
                }
                else
                {
                    if (!reconciled)
                    {
                        await ReconcileAsync(stoppingToken);
                        reconciled = true;
                    }

                    if (!_state.Load().PrintingPaused && await PrintNextAsync(stoppingToken))
                    {
                        continue; // look for the next job straight away
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (ApiException ex)
            {
                // Network loss or revoked token: reconcile again once the server is back (A.3).
                reconciled = false;
                _log.LogWarning("Print worker paused: {Code} {Message}", ex.Code, ex.Message);
            }
            catch (Exception ex)
            {
                reconciled = false;
                _log.LogError(ex, "Print worker loop failed");
            }

            try { await Task.Delay(IdleDelay, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    // ─── Normal path ───

    /// <summary>Lease and print the first job that is ours to print. Returns true if one was handled.</summary>
    private async Task<bool> PrintNextAsync(CancellationToken ct)
    {
        var jobs = await _api.ListJobsAsync("QUEUED", ct);
        if (jobs.Count == 0) return false;

        // Only lease jobs routed to printers installed on this PC.
        var installed = InstalledPrinters();
        var printers = await _api.GetPrintersAsync(ct);
        var localPrinterIds = printers
            .Where(p => p.Enabled && installed.Contains(p.PrinterName))
            .Select(p => p.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var local = _state.Load().Jobs;

        foreach (var job in jobs.OrderBy(j => j.PaidAt ?? j.CreatedAt, StringComparer.Ordinal))
        {
            var pj = job.PrintJob;
            if (pj is null || pj.Status != "READY" || !localPrinterIds.Contains(pj.PrinterId)) continue;
            if (local.ContainsKey(pj.Id)) continue; // this attempt was already touched here: never again

            LeaseResponse lease;
            try
            {
                lease = await _api.LeasePrintJobAsync(pj.Id, ct);
            }
            catch (ApiException ex) when (ex.Code is "NOT_NEXT_IN_QUEUE" or "PRINTER_BUSY" or "JOB_NOT_READY" or "PACKET_MISSING")
            {
                _log.LogInformation("Lease skipped for print job {PrintJobId}: {Code}", pj.Id, ex.Code);
                continue;
            }

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

        // Rule (A.3): print only a freshly leased attempt whose local phase is NOT_STARTED.
        if (_state.Load().Jobs.ContainsKey(lease.PrintJobId))
        {
            await ReportFailedAsync(lease.PrintJobId, "UNCERTAIN: this attempt was already started on this PC; not printing it again", ct);
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
                    ct);
            }
            catch (PrintEngineException ex)
            {
                await FailAsync(job, $"{ex.Code}: {ex.Message}", CancellationToken.None);
                _status.ShowToast($"Could not print {lease.PublicRef}", ex.Message, warning: true);
                return;
            }
            catch (Exception ex)
            {
                await FailAsync(job, $"UNCERTAIN: printer error during submission ({ex.Message})", CancellationToken.None);
                _status.ShowToast($"Check the printer for {lease.PublicRef}", "The print may be incomplete.", warning: true);
                return;
            }
            _state.SetPhase(job, LocalPhase.Submitted);
            _log.LogInformation("Submitted {Pages} pages as one spooler job {SpoolerJobId}", submission.PagesSent, submission.SpoolerJobId);

            // 4. Report SUBMITTED (retried: the spooler already has it).
            await WithRetryAsync(() => _api.ReportPrintStatusAsync(lease.PrintJobId,
                new PrintStatusReportDto { Status = "SUBMITTED", SpoolerJobId = submission.SpoolerJobId }, CancellationToken.None));
            _status.ShowToast($"Printing {lease.PublicRef}", $"{submission.PagesSent} pages sent to {lease.PrinterName}");

            // 5–6. Watch the spooler, then report SPOOLER_COMPLETE (telemetry: order stays PRINTING).
            await MonitorAsync(job, ct);
        }
        finally
        {
            try { if (File.Exists(pdfPath)) File.Delete(pdfPath); }
            catch (IOException ex) { _log.LogWarning(ex, "Could not delete the temporary packet"); }
        }
    }

    private async Task MonitorAsync(LocalJobState job, CancellationToken ct)
    {
        bool gone = await SpoolerJobFinder.WaitUntilGoneAsync(job.PrinterName, job.DocumentName, SpoolerWatchTimeout, ct);
        if (!gone)
        {
            // Still in the printer queue (jam, offline…). Leave it SUBMITTED for the operator.
            _status.ShowToast($"{job.PublicRef} is still in the printer queue", "Check the printer.", warning: true);
            return;
        }

        await WithRetryAsync(() => _api.ReportPrintStatusAsync(job.PrintJobId,
            new PrintStatusReportDto { Status = "SPOOLER_COMPLETE" }, CancellationToken.None));
        _state.SetPhase(job, LocalPhase.Done);
        _status.ShowToast($"{job.PublicRef} printed", "Check the stack and pickup slip, then Mark Ready.");
    }

    // ─── Reconciliation on start / reconnect (Appendix A.3) ───

    private async Task ReconcileAsync(CancellationToken ct)
    {
        var serverJobs = await _api.ListJobsAsync("PRINTING,QUEUED,NEEDS_OPERATOR_CHECK", ct);
        var local = _state.Load().Jobs;

        var inputs = serverJobs
            .Where(j => j.PrintJob is not null)
            .Select(j =>
            {
                local.TryGetValue(j.PrintJob!.Id, out var l);
                return new Reconciliation.ServerJob(
                    j.PrintJob.Id, j.OrderId, j.Status,
                    l?.DocumentName ?? $"KAGAZ-{j.PublicRef}-A{j.PrintJob.Attempt}",
                    LeasedByThisDevice: l is not null,
                    PrinterName: l?.PrinterName ?? string.Empty,
                    PrintJobStatus: j.PrintJob.Status);
            })
            .ToList();

        var spooled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var printer in local.Values.Select(l => l.PrinterName).Where(n => n.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            spooled.UnionWith(SpoolerJobFinder.ListDocumentNames(printer));
        }

        var outcomes = Reconciliation.Decide(inputs, local.ToDictionary(kv => kv.Key, kv => kv.Value.Phase), spooled);
        foreach (var outcome in outcomes)
        {
            local.TryGetValue(outcome.PrintJobId, out var job);
            switch (outcome.Decision)
            {
                case Reconciliation.Decision.ResumeMonitor when job is not null:
                    _log.LogInformation("Reconcile {PrintJobId}: still in the spooler, resuming", outcome.PrintJobId);
                    var server = serverJobs.First(j => j.PrintJob?.Id == outcome.PrintJobId);
                    if (server.PrintJob!.Status == "LEASED")
                    {
                        await _api.ReportPrintStatusAsync(job.PrintJobId, new PrintStatusReportDto { Status = "SUBMITTED" }, ct);
                    }
                    _state.SetPhase(job, LocalPhase.Submitted);
                    await MonitorAsync(job, ct);
                    break;

                case Reconciliation.Decision.ReportFailedNotSubmitted when job is not null:
                    await FailAsync(job, "NOT_SUBMITTED: the app stopped before this attempt reached the printer", ct);
                    break;

                case Reconciliation.Decision.ReportUncertain:
                    if (job is not null)
                    {
                        await FailAsync(job, "UNCERTAIN: the app restarted and could not confirm this print; check the output", ct);
                    }
                    _status.ShowToast("A print needs checking", "Open Jobs → Needs check.", warning: true);
                    break;

                case Reconciliation.Decision.None:
                    // The server no longer lists it as active (ready, collected, cancelled…).
                    _state.Update(s => s.Jobs.Remove(outcome.PrintJobId));
                    break;
            }
        }
    }

    // ─── Helpers ───

    private async Task FailAsync(LocalJobState job, string error, CancellationToken ct)
    {
        _state.SetPhase(job, LocalPhase.Failed);
        await ReportFailedAsync(job.PrintJobId, error, ct);
    }

    private async Task ReportFailedAsync(string printJobId, string error, CancellationToken ct)
    {
        _log.LogWarning("Reporting print job {PrintJobId} FAILED: {Error}", printJobId, error);
        try
        {
            await WithRetryAsync(() => _api.ReportPrintStatusAsync(printJobId,
                new PrintStatusReportDto { Status = "FAILED", Error = error.Length > 500 ? error[..500] : error }, ct));
        }
        catch (ApiException ex)
        {
            // Reconciliation reports it again once the server is reachable.
            _log.LogWarning("Could not report FAILED for {PrintJobId}: {Code}", printJobId, ex.Code);
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
            catch (ApiException ex) when (ex.Code == "NETWORK_ERROR" && attempt < 5)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2));
            }
        }
    }

    private static HashSet<string> InstalledPrinters()
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string name in PrinterSettings.InstalledPrinters) names.Add(name);
        return names;
    }

    public override void Dispose()
    {
        _download.Dispose();
        base.Dispose();
    }
}

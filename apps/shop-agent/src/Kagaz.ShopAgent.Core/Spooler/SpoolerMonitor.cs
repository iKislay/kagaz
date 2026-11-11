namespace Kagaz.ShopAgent.Core.Spooler;

public enum SpoolerOutcome
{
    /// <summary>Still in the queue (spooling, printing, or a problem inside the grace period).</summary>
    Pending,
    /// <summary>Report <c>SPOOLER_COMPLETE</c> (telemetry only — READY still needs the operator).</summary>
    SpoolerComplete,
    /// <summary>Report <c>FAILED {error}</c>: nothing was printed as far as the agent can tell.</summary>
    Failed,
    /// <summary>Report <c>UNCERTAIN {reason}</c>: pages may or may not have printed.</summary>
    Uncertain,
}

/// <param name="Outcome">What to report (nothing while <see cref="SpoolerOutcome.Pending"/>).</param>
/// <param name="Reason">Error / reason text for FAILED / UNCERTAIN (starts with a stable CODE).</param>
/// <param name="StatusText">Short human status for the app ("Printing page 2 of 5").</param>
/// <param name="Problem">A printer problem currently holding the job, if any.</param>
public sealed record SpoolerVerdict(SpoolerOutcome Outcome, string? Reason, string StatusText, string? Problem = null)
{
    public bool IsFinal => Outcome != SpoolerOutcome.Pending;
}

/// <summary>One poll of the spooler for the monitored document.</summary>
/// <param name="Queue">The printer queue (null = unreadable; <see cref="PrinterQueueSnapshot.Missing"/> = printer gone).</param>
/// <param name="Jobs">All jobs in that queue (null = unreadable).</param>
public sealed record SpoolerObservation(PrinterQueueSnapshot? Queue, IReadOnlyList<SpoolerJobSnapshot>? Jobs);

public sealed record SpoolerMonitorOptions
{
    /// <summary>A printer problem must persist this long before the attempt is handed to the operator.</summary>
    public TimeSpan ProblemGrace { get; init; } = TimeSpan.FromSeconds(30);
    /// <summary>The queue may be unreadable this long (spooler restart) before the outcome is UNCERTAIN.</summary>
    public TimeSpan UnreadableGrace { get; init; } = TimeSpan.FromSeconds(60);
    /// <summary>Still in the queue with no reported problem after this → UNCERTAIN (stuck).</summary>
    public TimeSpan StuckTimeout { get; init; } = TimeSpan.FromMinutes(30);
}

/// <summary>
/// Pure state machine that watches one submitted spooler job (P2.10, plan A.4) and decides what to
/// report: <c>SPOOLER_COMPLETE</c>, <c>FAILED</c> with a reason, or <c>UNCERTAIN</c>. It never
/// decides to print anything. Feed it one <see cref="SpoolerObservation"/> per poll.
/// <list type="bullet">
/// <item>completed / printed → SPOOLER_COMPLETE; left the queue normally → SPOOLER_COMPLETE.</item>
/// <item>deleted before any page printed → FAILED (DELETED); after printing started → UNCERTAIN.</item>
/// <item>error / offline / paper out lasting past <see cref="SpoolerMonitorOptions.ProblemGrace"/> → FAILED
/// if nothing printed yet (the job may still print when fixed — the operator checks), UNCERTAIN if
/// printing had started.</item>
/// <item>left the queue while a problem was showing, printer removed, queue unreadable too long, or
/// stuck → UNCERTAIN.</item>
/// </list>
/// Every FAILED/UNCERTAIN puts the order in NEEDS_OPERATOR_CHECK server-side; the customer never sees
/// READY from here (invariant 9).
/// </summary>
public sealed class SpoolerMonitor
{
    private readonly string _documentName;
    private readonly DateTimeOffset _startedAt;
    private readonly SpoolerMonitorOptions _options;
    private SpoolerJobSnapshot? _lastJob;
    private bool _printingSeen;
    private DateTimeOffset? _problemSince;
    private string? _problemCode;
    private string? _problemText;
    private DateTimeOffset _lastReadable;

    public SpoolerMonitor(string documentName, DateTimeOffset startedAt, SpoolerMonitorOptions? options = null)
    {
        _documentName = documentName;
        _startedAt = startedAt;
        _lastReadable = startedAt;
        _options = options ?? new SpoolerMonitorOptions();
    }

    public string DocumentName => _documentName;

    public SpoolerVerdict Observe(SpoolerObservation observation, DateTimeOffset now)
    {
        // Printer removed from Windows while our job was in it.
        if (observation.Queue is { Exists: false })
        {
            return Uncertain("PRINTER_REMOVED: the printer disappeared from Windows while printing; check the output tray");
        }

        if (observation.Queue is null || observation.Jobs is null)
        {
            if (now - _lastReadable >= _options.UnreadableGrace)
            {
                return Uncertain("SPOOLER_UNAVAILABLE: the Windows print queue could not be read; check the output tray");
            }
            return new SpoolerVerdict(SpoolerOutcome.Pending, null, "Waiting for the Windows print queue…");
        }
        _lastReadable = now;

        var job = observation.Jobs.FirstOrDefault(j => string.Equals(j.Name, _documentName, StringComparison.OrdinalIgnoreCase));
        return job is null ? Gone() : Present(job, observation.Queue, now);
    }

    private SpoolerVerdict Present(SpoolerJobSnapshot job, PrinterQueueSnapshot queue, DateTimeOffset now)
    {
        _lastJob = job;
        if (job.IsPrinting || job.PagesPrinted > 0) _printingSeen = true;

        if (job.IsCompleted || job.IsPrinted)
        {
            return Complete();
        }

        if (job.IsDeleting || job.IsDeleted)
        {
            return Deleted();
        }

        var problem = JobProblem(job) ?? QueueProblem(queue);
        if (problem is { } p)
        {
            _problemSince ??= now;
            _problemCode = p.Code;
            _problemText = p.Text;
            if (now - _problemSince.Value >= _options.ProblemGrace)
            {
                return _printingSeen
                    ? Uncertain($"{p.Code}: {p.Text} while printing — some pages may have printed; the job is still in the printer queue")
                    : Failed($"{p.Code}: {p.Text}; nothing printed yet — the job is still in the printer queue and may print when fixed");
            }
            return new SpoolerVerdict(SpoolerOutcome.Pending, null, p.Text, p.Text);
        }

        _problemSince = null;
        _problemCode = null;
        _problemText = null;

        if (now - _startedAt >= _options.StuckTimeout)
        {
            return Uncertain($"STUCK: still in the printer queue after {(int)_options.StuckTimeout.TotalMinutes} minutes; check the printer");
        }

        string status = job.IsPrinting || job.PagesPrinted > 0
            ? job.TotalPages > 0 ? $"Printing page {Math.Min(job.PagesPrinted + 1, job.TotalPages)} of {job.TotalPages}" : "Printing"
            : job.IsSpooling ? "Sending to the printer" : "Waiting in the printer queue";
        return new SpoolerVerdict(SpoolerOutcome.Pending, null, status);
    }

    /// <summary>The job is no longer in the queue.</summary>
    private SpoolerVerdict Gone()
    {
        if (_lastJob is null)
        {
            // Never saw it: a small job can be spooled and despooled between submission and the first
            // poll. Windows only removes a job early when it is deleted, which we'd have seen as such.
            return Complete();
        }
        if (_lastJob.IsDeleting || _lastJob.IsDeleted)
        {
            return Deleted();
        }
        if (_problemSince is not null)
        {
            return Uncertain($"{_problemCode}: the job left the printer queue while the printer reported \"{_problemText}\"; check the output tray");
        }
        return Complete();
    }

    private SpoolerVerdict Deleted() => _printingSeen
        ? Uncertain("DELETED: removed from the printer queue after printing started; some pages may have printed")
        : Failed("DELETED: removed from the printer queue before printing; nothing was printed");

    private static (string Code, string Text)? JobProblem(SpoolerJobSnapshot job)
    {
        if (job.IsPaperOut) return ("PAPER_OUT", "Printer is out of paper");
        if (job.IsOffline) return ("PRINTER_OFFLINE", "Printer is offline");
        if (job.IsInError) return ("PRINTER_ERROR", "Printer reported an error");
        if (job.IsBlocked || job.IsUserInterventionRequired) return ("PRINTER_ERROR", "Printer needs attention");
        if (job.IsPaused) return ("JOB_PAUSED", "The job is paused in the Windows print queue");
        return null;
    }

    private static (string Code, string Text)? QueueProblem(PrinterQueueSnapshot queue)
    {
        var health = PrinterHealth.Map(queue);
        if (!health.IsProblem) return null;
        string code = health.Status switch
        {
            PrinterHealthStatus.PaperOut => "PAPER_OUT",
            PrinterHealthStatus.Offline => "PRINTER_OFFLINE",
            _ => "PRINTER_ERROR",
        };
        return (code, health.LastError ?? "Printer problem");
    }

    private static SpoolerVerdict Complete() =>
        new(SpoolerOutcome.SpoolerComplete, null, "Sent to the printer");

    private static SpoolerVerdict Failed(string reason) => new(SpoolerOutcome.Failed, reason, "Needs checking", reason);

    private static SpoolerVerdict Uncertain(string reason) => new(SpoolerOutcome.Uncertain, reason, "Needs checking", reason);
}

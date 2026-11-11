using System.Text.Json;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Local print phases (Appendix A.3). The order matters: a job may only be submitted to the
/// spooler from <see cref="NotStarted"/>/<see cref="Downloaded"/> on a fresh lease, and anything at
/// or after <see cref="Submitting"/> is never printed again by the agent.
/// </summary>
public static class LocalPhase
{
    /// <summary>Lease taken; nothing downloaded yet.</summary>
    public const string NotStarted = "NOT_STARTED";
    /// <summary>Packet downloaded and checksum verified; not yet handed to the spooler.</summary>
    public const string Downloaded = "DOWNLOADED";
    /// <summary>About to call / inside the print engine: the outcome is unknown if we crash here.</summary>
    public const string Submitting = "SUBMITTING";
    /// <summary>Spooler accepted the job and SUBMITTED was reported.</summary>
    public const string Submitted = "SUBMITTED";
    /// <summary>SPOOLER_COMPLETE reported; the server moves the order to READY_FOR_PICKUP (ADR-002).</summary>
    public const string Done = "DONE";
    /// <summary>FAILED decided (and reported, or to be re-sent); the operator handles it (NEEDS_OPERATOR_CHECK).</summary>
    public const string Failed = "FAILED";
    /// <summary>UNCERTAIN decided (and reported, or to be re-sent); the operator checks the tray.</summary>
    public const string Uncertain = "UNCERTAIN";
}

/// <summary>
/// Local phase of a print job persisted in <c>%LOCALAPPDATA%\Kagaz\state.json</c>.
/// </summary>
public sealed class LocalJobState
{
    public string Phase { get; set; } = LocalPhase.NotStarted;
    public string OrderId { get; set; } = string.Empty;
    public string PrintJobId { get; set; } = string.Empty;
    public int Attempt { get; set; }
    public string PublicRef { get; set; } = string.Empty;
    public string DocumentName { get; set; } = string.Empty;
    public string PrinterName { get; set; } = string.Empty;
    /// <summary>Reason sent with FAILED / UNCERTAIN, kept so a lost report can be re-sent verbatim.</summary>
    public string? Reason { get; set; }
    /// <summary>Spooler job id reported with SUBMITTED, if found.</summary>
    public int? SpoolerJobId { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>One entry of a printer's local queue (job id, attempt; local phase is implicitly QUEUED).</summary>
public sealed class QueuedJob
{
    public string PrintJobId { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public string PublicRef { get; set; } = string.Empty;
    public int Attempt { get; set; }
    public string PrinterId { get; set; } = string.Empty;
    /// <summary>Server order of the queue (paidAt, else createdAt — ISO-8601 sorts lexically).</summary>
    public string SortKey { get; set; } = string.Empty;
    public DateTimeOffset EnqueuedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Durable local state: per-job print phase, paused flag, pairing details, registered printers.
/// Survives restarts so reconciliation can resume ambiguous jobs. Never holds the device token
/// (that lives in the DPAPI store).
/// </summary>
public sealed class AgentState
{
    /// <summary>Print attempts this PC has leased (keyed by print-job id). Never printed twice.</summary>
    public Dictionary<string, LocalJobState> Jobs { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>
    /// Per-printer local queue (P2.7, keyed by Windows printer name): server-QUEUED attempts routed to a
    /// printer on this PC, oldest first, not yet leased. The server lease still decides who prints.
    /// </summary>
    public Dictionary<string, List<QueuedJob>> Queues { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>The server answered <c>401 DEVICE_REVOKED</c>; the pairing screen says so until re-paired.</summary>
    public bool DeviceRevoked { get; set; }
    /// <summary>Last device-token rotation (P2.4); null on installs paired before rotation existed.</summary>
    public DateTimeOffset? TokenRotatedAt { get; set; }
    public bool PrintingPaused { get; set; }
    public List<string> RegisteredPrinterNames { get; set; } = new();
    /// <summary>API base URL chosen on the pairing screen (overrides appsettings.json).</summary>
    public string? ApiBaseUrl { get; set; }
    public string? ShopName { get; set; }
    public string? DeviceName { get; set; }
    public bool ShopIsDemo { get; set; }
}

/// <summary>
/// Reads/writes <c>state.json</c> under the Kagaz local state folder. Thread-safe: the print worker,
/// heartbeat and UI all update it.
/// </summary>
public sealed class AgentStateStore
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
    private readonly string _path;
    private readonly object _gate = new();

    public AgentStateStore(string path)
    {
        _path = path ?? throw new ArgumentNullException(nameof(path));
        RootDirectory = (Path.GetDirectoryName(_path) ?? Path.GetPathRoot(_path))!;
    }

    public string RootDirectory { get; }

    public string StatePath => _path;

    public AgentState Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path))
            {
                return new AgentState();
            }

            try
            {
                var json = File.ReadAllText(_path);
                var state = JsonSerializer.Deserialize<AgentState>(json, JsonOpts) ?? new AgentState();
                // Keep job ids / printer names case-insensitive after a round trip.
                state.Jobs = new Dictionary<string, LocalJobState>(state.Jobs ?? new(), StringComparer.OrdinalIgnoreCase);
                state.Queues = new Dictionary<string, List<QueuedJob>>(state.Queues ?? new(), StringComparer.OrdinalIgnoreCase);
                return state;
            }
            catch
            {
                // A corrupt state file must never crash the agent; start fresh.
                return new AgentState();
            }
        }
    }

    public void Save(AgentState state)
    {
        if (state is null) throw new ArgumentNullException(nameof(state));
        lock (_gate)
        {
            var directory = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }
            // Write-then-rename so a crash mid-write never leaves a truncated state file.
            var temp = _path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(state, JsonOpts));
            File.Move(temp, _path, overwrite: true);
        }
    }

    /// <summary>Load, apply <paramref name="change"/>, save — atomically with respect to other callers.</summary>
    public AgentState Update(Action<AgentState> change)
    {
        lock (_gate)
        {
            var state = Load();
            change(state);
            Save(state);
            return state;
        }
    }

    /// <summary>Record the local phase of one print attempt (persisted before acting on it).</summary>
    public void SetPhase(LocalJobState job, string phase)
    {
        job.Phase = phase;
        job.UpdatedAt = DateTimeOffset.UtcNow;
        Update(s => s.Jobs[job.PrintJobId] = job);
    }
}

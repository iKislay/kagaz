using System.Collections.Concurrent;
using System.Drawing.Printing;

namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Remembers which installed printers the driver could not open (<see cref="PrinterSettings.IsValid"/>
/// false / CreateDC fails — e.g. the Microsoft IPP Class Driver returns error 995 after ~16 s when
/// the printer is off or asleep). The Windows queue itself often still says "Ready" in that case,
/// so the heartbeat consults this to report the printer OFFLINE instead.
/// <para>Marked by the print worker on <c>PRINTER_UNREACHABLE</c>, cleared on a successful print, and
/// re-probed in the background at most once per <see cref="ProbeInterval"/> per printer (the probe
/// can block for many seconds, so it never runs on the heartbeat path itself).</para>
/// </summary>
public sealed class PrinterReachability
{
    public static readonly TimeSpan ProbeInterval = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.OrdinalIgnoreCase);
    private readonly Func<string, bool> _probe;
    private readonly Func<DateTimeOffset> _clock;

    public PrinterReachability(Func<string, bool>? probe = null, Func<DateTimeOffset>? clock = null)
    {
        _probe = probe ?? DefaultProbe;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    private sealed record Entry(bool Reachable, string? Error, DateTimeOffset CheckedAt, bool Probing);

    /// <summary>The engine could not open this printer.</summary>
    public void MarkUnreachable(string printerName, string? error = null) =>
        _entries[printerName] = new Entry(false, error ?? PrintEngineException.PrinterUnreachableMessage, _clock(), false);

    /// <summary>A print was submitted successfully.</summary>
    public void MarkReachable(string printerName) =>
        _entries[printerName] = new Entry(true, null, _clock(), false);

    /// <summary>
    /// Last known state: null = unknown/reachable, else the reason it is unreachable.
    /// Starts a background re-probe when the cached result is older than <see cref="ProbeInterval"/>.
    /// </summary>
    public string? UnreachableReason(string printerName)
    {
        var entry = _entries.GetOrAdd(printerName, _ => new Entry(true, null, DateTimeOffset.MinValue, false));
        if (!entry.Probing && _clock() - entry.CheckedAt >= ProbeInterval)
        {
            _entries[printerName] = entry with { Probing = true };
            _ = Task.Run(() =>
            {
                bool ok;
                try { ok = _probe(printerName); }
                catch { ok = false; }
                _entries[printerName] = ok
                    ? new Entry(true, null, _clock(), false)
                    : new Entry(false, PrintEngineException.PrinterUnreachableMessage, _clock(), false);
            });
        }
        return entry.Reachable ? null : entry.Error;
    }

    /// <summary>Only meaningful for installed printers; uninstalled ones are reported elsewhere.</summary>
    private static bool DefaultProbe(string printerName) =>
        !PdfiumPrintEngine.IsInstalled(printerName) || new PrinterSettings { PrinterName = printerName }.IsValid;
}

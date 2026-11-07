namespace Kagaz.ShopAgent.Core;

/// <summary>Builds the heartbeat payload (P2.7 / P4.4, contract §1). Pure.</summary>
public static class HeartbeatBuilder
{
    public const int MaxPrinters = 20;

    public static HeartbeatRequest Build(string appVersion, string os, TimeSpan uptime, AgentState state,
        IEnumerable<PrinterStatus> printers) =>
        new(
            AppVersion: appVersion,
            Printers: printers.Take(MaxPrinters).ToList(),
            Os: os,
            UptimeSeconds: (long)Math.Max(0, uptime.TotalSeconds),
            QueueDepth: LocalQueue.Depth(state),
            ActivePrintJobIds: LocalQueue.ActivePrintJobIds(state));

    /// <summary>"Windows 11 10.0.26300" — Windows 11 still reports major version 10, build ≥ 22000.</summary>
    public static string DescribeOs(Version version) =>
        $"Windows {(version.Major == 10 && version.Build >= 22000 ? "11" : version.Major == 10 ? "10" : version.Major.ToString())} " +
        $"{version.Major}.{version.Minor}.{version.Build}";

    /// <summary>
    /// Semantic-version comparison used to show the update banner even before the server says so
    /// (e.g. after a 426 carrying <c>minAgentVersion</c>). Non-numeric parts are ignored.
    /// </summary>
    public static bool IsOlderThan(string version, string? minimum)
    {
        if (string.IsNullOrWhiteSpace(minimum)) return false;
        return Parse(version).CompareTo(Parse(minimum)) < 0;

        static Version Parse(string s)
        {
            var core = s.Split('-', '+')[0];
            var parts = core.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).Concat([0, 0, 0]).Take(3).ToArray();
            return new Version(parts[0], parts[1], parts[2]);
        }
    }
}

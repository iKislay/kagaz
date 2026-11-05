namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Parsed response from <c>GET /api/health</c>.
/// </summary>
/// <param name="Status">Overall status reported by the API.</param>
/// <param name="Db">Database reachability.</param>
/// <param name="Storage">Storage reachability.</param>
/// <param name="Version">API version.</param>
/// <param name="Time">API server time (ISO-8601).</param>
public sealed record HealthReport(string Status, string Db, string Storage, string Version, DateTimeOffset Time);

/// <summary>
/// Result of a health check. Never throws to the UI.
/// </summary>
/// <param name="IsSuccess">True when the API answered with a 2xx and a valid body.</param>
/// <param name="Report">Parsed report when successful.</param>
/// <param name="FailureReason">Short human reason when unsuccessful.</param>
public sealed record HealthResult(bool IsSuccess, HealthReport? Report, string? FailureReason)
{
    public static HealthResult Success(HealthReport report) => new(true, report, null);
    public static HealthResult Failure(string reason) => new(false, null, reason);
}

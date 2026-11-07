namespace Kagaz.ShopAgent.Core;

/// <summary>When to rotate the device token (P2.4). Pure, so it is unit-tested.</summary>
public static class TokenRotationPolicy
{
    /// <summary>
    /// Due when the last rotation is at least <paramref name="days"/> old. An unknown last rotation
    /// (paired before rotation existed) is not due: the caller records "now" as the baseline instead,
    /// so upgrading the app never triggers an immediate rotation. <paramref name="days"/> ≤ 0 disables it.
    /// </summary>
    public static bool IsDue(DateTimeOffset? lastRotatedAt, DateTimeOffset now, int days) =>
        days > 0 && lastRotatedAt is { } last && now - last >= TimeSpan.FromDays(days);
}

using System.Globalization;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>Customer-facing wording for the shop's subscription state (pure; unit tested).</summary>
public static class BillingText
{
    /// <summary>
    /// The calm notice bar inside the app, or null when there's nothing to say. Inactive subscriptions
    /// never get here: they block the app with the subscription screen. <paramref name="contact"/> is how
    /// to reach Kaggaz (e.g. "Kaggaz support on +91 98765 43210").
    /// </summary>
    public static string? Notice(string? shopStatus, HeartbeatSubscription? sub, string contact) => sub switch
    {
        { Status: "ACTIVE", DaysLeft: <= 0 } => $"Your subscription ends today — contact {contact} to renew.",
        { Status: "ACTIVE", DaysLeft: int d and <= 7 } => $"Your subscription ends in {d} day{(d == 1 ? "" : "s")}.",
        _ when shopStatus == "CLOSED" => $"Your shop is closed to new orders — contact {contact} to open it.",
        _ => null,
    };

    /// <summary>Plan line for Settings, e.g. "Active · 2 printers · until 12 Dec 2026".</summary>
    public static string Plan(HeartbeatSubscription? sub) => sub?.Status switch
    {
        null => "Shown once this PC is connected.",
        "ACTIVE" => $"Active{Seats(sub.PrinterSeats)}{Until(sub.PeriodEnd)}",
        "EXPIRED" => $"Ended{On(sub.PeriodEnd)}{Seats(sub.PrinterSeats)}",
        _ => "Not active yet",
    };

    public static string? FormatDate(string? iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d)
            ? d.ToOffset(TimeSpan.FromMinutes(330)).ToString("d MMM yyyy", CultureInfo.InvariantCulture) // Asia/Kolkata
            : null;

    private static string On(string? iso) => FormatDate(iso) is { } d ? $" on {d}" : "";
    private static string Until(string? iso) => FormatDate(iso) is { } d ? $" · until {d}" : "";
    private static string Seats(int? seats) => seats is int n ? $" · {n} printer{(n == 1 ? "" : "s")}" : "";
}

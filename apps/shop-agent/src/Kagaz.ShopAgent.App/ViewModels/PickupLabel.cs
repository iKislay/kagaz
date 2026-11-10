using System.Globalization;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// ADR-002 daily pickup number: "#7", plus the date ("7 Nov") whenever it is not today's, so
/// yesterday's #7 is never mistaken for today's. Business dates are Asia/Kolkata.
/// </summary>
public static class PickupLabel
{
    private static readonly CultureInfo India = new("en-IN");

    /// <summary>Today's business date in Asia/Kolkata.</summary>
    public static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, IndiaTime.Zone).DateTime);

    public static string Number(int? number) => number is int n ? $"#{n}" : "—";

    public static string Date(DateOnly date) => date.ToString("d MMM", India);

    /// <summary>Parses the API's <c>pickupDate</c> (<c>YYYY-MM-DD</c>).</summary>
    public static DateOnly? ParseDate(string? value) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    /// <summary>The Asia/Kolkata calendar date of an ISO-8601 instant (fallback when <c>pickupDate</c> is missing).</summary>
    public static DateOnly? KolkataDate(string? iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)
            ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(t, IndiaTime.Zone).DateTime)
            : null;
}

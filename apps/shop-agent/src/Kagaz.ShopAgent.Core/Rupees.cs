using System.Globalization;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Rupee text ↔ integer paise for the owner's price editor. Decimal math only (never double):
/// "2.50" → 250, "₹ 1,200" → 120000; more than 2 decimals or negatives are rejected.
/// </summary>
public static class Rupees
{
    public const int MaxPaise = 10_000_000; // ₹1,00,000 per side is far beyond any real print price

    public static bool TryToPaise(string? text, out int paise)
    {
        paise = 0;
        var cleaned = (text ?? string.Empty).Replace("₹", "").Replace(",", "").Trim();
        if (!decimal.TryParse(cleaned, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var rupees))
        {
            return false;
        }
        decimal p = rupees * 100m;
        if (p != decimal.Truncate(p) || p < 0 || p > MaxPaise) return false;
        paise = (int)p;
        return true;
    }

    /// <summary>250 → "2.50", 200 → "2", 0 → "0".</summary>
    public static string FromPaise(int paise)
    {
        decimal rupees = paise / 100m;
        return rupees == decimal.Truncate(rupees)
            ? rupees.ToString("0", CultureInfo.InvariantCulture)
            : rupees.ToString("0.00", CultureInfo.InvariantCulture);
    }
}

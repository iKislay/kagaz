using System.Text.RegularExpressions;

namespace Kagaz.ShopAgent.Core;

// Direct-to-shop UPI payments (ADR-003, docs/contracts/UPI_PAYMENTS_CONTRACT.md). JSON mirrors
// packages/shared/src/upi-payments.ts (camelCase). The shop always comes from the device token.

// ─── Shop payment setup ───

/// <summary><c>readiness</c> of <c>GET /api/shop/payments/setup</c>: one status line in the app.</summary>
public static class ShopPaymentReadiness
{
    public const string NotRequired = "NOT_REQUIRED";
    public const string NeedsUpiId = "NEEDS_UPI_ID";
    public const string NeedsPhone = "NEEDS_PHONE";
    public const string PhoneOffline = "PHONE_OFFLINE";
    public const string Ready = "READY";
}

/// <summary>A phone running the payment-detector app, paired to this shop.</summary>
public record ObserverPhone(string Id, string Name, bool Online, string? LastSeenAt, string? LastPaymentSeenAt);

/// <summary><c>GET|PUT /api/shop/payments/setup</c>.</summary>
public record ShopPaymentSetup(
    string Provider,
    string Readiness,
    string? UpiId,
    string? PayeeName,
    List<ObserverPhone>? Phones,
    string? AppDownloadUrl,
    string? UpdatedAt);

/// <summary><c>PUT /api/shop/payments/setup</c> (operator) — step 1.</summary>
public record UpdateShopPaymentSetupRequest(string UpiId, string PayeeName);

/// <summary><c>POST /api/shop/payments/pairing</c> (operator) — step 2: show <see cref="QrText"/> as a QR.</summary>
public record ShopPhonePairing(string QrText, string ExpiresAt);

// ─── Customer payment reports (fallback: "I paid but it isn't confirmed") ───

public static class PaymentReportStatus
{
    public const string Open = "OPEN";
    public const string Approved = "APPROVED";
    public const string Declined = "DECLINED";
    public const string Superseded = "SUPERSEDED";
}

public static class DeclineReason
{
    public const string NotReceived = "NOT_RECEIVED";
    public const string WrongAmount = "WRONG_AMOUNT";
    public const string WrongReference = "WRONG_REFERENCE";
    public const string Other = "OTHER";
}

/// <summary>One report as the shop sees it: the full UTR, so the shop can find the credit in their UPI app.</summary>
public record ShopPaymentReport(
    string Id,
    string OrderId,
    string PublicRef,
    int AmountPaise,
    string Utr,
    string Status,
    string CreatedAt,
    string? DecidedAt,
    string? DeclineReason,
    string? CustomerPhoneLast4);

public record ShopPaymentReportList(List<ShopPaymentReport>? Reports);

/// <summary><c>POST /api/shop/payment-reports/:id/decline</c> (operator).</summary>
public record DeclinePaymentReportRequest(string Reason, string? Note);

// ─── Manual refunds (the provider cannot move money) ───

/// <summary>A refund the shop must send from their own UPI app.</summary>
public record ShopManualRefund(
    string RefundId,
    string OrderId,
    string PublicRef,
    int AmountPaise,
    string? PaymentReference,
    string? CustomerPhoneLast4,
    string? Reason,
    string CreatedAt);

public record ShopManualRefundList(List<ShopManualRefund>? Refunds);

/// <summary><c>POST /api/shop/refunds/:id/confirm</c> (operator): "I sent the money back".</summary>
public record ConfirmManualRefundRequest(string? Utr);

// ─── Validation (mirrors UpiIdSchema / UtrSchema / PayeeNameSchema) ───

public static partial class UpiFormat
{
    public const string UpiIdMessage = "Enter your UPI ID like name@bank — for example sriganesh@okicici or 9876543210@ybl.";
    public const string PayeeNameMessage = "Enter the name customers should see, 2 to 60 letters (for example Sri Ganesh Xerox).";
    public const string UtrMessage = "Enter the 12-digit UPI reference number, or leave it empty.";

    /// <summary>Trim + lower-case, as the server does.</summary>
    public static string NormalizeUpiId(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant();

    public static bool IsValidUpiId(string? value) => UpiIdRegex().IsMatch(NormalizeUpiId(value));

    /// <summary>Null when valid, otherwise a friendly message.</summary>
    public static string? ValidateUpiId(string? value) => IsValidUpiId(value) ? null : UpiIdMessage;

    public static string? ValidatePayeeName(string? value)
    {
        var name = (value ?? string.Empty).Trim();
        return name.Length is >= 2 and <= 60 ? null : PayeeNameMessage;
    }

    /// <summary>Removes all whitespace ("1234 5678 9012" → "123456789012").</summary>
    public static string NormalizeUtr(string? value) =>
        new((value ?? string.Empty).Where(c => !char.IsWhiteSpace(c)).ToArray());

    public static bool IsValidUtr(string? value) => UtrRegex().IsMatch(NormalizeUtr(value));

    /// <summary>"123456789012" → "1234 5678 9012" (easier to compare with the UPI app).</summary>
    public static string GroupUtr(string utr) =>
        utr.Length == 12 && utr.All(char.IsAsciiDigit) ? $"{utr[..4]} {utr[4..8]} {utr[8..]}" : utr;

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$")]
    private static partial Regex UpiIdRegex();

    [GeneratedRegex("^[0-9]{12}$")]
    private static partial Regex UtrRegex();
}

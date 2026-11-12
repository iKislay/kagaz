using System.ComponentModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Kaggaz support contact (from the server's public config, never hardcoded) and the links a new
/// shop needs: call, WhatsApp, email, website. Shown on first run, sign-in, Settings and the subscription sheet.
/// </summary>
public sealed partial class SupportViewModel : ObservableObject
{
    public const string WebsiteUrl = "https://kaggaz.in";

    private readonly ShopApiClient? _api;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Phone), nameof(DisplayPhone), nameof(CallText), nameof(Email), nameof(WhatsAppUrl),
        nameof(HasContact), nameof(ContactLine))]
    private SupportContact? _contact;

    /// <param name="api">Null in tests.</param>
    public SupportViewModel(ShopApiClient? api = null) => _api = api;

    public string? Phone => Blank(Contact?.Phone);
    /// <summary>"89872 63735" — how the number is said and dialled in India.</summary>
    public string? DisplayPhone => Phone is null ? null : FormatPhone(Phone);
    public string? CallText => DisplayPhone is null ? null : $"Call {DisplayPhone}";
    public string? Email => Blank(Contact?.Email);
    public string? WhatsAppUrl => SupportContact.WhatsAppUrl(Contact?.Whatsapp);
    public bool HasContact => Phone is not null || Email is not null || WhatsAppUrl is not null;

    /// <summary>For notice text: "Kaggaz support on 89872 63735".</summary>
    public string ContactLine => DisplayPhone is { } p ? $"Kaggaz support on {p}"
        : Email is { } e ? $"Kaggaz support at {e}"
        : "Kaggaz support (kaggaz.in)";

    /// <summary>Indian mobile numbers (+91 / 10 digits) → "98765 43210"; anything else as given.</summary>
    public static string FormatPhone(string number)
    {
        var digits = new string(number.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal)) digits = digits[2..];
        return digits.Length == 10 ? $"{digits[..5]} {digits[5..]}" : number.Trim();
    }

    [RelayCommand]
    private void CopyPhone()
    {
        if (DisplayPhone is null) return;
        try { System.Windows.Clipboard.SetText(DisplayPhone); }
        catch (System.Runtime.InteropServices.COMException) { } // clipboard busy: the number stays on screen
    }

    /// <summary>Best effort: without a connection the card just shows the website.</summary>
    public async Task LoadAsync()
    {
        if (_api is null) return;
        try
        {
            Contact = await _api.GetSupportAsync();
        }
        catch (ApiException)
        {
        }
    }

    [RelayCommand]
    private void OpenWebsite() => Open(WebsiteUrl);

    [RelayCommand]
    private void Call() => Open(Phone is null ? null : $"tel:{Phone}");

    [RelayCommand]
    private void OpenWhatsApp() => Open(WhatsAppUrl);

    [RelayCommand]
    private void SendEmail() => Open(Email is null ? null : $"mailto:{Email}");

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void Open(string? url)
    {
        if (url is null) return;
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            // No browser / mail / dialer handler registered on this PC: nothing more to do.
        }
    }
}

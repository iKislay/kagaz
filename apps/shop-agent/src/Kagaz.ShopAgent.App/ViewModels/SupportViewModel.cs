using System.ComponentModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Kaggaz support contact (from the server's public config, never hardcoded) and the links a new
/// shop needs: create an account, call, WhatsApp, email, website. Shown on pairing, sign-in and Settings.
/// </summary>
public sealed partial class SupportViewModel : ObservableObject
{
    public const string WebsiteUrl = "https://kaggaz.in";
    public const string RegisterUrl = "https://kaggaz.in/register";

    private readonly ShopApiClient? _api;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Phone), nameof(Email), nameof(WhatsAppUrl), nameof(HasContact))]
    private SupportContact? _contact;

    /// <param name="api">Null in tests.</param>
    public SupportViewModel(ShopApiClient? api = null) => _api = api;

    public string? Phone => Blank(Contact?.Phone);
    public string? Email => Blank(Contact?.Email);
    public string? WhatsAppUrl => SupportContact.WhatsAppUrl(Contact?.Whatsapp);
    public bool HasContact => Phone is not null || Email is not null || WhatsAppUrl is not null;

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
    private void CreateAccount() => Open(RegisterUrl);

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

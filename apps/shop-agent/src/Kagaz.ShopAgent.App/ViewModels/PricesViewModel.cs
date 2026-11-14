using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Owner page: the shop's prices per printed side, typed in rupees and sent as integer paise
/// (decimal math, never floats — the server stays the source of every customer price).
/// </summary>
public sealed partial class PricesViewModel : ObservableObject
{
    private readonly ShopApiClient? _api;

    [ObservableProperty]
    private string _mono = string.Empty;

    [ObservableProperty]
    private string _colour = string.Empty;

    [ObservableProperty]
    private string _monoDuplex = string.Empty;

    [ObservableProperty]
    private string _colourDuplex = string.Empty;

    [ObservableProperty]
    private string _minimum = string.Empty;

    [ObservableProperty]
    private string? _message;

    [ObservableProperty]
    private bool _messageIsError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private bool _isBusy;

    /// <param name="api">Null in tests.</param>
    public PricesViewModel(ShopApiClient? api = null) => _api = api;

    public async Task LoadAsync()
    {
        if (_api is null) return;
        try
        {
            Apply(await _api.GetPricingAsync());
        }
        catch (ApiException ex)
        {
            Show(StaffViewModel.OwnerError(ex), error: true);
        }
    }

    private bool CanSave() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanSave))]
    private async Task SaveAsync()
    {
        if (_api is null) return;
        var request = BuildRequest(Mono, Colour, MonoDuplex, ColourDuplex, Minimum, out var error);
        if (request is null)
        {
            Show(error!, error: true);
            return;
        }
        IsBusy = true;
        try
        {
            Apply(await _api.SetPricingAsync(request));
            Show("Saved. Customers see the new prices for new orders.", error: false);
        }
        catch (ApiException ex)
        {
            Show(StaffViewModel.OwnerError(ex), error: true);
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>Rupee text → request in paise; null + a message when something can't be a price.</summary>
    public static UpdateShopPricingRequest? BuildRequest(string mono, string colour, string monoDuplex, string colourDuplex,
        string minimum, out string? error)
    {
        error = null;
        if (!Rupees.TryToPaise(mono, out int m) || m == 0) { error = "Enter the black & white price per side, e.g. 2 or 1.50."; return null; }
        if (!Rupees.TryToPaise(colour, out int c) || c == 0) { error = "Enter the colour price per side, e.g. 10."; return null; }
        if (!Optional(monoDuplex, out int? md)) { error = "Double-sided black & white price isn't a valid amount."; return null; }
        if (!Optional(colourDuplex, out int? cd)) { error = "Double-sided colour price isn't a valid amount."; return null; }
        if (!Rupees.TryToPaise(string.IsNullOrWhiteSpace(minimum) ? "0" : minimum, out int min)) { error = "Minimum charge isn't a valid amount."; return null; }

        // No double-sided rates → each side costs the same as single-sided.
        string rule = md is null && cd is null ? "SAME_AS_SIMPLEX" : "DISCOUNTED_SIDE_RATE";
        return new UpdateShopPricingRequest(m, c, md, cd, rule, min);
    }

    private static bool Optional(string text, out int? paise)
    {
        paise = null;
        if (string.IsNullOrWhiteSpace(text)) return true;
        if (!Rupees.TryToPaise(text, out int p)) return false;
        paise = p;
        return true;
    }

    /// <summary>Shows the current prices; a shop without prices yet starts from empty fields.</summary>
    private void Apply(ShopPricing? p)
    {
        if (p is null) return;
        Mono = Rupees.FromPaise(p.MonoRatePaise);
        Colour = Rupees.FromPaise(p.ColourRatePaise);
        MonoDuplex = p.MonoDuplexRatePaise is int md ? Rupees.FromPaise(md) : string.Empty;
        ColourDuplex = p.ColourDuplexRatePaise is int cd ? Rupees.FromPaise(cd) : string.Empty;
        Minimum = Rupees.FromPaise(p.MinimumChargePaise);
    }

    private void Show(string text, bool error)
    {
        Message = text;
        MessageIsError = error;
    }
}

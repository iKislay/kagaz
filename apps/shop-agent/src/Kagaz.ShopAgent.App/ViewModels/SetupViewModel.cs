using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

public enum SetupStep
{
    Details,
    Location,
    Prices,
}

/// <summary>
/// First-run setup, shown to the shop owner after signing in until it's finished: shop details →
/// location → prices. Every step is saved to the server when the owner continues (never all at the
/// end), so closing the app midway keeps what was done. The location is a pin from this PC's
/// position or a searched place; the address customers read is suggested and the owner can edit it.
/// Operators see a "waiting for the owner" screen instead.
/// </summary>
public sealed partial class SetupViewModel : ObservableObject
{
    /// <summary>Beyond this Windows only knows the area of the internet connection: kilometres off.</summary>
    public const double MaxAccuracyMeters = 1000;
    private static readonly TimeSpan SearchDelay = TimeSpan.FromMilliseconds(350);

    private readonly ShopApiClient _api;
    private readonly ILocationService _location;
    private CancellationTokenSource? _search;
    private bool _applyingPlace;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsDetailsStep), nameof(IsLocationStep), nameof(IsPricesStep), nameof(StepNumber))]
    private SetupStep _step = SetupStep.Details;

    [ObservableProperty]
    private bool _isLoaded;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveDetailsCommand), nameof(UseCurrentLocationCommand), nameof(SaveLocationCommand),
        nameof(FinishCommand), nameof(BackCommand), nameof(LoadCommand))]
    private bool _isBusy;

    [ObservableProperty]
    private string? _busyText;

    [ObservableProperty]
    private string? _error;

    /// <summary>The error can be fixed in Windows Settings (location off or blocked for apps).</summary>
    [ObservableProperty]
    private bool _canOpenLocationSettings;

    // Step 1: details
    [ObservableProperty]
    private string _shopName = string.Empty;

    [ObservableProperty]
    private string _contactPhone = string.Empty;

    // Step 2: location
    [ObservableProperty]
    private string _searchText = string.Empty;

    [ObservableProperty]
    private Place? _selectedPlace;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPin), nameof(PinText))]
    private GeoPoint? _pin;

    [ObservableProperty]
    private string _address = string.Empty;

    [ObservableProperty]
    private string? _pinSource;

    public SetupViewModel(ShopApiClient api, AppStatus status, ILocationService location, PricesViewModel prices)
    {
        _api = api;
        _location = location;
        Status = status;
        Prices = prices;
        Suggestions.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasSuggestions));
    }

    public AppStatus Status { get; }
    public PricesViewModel Prices { get; }
    public ObservableCollection<Place> Suggestions { get; } = new();

    public bool IsDetailsStep => Step == SetupStep.Details;
    public bool IsLocationStep => Step == SetupStep.Location;
    public bool IsPricesStep => Step == SetupStep.Prices;
    public int StepNumber => (int)Step + 1;
    public bool HasSuggestions => Suggestions.Count > 0;
    public bool HasPin => Pin is not null;
    public string? PinText => Pin is { } p ? string.Create(CultureInfo.InvariantCulture, $"{p.Lat:0.00000}, {p.Lng:0.00000}") : null;

    private bool Idle() => !IsBusy;

    /// <summary>Loads the shop's profile (and prices) and starts at step 1 with what the server already has.</summary>
    [RelayCommand(CanExecute = nameof(Idle))]
    public async Task LoadAsync()
    {
        await RunAsync("Loading your shop…", async () =>
        {
            var profile = await _api.GetProfileAsync();
            Status.ApplyShopProfile(profile);
            ShopName = profile.Name;
            ContactPhone = profile.ContactPhone is { } phone ? SupportViewModel.FormatPhone(phone) : string.Empty;
            Pin = profile.Location;
            Address = profile.Address ?? string.Empty;
            PinSource = profile.Location is null ? null : "Saved location";
            Step = SetupStep.Details;
            IsLoaded = true;
            if (Status.IsOwner) await Prices.LoadAsync();
        });
    }

    // ─── Step 1: shop details ───

    [RelayCommand(CanExecute = nameof(Idle))]
    private async Task SaveDetailsAsync()
    {
        string name = ShopName.Trim();
        if (name.Length < 2)
        {
            Error = "Enter your shop's name as customers know it.";
            return;
        }
        string phone = ContactPhone.Trim();
        if (phone.Length > 0 && phone.Count(char.IsAsciiDigit) < 10)
        {
            Error = "Enter a 10-digit mobile number for the shop, or leave it empty.";
            return;
        }
        await RunAsync("Saving…", async () =>
        {
            var profile = await _api.UpdateProfileAsync(new UpdateShopProfileRequest(name, phone.Length > 0 ? phone : null));
            Status.ApplyShopProfile(profile);
            Step = SetupStep.Location;
        });
    }

    // ─── Step 2: location ───

    partial void OnSearchTextChanged(string value)
    {
        if (_applyingPlace) return;
        _search?.Cancel();
        Suggestions.Clear();
        if (value.Trim().Length < 3) return;
        var cts = _search = new CancellationTokenSource();
        _ = SearchAsync(value.Trim(), cts.Token);
    }

    private async Task SearchAsync(string query, CancellationToken ct)
    {
        try
        {
            await Task.Delay(SearchDelay, ct); // wait until the owner pauses typing
            var places = await _api.SearchPlacesAsync(query, ct);
            if (ct.IsCancellationRequested) return;
            Suggestions.Clear();
            foreach (var place in places) Suggestions.Add(place);
            Error = places.Count == 0 ? "No matches. Try the area or a landmark near your shop." : null;
        }
        catch (OperationCanceledException) { }
        catch (ApiException ex) when (!ct.IsCancellationRequested)
        {
            Error = StaffViewModel.OwnerError(ex);
        }
    }

    partial void OnSelectedPlaceChanged(Place? value)
    {
        if (value is null) return;
        _applyingPlace = true;
        SearchText = value.Name;
        _applyingPlace = false;
        _search?.Cancel();
        Suggestions.Clear();
        Pin = new GeoPoint(value.Lat, value.Lng);
        Address = value.Address;
        PinSource = "From search";
        Error = null;
    }

    [RelayCommand(CanExecute = nameof(Idle))]
    private async Task UseCurrentLocationAsync()
    {
        CanOpenLocationSettings = false;
        await RunAsync("Finding this PC's location…", async () =>
        {
            LocationFix fix;
            try
            {
                fix = await _location.GetCurrentAsync(CancellationToken.None);
            }
            catch (LocationUnavailableException ex)
            {
                Error = ex.Message;
                CanOpenLocationSettings = ex.SettingsCanFix;
                return;
            }
            if (fix.AccuracyMeters > MaxAccuracyMeters)
            {
                Error = $"Windows only knows this PC's location to within {fix.AccuracyMeters / 1000:0.#} km. " +
                        "Turn on Wi-Fi and try again, or search for your shop instead.";
                return;
            }
            Pin = new GeoPoint(fix.Lat, fix.Lng);
            PinSource = $"This PC's location (accurate to about {fix.AccuracyMeters:0} m)";
            Address = await _api.ReversePlaceAsync(fix.Lat, fix.Lng) ?? Address;
        });
    }

    [RelayCommand(CanExecute = nameof(Idle))]
    private async Task SaveLocationAsync()
    {
        if (Pin is not { } pin)
        {
            Error = "Use this PC's location or search for your shop first.";
            return;
        }
        string address = Address.Trim();
        if (address.Length < 5)
        {
            Error = "Enter the address customers should look for.";
            return;
        }
        await RunAsync("Saving…", async () =>
        {
            Status.ApplyShopProfile(await _api.SetLocationAsync(new ShopLocationRequest(pin.Lat, pin.Lng, address)));
            Step = SetupStep.Prices;
        });
    }

    [RelayCommand]
    private void OpenMap()
    {
        if (Pin is { } p)
        {
            Open(string.Create(CultureInfo.InvariantCulture, $"https://www.google.com/maps/search/?api=1&query={p.Lat},{p.Lng}"));
        }
    }

    [RelayCommand]
    private static void OpenLocationSettings() => Open("ms-settings:privacy-location");

    // ─── Step 3: prices, then finish ───

    [RelayCommand(CanExecute = nameof(Idle))]
    private async Task FinishAsync()
    {
        Error = null;
        if (!await Prices.TrySaveAsync()) return;
        await RunAsync("Finishing…", async () =>
        {
            Status.ApplyShopProfile(await _api.CompleteSetupAsync());
            Status.ShowToast("Your shop is set up", "Customers can find it once Kaggaz activates your subscription.");
        });
    }

    [RelayCommand(CanExecute = nameof(Idle))]
    private void Back()
    {
        Error = null;
        if (Step > SetupStep.Details) Step--;
    }

    private async Task RunAsync(string busyText, Func<Task> action)
    {
        IsBusy = true;
        BusyText = busyText;
        Error = null;
        try
        {
            await action();
        }
        catch (ApiException ex)
        {
            Error = StaffViewModel.OwnerError(ex);
        }
        finally
        {
            IsBusy = false;
            BusyText = null;
        }
    }

    private static void Open(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { }
    }
}

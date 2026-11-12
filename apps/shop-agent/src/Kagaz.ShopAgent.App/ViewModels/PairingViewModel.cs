using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>How the first-run screen connects this PC to a shop.</summary>
public enum PairingMode
{
    /// <summary>Existing shop: the owner's mobile number + password.</summary>
    SignIn,
    /// <summary>New shop: create the shop and owner login right here.</summary>
    SignUp,
    /// <summary>Fallback: a one-time pairing code from Kaggaz support.</summary>
    Code,
}

/// <summary>
/// First run (P1.9, FR-SHOP-01): shops never use a website dashboard. They sign in with the
/// owner's mobile number, create the shop account here, or (fallback) enter a pairing code.
/// Every path ends with a device token stored with DPAPI; sign-in/sign-up also sign the owner in so
/// they land in the app ready to work. The shop is whatever the server binds; this PC never picks
/// a shop id except from the server's own MULTIPLE_SHOPS list.
/// </summary>
public sealed partial class PairingViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly AgentSettings _settings;

    [ObservableProperty]
    private string _apiUrl;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsSignIn), nameof(IsSignUp), nameof(IsCode))]
    private PairingMode _mode = PairingMode.SignIn;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(PairCommand), nameof(SignInCommand), nameof(SignUpCommand))]
    private bool _isBusy;

    [ObservableProperty]
    private string? _error;

    /// <summary>The server address is for Kaggaz support only; shopkeepers never need it.</summary>
    [ObservableProperty]
    private bool _showAdvanced;

    // Sign in
    [ObservableProperty]
    private string _login = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasShopChoices))]
    private ShopChoice? _selectedShop;

    // Sign up
    [ObservableProperty]
    private string _shopName = string.Empty;

    [ObservableProperty]
    private string _shopAddress = string.Empty;

    [ObservableProperty]
    private string _ownerName = string.Empty;

    [ObservableProperty]
    private string _signUpPhone = string.Empty;

    // Pairing code
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(PairCommand))]
    private string _pairingCode = string.Empty;

    [ObservableProperty]
    private string _deviceName;

    public PairingViewModel(ShopApiClient api, AgentSettings settings, AgentStateStore state, AppStatus status,
        SupportViewModel? support = null)
    {
        _api = api;
        _settings = settings;
        Status = status;
        Support = support ?? new SupportViewModel();
        _apiUrl = settings.ApiBaseUrl;
        _deviceName = state.Load().DeviceName ?? Environment.MachineName;
    }

    public AppStatus Status { get; }
    public SupportViewModel Support { get; }

    public bool IsSignIn => Mode == PairingMode.SignIn;
    public bool IsSignUp => Mode == PairingMode.SignUp;
    public bool IsCode => Mode == PairingMode.Code;

    /// <summary>Set by the view (PasswordBox can't bind); never stored.</summary>
    public string Password { get; set; } = string.Empty;
    public string SignUpPassword { get; set; } = string.Empty;
    public string SignUpConfirm { get; set; } = string.Empty;

    /// <summary>The view clears its password boxes when this fires.</summary>
    public event Action? PasswordsCleared;

    /// <summary>Shops this login manages, from <c>409 MULTIPLE_SHOPS</c>.</summary>
    public ObservableCollection<ShopChoice> ShopChoices { get; } = new();
    public bool HasShopChoices => ShopChoices.Count > 0;

    partial void OnApiUrlChanged(string value) => _settings.ApiBaseUrl = value.Trim();

    partial void OnModeChanged(PairingMode value) => Error = null;

    partial void OnPairingCodeChanged(string value)
    {
        var upper = value.ToUpperInvariant();
        if (upper != value) PairingCode = upper;
        Error = null;
    }

    [RelayCommand]
    private void ShowSignIn() => Mode = PairingMode.SignIn;

    [RelayCommand]
    private void ShowSignUp() => Mode = PairingMode.SignUp;

    [RelayCommand]
    private void ShowCode() => Mode = PairingMode.Code;

    [RelayCommand]
    private void ToggleAdvanced() => ShowAdvanced = !ShowAdvanced;

    [RelayCommand]
    private void Unpair() => Status.Unpair();

    // ─── Sign in with the owner's mobile number ───

    private bool CanSubmit() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanSubmit))]
    private async Task SignInAsync()
    {
        string login = Login.Trim();
        if (login.Length == 0 || Password.Length == 0)
        {
            Error = "Enter your shop's mobile number and password.";
            return;
        }
        await RunAsync(async () =>
        {
            var response = await _api.EnrollWithLoginAsync(new EnrollWithLoginRequest(
                login, Password, PcName(), AppVersion(), SelectedShop?.Id));
            await CompleteAsync(response, login, Password);
        }, ex =>
        {
            switch (ex.Code)
            {
                case ApiErrorCodes.LoginFailed or ApiErrorCodes.InvalidCredentials:
                    return "Wrong mobile number or password.";
                case ApiErrorCodes.MultipleShops:
                    ShopChoices.Clear();
                    foreach (var s in ex.DetailShops()) ShopChoices.Add(s);
                    SelectedShop = ShopChoices.FirstOrDefault();
                    OnPropertyChanged(nameof(HasShopChoices));
                    return "This number manages more than one shop. Choose the shop for this PC and sign in again.";
                default:
                    return null;
            }
        });
    }

    // ─── Create a new shop account ───

    [RelayCommand(CanExecute = nameof(CanSubmit))]
    private async Task SignUpAsync()
    {
        string phone = SignUpPhone.Trim();
        if (ShopName.Trim().Length < 2 || ShopAddress.Trim().Length < 2 || OwnerName.Trim().Length < 2)
        {
            Error = "Enter your shop name, shop address and your name.";
            return;
        }
        if (phone.Count(char.IsAsciiDigit) < 10)
        {
            Error = "Enter a 10-digit mobile number.";
            return;
        }
        if (SignUpPassword.Length < 8)
        {
            Error = "Choose a password of at least 8 characters.";
            return;
        }
        if (SignUpPassword != SignUpConfirm)
        {
            Error = "The two passwords don't match.";
            return;
        }
        string password = SignUpPassword;
        await RunAsync(async () =>
        {
            var response = await _api.SignupAsync(new ShopSignupRequest(
                ShopName.Trim(), ShopAddress.Trim(), OwnerName.Trim(), phone, password, PcName(), AppVersion()));
            await CompleteAsync(response, phone, password);
        }, ex =>
        {
            if (ex.Code != ApiErrorCodes.PhoneInUse) return null;
            Login = phone;
            Mode = PairingMode.SignIn;
            return $"{ex.Message} Sign in with this number instead.";
        });
    }

    // ─── Fallback: pairing code from Kaggaz support ───

    private bool CanPair() => !IsBusy && NormalizeCode(PairingCode).Length >= 8;

    [RelayCommand(CanExecute = nameof(CanPair))]
    private async Task PairAsync()
    {
        await RunAsync(async () =>
        {
            var response = await _api.EnrollAsync(new EnrollDeviceRequest(PairingCode.Trim(), PcName(), AppVersion()));
            Status.MarkPaired(response, _settings.ApiBaseUrl);
            PairingCode = string.Empty;
            DeviceName = response.Device.Name;
        }, ex => ex.Code switch
        {
            "ENROLLMENT_CODE_INVALID" => "This pairing code is invalid, expired or already used. Ask Kaggaz support for a new one.",
            "VALIDATION_FAILED" => "Check the pairing code and the PC name.",
            _ => null,
        });
    }

    /// <summary>Store the pairing, then sign the owner in with the same login so they land in the app.</summary>
    private async Task CompleteAsync(EnrollDeviceResponse response, string login, string password)
    {
        Status.MarkPaired(response, _settings.ApiBaseUrl);
        DeviceName = response.Device.Name;
        ShopChoices.Clear();
        SelectedShop = null;
        try
        {
            var op = await _api.OperatorLoginAsync(login, password);
            Status.ShowToast($"Welcome, {op.Operator.Name}", $"This PC is connected to {response.Shop.Name}.");
        }
        catch (ApiException)
        {
            Status.ShowToast($"Connected to {response.Shop.Name}", "Sign in to start taking orders.");
        }
    }

    /// <summary>Common busy/validation/error handling; <paramref name="specific"/> maps flow-specific codes.</summary>
    private async Task RunAsync(Func<Task> action, Func<ApiException, string?> specific)
    {
        if (!Uri.TryCreate(ApiUrl.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            Error = "The server address is not valid. Under Advanced, set it to https://api.kaggaz.in/api.";
            ShowAdvanced = true;
            return;
        }
        IsBusy = true;
        Error = null;
        try
        {
            await action();
        }
        catch (ApiException ex)
        {
            Error = specific(ex) ?? CommonError(ex);
        }
        finally
        {
            Password = SignUpPassword = SignUpConfirm = string.Empty;
            PasswordsCleared?.Invoke();
            IsBusy = false;
        }
    }

    public static string CommonError(ApiException ex) => ex.Code switch
    {
        ApiErrorCodes.NetworkError => "Can't reach Kaggaz. Check this PC's internet connection and try again.",
        ApiErrorCodes.RateLimited or "TOO_MANY_REQUESTS" or "TooManyRequests" => "Too many attempts. Please try again later.",
        ApiErrorCodes.AgentUpgradeRequired => "This version of Kaggaz Shop is too old. Install the latest version from kaggaz.in.",
        _ when ex.HttpStatus == 429 => "Too many attempts. Please try again later.",
        _ when ex.HttpStatus == 404 => "This isn't available on the Kaggaz server yet. Please contact Kaggaz support.",
        _ => ex.Message,
    };

    private string PcName() => DeviceName.Trim().Length > 0 ? DeviceName.Trim() : Environment.MachineName;

    private static string? AppVersion() => typeof(App).Assembly.GetName().Version?.ToString(3);

    private static string NormalizeCode(string? value) =>
        new((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());
}

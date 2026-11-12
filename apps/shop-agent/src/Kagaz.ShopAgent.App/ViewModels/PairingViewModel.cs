using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Pairing (P1.9, FR-SHOP-01): one-time enrollment code (+ API URL under Advanced) → device token, stored with DPAPI.
/// The shop is whatever the server binds the code to; this PC never chooses a shop id.
/// </summary>
public sealed partial class PairingViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly AgentSettings _settings;

    [ObservableProperty]
    private string _apiUrl;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(PairCommand))]
    private string _pairingCode = string.Empty;

    [ObservableProperty]
    private string _deviceName;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(PairCommand))]
    private bool _isPairing;

    [ObservableProperty]
    private string? _error;

    /// <summary>The server address is for Kaggaz support only; shopkeepers never need it.</summary>
    [ObservableProperty]
    private bool _showAdvanced;

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

    partial void OnApiUrlChanged(string value) => _settings.ApiBaseUrl = value.Trim();

    partial void OnPairingCodeChanged(string value)
    {
        var upper = value.ToUpperInvariant();
        if (upper != value) PairingCode = upper;
        Error = null;
    }

    private bool CanPair() => !IsPairing && NormalizeCode(PairingCode).Length >= 8;

    [RelayCommand(CanExecute = nameof(CanPair))]
    private async Task PairAsync()
    {
        IsPairing = true;
        Error = null;
        try
        {
            if (!Uri.TryCreate(ApiUrl.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            {
                Error = "The server address is not valid. Under Advanced, set it to https://api.kaggaz.in/api.";
                ShowAdvanced = true;
                return;
            }

            var response = await _api.EnrollAsync(new EnrollDeviceRequest(
                PairingCode.Trim(), DeviceName.Trim().Length > 0 ? DeviceName.Trim() : Environment.MachineName,
                typeof(App).Assembly.GetName().Version?.ToString(3)));

            Status.MarkPaired(response, _settings.ApiBaseUrl);
            PairingCode = string.Empty;
            DeviceName = response.Device.Name;
        }
        catch (ApiException ex)
        {
            Error = ex.Code switch
            {
                "ENROLLMENT_CODE_INVALID" => "This pairing code is invalid, expired or already used. Generate a new one in your Kaggaz dashboard.",
                "VALIDATION_FAILED" => "Check the pairing code and device name.",
                "NETWORK_ERROR" => "Can't reach the Kaggaz server. Check the address and your internet connection.",
                _ => ex.Message,
            };
        }
        finally
        {
            IsPairing = false;
        }
    }

    [RelayCommand]
    private void Unpair() => Status.Unpair();

    [RelayCommand]
    private void ToggleAdvanced() => ShowAdvanced = !ShowAdvanced;

    private static string NormalizeCode(string? value) =>
        new((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());
}

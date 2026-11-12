using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Operator sign-in after pairing (P2.3). Email/phone + password → operator token, kept in memory
/// only (<see cref="AgentSession"/>) — never written to disk, cleared on sign-out and app exit.
/// The account must belong to <em>this device's</em> shop; the server answers a wrong password and a
/// foreign-shop account identically (<c>401 INVALID_CREDENTIALS</c>).
/// </summary>
public sealed partial class OperatorLoginViewModel : ObservableObject
{
    private readonly ShopApiClient _api;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SignInCommand))]
    private string _login = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SignInCommand))]
    private string _password = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SignInCommand))]
    private bool _isSigningIn;

    [ObservableProperty]
    private string? _error;

    public OperatorLoginViewModel(ShopApiClient api, AppStatus status)
    {
        _api = api;
        Status = status;
    }

    public AppStatus Status { get; }

    /// <summary>The view clears its PasswordBox when this fires (after every attempt).</summary>
    public event Action? PasswordCleared;

    partial void OnLoginChanged(string value) => Error = null;

    partial void OnPasswordChanged(string value) => Error = null;

    private bool CanSignIn() => !IsSigningIn && Login.Trim().Length > 0 && Password.Length > 0;

    [RelayCommand(CanExecute = nameof(CanSignIn))]
    private async Task SignInAsync()
    {
        IsSigningIn = true;
        Error = null;
        try
        {
            var result = await _api.OperatorLoginAsync(Login.Trim(), Password);
            Status.ShowToast($"Signed in as {result.Operator.Name}");
        }
        catch (ApiException ex)
        {
            Error = MapError(ex);
        }
        finally
        {
            Password = string.Empty;
            PasswordCleared?.Invoke();
            IsSigningIn = false;
        }
    }

    public static string MapError(ApiException ex) => ex.Code switch
    {
        ApiErrorCodes.InvalidCredentials => "Wrong login or password, or this account isn't part of this shop.",
        ApiErrorCodes.RateLimited or "TOO_MANY_REQUESTS" or "TooManyRequests" => "Too many attempts. Wait a few minutes and try again.",
        ApiErrorCodes.NetworkError => "Can't reach the Kaggaz server. Check the internet connection.",
        ApiErrorCodes.DeviceRevoked => AppStatus.RevokedText,
        ApiErrorCodes.DeviceUnauthorized => "This PC is not paired with a shop.",
        ApiErrorCodes.AgentUpgradeRequired => "This version of Kaggaz Shop is too old. Update it to continue.",
        "VALIDATION_FAILED" => "Enter your email or phone number and password.",
        _ => ex.Message,
    };
}

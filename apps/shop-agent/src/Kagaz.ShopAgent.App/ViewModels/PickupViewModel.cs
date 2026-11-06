using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Verify Pickup (P1.10, A.5): 8-char input, auto-uppercase, strips spaces/dashes; the server does
/// the shop-scoped HMAC lookup and one-time consumption → COLLECTED.
/// </summary>
public sealed partial class PickupViewModel : ObservableObject
{
    public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private readonly ShopApiClient _api;
    private readonly AppStatus _status;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(VerifyCommand))]
    private string _code = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(VerifyCommand))]
    private bool _isVerifying;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private VerifyPickupResponse? _collected;

    public PickupViewModel(ShopApiClient api, AppStatus status)
    {
        _api = api;
        _status = status;
    }

    public string CollectedSummary => Collected is null
        ? string.Empty
        : $"{Collected.PageCount ?? 0} page{(Collected.PageCount == 1 ? "" : "s")} · {Collected.Options.Copies} cop{(Collected.Options.Copies == 1 ? "y" : "ies")} · {(Collected.Options.Colour ? "Colour" : "Black & white")}";

    partial void OnCollectedChanged(VerifyPickupResponse? value) => OnPropertyChanged(nameof(CollectedSummary));

    partial void OnCodeChanged(string value)
    {
        // Keep what the operator typed readable (dashes allowed) but uppercase it.
        var upper = value.ToUpperInvariant();
        if (upper != value)
        {
            Code = upper;
            return;
        }
        Error = null;
        if (value.Length > 0) Collected = null;
    }

    /// <summary>Uppercase and remove spaces/dashes (same rule as the server).</summary>
    public static string Normalize(string? value) =>
        new string((value ?? string.Empty).Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray()).ToUpperInvariant();

    public static bool IsWellFormed(string normalized) =>
        normalized.Length == 8 && normalized.All(c => Alphabet.Contains(c));

    private bool CanVerify() => !IsVerifying && Normalize(Code).Length == 8;

    [RelayCommand(CanExecute = nameof(CanVerify))]
    private async Task VerifyAsync()
    {
        var normalized = Normalize(Code);
        if (!IsWellFormed(normalized))
        {
            Error = "That isn't a valid pickup code. Codes use letters and numbers without O, 0, I or 1.";
            return;
        }

        IsVerifying = true;
        Error = null;
        try
        {
            Collected = await _api.VerifyPickupAsync(normalized);
            Code = string.Empty;
            _status.ShowToast($"{Collected.PublicRef} collected", "Hand the stack to the customer.");
        }
        catch (ApiException ex)
        {
            Collected = null;
            Error = ex.Code switch
            {
                "PICKUP_CODE_INVALID" => "No order at this shop matches this code.",
                "PICKUP_ALREADY_USED" => $"Already collected. {ex.Message}.",
                "ORDER_NOT_READY" => $"Not ready yet: {ex.Message}. Mark it ready first.",
                "RATE_LIMITED" or "TOO_MANY_REQUESTS" => "Too many attempts. Wait a minute and try again.",
                _ => ex.Message,
            };
        }
        finally
        {
            IsVerifying = false;
        }
    }

    [RelayCommand]
    private void Clear()
    {
        Code = string.Empty;
        Error = null;
        Collected = null;
    }
}

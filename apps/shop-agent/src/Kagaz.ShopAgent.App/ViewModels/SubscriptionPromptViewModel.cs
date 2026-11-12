using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// When the "Get a Kaggaz subscription" sheet is open (pure; unit tested). It opens whenever the shop
/// enters an inactive state (NONE/EXPIRED — including ACTIVE → EXPIRED while the app runs) or a call
/// answers SUBSCRIPTION_INACTIVE; "Close" hides it for that state for this app session; ACTIVE closes it.
/// </summary>
public sealed class SubscriptionPromptState
{
    private string? _last;
    private bool _dismissed;

    public bool IsOpen { get; private set; }

    public static bool IsInactive(string? status) => status is "NONE" or "EXPIRED";

    /// <summary>Feed every heartbeat's subscription status (null = server doesn't report billing).</summary>
    public void Observe(string? status)
    {
        if (!IsInactive(status))
        {
            IsOpen = false;
            _dismissed = false;
        }
        else
        {
            if (status != _last) _dismissed = false; // a new inactive state always asks again
            if (!_dismissed) IsOpen = true;
        }
        _last = status;
    }

    /// <summary>An order/printer call returned SUBSCRIPTION_INACTIVE: ask now, even if dismissed before.</summary>
    public void ForceOpen()
    {
        _dismissed = false;
        IsOpen = true;
    }

    public void Dismiss()
    {
        _dismissed = true;
        IsOpen = false;
    }
}

/// <summary>The subscription sheet: plan pitch + Kaggaz contact (from /config, never hardcoded).</summary>
public sealed partial class SubscriptionPromptViewModel : ObservableObject
{
    private readonly SubscriptionPromptState _state = new();

    [ObservableProperty]
    private bool _isOpen;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Title), nameof(EndedText))]
    private HeartbeatSubscription? _subscription;

    public SubscriptionPromptViewModel(SupportViewModel support) => Support = support;

    public SupportViewModel Support { get; }

    public string Title => Subscription?.Status == "EXPIRED" ? "Renew your subscription" : "Start taking orders";

    public string? EndedText => Subscription?.Status == "EXPIRED" && BillingText.FormatDate(Subscription.PeriodEnd) is { } d
        ? $"Your subscription ended on {d}. New orders are paused until it's renewed."
        : null;

    public string Body => "Kaggaz is billed per connected printer. Call or WhatsApp us to choose a plan — we'll activate it right away.";

    /// <summary>Online purchase (Razorpay) isn't connected yet; flip this and add PurchaseOnlineCommand then.</summary>
    public bool CanPurchaseOnline => false;

    public void Observe(HeartbeatSubscription? subscription)
    {
        Subscription = subscription;
        _state.Observe(subscription?.Status);
        IsOpen = _state.IsOpen;
    }

    public void ForceOpen()
    {
        _state.ForceOpen();
        IsOpen = true;
    }

    [RelayCommand]
    private void Dismiss()
    {
        _state.Dismiss();
        IsOpen = false;
    }
}

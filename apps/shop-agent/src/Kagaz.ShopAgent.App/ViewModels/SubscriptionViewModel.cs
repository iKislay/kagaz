using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// "Start taking orders" / "Renew your subscription": fills the window while the shop has no active
/// subscription (see <see cref="AppGates"/>). Printing of jobs already accepted carries on in the
/// background. Kaggaz's contact comes from the server's /config, never hardcoded.
/// </summary>
public sealed partial class SubscriptionViewModel : ObservableObject
{
    private readonly AgentSignals _signals;

    public SubscriptionViewModel(AppStatus status, SupportViewModel support, AgentSignals signals)
    {
        Status = status;
        Support = support;
        _signals = signals;
        status.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName != nameof(AppStatus.Subscription)) return;
            OnPropertyChanged(nameof(Title));
            OnPropertyChanged(nameof(EndedText));
        };
        // A call refused for billing: ask the server now so the window reflects it without waiting for the next beat.
        status.Session.SubscriptionInactive += signals.Heartbeat.Pulse;
    }

    public AppStatus Status { get; }
    public SupportViewModel Support { get; }

    public string Title => Status.Subscription?.Status == "EXPIRED" ? "Renew your subscription" : "Start taking orders";

    public string? EndedText => Status.Subscription is { Status: "EXPIRED", PeriodEnd: var end } && BillingText.FormatDate(end) is { } d
        ? $"Your subscription ended on {d}. New orders are paused until it's renewed."
        : null;

    public string Body =>
        "Kaggaz is billed per connected printer. Call or WhatsApp us to choose a plan and we'll activate it right away. " +
        "This screen closes by itself once your subscription is active.";

    /// <summary>Re-check with the server now (the heartbeat brings the subscription state).</summary>
    [RelayCommand]
    private void CheckAgain()
    {
        _signals.Heartbeat.Pulse();
        Status.ShowToast("Checking your subscription…");
    }
}

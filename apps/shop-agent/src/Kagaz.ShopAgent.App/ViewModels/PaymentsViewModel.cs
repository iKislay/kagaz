using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>Status colours (CLAUDE.md design tokens, status only).</summary>
public enum StatusTone
{
    Grey,
    Red,
    Orange,
    Green,
}

/// <summary>ADR-003 contract: <c>readiness</c> → the one status line + dot colour.</summary>
public static class PaymentReadinessDisplay
{
    public static (string Text, StatusTone Tone) For(string? readiness) => readiness switch
    {
        ShopPaymentReadiness.NotRequired => ("Demo payments — nothing to set up", StatusTone.Grey),
        ShopPaymentReadiness.NeedsUpiId => ("Add your UPI ID so customers can pay you", StatusTone.Red),
        ShopPaymentReadiness.NeedsPhone => ("Connect your phone to confirm payments automatically", StatusTone.Orange),
        ShopPaymentReadiness.PhoneOffline => ("Your payments phone is offline — check internet / battery", StatusTone.Orange),
        ShopPaymentReadiness.Ready => ("Payments are confirmed automatically", StatusTone.Green),
        null => ("Checking your payment setup…", StatusTone.Grey),
        _ => ("Payment setup status unknown", StatusTone.Grey),
    };
}

/// <summary>Money, times and "last seen" for the Payments page (en-IN, Asia/Kolkata).</summary>
public static class PaymentDisplay
{
    private static readonly CultureInfo India = new("en-IN");

    /// <summary>
    /// Integer paise → "₹1,234.50" (en-IN grouping; no space after ₹, the same text the customer saw on
    /// the website — ICU's "C" format adds one on some machines).
    /// </summary>
    public static string Money(int paise) => "₹" + (paise / 100m).ToString("N2", India);

    public static DateTimeOffset? Parse(string? iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t : null;

    /// <summary>"7 Nov, 4:10 PM" in Asia/Kolkata.</summary>
    public static string Time(string? iso) =>
        Parse(iso) is { } t ? TimeZoneInfo.ConvertTime(t, IndiaTime.Zone).ToString("d MMM, h:mm tt", India) : "—";

    /// <summary>"just now", "5 min ago", "3 h ago", else the date and time.</summary>
    public static string Ago(DateTimeOffset at, DateTimeOffset now)
    {
        var age = now - at;
        if (age < TimeSpan.FromMinutes(1)) return "just now";
        if (age < TimeSpan.FromHours(1)) return $"{(int)age.TotalMinutes} min ago";
        if (age < TimeSpan.FromHours(24)) return $"{(int)age.TotalHours} h ago";
        return TimeZoneInfo.ConvertTime(at, IndiaTime.Zone).ToString("d MMM, h:mm tt", India);
    }

    public static string LastSeen(ObserverPhone phone, DateTimeOffset now)
    {
        if (phone.Online) return "Online";
        return Parse(phone.LastSeenAt) is { } seen ? $"Offline · last seen {Ago(seen, now)}" : "Not connected yet";
    }

    /// <summary>"Customer phone ••• 4321", or null when unknown.</summary>
    public static string? Phone(string? last4) => string.IsNullOrWhiteSpace(last4) ? null : $"Customer phone ••• {last4}";
}

/// <summary>A paired payments phone.</summary>
public sealed record PhoneItem(string Name, bool Online, string LastSeenText, string? LastPaymentText)
{
    public StatusTone Tone => Online ? StatusTone.Green : StatusTone.Orange;

    public static PhoneItem From(ObserverPhone phone, DateTimeOffset now) => new(
        string.IsNullOrWhiteSpace(phone.Name) ? "Phone" : phone.Name,
        phone.Online,
        PaymentDisplay.LastSeen(phone, now),
        PaymentDisplay.Parse(phone.LastPaymentSeenAt) is { } p ? $"Last payment seen {PaymentDisplay.Ago(p, now)}" : null);
}

/// <summary>A customer's "I paid" report, waiting for the shop to check its UPI app.</summary>
public sealed class PaymentReportItem
{
    public PaymentReportItem(ShopPaymentReport report) => Report = report;

    public ShopPaymentReport Report { get; }
    public string Id => Report.Id;
    public string PublicRef => Report.PublicRef;
    /// <summary>The full UTR (what the copy button copies).</summary>
    public string Utr => Report.Utr;
    /// <summary>"1234 5678 9012" — the same grouping most UPI apps show.</summary>
    public string DisplayUtr => UpiFormat.GroupUtr(Report.Utr);
    public string DisplayAmount => PaymentDisplay.Money(Report.AmountPaise);
    public string DisplayTime => PaymentDisplay.Time(Report.CreatedAt);
    public string? DisplayPhone => PaymentDisplay.Phone(Report.CustomerPhoneLast4);
    public string ApproveLabel => $"Approve — I received {DisplayAmount}";

    public override string ToString() => PublicRef;
}

/// <summary>A refund the shop must send back from its own UPI app.</summary>
public sealed class RefundItem
{
    public RefundItem(ShopManualRefund refund) => Refund = refund;

    public ShopManualRefund Refund { get; }
    public string RefundId => Refund.RefundId;
    public string PublicRef => Refund.PublicRef;
    public string DisplayAmount => PaymentDisplay.Money(Refund.AmountPaise);
    public string? DisplayPaymentReference => Refund.PaymentReference is { Length: > 0 } r ? UpiFormat.GroupUtr(r) : null;
    public string? DisplayPhone => PaymentDisplay.Phone(Refund.CustomerPhoneLast4);
    public string? Reason => string.IsNullOrWhiteSpace(Refund.Reason) ? null : Refund.Reason;
    public string DisplayTime => PaymentDisplay.Time(Refund.CreatedAt);

    public override string ToString() => PublicRef;
}

public sealed record DeclineReasonOption(string Code, string Label)
{
    public override string ToString() => Label;
}

/// <summary>
/// Payments page (ADR-003): direct-to-shop UPI setup in two steps — (1) UPI ID + the name customers see,
/// (2) scan a QR with the phone that gets the shop's UPI alerts — plus the two things that need the
/// shopkeeper: customers' "I paid" reports (approve / decline after checking the UPI app) and refunds
/// to send by hand. Reports and refunds are polled every 30 s (and woken by the
/// <c>payment_report.changed</c> socket hint) so the sidebar badge works on every page; the setup is
/// refreshed every 15 s while the page is open so the phone dot turns green right after pairing.
/// Runs on the UI thread (awaits resume there).
/// </summary>
public sealed partial class PaymentsViewModel : ObservableObject
{
    public static readonly TimeSpan ReportsPollInterval = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan SetupPollInterval = TimeSpan.FromSeconds(15);

    private readonly ShopApiClient _api;
    private readonly AppStatus _status;
    private readonly AgentSignals _signals;
    private readonly Func<string?, ImageSource?> _renderQr;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Action<string> _copy;
    private readonly WakeSignal _pageShown = new();

    private bool _applyingServer;
    private bool _step1Dirty;
    private string? _appDownloadUrl;
    private DateTimeOffset _pairingExpiresAt;
    private int _pairingVersion;
    private HashSet<string> _phoneIdsAtPairing = new();
    private HashSet<string>? _knownReports;
    private string _sheetKey = Guid.NewGuid().ToString();

    /// <param name="renderQr">QR renderer (tests pass a fake); defaults to <see cref="QrCodeRenderer.Render"/>.</param>
    /// <param name="clock">Clock for the pairing countdown and "last seen" (tests pass a fixed one).</param>
    /// <param name="copy">Clipboard writer (tests pass a fake).</param>
    public PaymentsViewModel(ShopApiClient api, AppStatus status, AgentSignals signals,
        Func<string?, ImageSource?>? renderQr = null, Func<DateTimeOffset>? clock = null, Action<string>? copy = null)
    {
        _api = api;
        _status = status;
        _signals = signals;
        _renderQr = renderQr ?? QrCodeRenderer.Render;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _copy = copy ?? CopyToClipboard;
        status.Unpaired += Clear;
    }

    // ─── Status line ───

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(StatusText), nameof(StatusTone), nameof(IsSetupVisible))]
    private string? _readiness;

    [ObservableProperty]
    private string? _setupError;

    public string StatusText => PaymentReadinessDisplay.For(Readiness).Text;
    public StatusTone StatusTone => PaymentReadinessDisplay.For(Readiness).Tone;

    /// <summary>The two setup steps; hidden for demo payments (nothing to set up) and before the first answer.</summary>
    public bool IsSetupVisible => Readiness is not null && Readiness != ShopPaymentReadiness.NotRequired;

    /// <summary>True while the Payments page is on screen (set by the shell): the setup refreshes every 15 s.</summary>
    [ObservableProperty]
    private bool _isActive;

    partial void OnIsActiveChanged(bool value)
    {
        if (value) _pageShown.Pulse();
    }

    // ─── Step 1: UPI ID + name ───

    [ObservableProperty]
    private string _upiId = string.Empty;

    [ObservableProperty]
    private string _payeeName = string.Empty;

    [ObservableProperty]
    private string? _upiIdError;

    [ObservableProperty]
    private string? _payeeNameError;

    [ObservableProperty]
    private string? _step1Message;

    /// <summary>The UPI ID the server has; step 2 needs it.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Step1Done), nameof(Step2Hint))]
    [NotifyCanExecuteChangedFor(nameof(ShowPairingCommand))]
    private string? _savedUpiId;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveSetupCommand))]
    private bool _isSaving;

    public bool Step1Done => !string.IsNullOrEmpty(SavedUpiId);

    partial void OnUpiIdChanged(string value)
    {
        if (_applyingServer) return;
        _step1Dirty = true;
        UpiIdError = null;
        Step1Message = null;
    }

    partial void OnPayeeNameChanged(string value)
    {
        if (_applyingServer) return;
        _step1Dirty = true;
        PayeeNameError = null;
        Step1Message = null;
    }

    private bool CanSaveSetup() => !IsSaving;

    [RelayCommand(CanExecute = nameof(CanSaveSetup))]
    private async Task SaveSetupAsync()
    {
        UpiIdError = UpiFormat.ValidateUpiId(UpiId);
        PayeeNameError = UpiFormat.ValidatePayeeName(PayeeName);
        Step1Message = null;
        if (UpiIdError is not null || PayeeNameError is not null) return;

        IsSaving = true;
        try
        {
            var request = new UpdateShopPaymentSetupRequest(UpiFormat.NormalizeUpiId(UpiId), PayeeName.Trim());
            var setup = await _api.UpdatePaymentSetupAsync(request, idempotencyKey: Guid.NewGuid().ToString());
            _step1Dirty = false;
            ApplySetup(setup);
            _status.ShowToast("UPI ID saved", Step1Done && setup.Readiness == ShopPaymentReadiness.NeedsPhone
                ? "Next: connect your phone (step 2)."
                : null);
        }
        catch (ApiException ex)
        {
            Step1Message = Friendly(ex);
        }
        finally
        {
            IsSaving = false;
        }
    }

    // ─── Step 2: connect the phone ───

    /// <summary>QR A: install the detector app.</summary>
    [ObservableProperty]
    private ImageSource? _appDownloadQr;

    /// <summary>QR B: scan inside the app (short-lived enrollment secret).</summary>
    [ObservableProperty]
    private ImageSource? _pairingQr;

    /// <summary>The pairing area shows a code (or its "expired" placeholder).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PairingButtonText))]
    private bool _isPairingShown;

    [ObservableProperty]
    private bool _pairingExpired;

    [ObservableProperty]
    private string? _pairingCountdown;

    [ObservableProperty]
    private string? _pairingError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ShowPairingCommand))]
    private bool _isPairing;

    public string PairingButtonText => IsPairingShown ? "New code" : "Show pairing code";

    public string Step2Hint => Step1Done
        ? "Open the app on that phone and scan this code. It works for 10 minutes."
        : "Save your UPI ID first (step 1).";

    public ObservableCollection<PhoneItem> Phones { get; } = new();

    public bool HasPhones => Phones.Count > 0;

    private bool CanShowPairing() => !IsPairing && Step1Done;

    [RelayCommand(CanExecute = nameof(CanShowPairing))]
    private async Task ShowPairingAsync()
    {
        IsPairing = true;
        PairingError = null;
        try
        {
            var pairing = await _api.CreatePhonePairingAsync(idempotencyKey: Guid.NewGuid().ToString());
            _pairingExpiresAt = PaymentDisplay.Parse(pairing.ExpiresAt) ?? _clock().AddMinutes(10);
            _phoneIdsAtPairing = CurrentPhoneIds;
            PairingQr = _renderQr(pairing.QrText);
            PairingExpired = false;
            IsPairingShown = true;
            var version = ++_pairingVersion;
            Tick();
            _ = CountdownAsync(version);
        }
        catch (ApiException ex)
        {
            PairingError = Friendly(ex);
        }
        finally
        {
            IsPairing = false;
        }
    }

    /// <summary>Updates the "valid for m:ss" text; drops the code once it has expired. Public for tests.</summary>
    public void Tick()
    {
        if (!IsPairingShown || PairingExpired) return;
        var left = _pairingExpiresAt - _clock();
        if (left <= TimeSpan.Zero)
        {
            PairingQr = null;
            PairingExpired = true;
            PairingCountdown = "This code has expired. Get a new one.";
            return;
        }
        PairingCountdown = $"Valid for {(int)left.TotalMinutes}:{left.Seconds:00}";
    }

    private async Task CountdownAsync(int version)
    {
        while (version == _pairingVersion && IsPairingShown && !PairingExpired)
        {
            await Task.Delay(TimeSpan.FromSeconds(1));
            if (version != _pairingVersion) return;
            Tick();
        }
    }

    private void HidePairing()
    {
        _pairingVersion++;
        PairingQr = null;
        IsPairingShown = false;
        PairingExpired = false;
        PairingCountdown = null;
    }

    private HashSet<string> CurrentPhoneIds => _lastPhones.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);

    private List<ObserverPhone> _lastPhones = new();

    // ─── Setup refresh ───

    /// <summary><c>GET /shop/payments/setup</c>.</summary>
    [RelayCommand]
    public async Task LoadSetupAsync()
    {
        if (!_status.IsPaired) return;
        try
        {
            ApplySetup(await _api.GetPaymentSetupAsync());
            SetupError = null;
        }
        catch (ApiException ex)
        {
            SetupError = ex.HttpStatus == 404
                ? "This server does not support UPI payments yet."
                : $"Could not load your payment setup. {Friendly(ex)}";
        }
    }

    public void ApplySetup(ShopPaymentSetup setup)
    {
        Readiness = setup.Readiness;
        SavedUpiId = setup.UpiId;
        if (!_step1Dirty)
        {
            _applyingServer = true;
            try
            {
                UpiId = setup.UpiId ?? string.Empty;
                // Most shops want their shop name; pre-fill it so step 1 is one field.
                PayeeName = setup.PayeeName ?? _status.ShopName ?? string.Empty;
            }
            finally
            {
                _applyingServer = false;
            }
        }

        if (setup.AppDownloadUrl != _appDownloadUrl)
        {
            _appDownloadUrl = setup.AppDownloadUrl;
            AppDownloadQr = _renderQr(setup.AppDownloadUrl);
        }

        var phones = setup.Phones ?? new();
        _lastPhones = phones;
        var now = _clock();
        Phones.Clear();
        foreach (var phone in phones) Phones.Add(PhoneItem.From(phone, now));
        OnPropertyChanged(nameof(HasPhones));

        // A new phone reported in while the pairing code was on screen: done.
        if (IsPairingShown && phones.Any(p => !_phoneIdsAtPairing.Contains(p.Id)))
        {
            HidePairing();
            _status.ShowToast("Phone connected", "Payments will be confirmed automatically.");
        }
    }

    // ─── Payment reports ("I paid but it isn't confirmed") ───

    public ObservableCollection<PaymentReportItem> Reports { get; } = new();

    public ObservableCollection<RefundItem> Refunds { get; } = new();

    public int OpenReportCount => Reports.Count;
    public int RefundCount => Refunds.Count;
    public bool HasReports => Reports.Count > 0;
    public bool HasRefunds => Refunds.Count > 0;

    /// <summary>Sidebar badge: things waiting for the shopkeeper.</summary>
    public int BadgeCount => Reports.Count + Refunds.Count;

    /// <summary>Window notice ("2 customers say they paid — check your UPI app"), or null.</summary>
    public string? AttentionText
    {
        get
        {
            var parts = new List<string>();
            if (Reports.Count == 1) parts.Add("1 customer says they paid — check your UPI app");
            else if (Reports.Count > 1) parts.Add($"{Reports.Count} customers say they paid — check your UPI app");
            if (Refunds.Count == 1) parts.Add("1 refund to send");
            else if (Refunds.Count > 1) parts.Add($"{Refunds.Count} refunds to send");
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }
    }

    [ObservableProperty]
    private string? _reportsError;

    /// <summary>Open reports + pending manual refunds. Failures keep the last list (safety poll retries).</summary>
    [RelayCommand]
    public async Task RefreshReportsAsync()
    {
        if (!_status.IsPaired) return;
        try
        {
            var reports = await _api.ListPaymentReportsAsync(PaymentReportStatus.Open);
            ApplyReports(reports);
            ReportsError = null;
        }
        catch (ApiException ex) when (ex.HttpStatus == 404)
        {
            ApplyReports([]); // older API: no UPI payments
        }
        catch (ApiException ex)
        {
            ReportsError = ex.Message;
        }

        try
        {
            ApplyRefunds(await _api.ListManualRefundsAsync());
        }
        catch (ApiException ex) when (ex.HttpStatus == 404)
        {
            ApplyRefunds([]);
        }
        catch (ApiException)
        {
            // Keep the last list; the next poll retries.
        }
    }

    private void ApplyReports(IEnumerable<ShopPaymentReport> reports)
    {
        var open = reports.Where(r => r.Status == PaymentReportStatus.Open)
            .OrderBy(r => PaymentDisplay.Parse(r.CreatedAt) ?? DateTimeOffset.MaxValue)
            .ToList();
        var ids = open.Select(r => r.Id).ToHashSet(StringComparer.Ordinal);
        if (_knownReports is not null)
        {
            var fresh = open.Where(r => !_knownReports.Contains(r.Id)).ToList();
            if (fresh.Count > 0)
            {
                _status.ShowToast(fresh.Count == 1 ? "A customer says they paid" : $"{fresh.Count} customers say they paid",
                    "Check your UPI app, then approve or decline in Payments.", warning: true);
                try { System.Media.SystemSounds.Asterisk.Play(); } catch (InvalidOperationException) { }
            }
        }
        _knownReports = ids;

        Reports.Clear();
        foreach (var report in open) Reports.Add(new PaymentReportItem(report));
        NotifyCounts();
    }

    private void ApplyRefunds(IEnumerable<ShopManualRefund> refunds)
    {
        Refunds.Clear();
        foreach (var refund in refunds.OrderBy(r => PaymentDisplay.Parse(r.CreatedAt) ?? DateTimeOffset.MaxValue))
        {
            Refunds.Add(new RefundItem(refund));
        }
        NotifyCounts();
    }

    private void NotifyCounts()
    {
        OnPropertyChanged(nameof(OpenReportCount));
        OnPropertyChanged(nameof(RefundCount));
        OnPropertyChanged(nameof(HasReports));
        OnPropertyChanged(nameof(HasRefunds));
        OnPropertyChanged(nameof(BadgeCount));
        OnPropertyChanged(nameof(AttentionText));
    }

    [RelayCommand]
    private void CopyUtr(PaymentReportItem? item)
    {
        if (item is null) return;
        _copy(item.Utr);
        _status.ShowToast("Reference copied", item.DisplayUtr);
    }

    // ─── Sheets: approve / decline / refund sent ───

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsApproveOpen))]
    [NotifyCanExecuteChangedFor(nameof(ConfirmApproveCommand))]
    private PaymentReportItem? _approveTarget;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsDeclineOpen))]
    [NotifyCanExecuteChangedFor(nameof(SubmitDeclineCommand))]
    private PaymentReportItem? _declineTarget;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitDeclineCommand))]
    private DeclineReasonOption? _selectedDeclineReason;

    [ObservableProperty]
    private string? _declineNote;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsRefundOpen))]
    [NotifyCanExecuteChangedFor(nameof(SubmitRefundCommand))]
    private RefundItem? _refundTarget;

    [ObservableProperty]
    private string? _refundUtr;

    [ObservableProperty]
    private string? _refundUtrError;

    [ObservableProperty]
    private string? _sheetError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ConfirmApproveCommand), nameof(SubmitDeclineCommand), nameof(SubmitRefundCommand))]
    private bool _isBusy;

    public bool IsApproveOpen => ApproveTarget is not null;
    public bool IsDeclineOpen => DeclineTarget is not null;
    public bool IsRefundOpen => RefundTarget is not null;

    public IReadOnlyList<DeclineReasonOption> DeclineReasons { get; } =
    [
        new(DeclineReason.NotReceived, "Not received — I can't find this payment"),
        new(DeclineReason.WrongAmount, "Wrong amount"),
        new(DeclineReason.WrongReference, "Wrong reference number"),
        new(DeclineReason.Other, "Other"),
    ];

    [RelayCommand]
    private void OpenApprove(PaymentReportItem? item)
    {
        if (item is null) return;
        OpenSheet();
        ApproveTarget = item;
    }

    [RelayCommand]
    private void OpenDecline(PaymentReportItem? item)
    {
        if (item is null) return;
        OpenSheet();
        SelectedDeclineReason = null;
        DeclineNote = null;
        DeclineTarget = item;
    }

    [RelayCommand]
    private void OpenRefund(RefundItem? item)
    {
        if (item is null) return;
        OpenSheet();
        RefundUtr = null;
        RefundUtrError = null;
        RefundTarget = item;
    }

    [RelayCommand]
    private void CancelSheet()
    {
        ApproveTarget = null;
        DeclineTarget = null;
        RefundTarget = null;
        SheetError = null;
    }

    private bool CanConfirmApprove() => !IsBusy && ApproveTarget is not null;

    /// <summary>Approve: the order becomes paid (pickup number, job enters the queue) — operator action, audited.</summary>
    [RelayCommand(CanExecute = nameof(CanConfirmApprove))]
    private async Task ConfirmApproveAsync()
    {
        var item = ApproveTarget!;
        await RunSheetActionAsync(async () =>
        {
            await _api.ApprovePaymentReportAsync(item.Id, _sheetKey);
            _status.ShowToast($"Payment approved · {item.PublicRef}", "The order is paid and its job is in your queue.");
            _signals.Jobs.Pulse();
        });
    }

    private bool CanSubmitDecline() => !IsBusy && DeclineTarget is not null && SelectedDeclineReason is not null;

    [RelayCommand(CanExecute = nameof(CanSubmitDecline))]
    private async Task SubmitDeclineAsync()
    {
        var item = DeclineTarget!;
        var reason = SelectedDeclineReason!.Code;
        var note = string.IsNullOrWhiteSpace(DeclineNote) ? null : DeclineNote.Trim();
        if (note is { Length: > 200 }) note = note[..200];
        await RunSheetActionAsync(async () =>
        {
            await _api.DeclinePaymentReportAsync(item.Id, new DeclinePaymentReportRequest(reason, note), _sheetKey);
            _status.ShowToast($"Payment report declined · {item.PublicRef}", "The customer will see why on their order page.");
        });
    }

    private bool CanSubmitRefund() => !IsBusy && RefundTarget is not null;

    [RelayCommand(CanExecute = nameof(CanSubmitRefund))]
    private async Task SubmitRefundAsync()
    {
        var item = RefundTarget!;
        string? utr = null;
        if (!string.IsNullOrWhiteSpace(RefundUtr))
        {
            if (!UpiFormat.IsValidUtr(RefundUtr))
            {
                RefundUtrError = UpiFormat.UtrMessage;
                return;
            }
            utr = UpiFormat.NormalizeUtr(RefundUtr);
        }
        RefundUtrError = null;
        await RunSheetActionAsync(async () =>
        {
            await _api.ConfirmManualRefundAsync(item.RefundId, new ConfirmManualRefundRequest(utr), _sheetKey);
            _status.ShowToast($"Refund recorded · {item.PublicRef}", $"{item.DisplayAmount} sent back to the customer.");
        });
    }

    private void OpenSheet()
    {
        CancelSheet();
        _sheetKey = Guid.NewGuid().ToString(); // one key per opened sheet: a double click can't act twice
    }

    private async Task RunSheetActionAsync(Func<Task> action)
    {
        IsBusy = true;
        SheetError = null;
        try
        {
            await action();
            CancelSheet();
        }
        catch (ApiException ex) when (ex.Code == ApiErrorCodes.PaymentReportNotOpen)
        {
            CancelSheet();
            _status.ShowToast("Already handled", "This payment report was already approved, declined or confirmed automatically.", warning: true);
        }
        catch (ApiException ex)
        {
            SheetError = Friendly(ex);
        }
        finally
        {
            IsBusy = false;
        }
        await RefreshReportsAsync();
    }

    // ─── Loops ───

    /// <summary>
    /// Background refresh, started on the UI thread at app start; ends when <paramref name="ct"/> is cancelled.
    /// Reports + refunds: every 30 s or on the socket hint. Setup: every 15 s while the page is open.
    /// </summary>
    public Task RunAsync(CancellationToken ct) => Task.WhenAll(ReportsLoopAsync(ct), SetupLoopAsync(ct));

    private async Task ReportsLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await RefreshReportsAsync();
            try { await _signals.PaymentReports.WaitAsync(ReportsPollInterval, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private async Task SetupLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (IsActive) await LoadSetupAsync();
            try { await _pageShown.WaitAsync(SetupPollInterval, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private void Clear()
    {
        HidePairing();
        CancelSheet();
        Readiness = null;
        SavedUpiId = null;
        _step1Dirty = false;
        _knownReports = null;
        _lastPhones = new();
        Phones.Clear();
        Reports.Clear();
        Refunds.Clear();
        OnPropertyChanged(nameof(HasPhones));
        NotifyCounts();
    }

    /// <summary>Plain-language error for the shopkeeper.</summary>
    public static string Friendly(ApiException ex) => ex.Code switch
    {
        ApiErrorCodes.OperatorLoginRequired => "Please sign in again and retry.",
        ApiErrorCodes.PaymentProviderUnavailable => "Could not reach the payment service. Check the internet and try again in a minute.",
        ApiErrorCodes.PaymentSetupRequired => "Save your UPI ID first (step 1).",
        ApiErrorCodes.PaymentReportNotOpen => "This payment report was already handled.",
        _ => ex.Message,
    };

    private static void CopyToClipboard(string text)
    {
        try { System.Windows.Clipboard.SetText(text); }
        catch (System.Runtime.InteropServices.ExternalException) { /* clipboard busy; the UTR is on screen */ }
    }
}

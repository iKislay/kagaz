using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>One order as the operator sees it (no customer phone number — the API never sends it).</summary>
public sealed partial class JobItem : ObservableObject
{
    private static readonly CultureInfo India = new("en-IN");
    private static readonly TimeZoneInfo Kolkata = FindKolkata();

    private readonly DateOnly _today;

    /// <param name="today">Today's business date in Asia/Kolkata (tests pass a fixed one).</param>
    public JobItem(ShopJob shopJob, DateOnly? today = null)
    {
        ShopJob = shopJob;
        _today = today ?? PickupLabel.Today();
    }

    public ShopJob ShopJob { get; }

    /// <summary>Live spooler status from this PC's monitor ("Printing page 2 of 5", "Printer is out of paper").</summary>
    [ObservableProperty]
    private string? _liveStatus;

    public string OrderId => ShopJob.OrderId;
    public string PublicRef => ShopJob.PublicRef;
    public string Status => ShopJob.Status;
    public ShopPrintOptions Options => ShopJob.Options;
    public ShopPrintJob? PrintJob => ShopJob.PrintJob;

    /// <summary>ADR-003: the customer pays <see cref="DisplayAmount"/> at the counter on pickup.</summary>
    public bool PayAtCounter => ShopJob.PayAtCounter;
    public string DisplayCollect => $"Collect {DisplayAmount} at the counter";
    public string DisplayOrderedLine => PayAtCounter ? $"Ordered {DisplayPaidAt}" : $"Paid {DisplayPaidAt}";

    public string DisplayAmount => ShopJob.AmountPaise is int paise
        ? (paise / 100m).ToString("C", India)
        : "—";

    public string DisplayPages => ShopJob.PageCount is int pages ? $"{pages} page{(pages == 1 ? "" : "s")}" : "—";
    public string DisplayCopies => $"{Options.Copies} cop{(Options.Copies == 1 ? "y" : "ies")}";
    public string DisplayMode => Options.Colour ? "Colour" : "Black & white";
    public string DisplaySides => Options.Duplex ? "Double-sided" : "Single-sided";
    public string DisplayRange => string.IsNullOrWhiteSpace(Options.PageRange) ? "All pages" : $"Pages {Options.PageRange}";
    public string DisplayPrintedSides => ShopJob.PrintedSides is int sides ? $"{sides} printed sides" : "—";
    public string Summary => $"{DisplayPages} · {DisplayCopies} · {DisplayMode} · {DisplaySides}";

    public string DisplayPaidAt => FormatTime(ShopJob.PaidAt ?? ShopJob.CreatedAt);

    // ─── Pickup number (ADR-002) ───

    public int? PickupNumber => ShopJob.PickupNumber;
    public bool HasPickupNumber => ShopJob.PickupNumber is not null;

    /// <summary>Business date of the pickup number; falls back to the paid date in Asia/Kolkata.</summary>
    public DateOnly? PickupDate => PickupLabel.ParseDate(ShopJob.PickupDate) ?? PickupLabel.KolkataDate(ShopJob.PaidAt);

    public bool IsToday => PickupDate == _today;

    /// <summary>"#7" — the big number on the row and in the detail pane.</summary>
    public string DisplayPickupNumber => PickupLabel.Number(ShopJob.PickupNumber);

    /// <summary>"7 Nov" when the number is not from today, otherwise null (so yesterday's #7 is never mistaken).</summary>
    public string? DisplayPickupDate => HasPickupNumber && PickupDate is { } d && d != _today ? PickupLabel.Date(d) : null;

    /// <summary>"#7" or "#7 · 7 Nov".</summary>
    public string DisplayPickup => DisplayPickupDate is { } date ? $"{DisplayPickupNumber} · {date}" : DisplayPickupNumber;

    public string StatusLabel => Status switch
    {
        "PENDING_REVIEW" => "Needs review",
        "QUEUED" => "Queued",
        "PRINTING" => PrintJob?.Status switch
        {
            "SPOOLER_COMPLETE" => "Printed — moving to Ready",
            "SUBMITTED" => "Printing",
            _ => "Starting print",
        },
        "NEEDS_OPERATOR_CHECK" => "Needs check",
        "READY_FOR_PICKUP" => "Ready for pickup",
        "COLLECTED" => "Collected",
        "REJECTED" => "Rejected",
        _ => Status,
    };

    /// <summary>Attempt + spooler details for the detail pane.</summary>
    public string? PrintJobDetail => PrintJob is null
        ? null
        : $"Attempt {PrintJob.Attempt} · {PrintJob.Status}{(PrintJob.SpoolerJobId is int id ? $" · spooler job {id}" : "")}";

    public string? PrintError => PrintJob?.Error;

    /// <summary>Status on the Today's pickups list; null for orders that are not (or no longer) for pickup.</summary>
    public string? PickupStatus => Status switch
    {
        "PENDING_REVIEW" or "QUEUED" => "Waiting",
        "PRINTING" => "Printing",
        "READY_FOR_PICKUP" or "COLLECTED" => "Ready",
        "NEEDS_OPERATOR_CHECK" => "Needs check",
        _ => null,
    };

    public string TabCategory => Status switch
    {
        "PENDING_REVIEW" => "Pending",
        "QUEUED" => "Queue",
        "PRINTING" => "Printing",
        "NEEDS_OPERATOR_CHECK" => "Needs check",
        "READY_FOR_PICKUP" => "Ready",
        _ => "Other",
    };

    public bool CanAccept => Status == "PENDING_REVIEW";

    /// <summary>Accessible name of the list row.</summary>
    public override string ToString() => PublicRef;
    public bool CanReject => Status is "PENDING_REVIEW" or "QUEUED";
    /// <summary>P2.11: the print outcome is unknown or failed; the operator decides.</summary>
    public bool NeedsCheck => Status == "NEEDS_OPERATOR_CHECK";

    private static string FormatTime(string iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)
            ? TimeZoneInfo.ConvertTime(t, Kolkata).ToString("d MMM, h:mm tt", India)
            : iso;

    private static TimeZoneInfo FindKolkata()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("India Standard Time"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.CreateCustomTimeZone("IST", TimeSpan.FromMinutes(330), "IST", "IST"); }
    }
}

/// <summary>A segment of the Jobs segmented control.</summary>
public sealed partial class JobTab : ObservableObject
{
    public JobTab(string key) => Key = key;

    public string Key { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Title))]
    private int _count;

    public string Title => Count > 0 ? $"{Key}  {Count}" : Key;

    public override string ToString() => Key;
}

public sealed record RejectReason(string Code, string Label)
{
    public override string ToString() => Label;
}

/// <summary>
/// Jobs screen (P1.9/P1.10): polls <c>GET /api/shop/jobs</c> every few seconds; Pending / Queue /
/// Printing / Needs check / Ready; accept, reject with reason, open preview, resolve needs-check.
/// ADR-002: no Mark Ready — the server moves a finished print to Ready by itself, and it shows up
/// on the next refresh. Runs on the UI thread (the awaits resume there), so collections are only
/// touched by the dispatcher.
/// </summary>
public sealed partial class JobsViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly AgentStateStore _state;
    private readonly AppStatus _status;
    private readonly AgentSettings _settings;
    private readonly AgentSignals _signals;
    private readonly List<JobItem> _all = new();
    private HashSet<string>? _knownPending;

    [ObservableProperty]
    private JobTab _selectedTab;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasSelection))]
    [NotifyCanExecuteChangedFor(nameof(AcceptCommand), nameof(OpenRejectCommand), nameof(OpenPreviewCommand),
        nameof(OpenConfirmPrintedCommand), nameof(OpenReprintCommand), nameof(OpenMarkFailedCommand))]
    private JobItem? _selectedJob;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AcceptCommand), nameof(SubmitRejectCommand),
        nameof(SubmitResolveCommand), nameof(ContinueReprintCommand))]
    private bool _isBusy;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private string? _lastUpdated;

    [ObservableProperty]
    private bool _isPaused;

    // Reject sheet
    [ObservableProperty]
    private bool _isRejectOpen;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitRejectCommand))]
    private RejectReason? _rejectReason;

    [ObservableProperty]
    private string? _rejectNote;

    public JobsViewModel(ShopApiClient api, AgentStateStore state, AppStatus status, AgentSettings settings, AgentSignals signals)
    {
        _signals = signals;
        status.LiveStatusChanged += OnLiveStatusChanged;
        _api = api;
        _state = state;
        _status = status;
        _settings = settings;
        Tabs = new[] { "Pending", "Queue", "Printing", "Needs check", "Ready" }.Select(k => new JobTab(k)).ToList();
        _selectedTab = Tabs[0];
        _isPaused = state.Load().PrintingPaused;
    }

    public IReadOnlyList<JobTab> Tabs { get; }
    public ObservableCollection<JobItem> Jobs { get; } = new();

    /// <summary>Raised on the UI thread after every successful refresh with the full job list.</summary>
    public event Action<IReadOnlyList<ShopJob>>? Refreshed;
    public bool HasSelection => SelectedJob is not null;
    public bool IsEmpty => Jobs.Count == 0;

    public string EmptyText => SelectedTab.Key switch
    {
        "Pending" => "No orders waiting for review.",
        "Queue" => "Nothing queued for printing.",
        "Printing" => "Nothing printing right now.",
        "Needs check" => "No prints need checking.",
        _ => "No orders waiting for pickup.",
    };

    public IReadOnlyList<RejectReason> RejectReasons { get; } =
    [
        new("FILE_UNREADABLE", "File can't be read or printed"),
        new("CONTENT_NOT_ALLOWED", "Content not allowed"),
        new("PRINTER_UNAVAILABLE", "Printer unavailable"),
        new("OPTION_UNSUPPORTED", "Option not supported (colour/duplex)"),
        new("OUT_OF_SUPPLIES", "Out of paper or toner"),
        new("SHOP_CLOSING", "Shop is closing"),
        new("OTHER", "Other reason"),
    ];

    /// <summary>
    /// Refresh loop. Call from the UI thread; ends when <paramref name="ct"/> is cancelled. Socket hints
    /// (P2.9) wake it immediately; otherwise it polls every 10 s while the socket is up (safety poll) and
    /// every <see cref="AgentSettings.PollIntervalSeconds"/> while it is down.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (_status.IsPaired) await RefreshAsync();
            var interval = TimeSpan.FromSeconds(_status.RealtimeConnected
                ? Math.Max(2, _settings.SafetyPollSeconds)
                : Math.Max(2, _settings.PollIntervalSeconds));
            try { await _signals.Jobs.WaitAsync(interval, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    private void OnLiveStatusChanged(string orderId)
    {
        void Apply()
        {
            foreach (var job in _all.Where(j => string.Equals(j.OrderId, orderId, StringComparison.OrdinalIgnoreCase)))
            {
                job.LiveStatus = _status.LiveStatus.TryGetValue(orderId, out var text) ? text : null;
            }
        }
        var dispatcher = System.Windows.Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess()) Apply();
        else dispatcher.BeginInvoke(Apply);
    }

    [RelayCommand]
    private async Task RefreshAsync()
    {
        try
        {
            var jobs = await _api.ListJobsAsync(status: null);
            _all.Clear();
            _all.AddRange(jobs.Select(j => new JobItem(j)
            {
                LiveStatus = _status.LiveStatus.TryGetValue(j.OrderId, out var live) ? live : null,
            }));
            Error = null;
            LastUpdated = $"Updated {DateTime.Now:h:mm:ss tt}";
            NotifyNewPending();
            ApplyFilter();
            Refreshed?.Invoke(jobs);
        }
        catch (ApiException ex)
        {
            Error = ex.Code == "DEVICE_UNAUTHORIZED" ? "This PC is not paired with a shop." : ex.Message;
        }
    }

    partial void OnSelectedTabChanged(JobTab value)
    {
        ApplyFilter();
        OnPropertyChanged(nameof(EmptyText));
    }

    partial void OnIsPausedChanged(bool value)
    {
        _state.Update(s => s.PrintingPaused = value);
        _status.ShowToast(value ? "Printing paused" : "Printing resumed",
            value ? "New jobs stay queued until you resume." : null);
    }

    private void ApplyFilter()
    {
        foreach (var tab in Tabs) tab.Count = _all.Count(j => j.TabCategory == tab.Key);

        string? selectedId = SelectedJob?.OrderId;
        Jobs.Clear();
        foreach (var job in ForTab(_all, SelectedTab.Key)) Jobs.Add(job);
        SelectedJob = Jobs.FirstOrDefault(j => j.OrderId == selectedId) ?? Jobs.FirstOrDefault();
        OnPropertyChanged(nameof(IsEmpty));
    }

    /// <summary>
    /// The jobs of one tab. Ready is sorted by pickup number, newest first (latest date, then highest
    /// number), so "#12" is on top and the stack order matches; other tabs keep the server's order.
    /// </summary>
    public static IEnumerable<JobItem> ForTab(IEnumerable<JobItem> jobs, string tabKey)
    {
        var inTab = jobs.Where(j => j.TabCategory == tabKey);
        return tabKey == "Ready"
            ? inTab.OrderByDescending(j => j.PickupDate ?? DateOnly.MinValue).ThenByDescending(j => j.PickupNumber ?? int.MinValue)
            : inTab;
    }

    private void NotifyNewPending()
    {
        var pending = _all.Where(j => j.TabCategory == "Pending").Select(j => j.OrderId).ToHashSet();
        if (_knownPending is not null)
        {
            var fresh = _all.Where(j => j.TabCategory == "Pending" && !_knownPending.Contains(j.OrderId)).ToList();
            if (fresh.Count > 0)
            {
                _status.ShowToast(fresh.Count == 1 ? "New order to review" : $"{fresh.Count} new orders to review",
                    string.Join(", ", fresh.Select(f => f.PublicRef)));
                try { System.Media.SystemSounds.Asterisk.Play(); } catch (InvalidOperationException) { }
            }
        }
        _knownPending = pending;
    }

    // ─── Accept ───

    private bool CanAccept() => !IsBusy && SelectedJob is { CanAccept: true };

    [RelayCommand(CanExecute = nameof(CanAccept))]
    private async Task AcceptAsync()
    {
        var job = SelectedJob!;
        await RunActionAsync(async () =>
        {
            // The server picks the shop's default printer; the shop comes from the device token.
            await _api.AcceptJobAsync(job.OrderId, printerId: null);
            _status.ShowToast(job.HasPickupNumber ? $"Accepted {job.DisplayPickupNumber} · {job.PublicRef}" : $"Accepted {job.PublicRef}", "Queued for printing.");
        });
    }

    // ─── Reject ───

    private bool CanOpenReject() => SelectedJob is { CanReject: true };

    [RelayCommand(CanExecute = nameof(CanOpenReject))]
    private void OpenReject()
    {
        RejectReason = null;
        RejectNote = null;
        IsRejectOpen = true;
    }

    [RelayCommand]
    private void CancelReject() => IsRejectOpen = false;

    private bool CanSubmitReject() => !IsBusy && RejectReason is not null;

    [RelayCommand(CanExecute = nameof(CanSubmitReject))]
    private async Task SubmitRejectAsync()
    {
        var job = SelectedJob;
        if (job is null) return;
        var note = string.IsNullOrWhiteSpace(RejectNote) ? null : RejectNote.Trim();
        await RunActionAsync(async () =>
        {
            await _api.RejectJobAsync(job.OrderId, new RejectJobRequest(RejectReason!.Code, note));
            IsRejectOpen = false;
            _status.ShowToast($"Rejected {job.PublicRef}", job.PayAtCounter ? "Order rejected. The customer pays nothing." : "The customer will be refunded.");
        });
    }

    // ─── Needs check (P2.11) ───

    public const string NeedsCheckWarning =
        "Check the printer output tray before reprinting — reprinting may produce duplicate pages";

    /// <summary>Which resolve sheet is open; reprint takes two explicit steps.</summary>
    public enum ResolveSheet { None, ConfirmPrinted, ReprintCheck, ReprintFinal, MarkFailed }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsConfirmPrintedOpen), nameof(IsReprintCheckOpen), nameof(IsReprintFinalOpen), nameof(IsMarkFailedOpen))]
    [NotifyCanExecuteChangedFor(nameof(SubmitResolveCommand), nameof(ContinueReprintCommand))]
    private ResolveSheet _resolveStep;

    /// <summary>The operator's tick on the current resolve sheet (tray checked / stack found).</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitResolveCommand), nameof(ContinueReprintCommand))]
    private bool _resolveChecked;

    [ObservableProperty]
    private string? _resolveNote;

    /// <summary>One key per opened sheet: a double click or retry can't resolve twice.</summary>
    private string _resolveIdempotencyKey = Guid.NewGuid().ToString();

    public bool IsConfirmPrintedOpen => ResolveStep == ResolveSheet.ConfirmPrinted;
    public bool IsReprintCheckOpen => ResolveStep == ResolveSheet.ReprintCheck;
    public bool IsReprintFinalOpen => ResolveStep == ResolveSheet.ReprintFinal;
    public bool IsMarkFailedOpen => ResolveStep == ResolveSheet.MarkFailed;

    private bool CanOpenResolve() => SelectedJob is { NeedsCheck: true };

    [RelayCommand(CanExecute = nameof(CanOpenResolve))]
    private void OpenConfirmPrinted() => OpenResolve(ResolveSheet.ConfirmPrinted);

    [RelayCommand(CanExecute = nameof(CanOpenResolve))]
    private void OpenReprint() => OpenResolve(ResolveSheet.ReprintCheck);

    [RelayCommand(CanExecute = nameof(CanOpenResolve))]
    private void OpenMarkFailed() => OpenResolve(ResolveSheet.MarkFailed);

    [RelayCommand]
    private void CancelResolve() => ResolveStep = ResolveSheet.None;

    private bool CanContinueReprint() => !IsBusy && ResolveStep == ResolveSheet.ReprintCheck && ResolveChecked;

    /// <summary>Reprint step 1 → step 2: a second, separate confirmation.</summary>
    [RelayCommand(CanExecute = nameof(CanContinueReprint))]
    private void ContinueReprint() => ResolveStep = ResolveSheet.ReprintFinal;

    private bool CanSubmitResolve() => !IsBusy && ResolveStep switch
    {
        ResolveSheet.ConfirmPrinted => ResolveChecked,
        ResolveSheet.ReprintFinal => true, // its tick was step 1
        ResolveSheet.MarkFailed => true,
        _ => false,
    };

    [RelayCommand(CanExecute = nameof(CanSubmitResolve))]
    private async Task SubmitResolveAsync()
    {
        var job = SelectedJob;
        if (job is null) return;
        var step = ResolveStep;
        var request = step switch
        {
            ResolveSheet.ConfirmPrinted => new ResolveJobRequest(ResolveAction.ConfirmPrinted, null, Trimmed(ResolveNote)),
            // confirm: true is only ever sent from the second reprint confirmation.
            ResolveSheet.ReprintFinal => new ResolveJobRequest(ResolveAction.Reprint, true, Trimmed(ResolveNote)),
            ResolveSheet.MarkFailed => new ResolveJobRequest(ResolveAction.MarkFailed, null, Trimmed(ResolveNote)),
            _ => null,
        };
        if (request is null) return;

        await RunActionAsync(async () =>
        {
            await _api.ResolveJobAsync(job.OrderId, request, _resolveIdempotencyKey);
            ResolveStep = ResolveSheet.None;
            switch (step)
            {
                case ResolveSheet.ConfirmPrinted:
                    _status.ShowToast($"{job.PublicRef} is ready for pickup", "Confirmed as printed.");
                    break;
                case ResolveSheet.ReprintFinal:
                    _status.ShowToast($"Reprinting {job.PublicRef}", $"A new attempt was queued with the same packet and pickup number {job.DisplayPickup}.");
                    _signals.Jobs.Pulse();
                    break;
                default:
                    _status.ShowToast($"{job.PublicRef} marked failed", job.PayAtCounter ? "The customer pays nothing." : "The customer will be refunded.");
                    break;
            }
        });
    }

    private void OpenResolve(ResolveSheet step)
    {
        ResolveChecked = false;
        ResolveNote = null;
        _resolveIdempotencyKey = Guid.NewGuid().ToString();
        ResolveStep = step;
    }

    private static string? Trimmed(string? note)
    {
        if (string.IsNullOrWhiteSpace(note)) return null;
        var t = note.Trim();
        return t.Length > 500 ? t[..500] : t;
    }

    // ─── Preview ───

    private bool CanOpenPreview() => SelectedJob is not null;

    [RelayCommand(CanExecute = nameof(CanOpenPreview))]
    private async Task OpenPreviewAsync()
    {
        var job = SelectedJob!;
        try
        {
            var detail = await _api.GetJobAsync(job.OrderId);
            if (string.IsNullOrEmpty(detail.PreviewUrl))
            {
                _status.ShowToast("No preview available", job.PublicRef, warning: true);
                return;
            }
            // Short-lived signed URL: hand it to the default viewer, never log it.
            Process.Start(new ProcessStartInfo(detail.PreviewUrl) { UseShellExecute = true });
        }
        catch (ApiException ex)
        {
            Error = ex.Message;
        }
    }

    private async Task RunActionAsync(Func<Task> action)
    {
        IsBusy = true;
        Error = null;
        try
        {
            await action();
            await RefreshAsync();
        }
        catch (ApiException ex)
        {
            Error = ex.Message;
            await RefreshAsync();
        }
        finally
        {
            IsBusy = false;
        }
    }
}

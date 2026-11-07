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

    public JobItem(ShopJob shopJob)
    {
        ShopJob = shopJob;
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
    public bool IsDemoPayment => ShopJob.SimulatedPayment;

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

    public string StatusLabel => Status switch
    {
        "PENDING_REVIEW" => "Needs review",
        "QUEUED" => "Queued",
        "PRINTING" => PrintJob?.Status switch
        {
            "SPOOLER_COMPLETE" => "Printed — check & mark ready",
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

    /// <summary>READY needs a human (invariant 9) and a print that reached the spooler.</summary>
    public bool CanMarkReady => Status == "PRINTING" && PrintJob is { Status: "SUBMITTED" or "SPOOLER_COMPLETE" };

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
/// Printing / Needs check / Ready; accept, reject with reason, open preview, Mark Ready with
/// explicit confirmation. Runs on the UI thread (the awaits resume there), so collections are
/// only touched by the dispatcher.
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
    [NotifyCanExecuteChangedFor(nameof(AcceptCommand), nameof(OpenRejectCommand), nameof(OpenMarkReadyCommand), nameof(OpenPreviewCommand))]
    private JobItem? _selectedJob;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AcceptCommand), nameof(SubmitRejectCommand), nameof(ConfirmMarkReadyCommand))]
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

    // Mark Ready sheet
    [ObservableProperty]
    private bool _isMarkReadyOpen;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ConfirmMarkReadyCommand))]
    private bool _markReadyChecked;

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
        foreach (var job in _all.Where(j => j.TabCategory == SelectedTab.Key)) Jobs.Add(job);
        SelectedJob = Jobs.FirstOrDefault(j => j.OrderId == selectedId) ?? Jobs.FirstOrDefault();
        OnPropertyChanged(nameof(IsEmpty));
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
            _status.ShowToast($"Accepted {job.PublicRef}", "Queued for printing.");
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
            _status.ShowToast($"Rejected {job.PublicRef}", job.IsDemoPayment ? "Demo refund — no money moved" : "The customer will be refunded.");
        });
    }

    // ─── Mark Ready ───

    private bool CanOpenMarkReady() => SelectedJob is { CanMarkReady: true };

    [RelayCommand(CanExecute = nameof(CanOpenMarkReady))]
    private void OpenMarkReady()
    {
        MarkReadyChecked = false;
        IsMarkReadyOpen = true;
    }

    [RelayCommand]
    private void CancelMarkReady() => IsMarkReadyOpen = false;

    private bool CanConfirmMarkReady() => !IsBusy && MarkReadyChecked;

    [RelayCommand(CanExecute = nameof(CanConfirmMarkReady))]
    private async Task ConfirmMarkReadyAsync()
    {
        var job = SelectedJob;
        if (job is null) return;
        await RunActionAsync(async () =>
        {
            await _api.MarkReadyAsync(job.OrderId);
            IsMarkReadyOpen = false;
            _status.ShowToast($"{job.PublicRef} is ready for pickup", "The customer can now collect it with their code.");
        });
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

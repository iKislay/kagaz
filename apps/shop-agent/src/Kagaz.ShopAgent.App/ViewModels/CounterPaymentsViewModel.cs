using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// A customer waiting to pay at the counter (ADR-003), shown by their daily pickup number — the
/// same number they will use to collect the prints.
/// </summary>
public sealed class CounterRequestItem
{
    private static readonly CultureInfo India = new("en-IN");
    private readonly DateOnly _today;

    /// <param name="today">Today's business date in Asia/Kolkata (tests pass a fixed one).</param>
    public CounterRequestItem(CounterPaymentRequest request, DateOnly? today = null)
    {
        Request = request;
        _today = today ?? PickupLabel.Today();
    }

    public CounterPaymentRequest Request { get; }

    public string OrderId => Request.OrderId;
    public string PublicRef => Request.PublicRef;
    public int PickupNumber => Request.PickupNumber;
    public ShopPrintOptions Options => Request.Options;

    /// <summary>"#7" — big on the row and the result card.</summary>
    public string DisplayPickupNumber => PickupLabel.Number(Request.PickupNumber);

    /// <summary>"11 Nov" when the number is not from today (numbers restart daily), otherwise null.</summary>
    public string? DisplayPickupDate => PickupLabel.ParseDate(Request.PickupDate) is { } d && d != _today ? PickupLabel.Date(d) : null;

    /// <summary>Exactly what to collect — integer paise, shown like a price (never a float).</summary>
    public string DisplayAmount => (Request.AmountPaise / 100m).ToString("C", India);

    public string DisplayPages => Request.PageCount is int pages ? $"{pages} page{(pages == 1 ? "" : "s")}" : "—";
    public string DisplayCopies => $"{Options.Copies} cop{(Options.Copies == 1 ? "y" : "ies")}";
    public string DisplayMode => Options.Colour ? "Colour" : "Black & white";
    public string DisplaySides => Options.Duplex ? "Double-sided" : "Single-sided";
    public string Summary => $"{PublicRef} · {DisplayPages} · {DisplayCopies} · {DisplayMode} · {DisplaySides}";

    /// <summary>When the customer chose pay at counter (Asia/Kolkata).</summary>
    public string DisplayRequestedAt => FormatTime(Request.RequestedAt);

    /// <summary>Accessible name of the list row.</summary>
    public override string ToString() => $"{DisplayPickupNumber}, {PublicRef}";

    private static string FormatTime(string iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t)
            ? TimeZoneInfo.ConvertTime(t, IndiaTime.Zone).ToString("h:mm tt", India)
            : iso;
}

/// <summary>
/// Counter payments (ADR-003). A customer who chose "pay at counter" already has their daily
/// pickup number ("#7") on their phone. The list shows "#7 · collect ₹24.00"; the operator picks
/// the row (or types the number), takes the money and approves. The server re-checks the number,
/// marks the order paid and it continues into the normal Jobs flow with the same #7.
/// <para>The list is refreshed whenever the Jobs page refreshes (every ~10 s and on every socket
/// hint), the same way Today's pickups hooks it.</para>
/// </summary>
public sealed partial class CounterPaymentsViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly AppStatus _status;
    private readonly JobsViewModel? _jobs;

    /// <summary>Order ids seen in the previous list — null until the first load (no toast then).</summary>
    private HashSet<string>? _known;

    private bool _applying;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasResult))]
    [NotifyCanExecuteChangedFor(nameof(ApproveCommand), nameof(CancelRequestCommand))]
    private CounterRequestItem? _result;

    /// <summary>The number typed in the box ("7", "#7").</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasNumber))]
    private string _number = string.Empty;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private string? _lastUpdated;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ApproveCommand), nameof(CancelRequestCommand), nameof(CancelWaitingCommand), nameof(FindCommand))]
    private bool _isBusy;

    [ObservableProperty]
    private CounterRequestItem? _selectedWaiting;

    /// <param name="jobs">The live job source; null in tests (the list is then fed with <see cref="ApplyWaiting"/>).</param>
    public CounterPaymentsViewModel(ShopApiClient api, AppStatus status, JobsViewModel? jobs = null)
    {
        _api = api;
        _status = status;
        _jobs = jobs;
        if (jobs is not null) jobs.Refreshed += OnJobsRefreshed;
    }

    /// <summary>Confirmation before cancelling a waiting payment (a message box in the app).</summary>
    public Func<CounterRequestItem, bool> ConfirmCancel { get; set; } = DefaultConfirmCancel;

    /// <summary>Today's business date used for the row labels (tests pin it).</summary>
    public DateOnly? Today { get; set; }

    /// <summary>The customers waiting to pay at the counter, oldest first.</summary>
    public ObservableCollection<CounterRequestItem> Waiting { get; } = new();

    public bool HasResult => Result is not null;
    public bool HasNumber => !string.IsNullOrEmpty(Number);
    public bool IsEmpty => Waiting.Count == 0;
    public int WaitingCount => Waiting.Count;
    public string CountsText => WaitingCount == 1 ? "1 waiting" : $"{WaitingCount} waiting";

    /// <summary>"7", "#7", " # 7 " → 7; anything else → null.</summary>
    public static int? ParseNumber(string? text)
    {
        var t = new string((text ?? string.Empty).Where(c => !char.IsWhiteSpace(c)).ToArray()).TrimStart('#');
        return t.Length is > 0 and <= 5 && t.All(char.IsAsciiDigit) && int.Parse(t, CultureInfo.InvariantCulture) is var n and > 0
            ? n
            : null;
    }

    /// <summary>The error text shown under the number box.</summary>
    public static string MapError(ApiException ex) => ex.Code switch
    {
        "COUNTER_PAYMENT_NOT_FOUND" => "No one is waiting to pay with that number. Check the number on the customer's phone.",
        "PICKUP_NUMBER_MISMATCH" => "That number belongs to another order. Check the number on the customer's phone.",
        "COUNTER_PAYMENT_NOT_PENDING" => "This order was already paid or cancelled.",
        _ => ex.Message,
    };

    // ─── The waiting list ───

    /// <summary>
    /// Replace the waiting list and tell the operator about customers who just arrived. The very
    /// first load only fills the list — it never toasts.
    /// </summary>
    public void ApplyWaiting(IEnumerable<CounterPaymentRequest> requests)
    {
        var items = requests.Select(r => new CounterRequestItem(r, Today)).ToList();
        var ids = items.Select(i => i.OrderId).ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (_known is not null)
        {
            var fresh = items.Where(i => !_known.Contains(i.OrderId)).ToList();
            if (fresh.Count > 0)
            {
                _status.ShowToast(
                    fresh.Count == 1 ? "Counter payment waiting" : $"{fresh.Count} counter payments waiting",
                    string.Join(", ", fresh.Select(f => $"{f.DisplayPickupNumber} · collect {f.DisplayAmount}")));
            }
        }
        _known = ids;

        string? selectedId = SelectedWaiting?.OrderId;
        _applying = true;
        try
        {
            Waiting.Clear();
            foreach (var item in items) Waiting.Add(item);
            SelectedWaiting = items.FirstOrDefault(w => string.Equals(w.OrderId, selectedId, StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            _applying = false;
        }

        // The order on the card was paid or cancelled elsewhere: it can no longer be approved here.
        if (Result is not null && !ids.Contains(Result.OrderId)) Result = null;

        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(WaitingCount));
        OnPropertyChanged(nameof(CountsText));
    }

    /// <summary>Reload the waiting list from the server.</summary>
    [RelayCommand]
    public async Task RefreshAsync()
    {
        try
        {
            var requests = await _api.ListCounterPaymentsAsync();
            OnUi(() =>
            {
                ApplyWaiting(requests);
                LastUpdated = $"Updated {DateTime.Now:h:mm:ss tt}";
            });
        }
        catch (ApiException ex)
        {
            OnUi(() => Error = ex.Message);
        }
    }

    // ─── Finding the customer ───

    partial void OnNumberChanged(string value) => Error = null;

    partial void OnSelectedWaitingChanged(CounterRequestItem? value)
    {
        if (_applying || value is null) return;
        Result = value;
        Error = null;
    }

    private bool CanFind() => !IsBusy;

    /// <summary>Find the waiting order for the number the customer shows.</summary>
    [RelayCommand(CanExecute = nameof(CanFind))]
    private async Task FindAsync()
    {
        if (ParseNumber(Number) is not int number)
        {
            Error = "Type the pickup number on the customer's phone, e.g. 7.";
            return;
        }

        // Already in the list: no round trip needed.
        var listed = Waiting.FirstOrDefault(w => w.PickupNumber == number);
        if (listed is not null)
        {
            SelectedWaiting = listed;
            Result = listed;
            return;
        }

        IsBusy = true;
        Error = null;
        try
        {
            Result = new CounterRequestItem(await _api.LookupCounterPaymentAsync(number), Today);
        }
        catch (ApiException ex)
        {
            Result = null;
            Error = MapError(ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    // ─── Approve / cancel ───

    private bool CanApprove() => !IsBusy && Result is not null;

    /// <summary>The customer paid: mark the order paid; it keeps its pickup number.</summary>
    [RelayCommand(CanExecute = nameof(CanApprove))]
    private async Task ApproveAsync()
    {
        var item = Result;
        if (item is null) return;

        IsBusy = true;
        Error = null;
        try
        {
            await _api.ApproveCounterPaymentAsync(item.OrderId, item.PickupNumber, Guid.NewGuid().ToString());
            ClearResult();
            _status.ShowToast($"Paid · pickup {item.DisplayPickupNumber}", $"{item.PublicRef} is now in Jobs");
            await RefreshAsync();
            await RefreshJobsAsync();
        }
        catch (ApiException ex)
        {
            Error = MapError(ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private bool CanCancelRequest() => !IsBusy && Result is not null;

    /// <summary>The customer left without paying: close the counter payment.</summary>
    [RelayCommand(CanExecute = nameof(CanCancelRequest))]
    private async Task CancelRequestAsync()
    {
        if (Result is { } item) await CancelAsync(item);
    }

    private bool CanCancelWaiting(CounterRequestItem? item) => !IsBusy && item is not null;

    /// <summary>Cancel a waiting payment straight from the list.</summary>
    [RelayCommand(CanExecute = nameof(CanCancelWaiting))]
    private async Task CancelWaitingAsync(CounterRequestItem? item)
    {
        if (item is not null) await CancelAsync(item);
    }

    private async Task CancelAsync(CounterRequestItem item)
    {
        if (!ConfirmCancel(item)) return;

        IsBusy = true;
        Error = null;
        try
        {
            await _api.CancelCounterPaymentAsync(item.OrderId, Guid.NewGuid().ToString());
            _status.ShowToast("Counter payment cancelled", $"{item.DisplayPickupNumber} · {item.PublicRef} — nothing was charged.");
            if (Result is not null && string.Equals(Result.OrderId, item.OrderId, StringComparison.OrdinalIgnoreCase))
            {
                ClearResult();
            }
            await RefreshAsync();
        }
        catch (ApiException ex)
        {
            Error = MapError(ex);
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>Empty the number box and the result card.</summary>
    [RelayCommand]
    private void Clear() => ClearResult();

    private void ClearResult()
    {
        Number = string.Empty;
        Result = null;
        SelectedWaiting = null;
        Error = null;
    }

    // ─── Helpers ───

    private void OnJobsRefreshed(IReadOnlyList<ShopJob> jobs) => _ = RefreshAsync();

    private async Task RefreshJobsAsync()
    {
        if (_jobs is not null) await _jobs.RefreshCommand.ExecuteAsync(null);
    }

    private static bool DefaultConfirmCancel(CounterRequestItem item) =>
        MessageBox.Show(
            $"Cancel {item.DisplayPickupNumber} ({item.PublicRef})?\n\nOnly do this if the customer left without paying. Nothing is charged and the order is closed.",
            "Kagaz Shop", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;

    private static void OnUi(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess()) action();
        else dispatcher.BeginInvoke(action);
    }
}

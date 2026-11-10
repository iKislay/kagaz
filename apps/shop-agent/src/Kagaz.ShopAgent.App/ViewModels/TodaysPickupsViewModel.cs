using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Today's pickups (ADR-002): every paid order of today at this shop with its daily pickup number,
/// newest first, so the operator can answer "copies for number 7?" at a glance. There is no
/// verification call: it reads the same <c>GET /api/shop/jobs</c> refresh as the Jobs page.
/// Typing in the filter box narrows the list by number ("7" → #7 first, then #70–#79) or by ref.
/// </summary>
public sealed partial class TodaysPickupsViewModel : ObservableObject
{
    private readonly JobsViewModel? _jobs;
    private List<JobItem> _today = new();

    [ObservableProperty]
    private string _filter = string.Empty;

    [ObservableProperty]
    private JobItem? _selected;

    [ObservableProperty]
    private string? _lastUpdated;

    /// <param name="jobs">The live job source; null in tests (feed it with <see cref="Load"/>).</param>
    public TodaysPickupsViewModel(JobsViewModel? jobs = null)
    {
        _jobs = jobs;
        if (jobs is not null) jobs.Refreshed += list => Load(list, PickupLabel.Today());
    }

    public ObservableCollection<JobItem> Pickups { get; } = new();

    public int TotalToday => _today.Count;
    public int ReadyCount => _today.Count(j => j.PickupStatus == "Ready");
    public string CountsText => TotalToday == 0 ? "No paid orders yet today." : $"{TotalToday} today · {ReadyCount} ready";
    public bool IsEmpty => Pickups.Count == 0;
    public bool HasFilter => !string.IsNullOrWhiteSpace(Filter);

    public string EmptyText => HasFilter
        ? $"No order {Filter.Trim()} today."
        : "Paid orders get a pickup number as soon as payment is verified. They show up here.";

    /// <summary>Replace the list with today's paid orders from a refresh.</summary>
    public void Load(IEnumerable<ShopJob> jobs, DateOnly today)
    {
        _today = jobs.Select(j => new JobItem(j, today))
            .Where(j => j.HasPickupNumber && j.IsToday && j.PickupStatus is not null)
            .ToList();
        LastUpdated = $"Updated {DateTime.Now:h:mm:ss tt}";
        Apply();
        OnPropertyChanged(nameof(TotalToday));
        OnPropertyChanged(nameof(ReadyCount));
        OnPropertyChanged(nameof(CountsText));
    }

    partial void OnFilterChanged(string value)
    {
        Apply();
        OnPropertyChanged(nameof(HasFilter));
    }

    [RelayCommand]
    private void ClearFilter() => Filter = string.Empty;

    [RelayCommand]
    private async Task RefreshAsync()
    {
        if (_jobs is not null) await _jobs.RefreshCommand.ExecuteAsync(null);
    }

    private void Apply()
    {
        var selectedId = Selected?.OrderId;
        var rows = Match(_today, Filter);
        Pickups.Clear();
        foreach (var row in rows) Pickups.Add(row);

        // Typing a number jumps to that order; otherwise keep the selection when it is still listed.
        var exact = ExactNumber(Filter) is int n ? Pickups.FirstOrDefault(p => p.PickupNumber == n) : null;
        Selected = exact ?? Pickups.FirstOrDefault(p => p.OrderId == selectedId) ?? (HasFilter ? Pickups.FirstOrDefault() : null);
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(EmptyText));
    }

    /// <summary>
    /// Filter + sort. Empty filter: all, highest number first. Digits (a leading "#" and spaces are
    /// ignored): numbers starting with those digits, the exact number first. Anything else: orders whose
    /// ref contains the text.
    /// </summary>
    public static IReadOnlyList<JobItem> Match(IEnumerable<JobItem> pickups, string? filter)
    {
        var byNumberDesc = pickups.OrderByDescending(p => p.PickupNumber ?? int.MinValue);
        var text = Normalize(filter);
        if (text.Length == 0) return byNumberDesc.ToList();

        if (text.All(char.IsAsciiDigit))
        {
            var digits = text.TrimStart('0');
            if (digits.Length == 0) digits = "0";
            var exact = ExactNumber(filter);
            return byNumberDesc
                .Where(p => p.PickupNumber is int n && n.ToString(CultureInfo.InvariantCulture).StartsWith(digits, StringComparison.Ordinal))
                .OrderByDescending(p => p.PickupNumber == exact)
                .ThenByDescending(p => p.PickupNumber)
                .ToList();
        }

        return byNumberDesc.Where(p => p.PublicRef.Contains(text, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    /// <summary>The number typed in the filter ("7", "#7", " # 7 "), or null.</summary>
    public static int? ExactNumber(string? filter)
    {
        var text = Normalize(filter);
        return text.Length is > 0 and <= 6 && text.All(char.IsAsciiDigit) ? int.Parse(text, CultureInfo.InvariantCulture) : null;
    }

    private static string Normalize(string? filter) =>
        new string((filter ?? string.Empty).Where(c => !char.IsWhiteSpace(c)).ToArray()).TrimStart('#');
}

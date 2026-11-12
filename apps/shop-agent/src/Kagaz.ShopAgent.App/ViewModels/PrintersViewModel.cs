using System.Collections.ObjectModel;
using System.Drawing.Printing;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>One installed Windows printer and the operator's choices for it.</summary>
public sealed partial class PrinterChoice : ObservableObject
{
    public PrinterChoice(string printerName, bool driverColour, bool driverDuplex)
    {
        PrinterName = printerName;
        DriverColour = driverColour;
        DriverDuplex = driverDuplex;
        _colourCapable = driverColour;
        _duplexCapable = driverDuplex;
    }

    public string PrinterName { get; }
    public bool DriverColour { get; }
    public bool DriverDuplex { get; }

    public string DriverSummary =>
        $"Driver reports {(DriverColour ? "colour" : "black & white only")}, {(DriverDuplex ? "double-sided" : "single-sided only")}";

    [ObservableProperty]
    private bool _isUsed;

    [ObservableProperty]
    private bool _colourCapable;

    [ObservableProperty]
    private bool _duplexCapable;

    [ObservableProperty]
    private bool _capabilitiesConfirmed;

    [ObservableProperty]
    private bool _isDefault;

    [ObservableProperty]
    private string? _serverStatus;
}

/// <summary>
/// Printer setup (P1.9): list installed printers, operator picks the shop printer(s), confirms
/// colour/duplex, marks one default → <c>PUT /api/shop/printers</c>.
/// </summary>
public sealed partial class PrintersViewModel : ObservableObject
{
    private readonly ShopApiClient _api;
    private readonly AgentStateStore _state;
    private readonly AppStatus _status;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    private bool _isBusy;

    [ObservableProperty]
    private string? _message;

    [ObservableProperty]
    private bool _messageIsError;

    public PrintersViewModel(ShopApiClient api, AgentStateStore state, AppStatus status)
    {
        _api = api;
        _state = state;
        _status = status;
        status.Paired += () => _ = LoadAsync();
    }

    public ObservableCollection<PrinterChoice> Printers { get; } = new();

    /// <summary>Called when the page is shown.</summary>
    [RelayCommand]
    public async Task LoadAsync()
    {
        Message = null;
        var installed = new List<PrinterChoice>();
        foreach (string name in PrinterSettings.InstalledPrinters)
        {
            var ps = new PrinterSettings { PrinterName = name };
            installed.Add(new PrinterChoice(name, ps.IsValid && ps.SupportsColor, ps.IsValid && ps.CanDuplex));
        }

        if (_status.IsPaired)
        {
            try
            {
                var server = await _api.GetPrintersAsync();
                foreach (var choice in installed)
                {
                    var match = server.FirstOrDefault(p => string.Equals(p.PrinterName, choice.PrinterName, StringComparison.OrdinalIgnoreCase));
                    if (match is null || !match.Enabled) continue;
                    choice.IsUsed = true;
                    choice.ColourCapable = match.ColourCapable;
                    choice.DuplexCapable = match.DuplexCapable;
                    choice.CapabilitiesConfirmed = match.CapabilitiesConfirmed;
                    choice.IsDefault = match.IsDefault;
                    choice.ServerStatus = match.Status;
                }
            }
            catch (ApiException ex)
            {
                ShowMessage($"Couldn't load this shop's printers: {ex.Message}", error: true);
            }
        }

        Printers.Clear();
        foreach (var p in installed.OrderByDescending(p => p.IsUsed).ThenBy(p => p.PrinterName)) Printers.Add(p);
        OnPropertyChanged(nameof(SeatsText));
    }

    [RelayCommand]
    private void MakeDefault(PrinterChoice choice)
    {
        foreach (var p in Printers) p.IsDefault = ReferenceEquals(p, choice);
        choice.IsUsed = true;
    }

    private bool CanSave() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanSave))]
    private async Task SaveAsync()
    {
        if (!_status.IsPaired)
        {
            ShowMessage("Pair this PC with your shop first.", error: true);
            return;
        }

        var used = Printers.Where(p => p.IsUsed).ToList();
        if (used.Count == 0)
        {
            ShowMessage("Turn on at least one printer for Kaggaz orders.", error: true);
            return;
        }
        if (!used.Any(p => p.IsDefault))
        {
            used[0].IsDefault = true;
        }

        IsBusy = true;
        try
        {
            var saved = await _api.RegisterPrintersAsync(new RegisterPrintersRequest(used
                .Select(p => new PrinterRegistration(p.PrinterName, null, p.ColourCapable, p.DuplexCapable,
                    p.CapabilitiesConfirmed, p.IsDefault))
                .ToList()));
            _state.Update(s => s.RegisteredPrinterNames = saved.Select(p => p.PrinterName).ToList());
            ShowMessage(used.Count == 1 ? $"Saved. Orders will print on {used[0].PrinterName}." : $"Saved {used.Count} printers.", error: false);
            _status.ShowToast("Printers saved", used.FirstOrDefault(p => p.IsDefault)?.PrinterName);
        }
        catch (ApiException ex) when (ex.Code == ApiErrorCodes.PrinterLimitReached)
        {
            // The plan covers fewer printers: put the toggles back to what's saved, then explain.
            await LoadAsync();
            ShowMessage(ex.Message, error: true);
        }
        catch (ApiException ex)
        {
            ShowMessage(ex.Message, error: true);
        }
        finally
        {
            IsBusy = false;
            OnPropertyChanged(nameof(SeatsText));
        }
    }

    /// <summary>"1 of 2 printers in use" when the plan's seats are known (connected printers, not models).</summary>
    public string? SeatsText => _status.Subscription?.PrinterSeats is int seats
        ? $"{Printers.Count(p => p.IsUsed)} of {seats} printer{(seats == 1 ? "" : "s")} in use"
        : null;

    private void ShowMessage(string text, bool error)
    {
        Message = text;
        MessageIsError = error;
    }
}

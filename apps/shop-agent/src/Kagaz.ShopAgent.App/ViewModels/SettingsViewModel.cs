using System.Diagnostics;
using System.Globalization;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>
/// Order approval mode (ADR-002), app details: server, pairing, device-token rotation (P2.4), where local
/// state and logs live.
/// </summary>
public sealed partial class SettingsViewModel : ObservableObject
{
    private readonly AgentPaths _paths;
    private readonly TokenRotationService _rotation;
    private readonly StartupRegistration _startup;
    private bool _loadingStartup;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RotateTokenCommand))]
    private bool _isRotating;

    [ObservableProperty]
    private string? _rotationMessage;

    [ObservableProperty]
    private string _lastRotated = "—";

    [ObservableProperty]
    private bool _startWithWindows;

    [ObservableProperty]
    private string? _startupMessage;

    public SettingsViewModel(AgentSettings settings, AgentPaths paths, AppStatus status, TokenRotationService rotation,
        StartupRegistration startup, UpdateViewModel update, ShopModeViewModel mode)
    {
        Mode = mode;
        _paths = paths;
        _rotation = rotation;
        _startup = startup;
        Update = update;
        _loadingStartup = true;
        try { StartWithWindows = startup.IsEnabled; }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException) { }
        finally { _loadingStartup = false; }
        Settings = settings;
        Status = status;
        Version = typeof(SettingsViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        RefreshLastRotated();
    }

    public UpdateViewModel Update { get; }

    /// <summary>Order approval (Manual | Auto, pause auto-accept) — a shop setting since ADR-002.</summary>
    public ShopModeViewModel Mode { get; }
    public AgentSettings Settings { get; }
    public AppStatus Status { get; }
    public string Version { get; }
    public string StatePath => _paths.RootDirectory;
    public string LogPath => _paths.LogsDirectory;
    public string PrintToPdfPath => Path.Combine(_paths.RootDirectory, "print-to-pdf");
    public string RotationPolicy => Settings.TokenRotationDays > 0
        ? $"Rotated automatically every {Settings.TokenRotationDays} days."
        : "Automatic rotation is off.";

    partial void OnStartWithWindowsChanged(bool value)
    {
        if (_loadingStartup) return;
        try
        {
            _startup.SetEnabled(value);
            StartupMessage = value ? "Kaggaz Shop will start when you sign in to Windows." : null;
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            StartupMessage = $"Could not change this setting ({ex.Message}).";
        }
    }

    [RelayCommand]
    private void OpenLogs() => OpenFolder(_paths.LogsDirectory);

    [RelayCommand]
    private void OpenPrintToPdf() => OpenFolder(PrintToPdfPath);

    private bool CanRotate() => !IsRotating && Status.IsPaired;

    [RelayCommand(CanExecute = nameof(CanRotate))]
    private async Task RotateTokenAsync()
    {
        IsRotating = true;
        RotationMessage = null;
        try
        {
            string? error = await _rotation.RotateAsync();
            RotationMessage = error ?? "Device token rotated. The old token no longer works.";
            if (error is null) Status.ShowToast("Device token rotated");
            RefreshLastRotated();
        }
        finally
        {
            IsRotating = false;
        }
    }

    private void RefreshLastRotated()
    {
        var at = _rotation.LastRotatedAt;
        LastRotated = at is { } t
            ? TimeZoneInfo.ConvertTime(t, IndiaTime.Zone).ToString("d MMM yyyy, h:mm tt", new CultureInfo("en-IN"))
            : "—";
    }

    private static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }
}

/// <summary>Display times in Asia/Kolkata (CLAUDE.md conventions).</summary>
internal static class IndiaTime
{
    public static readonly TimeZoneInfo Zone = Find();

    private static TimeZoneInfo Find()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("India Standard Time"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.CreateCustomTimeZone("IST", TimeSpan.FromMinutes(330), "IST", "IST"); }
    }
}

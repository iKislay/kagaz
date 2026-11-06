using System.Diagnostics;
using System.IO;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

/// <summary>Read-only app details: server, pairing, where local state and logs live.</summary>
public sealed partial class SettingsViewModel : ObservableObject
{
    private readonly AgentPaths _paths;

    public SettingsViewModel(AgentSettings settings, AgentPaths paths, AppStatus status)
    {
        _paths = paths;
        Settings = settings;
        Status = status;
        Version = typeof(SettingsViewModel).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
    }

    public AgentSettings Settings { get; }
    public AppStatus Status { get; }
    public string Version { get; }
    public string StatePath => _paths.RootDirectory;
    public string LogPath => _paths.LogsDirectory;
    public string PrintToPdfPath => Path.Combine(_paths.RootDirectory, "print-to-pdf");

    [RelayCommand]
    private void OpenLogs() => OpenFolder(_paths.LogsDirectory);

    [RelayCommand]
    private void OpenPrintToPdf() => OpenFolder(PrintToPdfPath);

    private static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }
}

using Microsoft.Win32;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>Per-user "Run" registry value (<c>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</c>).</summary>
public interface IRunKey
{
    string? Get(string name);
    void Set(string name, string value);
    void Delete(string name);
}

public sealed class CurrentUserRunKey : IRunKey
{
    private const string Path = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public string? Get(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(Path, writable: false);
        return key?.GetValue(name) as string;
    }

    public void Set(string name, string value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(Path, writable: true);
        key.SetValue(name, value, RegistryValueKind.String);
    }

    public void Delete(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(Path, writable: true);
        key?.DeleteValue(name, throwOnMissingValue: false);
    }
}

/// <summary>
/// "Start Kaggaz Shop when I sign in to Windows" (P5.4). Per-user only — no admin rights, no service.
/// The value points at the running executable, which for a Velopack install is the stable
/// <c>%LOCALAPPDATA%\KagazShop\current\Kagaz.ShopAgent.App.exe</c> across updates.
/// </summary>
public sealed class StartupRegistration
{
    public const string ValueName = "KagazShop";

    private readonly IRunKey _runKey;
    private readonly string _exePath;

    public StartupRegistration(IRunKey runKey, string? exePath = null)
    {
        _runKey = runKey;
        _exePath = exePath ?? Environment.ProcessPath ?? string.Empty;
    }

    public string Command => $"\"{_exePath}\" --autostart";

    public bool IsEnabled => string.Equals(_runKey.Get(ValueName), Command, StringComparison.OrdinalIgnoreCase);

    public void SetEnabled(bool enabled)
    {
        if (enabled) _runKey.Set(ValueName, Command);
        else _runKey.Delete(ValueName);
    }
}

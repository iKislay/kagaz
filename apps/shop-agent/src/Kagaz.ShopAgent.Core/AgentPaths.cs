namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Resolves the local state folders. Created on demand.
/// </summary>
public sealed class AgentPaths
{
    public string RootDirectory { get; }
    public string LogsDirectory { get; }
    public string DeviceTokenPath { get; }

    public AgentPaths(string? rootDirectory = null)
    {
        RootDirectory = rootDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Kagaz");
        LogsDirectory = Path.Combine(RootDirectory, "logs");
        DeviceTokenPath = Path.Combine(RootDirectory, "device.token");
    }

    public void EnsureCreated()
    {
        Directory.CreateDirectory(RootDirectory);
        Directory.CreateDirectory(LogsDirectory);
    }
}

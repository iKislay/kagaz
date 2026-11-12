namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Resolves the local state folders. Created on demand.
/// </summary>
public sealed class AgentPaths
{
    public string RootDirectory { get; }
    public string LogsDirectory { get; }
    public string DeviceTokenPath { get; }

    /// <summary>Signed-in operator, DPAPI-encrypted, so staff stay signed in across restarts.</summary>
    public string OperatorTokenPath { get; }

    public AgentPaths(string? rootDirectory = null)
    {
        RootDirectory = rootDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Kagaz");
        LogsDirectory = Path.Combine(RootDirectory, "logs");
        DeviceTokenPath = Path.Combine(RootDirectory, "device.token");
        OperatorTokenPath = Path.Combine(RootDirectory, "operator.token");
    }

    public void EnsureCreated()
    {
        Directory.CreateDirectory(RootDirectory);
        Directory.CreateDirectory(LogsDirectory);
    }
}

using System.Security.Cryptography;
using System.Text;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// DPAPI-backed secure store for the device token.
/// Encrypted with <see cref="ProtectedData"/>, scope <see cref="DataProtectionScope.CurrentUser"/>,
/// using a fixed app-specific entropy, at <c>%LOCALAPPDATA%\Kagaz\device.token</c>.
/// </summary>
public sealed class DpapiSecureStore : ISecureStore
{
    private static readonly byte[] Entropy = "Kagaz.ShopAgent.DeviceToken.v1"u8.ToArray();
    private readonly string _filePath;

    public DpapiSecureStore(string filePath)
    {
        _filePath = !string.IsNullOrWhiteSpace(filePath)
            ? filePath
            : throw new ArgumentException("Secure store file path is required.", nameof(filePath));
    }

    public string? Load()
    {
        if (!File.Exists(_filePath))
        {
            return null;
        }

        byte[] protectedBytes = Convert.FromBase64String(File.ReadAllText(_filePath));
        byte[] decrypted = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
        return Encoding.UTF8.GetString(decrypted);
    }

    public void Save(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new ArgumentException("Secret cannot be empty.", nameof(secret));
        }

        string? directory = Path.GetDirectoryName(_filePath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        byte[] protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), Entropy, DataProtectionScope.CurrentUser);
        // Write-then-rename: token rotation (P2.4) must never leave a truncated or half-old token file,
        // because the server invalidates the old token the moment it issues the new one.
        string temp = _filePath + ".tmp";
        File.WriteAllText(temp, Convert.ToBase64String(protectedBytes));
        File.Move(temp, _filePath, overwrite: true);
    }

    public void Delete()
    {
        if (File.Exists(_filePath))
        {
            File.Delete(_filePath);
        }
    }
}

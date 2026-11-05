namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Save/load/delete a single secret string (the device token).
/// </summary>
public interface ISecureStore
{
    string? Load();
    void Save(string secret);
    void Delete();
}

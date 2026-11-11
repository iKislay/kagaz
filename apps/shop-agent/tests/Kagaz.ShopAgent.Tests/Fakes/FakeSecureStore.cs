namespace Kagaz.ShopAgent.Tests.Fakes;

/// <summary>
/// In-memory double of <see cref="Kagaz.ShopAgent.Core.ISecureStore"/> for tests.
/// </summary>
public sealed class FakeSecureStore : Kagaz.ShopAgent.Core.ISecureStore
{
    private string? _secret;

    public FakeSecureStore(string? secret = null) => _secret = secret;

    public string? Load() => _secret;

    public void Save(string secret) => _secret = secret;

    public void Delete() => _secret = null;
}

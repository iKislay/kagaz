using Kagaz.ShopAgent.Core;
using System.IO;

namespace Kagaz.ShopAgent.Tests;

public class DpapiSecureStoreTests
{
    [Fact]
    public void Round_trip_and_delete_work()
    {
        string root = Path.Combine(Path.GetTempPath(), "kagaz-tests", Guid.NewGuid().ToString("N"));
        string tokenPath = Path.Combine(root, "device.token");
        try
        {
            ISecureStore store = new DpapiSecureStore(tokenPath);

            Assert.Null(store.Load());

            store.Save("device-token-abc");
            Assert.Equal("device-token-abc", store.Load());

            store.Save("device-token-def");
            Assert.Equal("device-token-def", store.Load());

            store.Delete();
            Assert.Null(store.Load());

            store.Delete();
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }
    }
}

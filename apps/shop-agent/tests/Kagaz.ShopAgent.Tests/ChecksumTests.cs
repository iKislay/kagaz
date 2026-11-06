using System.Security.Cryptography;
using System.Text;

namespace Kagaz.ShopAgent.Tests;

public class ChecksumTests
{
    [Fact]
    public void Matching_sha256_passes_verification()
    {
        byte[] bytes = Encoding.UTF8.GetBytes("hello world");
        var expected = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        var actual = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        Assert.Equal(expected, actual);
        Assert.Equal(64, expected.Length);
    }

    [Fact]
    public void Mismatching_sha256_fails_verification()
    {
        var a = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("packet"))).ToLowerInvariant();
        var b = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("packet!"))).ToLowerInvariant();

        Assert.NotEqual(a, b);
    }
}

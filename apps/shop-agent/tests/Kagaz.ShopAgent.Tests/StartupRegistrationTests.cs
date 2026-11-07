using Kagaz.ShopAgent.App.Services;

namespace Kagaz.ShopAgent.Tests;

/// <summary>P5.4: per-user start-with-Windows (tested against a fake Run key — never the real registry).</summary>
public class StartupRegistrationTests
{
    private sealed class FakeRunKey : IRunKey
    {
        public Dictionary<string, string> Values { get; } = new(StringComparer.OrdinalIgnoreCase);
        public string? Get(string name) => Values.TryGetValue(name, out var v) ? v : null;
        public void Set(string name, string value) => Values[name] = value;
        public void Delete(string name) => Values.Remove(name);
    }

    [Fact]
    public void Enable_and_disable_write_the_quoted_exe_path()
    {
        var key = new FakeRunKey();
        var reg = new StartupRegistration(key, @"C:\Users\shop\AppData\Local\KagazShop\current\Kagaz.ShopAgent.App.exe");

        Assert.False(reg.IsEnabled);
        reg.SetEnabled(true);

        Assert.True(reg.IsEnabled);
        Assert.Equal("\"C:\\Users\\shop\\AppData\\Local\\KagazShop\\current\\Kagaz.ShopAgent.App.exe\" --autostart", key.Values["KagazShop"]);

        reg.SetEnabled(false);
        Assert.False(reg.IsEnabled);
        Assert.Empty(key.Values);
    }

    [Fact]
    public void Entry_pointing_elsewhere_is_not_reported_as_enabled()
    {
        var key = new FakeRunKey();
        key.Set(StartupRegistration.ValueName, "\"D:\\old\\Kagaz.ShopAgent.App.exe\" --autostart");

        Assert.False(new StartupRegistration(key, @"C:\new\Kagaz.ShopAgent.App.exe").IsEnabled);
    }
}

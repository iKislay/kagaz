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
    public void First_run_turns_it_on_once_and_respects_a_later_off()
    {
        var root = Path.Combine(Path.GetTempPath(), "kagaz-startup-tests", Guid.NewGuid().ToString("N"));
        try
        {
            var state = new Kagaz.ShopAgent.Core.AgentStateStore(Path.Combine(root, "state.json"));
            var startup = new StartupRegistration(new FakeRunKey(), @"C:\kagaz\Kagaz.ShopAgent.App.exe");

            startup.EnableOnFirstRun(state);
            Assert.True(startup.IsEnabled);

            startup.SetEnabled(false);
            startup.EnableOnFirstRun(state);
            Assert.False(startup.IsEnabled);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Entry_pointing_elsewhere_is_not_reported_as_enabled()
    {
        var key = new FakeRunKey();
        key.Set(StartupRegistration.ValueName, "\"D:\\old\\Kagaz.ShopAgent.App.exe\" --autostart");

        Assert.False(new StartupRegistration(key, @"C:\new\Kagaz.ShopAgent.App.exe").IsEnabled);
    }
}

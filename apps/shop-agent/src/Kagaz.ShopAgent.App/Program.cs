using Kagaz.ShopAgent.App.Services;
using Velopack;

namespace Kagaz.ShopAgent.App;

/// <summary>
/// Entry point (P5.4). Velopack must run first: during install/update/uninstall it invokes the app
/// with hook arguments and exits before any UI. Single instance is enforced in <see cref="App"/>
/// with a named mutex.
/// </summary>
public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build()
            // Don't leave a dangling "start with Windows" entry behind after uninstall.
            .OnBeforeUninstallFastCallback(_ =>
            {
                try { new StartupRegistration(new CurrentUserRunKey()).SetEnabled(false); }
                catch (Exception) { /* best effort during uninstall */ }
            })
            .Run();

        var app = new App();
        app.InitializeComponent();
        app.Run();
    }
}

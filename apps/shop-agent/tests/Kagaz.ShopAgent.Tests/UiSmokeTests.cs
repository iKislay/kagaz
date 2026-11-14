using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Controls;
using Kagaz.ShopAgent.App;
using ShopApp = Kagaz.ShopAgent.App.App;
using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Kagaz.ShopAgent.Tests;

/// <summary>
/// Loads the real window and every view with the app's resources and DI graph, so XAML that only
/// fails at runtime (bad style triggers, missing resources, broken templates) fails the build instead
/// of crashing shops' PCs on start.
/// It creates the process-wide WPF Application, so it runs alone (other tests marshal UI work through it).
/// </summary>
[Collection(WpfApplicationCollection.Name)]
public sealed class UiSmokeTests
{
    [Fact]
    public void Main_window_and_every_view_load_with_their_view_models() => RunOnSta(() =>
    {
        var app = Application.Current as ShopApp ?? new ShopApp();
        if (app.Resources.Count == 0) app.InitializeComponent();

        var root = Path.Combine(Path.GetTempPath(), "kagaz-ui-" + Guid.NewGuid().ToString("N"));
        var paths = new AgentPaths(root);
        paths.EnsureCreated();
        using IHost host = HostFactory.CreateHost(paths);
        try
        {
            var window = host.Services.GetRequiredService<MainWindow>();
            Render(window);

            var views = typeof(ShopApp).Assembly.GetTypes()
                .Where(t => t.Namespace == "Kagaz.ShopAgent.App.Views" && typeof(UserControl).IsAssignableFrom(t) && !t.IsAbstract)
                .ToList();
            Assert.NotEmpty(views);
            foreach (var viewType in views)
            {
                var view = (UserControl)Activator.CreateInstance(viewType)!;
                var vmType = typeof(ShopApp).Assembly.GetType($"Kagaz.ShopAgent.App.ViewModels.{viewType.Name.Replace("View", "")}ViewModel");
                if (vmType is not null) view.DataContext = host.Services.GetService(vmType);
                Render(view);
            }
            window.Close();
        }
        finally
        {
            app.Dispatcher.InvokeShutdown(); // other tests then marshal nothing to this dead UI thread
            try { Directory.Delete(root, recursive: true); } catch (IOException) { }
        }
    });

    private static void Render(FrameworkElement element)
    {
        element.Measure(new Size(1180, 760));
        element.Arrange(new Rect(0, 0, 1180, 760));
        element.UpdateLayout();
    }

    private static void RunOnSta(Action action)
    {
        ExceptionDispatchInfo? failure = null;
        var thread = new Thread(() =>
        {
            try { action(); }
            catch (Exception ex) { failure = ExceptionDispatchInfo.Capture(ex); }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        failure?.Throw();
    }
}

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class WpfApplicationCollection
{
    public const string Name = "WPF application";
}

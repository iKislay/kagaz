using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.App.ViewModels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace Kagaz.ShopAgent.App;

public sealed partial class App : Application
{
    private const string SingleInstanceMutexName = "Kagaz.ShopAgent.SingleInstance";
    private static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(5);

    private Mutex? _singleInstanceMutex;
    private bool _ownsSingleInstanceMutex;
    private IHost? _host;

    public App()
    {
        AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
    }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _singleInstanceMutex = new Mutex(initiallyOwned: true, name: SingleInstanceMutexName, out bool createdNew);
        _ownsSingleInstanceMutex = createdNew;

        if (!_ownsSingleInstanceMutex)
        {
            _ = MessageBox.Show("Kagaz Shop is already running.", "Kagaz Shop", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        try
        {
            AgentPaths paths = new();
            paths.EnsureCreated();
            Log.Logger = LoggingSetup.CreateLogger(paths);

            _host = HostFactory.CreateHost(paths);
            await _host.StartAsync();

            MainWindow = _host.Services.GetRequiredService<MainWindow>();
            MainWindow.Show();

            // Jobs poller runs on the UI thread (its awaits resume on the dispatcher); the print
            // worker and heartbeat are hosted services.
            var lifetime = _host.Services.GetRequiredService<IHostApplicationLifetime>();
            _ = _host.Services.GetRequiredService<JobsViewModel>().RunAsync(lifetime.ApplicationStopping);
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Kagaz Shop failed to start");
            _ = MessageBox.Show($"Kagaz Shop failed to start: {ex.Message}", "Kagaz Shop", MessageBoxButton.OK, MessageBoxImage.Stop);
            Shutdown();
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            if (_host is not null)
            {
                _host.StopAsync(ShutdownTimeout).GetAwaiter().GetResult();
                _host.Dispose();
            }
        }
        catch
        {
            // Ignore shutdown failures; still close the log.
        }
        finally
        {
            Log.CloseAndFlush();
            if (_ownsSingleInstanceMutex)
            {
                _singleInstanceMutex?.ReleaseMutex();
            }
            _singleInstanceMutex?.Dispose();
            base.OnExit(e);
        }
    }

    private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        Log.Fatal(e.ExceptionObject as Exception, "Unhandled exception terminated the process");
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Error(e.Exception, "Dispatcher unhandled exception");
        e.Handled = true;
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        Log.Error(e.Exception, "Unobserved task exception");
        e.SetObserved();
    }
}

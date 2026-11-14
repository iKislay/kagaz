using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Markup;
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
    private bool _closingOnFatal;

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
            _ = MessageBox.Show("Kaggaz Shop is already running.", "Kaggaz Shop", MessageBoxButton.OK, MessageBoxImage.Information);
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
            Log.Fatal(ex, "Kaggaz Shop failed to start");
            _ = MessageBox.Show($"Kaggaz Shop failed to start: {ex.Message}", "Kaggaz Shop", MessageBoxButton.OK, MessageBoxImage.Stop);
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
        e.Handled = true;
        if (_closingOnFatal) return;
        if (e.Exception is not XamlParseException)
        {
            Log.Error(e.Exception, "Dispatcher unhandled exception");
            return;
        }
        // A broken screen throws again on every layout pass: report it once and close instead of spinning.
        _closingOnFatal = true;
        Log.Fatal(e.Exception, "A Kaggaz Shop screen failed to load");
        _ = MessageBox.Show("Kaggaz Shop hit a problem and needs to close. Please contact Kaggaz support.", "Kaggaz Shop",
            MessageBoxButton.OK, MessageBoxImage.Stop);
        Shutdown(1);
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        Log.Error(e.Exception, "Unobserved task exception");
        e.SetObserved();
    }
}

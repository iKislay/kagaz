using System.IO;
using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Core.Spooler;
using Kagaz.ShopAgent.Printing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Serilog;

namespace Kagaz.ShopAgent.App;

/// <summary>
/// Builds the Generic Host: configuration from <c>appsettings.json</c> (+ environment variables),
/// Serilog logging, DPAPI token store, typed API clients, view models and background services.
/// The app only makes outbound HTTP calls; it never opens a listening port.
/// </summary>
public static class HostFactory
{
    public static IHost CreateHost(AgentPaths paths)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            ContentRootPath = AppContext.BaseDirectory,
        });

        builder.Logging.ClearProviders();
        builder.Logging.AddSerilog(Log.Logger, dispose: false);

        // One settings instance for everyone, so the API URL chosen on the pairing screen
        // (persisted in state.json) is what every client uses.
        var stateStore = new AgentStateStore(Path.Combine(paths.RootDirectory, "state.json"));
        var settings = new AgentSettings();
        builder.Configuration.Bind(settings);
        string? savedApiUrl = stateStore.Load().ApiBaseUrl;
        if (!string.IsNullOrWhiteSpace(savedApiUrl))
        {
            settings.ApiBaseUrl = savedApiUrl;
        }
        settings.AppVersion = typeof(App).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        builder.Services.AddSingleton(settings);
        builder.Services.AddSingleton<IOptions<AgentSettings>>(Options.Create(settings));

        builder.Services.AddSingleton(paths);
        builder.Services.AddSingleton(stateStore);
        builder.Services.AddSingleton<ISecureStore>(_ => new DpapiSecureStore(paths.DeviceTokenPath));
        // Operator token + server signals (revoked / login required / upgrade) — memory only.
        builder.Services.AddSingleton(new AgentSession());
        builder.Services.AddSingleton<AgentSignals>();
        builder.Services.AddSingleton<ISpoolerProbe, SystemPrintingSpoolerProbe>();
        builder.Services.AddSingleton<IUpdateService, NoUpdateService>();
        builder.Services.AddSingleton<AppStatus>();

        builder.Services.AddHttpClient<ShopApiClient>(client => client.Timeout = TimeSpan.FromSeconds(15));
        builder.Services.AddHttpClient<KagazApiClient>(client => client.Timeout = TimeSpan.FromSeconds(5));

        // PDFium + GDI printing run in a helper process so a driver/renderer crash can't take
        // down the app mid-print (it fails that attempt as UNCERTAIN instead).
        builder.Services.AddSingleton<IPrintEngine>(_ => new OutOfProcessPrintEngine(
            Path.Combine(AppContext.BaseDirectory, "Kagaz.ShopAgent.PrintHost.exe"),
            settings.MaxRenderDpi,
            settings.PrintToFileFolder,
            virtualPdfFolder: Path.Combine(paths.RootDirectory, "print-to-pdf")));

        builder.Services.AddSingleton(_ => new PrinterReachability());

        builder.Services.AddSingleton<PairingViewModel>();
        builder.Services.AddSingleton<OperatorLoginViewModel>();
        builder.Services.AddSingleton<PrintersViewModel>();
        builder.Services.AddSingleton<JobsViewModel>();
        builder.Services.AddSingleton<PickupViewModel>();
        builder.Services.AddSingleton<SettingsViewModel>();
        builder.Services.AddSingleton<ShopModeViewModel>();
        builder.Services.AddSingleton<UpdateViewModel>();
        builder.Services.AddSingleton<ShellViewModel>();
        builder.Services.AddSingleton<MainWindow>();

        builder.Services.AddHostedService<HeartbeatService>();
        builder.Services.AddHostedService<PrintWorkerService>();
        builder.Services.AddHostedService<RealtimeService>();
        builder.Services.AddSingleton<TokenRotationService>();
        builder.Services.AddHostedService(sp => sp.GetRequiredService<TokenRotationService>());

        return builder.Build();
    }
}

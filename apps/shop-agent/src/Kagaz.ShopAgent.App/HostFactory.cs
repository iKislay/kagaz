using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Serilog;

namespace Kagaz.ShopAgent.App;

public static class HostFactory
{
    public static IHost CreateHost(AgentPaths paths)
    {
        HostApplicationBuilder builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            ContentRootPath = AppContext.BaseDirectory,
        });

        builder.Logging.ClearProviders();
        builder.Logging.AddSerilog(Log.Logger, dispose: false);

        builder.Services.Configure<AgentSettings>(builder.Configuration);
        builder.Services.AddSingleton(paths);
        builder.Services.AddSingleton<ISecureStore>(sp => new DpapiSecureStore(paths.DeviceTokenPath));

        builder.Services.AddHttpClient<KagazApiClient>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(5);
        });

        builder.Services.AddSingleton<ShellViewModel>();
        builder.Services.AddSingleton<MainWindow>();
        builder.Services.AddHostedService<Services.ConnectionMonitor>();

        return builder.Build();
    }
}

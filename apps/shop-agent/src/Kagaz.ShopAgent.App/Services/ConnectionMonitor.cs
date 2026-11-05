using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Kagaz.ShopAgent.App.Services;

internal sealed class ConnectionMonitor : BackgroundService
{
    private readonly KagazApiClient _apiClient;
    private readonly ShellViewModel _shell;
    private readonly IOptions<AgentSettings> _settings;

    public ConnectionMonitor(KagazApiClient apiClient, ShellViewModel shell, IOptions<AgentSettings> settings)
    {
        _apiClient = apiClient;
        _shell = shell;
        _settings = settings;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            HealthResult result = await _apiClient.GetHealthAsync(stoppingToken);
            await _shell.UpdateConnectionAsync(result);

            int seconds = _settings.Value.HeartbeatSeconds > 0 ? _settings.Value.HeartbeatSeconds : 15;
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(seconds), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}

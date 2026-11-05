using Serilog;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Builds the Serilog logger used by the agent: a rolling daily file in the logs folder (14 retained)
/// plus Debug output. The device token is never logged.
/// </summary>
public static class LoggingSetup
{
    public static Serilog.ILogger CreateLogger(AgentPaths paths)
    {
        paths.EnsureCreated();

        return new Serilog.LoggerConfiguration()
            .MinimumLevel.Information()
            .Enrich.FromLogContext()
            .WriteTo.Sink(new DebugSink())
            .WriteTo.File(
                path: Path.Combine(paths.LogsDirectory, "agent-.log"),
                rollingInterval: Serilog.RollingInterval.Day,
                retainedFileCountLimit: 14,
                shared: true,
                flushToDiskInterval: TimeSpan.FromSeconds(1))
            .CreateLogger();
    }
}

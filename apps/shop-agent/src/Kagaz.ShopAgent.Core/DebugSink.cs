using System.Diagnostics;
using Serilog.Core;
using Serilog.Events;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Serilog sink that writes log events to <see cref="Debug.WriteLine(string?)"/>
/// so they appear in debugger/trace output. The device token is never logged.
/// </summary>
public sealed class DebugSink : ILogEventSink
{
    public void Emit(LogEvent logEvent)
    {
        Debug.WriteLine(logEvent.RenderMessage());
    }
}

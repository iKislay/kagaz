namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Agent configuration bound from <c>appsettings.json</c>.
/// The device token is intentionally NOT stored here; it is kept in the DPAPI-protected device token store.
/// </summary>
public sealed class AgentSettings
{
    public string ApiBaseUrl { get; set; } = "http://localhost:4000/api";
    /// <summary>Jobs poll while the realtime socket is down (the socket-up safety poll is <see cref="SafetyPollSeconds"/>).</summary>
    public int PollIntervalSeconds { get; set; } = 5;
    /// <summary>REST safety poll while the realtime socket is connected (P2.9: 10 s).</summary>
    public int SafetyPollSeconds { get; set; } = 10;
    public int HeartbeatSeconds { get; set; } = 15;
    /// <summary>Rotate the device token this often (P2.4); 0 disables automatic rotation.</summary>
    public int TokenRotationDays { get; set; } = 7;
    /// <summary>Realtime hints over Socket.IO <c>/shop</c> (P2.9). The app works fully with it off.</summary>
    public bool RealtimeEnabled { get; set; } = true;
    /// <summary>Velopack update feed (folder or https URL); empty disables update checks (P5.4).</summary>
    public string? UpdateFeedUrl { get; set; }
    public string PrintEngine { get; set; } = "Pdfium";
    public int MaxRenderDpi { get; set; } = 300;
    /// <summary>Testing only: print every job to a PDF file in this folder instead of paper.</summary>
    public string? PrintToFileFolder { get; set; }

    /// <summary>This build's version (set at startup, sent as <c>X-Agent-Version</c> and in the heartbeat).</summary>
    public string AppVersion { get; set; } = "0.0.0";
}

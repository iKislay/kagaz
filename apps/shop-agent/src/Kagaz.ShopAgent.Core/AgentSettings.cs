namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Agent configuration bound from <c>appsettings.json</c>.
/// The device token is intentionally NOT stored here; it is kept in the DPAPI-protected device token store.
/// </summary>
public sealed class AgentSettings
{
    public string ApiBaseUrl { get; set; } = "http://localhost:4000/api";
    public int PollIntervalSeconds { get; set; } = 5;
    public int HeartbeatSeconds { get; set; } = 15;
    public string PrintEngine { get; set; } = "Pdfium";
    public int MaxRenderDpi { get; set; } = 300;
    /// <summary>Testing only: print every job to a PDF file in this folder instead of paper.</summary>
    public string? PrintToFileFolder { get; set; }
}

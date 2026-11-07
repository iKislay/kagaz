namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Thrown by <see cref="IPrintEngine"/> implementations when a job cannot be printed
/// (e.g. capability mismatch or printer unavailable). <see cref="Code"/> is reported to the API.
/// </summary>
public sealed class PrintEngineException : Exception
{
    public const string UnsupportedSetting = "UNSUPPORTED_SETTING";
    /// <summary>No printer with this name is installed on this PC.</summary>
    public const string PrinterNotFound = "PRINTER_NOT_FOUND";
    /// <summary>
    /// Installed, but the driver can't open the device (e.g. the IPP class driver's CreateIC fails
    /// with error 995 when the printer is off, asleep or disconnected). Nothing was printed.
    /// </summary>
    public const string PrinterUnreachable = "PRINTER_UNREACHABLE";
    public const string PrinterUnreachableMessage = "Printer is installed but not responding — check it is on, awake and connected";
    public const string InvalidPacket = "INVALID_PACKET";
    public const string Incomplete = "INCOMPLETE";

    public PrintEngineException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

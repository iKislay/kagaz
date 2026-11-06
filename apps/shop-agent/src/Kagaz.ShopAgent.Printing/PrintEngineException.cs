namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Thrown by <see cref="IPrintEngine"/> implementations when a job cannot be printed
/// (e.g. capability mismatch or printer unavailable). <see cref="Code"/> is reported to the API.
/// </summary>
public sealed class PrintEngineException : Exception
{
    public const string UnsupportedSetting = "UNSUPPORTED_SETTING";
    public const string PrinterNotFound = "PRINTER_NOT_FOUND";
    public const string InvalidPacket = "INVALID_PACKET";
    public const string Incomplete = "INCOMPLETE";

    public PrintEngineException(string code, string message) : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

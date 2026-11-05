namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Print request for a single copy of a packet.
/// Copies is always 1 by design, so there is no copies parameter.
/// </summary>
/// <param name="PrinterName">Name of the target printer.</param>
/// <param name="Colour">Print in colour.</param>
/// <param name="Duplex">Print duplex.</param>
/// <param name="PaperSize">Paper size, e.g. A4.</param>
/// <param name="DocumentName">
/// Document name used for the spooler job. Must be <c>KAGAZ-&lt;publicRef&gt;-A&lt;attempt&gt;</c>
/// so the spooler job can be located during reconciliation.
/// </param>
public record PrintRequest(string PrinterName, bool Colour, bool Duplex, string PaperSize, string DocumentName);

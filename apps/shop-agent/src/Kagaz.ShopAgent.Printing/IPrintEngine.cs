namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Abstracts submitting a print job to a local printer behind <see cref="IPrintEngine"/>.
/// </summary>
public interface IPrintEngine
{
    /// <summary>
    /// Prints the supplied packet PDF as a single spooler job.
    /// </summary>
    /// <param name="pdfPath">Local path to the combined PDF packet.</param>
    /// <param name="request">Print request.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result describing the submitted spooler job.</returns>
    Task<PrintSubmission> PrintAsync(string pdfPath, PrintRequest request, CancellationToken ct);
}

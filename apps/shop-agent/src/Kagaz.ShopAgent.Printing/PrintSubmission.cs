namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Result of a print submission.
/// </summary>
/// <param name="SpoolerJobId">Spooler job identifier if it was found in the queue, otherwise null.</param>
/// <param name="DocumentName">Document name used for the spooler job.</param>
/// <param name="PagesSent">Number of packet pages rendered into the one spooler job.</param>
public record PrintSubmission(int? SpoolerJobId, string DocumentName, int PagesSent);

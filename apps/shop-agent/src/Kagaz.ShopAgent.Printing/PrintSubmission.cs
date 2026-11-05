namespace Kagaz.ShopAgent.Printing;

/// <summary>
/// Result of a print submission.
/// </summary>
/// <param name="SpoolerJobId">Spooler job identifier if available, otherwise null.</param>
/// <param name="DocumentName">Document name used for the spooler job.</param>
public record PrintSubmission(int? SpoolerJobId, string DocumentName);

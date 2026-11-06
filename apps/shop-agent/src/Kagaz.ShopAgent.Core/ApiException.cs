namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Thrown by the shop API client when the server responds with an error status.
/// Carries the stable error code from the <c>{ error: { code, message } }</c> envelope.
/// </summary>
public sealed class ApiException : Exception
{
    public string Code { get; }

    public ApiException(string code, string message) : base(message)
    {
        Code = code;
    }
}

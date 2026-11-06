using System.Text.Json;

namespace Kagaz.ShopAgent.Core;

/// <summary>
/// Shared JSON options for the shop API client.
/// Requests are serialized camelCase; responses are read case-insensitively.
/// </summary>
public static class JsonOptions
{
    public static readonly JsonSerializerOptions Request = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public static readonly JsonSerializerOptions Response = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}

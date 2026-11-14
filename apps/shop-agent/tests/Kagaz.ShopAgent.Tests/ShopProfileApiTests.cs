using System.Net;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>Shop profile / places / owner pages: request shapes and response parsing.</summary>
public class ShopProfileApiTests
{
    private static (ShopApiClient Client, List<(HttpMethod Method, string Url, string? Body)> Calls) Client(string responseJson)
    {
        var calls = new List<(HttpMethod, string, string?)>();
        var handler = new StubHttpMessageHandler(async (req, ct) =>
        {
            calls.Add((req.Method, req.RequestUri!.AbsoluteUri, req.Content is null ? null : await req.Content.ReadAsStringAsync(ct)));
            return TestApi.Ok(responseJson);
        });
        return (TestApi.Client(handler), calls);
    }

    private const string Profile = """
        { "name": "Raju Prints", "contactPhone": "+919876543210", "address": "Shop 4, Hospital Road, Mandya",
          "location": { "lat": 12.5223, "lng": 76.8975 }, "setupComplete": false }
        """;

    [Fact]
    public async Task Profile_parses_location_and_setup_state()
    {
        var (client, _) = Client(Profile);
        var p = await client.GetProfileAsync();
        Assert.Equal("Raju Prints", p.Name);
        Assert.Equal(new GeoPoint(12.5223, 76.8975), p.Location);
        Assert.False(p.SetupComplete);
    }

    [Fact]
    public async Task Profile_update_sends_only_the_changed_fields()
    {
        var (client, calls) = Client(Profile);
        await client.UpdateProfileAsync(new UpdateShopProfileRequest(Name: "Raju Prints"));
        Assert.Equal(HttpMethod.Patch, calls[0].Method);
        Assert.Equal("""{"name":"Raju Prints"}""", calls[0].Body);
    }

    [Fact]
    public async Task Place_search_escapes_the_query_and_reverse_uses_invariant_numbers()
    {
        var (client, calls) = Client("""{ "places": [ { "name": "Bus Stand", "address": "Bus Stand, Mandya", "lat": 12.52, "lng": 76.89 } ], "address": "Near X" }""");
        var places = await client.SearchPlacesAsync("bus stand & co");
        Assert.Equal("Bus Stand", Assert.Single(places).Name);
        Assert.EndsWith("/shop/places?q=bus%20stand%20%26%20co", calls[0].Url);

        var previous = Thread.CurrentThread.CurrentCulture;
        Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE"); // decimal comma
        try { Assert.Equal("Near X", await client.ReversePlaceAsync(12.5, 76.25)); }
        finally { Thread.CurrentThread.CurrentCulture = previous; }
        Assert.EndsWith("/shop/places/reverse?lat=12.5&lng=76.25", calls[1].Url);
    }

    [Fact]
    public async Task Location_puts_pin_and_edited_address()
    {
        var (client, calls) = Client(Profile);
        await client.SetLocationAsync(new ShopLocationRequest(12.5223, 76.8975, "Shop 4, Hospital Road, Mandya"));
        Assert.Equal(HttpMethod.Put, calls[0].Method);
        Assert.Equal("""{"lat":12.5223,"lng":76.8975,"address":"Shop 4, Hospital Road, Mandya"}""", calls[0].Body);
    }

    [Fact]
    public async Task Members_are_read_from_the_members_envelope()
    {
        var (client, _) = Client("""{ "members": [ { "userId": "u-1", "name": "Raju", "phone": "+919876543210", "role": "OWNER" } ] }""");
        Assert.Equal("Raju", Assert.Single(await client.GetMembersAsync()).Name);
    }

    [Fact]
    public async Task A_shop_without_prices_yet_reads_as_null()
    {
        var (client, _) = Client("");
        Assert.Null(await client.GetPricingAsync());
    }

    [Fact]
    public async Task An_unreadable_body_is_an_api_error_not_a_crash()
    {
        var (client, _) = Client("""[1, 2, 3]""");
        var ex = await Assert.ThrowsAsync<ApiException>(() => client.GetProfileAsync());
        Assert.Equal("INVALID_RESPONSE", ex.Code);
    }
}

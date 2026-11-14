using Kagaz.ShopAgent.App.Services;
using Kagaz.ShopAgent.App.ViewModels;
using Kagaz.ShopAgent.Core;
using Kagaz.ShopAgent.Tests.Fakes;

namespace Kagaz.ShopAgent.Tests;

/// <summary>First-run setup: each step is saved when the owner continues; the location is a pin + an editable address.</summary>
public sealed class SetupViewModelTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "kagaz-setup-" + Guid.NewGuid().ToString("N"));
    private readonly List<(string Method, string Path, string? Body)> _calls = new();
    private bool _setupComplete;

    private sealed class FakeLocation(LocationFix? fix) : ILocationService
    {
        public Task<LocationFix> GetCurrentAsync(CancellationToken ct) =>
            fix is null ? throw new LocationUnavailableException("Location is off", settingsCanFix: true) : Task.FromResult(fix);
    }

    private string Profile => $$"""
        { "name": "Raju Prints", "contactPhone": "+919876543210", "address": null, "location": null, "setupComplete": {{(_setupComplete ? "true" : "false")}} }
        """;

    private (SetupViewModel Setup, AppStatus Status) Create(LocationFix? fix = null)
    {
        var handler = new StubHttpMessageHandler(async (req, ct) =>
        {
            string path = req.RequestUri!.AbsolutePath;
            _calls.Add((req.Method.Method, path, req.Content is null ? null : await req.Content.ReadAsStringAsync(ct)));
            if (path.EndsWith("/complete-setup")) _setupComplete = true;
            return path switch
            {
                "/api/shop/pricing" => TestApi.Ok("""{ "monoRatePaise": 200, "colourRatePaise": 1000, "monoDuplexRatePaise": null, "colourDuplexRatePaise": null, "duplexRule": "SAME_AS_SIMPLEX", "minimumChargePaise": 500 }"""),
                "/api/shop/places/reverse" => TestApi.Ok("""{ "address": "Near Perfect Gym, Bannur Road, Mandya, 571401" }"""),
                _ => TestApi.Ok(Profile),
            };
        });
        var session = new AgentSession();
        session.SignIn(new OperatorLoginResponse("op-jwt", "2099-01-01T00:00:00Z", new OperatorInfo("u", "Raju", "SHOP_OWNER")));
        Directory.CreateDirectory(_root);
        var status = new AppStatus(new FakeSecureStore("device-token"), new AgentStateStore(Path.Combine(_root, "state.json")), session);
        var api = TestApi.Client(handler, session: session);
        return (new SetupViewModel(api, status, new FakeLocation(fix), new PricesViewModel(api)), status);
    }

    [Fact]
    public async Task Details_are_saved_before_moving_on()
    {
        var (setup, _) = Create();
        await setup.LoadAsync();
        Assert.Equal(SetupStep.Details, setup.Step);
        Assert.Equal("98765 43210", setup.ContactPhone);

        setup.ShopName = "Raju Xerox and Prints";
        await setup.SaveDetailsCommand.ExecuteAsync(null);

        Assert.Contains(_calls, c => c is { Method: "PATCH", Path: "/api/shop/profile" } && c.Body!.Contains("Raju Xerox and Prints"));
        Assert.Equal(SetupStep.Location, setup.Step);
    }

    [Fact]
    public async Task A_vague_pc_location_is_refused_and_location_off_offers_settings()
    {
        var (vague, _) = Create(new LocationFix(12.5, 76.9, 25_000));
        await vague.UseCurrentLocationCommand.ExecuteAsync(null);
        Assert.False(vague.HasPin);
        Assert.Contains("25 km", vague.Error);

        var (off, _) = Create(fix: null);
        await off.UseCurrentLocationCommand.ExecuteAsync(null);
        Assert.False(off.HasPin);
        Assert.True(off.CanOpenLocationSettings);
    }

    [Fact]
    public async Task Pc_location_suggests_an_address_the_owner_edits_before_saving()
    {
        var (setup, _) = Create(new LocationFix(12.51663, 76.88216, 108));
        await setup.LoadAsync();
        setup.Step = SetupStep.Location;

        await setup.UseCurrentLocationCommand.ExecuteAsync(null);
        Assert.Equal("Near Perfect Gym, Bannur Road, Mandya, 571401", setup.Address);

        setup.Address = "Shop 4, Bannur Road, Mandya, 571401";
        await setup.SaveLocationCommand.ExecuteAsync(null);

        var put = Assert.Single(_calls, c => c is { Method: "PUT", Path: "/api/shop/location" });
        Assert.Equal("""{"lat":12.51663,"lng":76.88216,"address":"Shop 4, Bannur Road, Mandya, 571401"}""", put.Body);
        Assert.Equal(SetupStep.Prices, setup.Step);
    }

    [Fact]
    public async Task Picking_a_search_result_sets_the_pin_and_address()
    {
        var (setup, _) = Create();
        setup.SelectedPlace = new Place("KSRTC Bus Stand", "KSRTC Bus Stand, Mandya, 571401", 12.52, 76.89);

        Assert.Equal(new GeoPoint(12.52, 76.89), setup.Pin);
        Assert.Equal("KSRTC Bus Stand, Mandya, 571401", setup.Address);
        Assert.Equal("KSRTC Bus Stand", setup.SearchText);
        Assert.Empty(setup.Suggestions);
    }

    [Fact]
    public async Task Without_a_pin_the_location_step_does_not_save()
    {
        var (setup, _) = Create();
        setup.Step = SetupStep.Location;
        await setup.SaveLocationCommand.ExecuteAsync(null);
        Assert.DoesNotContain(_calls, c => c.Path == "/api/shop/location");
        Assert.Equal(SetupStep.Location, setup.Step);
    }

    [Fact]
    public async Task Finish_saves_prices_then_completes_setup()
    {
        var (setup, status) = Create();
        await setup.LoadAsync();
        setup.Step = SetupStep.Prices;

        await setup.FinishCommand.ExecuteAsync(null);

        var order = _calls.Where(c => c.Method != "GET").Select(c => c.Path).ToList();
        Assert.Equal(["/api/shop/pricing", "/api/shop/profile/complete-setup"], order);
        Assert.True(status.ShopSetupComplete);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }
}

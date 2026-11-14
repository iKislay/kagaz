using Windows.Devices.Geolocation;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>Where this PC is, as Windows knows it (Wi-Fi positioning on most shop PCs).</summary>
public sealed record LocationFix(double Lat, double Lng, double AccuracyMeters);

/// <summary>Windows couldn't give a position. <see cref="SettingsCanFix"/>: location is off or blocked for apps.</summary>
public sealed class LocationUnavailableException(string message, bool settingsCanFix) : Exception(message)
{
    public bool SettingsCanFix { get; } = settingsCanFix;
}

public interface ILocationService
{
    /// <exception cref="LocationUnavailableException">Location is off, blocked or timed out.</exception>
    Task<LocationFix> GetCurrentAsync(CancellationToken ct);
}

/// <summary><see cref="ILocationService"/> over <c>Windows.Devices.Geolocation</c>.</summary>
public sealed class WindowsLocationService : ILocationService
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public async Task<LocationFix> GetCurrentAsync(CancellationToken ct)
    {
        var access = await Geolocator.RequestAccessAsync().AsTask(ct);
        if (access != GeolocationAccessStatus.Allowed)
        {
            throw new LocationUnavailableException(
                "Windows location is turned off for this PC or for apps. Turn it on in Settings, or search for your shop instead.",
                settingsCanFix: true);
        }
        try
        {
            var locator = new Geolocator { DesiredAccuracy = PositionAccuracy.High };
            var position = await locator.GetGeopositionAsync(maximumAge: TimeSpan.Zero, timeout: Timeout).AsTask(ct);
            var point = position.Coordinate.Point.Position;
            return new LocationFix(point.Latitude, point.Longitude, position.Coordinate.Accuracy);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Timeout (no Wi-Fi to locate by) or the location service stopped.
            throw new LocationUnavailableException(
                "This PC couldn't find its location. Turn on Wi-Fi (it doesn't need to connect), or search for your shop instead.",
                settingsCanFix: false);
        }
    }
}

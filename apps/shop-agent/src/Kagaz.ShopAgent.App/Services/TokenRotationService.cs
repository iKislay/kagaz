using System.IO;
using Kagaz.ShopAgent.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Rotates the device token every <see cref="AgentSettings.TokenRotationDays"/> (P2.4) and on demand
/// from Settings. <c>POST /devices/rotate-token</c> invalidates the old token at once, so the new one
/// is written to the DPAPI store atomically (write-then-rename) before anything else uses it.
/// </summary>
public sealed class TokenRotationService : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);

    private readonly ShopApiClient _api;
    private readonly AgentStateStore _state;
    private readonly AgentSettings _settings;
    private readonly AppStatus _status;
    private readonly ILogger<TokenRotationService> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public TokenRotationService(ShopApiClient api, AgentStateStore state, AgentSettings settings, AppStatus status,
        ILogger<TokenRotationService> log)
    {
        _api = api;
        _state = state;
        _settings = settings;
        _status = status;
        _log = log;
    }

    public DateTimeOffset? LastRotatedAt => _state.Load().TokenRotatedAt;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } // let startup settle first
            catch (OperationCanceledException) { return; }

            if (_status.IsPaired)
            {
                var last = _state.Load().TokenRotatedAt;
                if (last is null)
                {
                    _state.Update(s => s.TokenRotatedAt = DateTimeOffset.UtcNow); // baseline, see TokenRotationPolicy
                }
                else if (TokenRotationPolicy.IsDue(last, DateTimeOffset.UtcNow, _settings.TokenRotationDays))
                {
                    await RotateAsync(stoppingToken);
                }
            }

            try { await Task.Delay(CheckInterval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>Rotate now. Returns null on success, else a message for the operator.</summary>
    public async Task<string?> RotateAsync(CancellationToken ct = default)
    {
        if (!await _gate.WaitAsync(0, ct)) return "A rotation is already in progress.";
        try
        {
            await _api.RotateTokenAsync(ct);
            _state.Update(s => s.TokenRotatedAt = DateTimeOffset.UtcNow);
            _log.LogInformation("Device token rotated");
            return null;
        }
        catch (ApiException ex)
        {
            _log.LogWarning("Device token rotation failed: {Code}", ex.Code);
            return ex.Code == ApiErrorCodes.NetworkError ? "Can't reach the Kagaz server." : ex.Message;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
        {
            // The server already issued a new token; failing to store it means re-pairing.
            _log.LogError(ex, "Could not store the rotated device token");
            return "The new device token could not be saved. Re-pair this PC if it stops connecting.";
        }
        finally
        {
            _gate.Release();
        }
    }

    public override void Dispose()
    {
        _gate.Dispose();
        base.Dispose();
    }
}

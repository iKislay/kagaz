namespace Kagaz.ShopAgent.Core;

/// <summary>
/// A broadcast wake-up: every waiter is released by <see cref="Pulse"/>, or by its own timeout.
/// Used so realtime hints (P2.9) shortcut the REST polls without replacing them (invariant 13).
/// </summary>
public sealed class WakeSignal
{
    private TaskCompletionSource _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object _gate = new();

    public void Pulse()
    {
        TaskCompletionSource toRelease;
        lock (_gate)
        {
            toRelease = _tcs;
            _tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        toRelease.TrySetResult();
    }

    /// <summary>Completes on the next <see cref="Pulse"/> or after <paramref name="timeout"/>. Returns true if pulsed.</summary>
    public async Task<bool> WaitAsync(TimeSpan timeout, CancellationToken ct)
    {
        Task pulse;
        lock (_gate) pulse = _tcs.Task;
        var delay = Task.Delay(timeout, ct);
        var first = await Task.WhenAny(pulse, delay).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        return first == pulse;
    }
}

/// <summary>App-wide wake signals (singleton).</summary>
public sealed class AgentSignals
{
    /// <summary>Jobs changed on the server (socket <c>job.created</c>/<c>job.updated</c>, or a local action).</summary>
    public WakeSignal Jobs { get; } = new();

    /// <summary>Send a heartbeat now (e.g. socket <c>device.revoked</c> hint — the REST answer decides).</summary>
    public WakeSignal Heartbeat { get; } = new();

    private int _connectionEpoch;

    /// <summary>Bumped every time the server becomes reachable again; the worker reconciles on change (A.3).</summary>
    public int ConnectionEpoch => Volatile.Read(ref _connectionEpoch);

    public void MarkReconnected()
    {
        Interlocked.Increment(ref _connectionEpoch);
        Jobs.Pulse();
    }
}

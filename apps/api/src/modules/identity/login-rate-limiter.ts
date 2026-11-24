const MAX_TRACKED_KEYS = 10_000;

/**
 * In-memory sliding-window limiter for failed logins (single API instance in the prototype;
 * PostgreSQL-backed limits are a Phase 5 hardening item). Only failures count.
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 10 * 60 * 1000,
  ) {}

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.maxFailures;
  }

  /** Records a failure; returns true when the key is now blocked. */
  fail(key: string): boolean {
    if (this.failures.size >= MAX_TRACKED_KEYS) this.sweep();
    const attempts = [...this.recent(key), Date.now()];
    this.failures.set(key, attempts);
    return attempts.length >= this.maxFailures;
  }

  /** Number of keys currently tracked (tests). */
  get size(): number {
    return this.failures.size;
  }

  /**
   * Drops expired keys, so spraying unique logins/IPs can't grow memory without bound
   * (security audit 2026-11-24, L-4). If everything is still live, the oldest keys go.
   */
  private sweep(): void {
    for (const key of [...this.failures.keys()]) this.recent(key);
    const excess = this.failures.size - MAX_TRACKED_KEYS / 2;
    if (excess <= 0) return;
    let dropped = 0;
    for (const key of this.failures.keys()) {
      if (dropped++ >= excess) break;
      this.failures.delete(key);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const now = Date.now();
    const attempts = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (attempts.length === 0) this.failures.delete(key);
    else this.failures.set(key, attempts);
    return attempts;
  }
}

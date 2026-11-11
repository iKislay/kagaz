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
    const attempts = [...this.recent(key), Date.now()];
    this.failures.set(key, attempts);
    return attempts.length >= this.maxFailures;
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

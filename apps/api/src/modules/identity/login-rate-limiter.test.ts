import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './login-rate-limiter.js';

describe('LoginRateLimiter', () => {
  it('blocks a key after maxFailures within the window and resets on success', () => {
    const limiter = new LoginRateLimiter(3, 60_000);
    expect(limiter.fail('a')).toBe(false);
    expect(limiter.fail('a')).toBe(false);
    expect(limiter.isBlocked('a')).toBe(false);
    expect(limiter.fail('a')).toBe(true);
    expect(limiter.isBlocked('a')).toBe(true);
    expect(limiter.isBlocked('b')).toBe(false);
    limiter.reset('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('audit L-4: spraying unique keys cannot grow memory without bound', () => {
    const limiter = new LoginRateLimiter(5, 60_000);
    for (let i = 0; i < 25_000; i++) limiter.fail(`ip-${i}|login-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(10_000);
  });

  it('expired keys are swept first', () => {
    const limiter = new LoginRateLimiter(5, 1); // 1 ms window: everything expires at once
    for (let i = 0; i < 10_000; i++) limiter.fail(`k${i}`);
    const until = Date.now() + 5;
    while (Date.now() < until) {
      // let the 1 ms window pass
    }
    limiter.fail('fresh');
    expect(limiter.size).toBe(1);
  });
});

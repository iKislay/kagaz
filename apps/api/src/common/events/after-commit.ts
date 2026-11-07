import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * "Run this after the surrounding DB transaction commits" (CLAUDE.md invariant 5: realtime
 * events are emitted after commit). PrismaService.$transaction opens a commit scope; code inside
 * the transaction registers callbacks with afterCommit(); they run only once the transaction
 * resolved. If it throws (rollback), the callbacks are dropped.
 */
interface CommitScope {
  callbacks: Array<() => void>;
}

const storage = new AsyncLocalStorage<CommitScope>();

export async function runInCommitScope<T>(
  fn: () => Promise<T>,
  onCallbackError?: (err: unknown) => void,
): Promise<T> {
  const scope: CommitScope = { callbacks: [] };
  const result = await storage.run(scope, fn);
  for (const cb of scope.callbacks) {
    try {
      cb();
    } catch (err) {
      onCallbackError?.(err);
    }
  }
  return result;
}

/**
 * Defers `cb` until the current transaction commits. Outside a transaction scope (autocommit
 * writes) the work is already durable, so it runs on the next tick.
 */
export function afterCommit(cb: () => void): void {
  const scope = storage.getStore();
  if (scope) scope.callbacks.push(cb);
  else setImmediate(cb);
}

/** True inside PrismaService.$transaction (useful for tests and assertions). */
export function inCommitScope(): boolean {
  return storage.getStore() !== undefined;
}

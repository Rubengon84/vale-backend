// Work that must not slow down or break the request that triggered it, such
// as sending emails. Errors are logged, never thrown.
const pending = new Set();

export function inBackground(task, label) {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => console.error(`[background] ${label} failed:`, error))
    .finally(() => pending.delete(promise));
  pending.add(promise);
}

// For tests and shutdown: wait until all background work has finished.
export async function flushBackground() {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

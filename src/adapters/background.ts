const pending = new Set<Promise<unknown>>();

export function trackAdapterTask<T>(task: Promise<T>): void {
  const tracked = task.catch(() => undefined);
  pending.add(tracked);
  void tracked.finally(() => pending.delete(tracked));
}

export async function settleAdapterTasks(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

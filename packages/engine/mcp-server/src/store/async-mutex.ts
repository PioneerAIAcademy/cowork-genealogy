// AsyncMutex — the per-project FIFO queue both ProjectStore backends put in
// front of a writer body. The file backend's whole lock is this queue; the
// Postgres backend queues in-process first so bodies for one project run in
// arrival order and only one of them holds a pool connection while it waits on
// the database's advisory lock.

/** A FIFO async mutex: `run` queues its callback behind every earlier one and
 *  releases the next only after this one settles (resolve OR reject). */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    // Reassigned synchronously, before the first await below, so callers arriving
    // in the same tick chain in arrival order rather than racing on `tail`.
    this.tail = new Promise<void>((resolve) => (release = resolve));
    return prev.then(fn).finally(release);
  }
}

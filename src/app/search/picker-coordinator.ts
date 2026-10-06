/** Owns replies by operation and by the complete question that produced them. */
export class PickerCoordinator {
  private readonly operations = new Map<string, { controller: AbortController; status: string }>();
  private alive = true;

  begin(key: string, context: () => string) {
    this.operations.get(key)?.controller.abort();
    const owner = { controller: new AbortController(), status: 'pending' };
    const identity = context();
    if (this.alive) this.operations.set(key, owner);
    const current = () =>
      this.alive && this.operations.get(key) === owner && !owner.controller.signal.aborted && context() === identity;
    return {
      signal: owner.controller.signal,
      current,
      finish: () => {
        if (current()) owner.status = 'ready';
      },
      fail: () => {
        if (current()) owner.status = 'error';
      },
    };
  }

  reset() {
    for (const operation of this.operations.values()) operation.controller.abort();
    this.operations.clear();
  }
  dispose() {
    this.reset();
    this.alive = false;
  }
  get active() {
    return this.alive;
  }
  get report() {
    return [...this.operations].map(([scope, operation]) => ({ scope, status: operation.status }));
  }
}

export interface LifecycleService {
  readonly name: string;
  start(signal: AbortSignal): Promise<void> | void;
  stop(): Promise<void> | void;
}

/** Owns cancellation and deterministic reverse-order teardown for long-lived services. */
export class LifecycleRegistry {
  private readonly services: LifecycleService[] = [];
  private readonly started: LifecycleService[] = [];
  private controller: AbortController | null = null;

  register(service: LifecycleService): void {
    if (this.controller) throw new Error("Cannot register lifecycle services after startup");
    if (this.services.some((candidate) => candidate.name === service.name)) {
      throw new Error(`Lifecycle service '${service.name}' is already registered`);
    }
    this.services.push(service);
  }

  async startAll(): Promise<void> {
    if (this.controller) return;
    this.controller = new AbortController();
    try {
      for (const service of this.services) {
        await service.start(this.controller.signal);
        this.started.push(service);
      }
    } catch (error) {
      await this.stopAll();
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    this.controller?.abort();
    this.controller = null;
    const failures: unknown[] = [];
    for (const service of this.started.splice(0).reverse()) {
      try {
        await service.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Lifecycle teardown failed");
  }
}

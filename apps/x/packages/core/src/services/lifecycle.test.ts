import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LifecycleRegistry, type LifecycleService } from "./lifecycle.js";

function service(name: string, log: string[]): LifecycleService {
  return {
    name,
    start(signal) {
      expect(signal.aborted).toBe(false);
      log.push(`start:${name}`);
    },
    stop() {
      log.push(`stop:${name}`);
    },
  };
}

describe("LifecycleRegistry", () => {
  it("starts in registration order and stops in reverse order", async () => {
    const log: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(service("one", log));
    registry.register(service("two", log));
    await registry.startAll();
    await registry.stopAll();
    expect(log).toEqual(["start:one", "start:two", "stop:two", "stop:one"]);
  });

  it("tears down already-started services when startup fails", async () => {
    const log: string[] = [];
    const registry = new LifecycleRegistry();
    registry.register(service("one", log));
    registry.register({
      name: "broken",
      start() {
        throw new Error("boom");
      },
      stop() {},
    });
    await expect(registry.startAll()).rejects.toThrow("boom");
    expect(log).toEqual(["start:one", "stop:one"]);
  });

  it("preserves ordered startup and reverse teardown for generated service graphs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 20 }),
        fc.nat(),
        async (names, failureSeed) => {
          const failureIndex = failureSeed % (names.length + 1);
          const log: string[] = [];
          const signals: AbortSignal[] = [];
          const registry = new LifecycleRegistry();
          names.forEach((name, index) => {
            registry.register({
              name,
              start(signal) {
                signals.push(signal);
                if (index === failureIndex) throw new Error("generated failure");
                log.push(`start:${name}`);
              },
              stop() {
                log.push(`stop:${name}`);
              },
            });
          });

          if (failureIndex < names.length) {
            await expect(registry.startAll()).rejects.toThrow("generated failure");
          } else {
            await registry.startAll();
            await registry.stopAll();
          }

          const startedNames = names.slice(0, failureIndex);
          expect(log).toEqual([
            ...startedNames.map((name) => `start:${name}`),
            ...startedNames.reverse().map((name) => `stop:${name}`),
          ]);
          expect(signals.every((signal) => signal.aborted)).toBe(true);
        },
      ),
      { numRuns: 250 },
    );
  });
});

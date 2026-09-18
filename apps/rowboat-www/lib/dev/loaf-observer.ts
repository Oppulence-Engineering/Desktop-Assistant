export type LoafEntry = {
  id: string;
  duration: number;
  startTime: number;
  source?: string;
};

const MAX_ENTRIES = 20;

let entries: LoafEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function getLoafLog(): readonly LoafEntry[] {
  return entries;
}

export function subscribeLoafLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearLoafLog(): void {
  entries = [];
  notify();
}

declare global {
  interface Window {
    __oppulenceLoafObserver?: PerformanceObserver;
  }
}

/** Observe long animation frames when the browser supports LoAF. */
export function installLoafObserver(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (window.__oppulenceLoafObserver) return () => undefined;
  if (!("PerformanceObserver" in window)) return () => undefined;

  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const loaf = entry as PerformanceEntry & {
          duration: number;
          startTime: number;
          sources?: Array<{ name?: string }>;
        };
        entries = [
          {
            id: crypto.randomUUID(),
            duration: loaf.duration,
            startTime: loaf.startTime,
            source: loaf.sources?.[0]?.name,
          },
          ...entries,
        ].slice(0, MAX_ENTRIES);
        notify();
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: true } as PerformanceObserverInit);
    window.__oppulenceLoafObserver = observer;
  } catch {
    return () => undefined;
  }

  return () => {
    observer?.disconnect();
    delete window.__oppulenceLoafObserver;
  };
}

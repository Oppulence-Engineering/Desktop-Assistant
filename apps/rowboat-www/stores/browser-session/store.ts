/** Landing preview stub — no live browser sessions on the marketing site. */
export function useBrowserSessionStore<T>(
  _selector: (state: { sessions: Record<string, never> }) => T,
): T {
  return _selector({ sessions: {} });
}

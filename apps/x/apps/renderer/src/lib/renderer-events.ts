/**
 * Typed, renderer-local application events.
 *
 * Native browser events still use addEventListener directly. Cross-feature app
 * events must be declared here so producers and consumers share one payload
 * contract and event names cannot drift independently.
 */
export interface RendererEventMap {
  "calendar-block:join-meeting": undefined;
  "code-mode-config-changed": undefined;
  "code-mode-detected": { runId?: string; agent: string };
  "email-block:draft-with-assistant": undefined;
  "models-config-changed": undefined;
  "rowboat-chat-recent-work-dirs-changed": undefined;
  "rowboat:open-copilot-edit-live-note": { filePath: string };
  "rowboat:open-copilot-prompt": {
    instruction: string;
    filePath?: string;
    label?: string;
  };
  "rowboat:open-live-note-panel": { filePath: string };
  "rowboat:open-related-notes-panel": { filePath: string };
  "transcription-config-changed":
    | {
        privacy?: { localOnly?: boolean };
      }
    | undefined;
}

export type RendererEventName = keyof RendererEventMap;

export function emitRendererEvent<K extends RendererEventName>(
  name: K,
  ...detail: undefined extends RendererEventMap[K]
    ? [detail?: RendererEventMap[K]]
    : [detail: RendererEventMap[K]]
): void {
  window.dispatchEvent(new CustomEvent(name, { detail: detail[0] }));
}

export function onRendererEvent<K extends RendererEventName>(
  name: K,
  handler: (detail: RendererEventMap[K]) => void,
): () => void {
  const listener: EventListener = (event) => {
    handler((event as CustomEvent<RendererEventMap[K]>).detail);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

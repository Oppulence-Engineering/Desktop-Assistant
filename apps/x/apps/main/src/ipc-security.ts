import type { IpcMainInvokeEvent } from "electron";

const DEV_RENDERER_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);

export function isTrustedRendererUrl(rawUrl: string, packaged: boolean): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "app:" && url.hostname === "-") return true;
    return !packaged && DEV_RENDERER_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

/** Reject IPC from embedded/remote WebContents before parsing privileged input. */
export function assertTrustedIpcSender(event: IpcMainInvokeEvent, packaged: boolean): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl, packaged)) {
    throw new Error("Rejected IPC request from an untrusted renderer");
  }
}

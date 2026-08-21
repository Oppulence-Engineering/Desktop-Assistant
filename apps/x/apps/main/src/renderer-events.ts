import type { BrowserWindow, WebContents } from "electron";
import { ipc } from "@x/shared";

type SendChannels = ipc.SendChannels;
type IPCChannels = ipc.IPCChannels;

/** Validate every main → renderer event against the shared IPC contract. */
export function sendRendererEvent<K extends SendChannels>(
  target: WebContents,
  channel: K,
  payload: IPCChannels[K]["req"],
): void {
  target.send(channel, ipc.validateRequest(channel, payload));
}

/** Broadcast a validated event to each live renderer window. */
export function broadcastRendererEvent<K extends SendChannels>(
  windows: BrowserWindow[],
  channel: K,
  payload: IPCChannels[K]["req"],
): void {
  const validated = ipc.validateRequest(channel, payload);
  for (const win of windows) {
    if (!win.isDestroyed()) win.webContents.send(channel, validated);
  }
}

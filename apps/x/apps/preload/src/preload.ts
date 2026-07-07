import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import type { ipc as ipcShared } from "@x/shared";

type InvokeChannels = ipcShared.InvokeChannels;
type IPCChannels = ipcShared.IPCChannels;
type SendChannels = ipcShared.SendChannels;

const ipc = {
  /**
   * Invoke a channel that expects a response (request/response pattern)
   * Only channels with non-null responses can be invoked
   */
  invoke<K extends InvokeChannels>(
    channel: K,
    args: IPCChannels[K]["req"],
  ): Promise<IPCChannels[K]["res"]> {
    return ipcRenderer.invoke(channel, args);
  },

  /**
   * Send a message to a channel without expecting a response (fire-and-forget)
   * Only channels with null responses can be sent
   */
  send<K extends SendChannels>(channel: K, args: IPCChannels[K]["req"]): void {
    ipcRenderer.send(channel, args);
  },

  /**
   * Listen to a send channel event
   * Returns a cleanup function to remove the listener
   */
  on<K extends SendChannels>(
    channel: K,
    handler: (event: IPCChannels[K]["req"]) => void,
  ): () => void {
    const listener = (_event: unknown, data: IPCChannels[K]["req"]) => {
      handler(data);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld("ipc", ipc);

contextBridge.exposeInMainWorld("electronUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getZoomFactor: () => webFrame.getZoomFactor(),
});

// RFC 009 streaming transcription: the main process transfers a MessagePort for a
// meeting session out-of-band on the `whisper:streamPort` channel. A MessagePort
// cannot cross the contextBridge directly, so we re-post it onto the shared DOM
// window (transferring the port); the renderer grabs it by streamId. This is the
// standard Electron MessagePort hand-off pattern.
ipcRenderer.on("whisper:streamPort", (event, payload: { streamId: string }) => {
  window.postMessage({ __rowboatWhisperStreamPort: payload.streamId }, "*", event.ports);
});

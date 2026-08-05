import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { UpdateStatus, UpdateStatusName } from "@x/shared/dist/updates.js";
import { updatePending } from "@x/shared/dist/updates.js";

export type { UpdateStatus, UpdateStatusName };
export { updatePending };

const READY_TOAST_ID = "app-update-ready";
const AVAILABLE_TOAST_ID = "app-update-available";

/**
 * Subscribe to update status without announcing anything.
 *
 * Separate from useUpdatePrompt so passive indicators (the dot on Settings) can
 * read the same status without a second copy of the toasts firing.
 */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    void window.ipc.invoke("app:getUpdateStatus", null).then(setStatus);
    return window.ipc.on("app:updateStatus", (next) => setStatus(next as UpdateStatus));
  }, []);

  return status;
}

/**
 * Announces updates. Call once, at the app root.
 *
 * Two different messages, because they answer different questions:
 *
 *   downloading → "a new version exists" — worth knowing, nothing to do yet, so
 *     it auto-dismisses and never asks for a decision. Electron's
 *     `update-available` carries no version number, hence no version in the copy.
 *   ready → "you can have it now" — actionable, so it persists until answered.
 *
 * Skipping the first message would mean nobody learns an update exists until
 * the download happens to finish, which on a slow link or a failed download is
 * never. The dot on Settings outlives both toasts.
 */
export function useUpdatePrompt(): UpdateStatus {
  const status = useUpdateStatus();
  const dismissedVersion = useRef<string | null>(null);
  const announcedAvailable = useRef(false);

  useEffect(() => {
    if (status.state === "downloading" && !announcedAvailable.current) {
      // Once per run: this fires again on every relaunch until the update is
      // installed, which is the reminder, without repeating within a session.
      announcedAvailable.current = true;
      toast("A new version is available", {
        id: AVAILABLE_TOAST_ID,
        description: "Downloading now — you'll be asked to restart when it's ready.",
      });
      return;
    }

    if (status.state !== "ready") return;
    const version = status.version ?? "";
    if (dismissedVersion.current === version) return;

    // Supersede the "downloading" notice rather than stacking on top of it.
    toast.dismiss(AVAILABLE_TOAST_ID);

    const label = status.version ? `Version ${status.version} is ready` : "An update is ready";
    toast(label, {
      id: READY_TOAST_ID,
      description: "Restart to finish installing.",
      duration: Infinity,
      action: {
        label: "Restart now",
        onClick: () => {
          void window.ipc.invoke("app:installUpdate", null).then((result) => {
            // A refusal is a result, not an error — the main process declines
            // while a meeting is recording, and says so in `reason`.
            if (!result.installed && result.reason) {
              toast.error(result.reason);
            }
          });
        },
      },
      cancel: {
        label: "Later",
        onClick: () => {
          dismissedVersion.current = version;
        },
      },
      onDismiss: () => {
        dismissedVersion.current = version;
      },
    });
  }, [status]);

  return status;
}

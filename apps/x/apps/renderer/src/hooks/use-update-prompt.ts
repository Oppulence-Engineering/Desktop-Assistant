import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { UpdateStatus, UpdateStatusName } from "@x/shared/updates";
import { updatePending } from "@x/shared/updates";

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
    // The pull exists because main broadcasts before any window is open, so a
    // window that opens later would otherwise never learn a staged update
    // exists. But the two can cross: if a push lands while the pull is still in
    // flight, the pull's older answer must not overwrite it — that would drop a
    // `ready` back to whatever was true a moment earlier.
    let pushed = false;
    const off = window.ipc.on("app:updateStatus", (next) => {
      pushed = true;
      setStatus(next);
    });
    void window.ipc.invoke("app:getUpdateStatus", null).then((initial) => {
      if (!pushed) setStatus(initial);
    });
    return off;
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
        onClick: (event) => {
          // sonner removes the toast on action click unless the handler
          // prevents it. Letting it close here would delete the only prompt the
          // moment a restart is refused — a user recording a meeting would tap
          // Restart, get told no, and have nothing left to tap afterwards. On
          // success the app is quitting, so an un-dismissed toast costs nothing.
          event.preventDefault();
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

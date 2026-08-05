import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type UpdateStatusName =
  | "unsupported"
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "error";

export interface UpdateStatus {
  state: UpdateStatusName;
  version?: string;
  detail?: string;
  lastCheckedAt?: number;
}

const TOAST_ID = "app-update-ready";

/**
 * Tracks update status and prompts once an update is downloaded and waiting.
 *
 * Only `ready` prompts. Earlier states are real but not actionable — asking
 * someone to restart for a download that hasn't finished just makes them wait
 * with the dialog open. Settings shows the in-between states; this doesn't.
 *
 * Declining is remembered for that version, so dismissing doesn't buy a few
 * minutes of quiet before the same prompt returns. A genuinely newer version
 * prompts again, because that's new information.
 */
export function useUpdatePrompt(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const dismissedVersion = useRef<string | null>(null);

  useEffect(() => {
    void window.ipc.invoke("app:getUpdateStatus", null).then(setStatus);
    return window.ipc.on("app:updateStatus", (next) => setStatus(next as UpdateStatus));
  }, []);

  useEffect(() => {
    if (status.state !== "ready") return;
    const version = status.version ?? "";
    if (dismissedVersion.current === version) return;

    const label = status.version ? `Version ${status.version} is ready` : "An update is ready";
    toast(label, {
      id: TOAST_ID,
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

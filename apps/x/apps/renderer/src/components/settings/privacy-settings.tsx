import { useCallback, useEffect, useState } from "react";
import { Check, HardDrive, Loader2, Trash2, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingsSection } from "@/components/settings/settings-ui";

/**
 * Privacy, stated rather than implied.
 *
 * Every fact on this page was already true — audio is captured by a local sidecar,
 * transcribed by a local model, and written to a folder on this machine. None of it had
 * ever been said out loud, and the Preferences tab was already *promising* privacy
 * controls that did not exist anywhere in the app.
 *
 * The design rule here is that nothing on this page may overstate. Meeting audio and
 * transcripts genuinely never leave the device; summaries and chat go to whichever model
 * is configured, which is frequently a cloud API. Both are said plainly. A privacy page
 * that rounds "mostly local" up to "nothing leaves" is worse than no page at all, because
 * the one claim a user checks and finds false discredits every other claim on it.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

interface Usage {
  sessions: number;
  bytes: number;
  dir: string;
}

/** What stays here, and what does not. Ordered most- to least-reassuring so the
 *  qualified line is read, not buried. */
const FACTS: { local: boolean; label: string; detail: string }[] = [
  {
    local: true,
    label: "Meeting audio",
    detail: "Captured and stored on this Mac. Never uploaded anywhere.",
  },
  {
    local: true,
    label: "Transcription",
    detail: "Runs on this Mac, on-device. The audio is never sent to a service.",
  },
  {
    local: true,
    label: "Your notes and files",
    detail: "Plain Markdown in a folder you control. No sync, no server copy.",
  },
  {
    local: false,
    label: "Summaries and chat",
    detail:
      "Sent to whichever model you configured. If that is a cloud provider, the text goes to them — set a local model to keep it here.",
  },
];

export function PrivacySettings({ dialogOpen }: { dialogOpen?: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [alsoDeleteNotes, setAlsoDeleteNotes] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsage(await window.ipc.invoke("meeting:storageUsage", null));
    } catch {
      // Capture may be unavailable on this platform — the facts above still apply.
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    if (dialogOpen === false) return;
    void refresh();
  }, [dialogOpen, refresh]);

  const confirmDeleteAll = useCallback(async () => {
    setDeleting(true);
    try {
      const outcome = await window.ipc.invoke("meeting:deleteAllSessions", {
        deleteNotes: alsoDeleteNotes,
      });
      const parts = [`${outcome.deleted} recording${outcome.deleted === 1 ? "" : "s"} deleted`];
      if (outcome.notesDeleted > 0) parts.push(`${outcome.notesDeleted} moved to trash`);
      // Never silent about a partial result: a sweep that skipped something and said
      // "done" is exactly the failure this page exists to rule out.
      if (outcome.failed > 0) parts.push(`${outcome.failed} could not be deleted`);
      setResult(parts.join(" · "));
    } catch (err) {
      setResult(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
      setConfirming(false);
      setAlsoDeleteNotes(false);
      void refresh();
    }
  }, [alsoDeleteNotes, refresh]);

  return (
    <div className="space-y-7">
      <SettingsSection
        title="What stays on this Mac"
        description="Where each kind of data actually goes."
      >
        <div className="settings-panel divide-y divide-border/60">
          {FACTS.map((fact) => (
            <div key={fact.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              {fact.local ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : (
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0">
                <p className="settings-row-label">{fact.label}</p>
                <p className="settings-row-description">{fact.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Recordings on disk"
        description="Meeting audio kept by your retention setting."
      >
        <div className="settings-panel space-y-3">
          <div className="flex items-center gap-3">
            <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              {usage === null ? (
                <p className="settings-row-description">Not available on this device.</p>
              ) : usage.sessions === 0 ? (
                <p className="settings-row-description">No recordings are stored.</p>
              ) : (
                <>
                  <p className="settings-row-label">
                    {usage.sessions} recording{usage.sessions === 1 ? "" : "s"} ·{" "}
                    {formatBytes(usage.bytes)}
                  </p>
                  <p className="settings-row-description truncate" title={usage.dir}>
                    {usage.dir}
                  </p>
                </>
              )}
            </div>
            {usage !== null && usage.sessions > 0 && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                Delete all
              </Button>
            )}
          </div>
          {result && <p className="settings-row-description">{result}</p>}
        </div>
      </SettingsSection>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(false);
            // Opt-in, and reset every time: "also delete my notes" must never be
            // sticky from a previous confirmation.
            setAlsoDeleteNotes(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete every recording?</AlertDialogTitle>
            <AlertDialogDescription>
              {usage
                ? `${usage.sessions} recording${usage.sessions === 1 ? "" : "s"} (${formatBytes(usage.bytes)}) will be removed from this device. This cannot be undone.`
                : "All recordings will be removed from this device. This cannot be undone."}{" "}
              Your meeting notes stay in your workspace unless you choose otherwise below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={alsoDeleteNotes}
              onCheckedChange={(checked) => setAlsoDeleteNotes(checked === true)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              Also delete the meeting notes. They move to the trash, so this one is recoverable.
            </span>
          </label>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDeleteAll()}
            >
              {deleting ? <Loader2 className="size-3 animate-spin" /> : null}
              Delete all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

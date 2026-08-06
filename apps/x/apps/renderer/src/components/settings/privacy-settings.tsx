import { useCallback, useEffect, useState } from "react";
import { Check, Cloud, HardDrive, Laptop, Loader2, Trash2, TriangleAlertIcon } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import type {
  TranscriptionDataLocation,
  TranscriptionRouting,
} from "@x/shared/dist/transcription.js";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@oppulence/ui/components/alert-dialog";
import { SettingsSection } from "@/components/settings/settings-ui";

/**
 * A live data-flow receipt rather than platform-wide privacy copy.
 *
 * Main resolves the actual provider/capture/model routes; this page only renders that
 * result. Cloud routes are permitted when the user selected them and are stated plainly.
 * Unknown endpoints remain unknown, and local-only is shown as the effective override.
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

interface RouteFact {
  location: TranscriptionDataLocation;
  label: string;
  detail: string;
}

function providerLabel(provider: string): string {
  if (provider === "whisper-local") return "Whisper on this device";
  if (provider === "solomon") return "Oppulence Cloud (Deepgram)";
  if (provider === "deepgram") return "Deepgram Cloud";
  if (provider === "none" || provider === "unconfigured") return "Unavailable";
  return provider;
}

function speechRouteDetail(
  route: TranscriptionRouting["voice"] | TranscriptionRouting["meeting"],
  subject: string,
): string {
  if (route.location === "device") {
    return `${subject} stays on this device and is transcribed by ${route.engine ?? providerLabel(route.effectiveProvider)}.`;
  }
  if (route.location === "cloud") {
    return `Cloud is selected in Transcription settings. ${subject} is sent to ${providerLabel(route.effectiveProvider)} for transcription.`;
  }
  if (route.location === "unavailable") {
    return "No permitted transcription route is available with the current settings.";
  }
  return "The app cannot determine whether this route is local or remote.";
}

function routeFacts(routing: TranscriptionRouting | null): RouteFact[] {
  if (!routing) {
    return [
      {
        location: "unknown",
        label: "Transcription routing",
        detail: "Loading the effective data route…",
      },
    ];
  }

  const enrichment = routing.enrichment;
  const enrichmentDetail =
    enrichment.location === "device"
      ? `Meeting summaries, commitment suggestions, and live answers use ${providerLabel(enrichment.provider)} on this device.`
      : enrichment.location === "cloud"
        ? `Meeting transcript text is sent to ${providerLabel(enrichment.provider)} (${enrichment.model}) for enabled summaries, commitment suggestions, or live answers. Audio is not sent for this enrichment step.`
        : `Meeting transcript text may leave this device for enabled summaries, commitment suggestions, or live answers because the location of ${providerLabel(enrichment.provider)} could not be verified.`;
  const relationshipEvidence = routing.relationshipEvidence;
  // Name what is actually on, flag by flag. The old copy described transcripts
  // and commitments regardless of which of the five switches was enabled, so a
  // user sharing email metadata was told their data stayed local.
  const sharedKinds = [
    relationshipEvidence.sharing.meetingTranscripts && "finished 1:1 transcript text and confirmed commitments",
    relationshipEvidence.sharing.meetingAttendance && "who was invited to your meetings",
    relationshipEvidence.sharing.emailMetadata && "email participants, direction and timing (never subjects or bodies)",
    relationshipEvidence.sharing.signatureEnrichment && "names and titles parsed from email signatures",
    relationshipEvidence.sharing.modelContactExtraction && "contact details a model extracted from message text",
  ].filter((v): v is string => typeof v === "string");

  const relationshipEvidenceDetail = !relationshipEvidence.enabled
    ? "Off. Nothing about your meetings, email or contacts is published to relationship state."
    : relationshipEvidence.location === "device"
      ? `Enabled. Published to ${relationshipEvidence.destination} on this device: ${sharedKinds.join("; ")}.`
      : relationshipEvidence.location === "cloud"
        ? `Enabled in Transcription settings. Sent to ${relationshipEvidence.destination}: ${sharedKinds.join("; ")}. Meeting audio and local file paths are never sent by this step.`
        : `Enabled. This may leave the device because the location of ${relationshipEvidence.destination} could not be verified: ${sharedKinds.join("; ")}.`;

  return [
    {
      location: routing.voice.location,
      label: "Push-to-talk and dictation",
      detail: speechRouteDetail(routing.voice, "Microphone audio"),
    },
    {
      location: routing.voiceMemo.location,
      label: "Voice memos",
      detail: `${speechRouteDetail(routing.voiceMemo, "Microphone audio")} Raw voice-memo audio is not retained after transcription.`,
    },
    {
      location: routing.meeting.location,
      label: "Meeting transcription",
      detail: `${speechRouteDetail(
        routing.meeting,
        routing.meeting.captureEngine === "native"
          ? "The two recorded tracks"
          : "Microphone and available system audio",
      )} Capture engine: ${routing.meeting.captureEngine}.`,
    },
    {
      location: enrichment.location,
      label: "Transcript enrichment",
      detail: enrichmentDetail,
    },
    {
      location: relationshipEvidence.enabled ? relationshipEvidence.location : "device",
      label: "Shared relationship evidence",
      detail: relationshipEvidenceDetail,
    },
    {
      location: "device",
      label: "Notes and transcript files",
      detail:
        "Stored as inspectable files in the local workspace. Model-backed enrichment and shared relationship state have their own routes above.",
    },
  ];
}

export function PrivacySettings({ dialogOpen }: { dialogOpen?: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [routing, setRouting] = useState<TranscriptionRouting | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [alsoDeleteNotes, setAlsoDeleteNotes] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextUsage, nextRouting] = await Promise.allSettled([
      window.ipc.invoke("meeting:storageUsage", null),
      window.ipc.invoke("transcription:getRouting", null),
    ]);
    setUsage(nextUsage.status === "fulfilled" ? nextUsage.value : null);
    setRouting(nextRouting.status === "fulfilled" ? nextRouting.value : null);
  }, []);

  useEffect(() => {
    if (dialogOpen === false) return;
    void refresh();
    const onConfigChanged = () => void refresh();
    window.addEventListener("transcription-config-changed", onConfigChanged);
    return () => window.removeEventListener("transcription-config-changed", onConfigChanged);
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
        title="Where transcription data goes"
        description={
          routing?.localOnly
            ? "Local-only is on. Speech audio stays on this device."
            : "The effective route after provider choices, device capability, and capture-engine overrides."
        }
      >
        <div className="settings-panel divide-y divide-border/60">
          {routeFacts(routing).map((fact) => (
            <div key={fact.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              {fact.location === "device" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : fact.location === "cloud" ? (
                <Cloud className="mt-0.5 size-4 shrink-0 text-blue-500" />
              ) : fact.location === "unavailable" ? (
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
              ) : (
                <Laptop className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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

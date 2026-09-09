"use client";

import "client-only";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleNotchIcon,
  ExportIcon,
  PlugsIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import { Button } from "@oppulence/ui/components/button";
import { AuthGate } from "@/components/auth-gate";
import { capture, RevenueEvents } from "@/lib/analytics";
import {
  downloadMarkdown,
  friendlyRevenueError,
  getOpenPromisesReport,
  getOpenPromisesReportMarkdown,
  getScan,
  listRelationshipSources,
  safeResearchCitationURL,
  startScan,
} from "@/lib/revenue";
import type { OpenPromisesReport, RelationshipSourceInventoryItem } from "@/types/revenue";

const ACTIVE_SOURCE_STATES = new Set(["connected", "backfilling", "live"]);

// Health reports the WORST account, never the best. A .some() over accounts
// let one healthy connection hide a dead grant, and this page would then invite
// the user to run a scan that cannot possibly read their mail.
const ATTENTION_SOURCE_STATES = new Set(["reconnect_required", "disconnected"]);

function googleHealth(sources: RelationshipSourceInventoryItem[]) {
  const google = sources.find((source) => source.source === "google");
  const accounts = google?.accounts ?? [];
  if (accounts.some((a) => ATTENTION_SOURCE_STATES.has(a.status) || a.missingScopes.length > 0)) {
    return "needs_reconnect" as const;
  }
  if (accounts.some((a) => ACTIVE_SOURCE_STATES.has(a.status))) return "ready" as const;
  return "not_connected" as const;
}

export function OpenPromisesReportClient() {
  return (
    <AuthGate>
      <React.Suspense fallback={null}>
        <ReportBody />
      </React.Suspense>
    </AuthGate>
  );
}

function ReportBody() {
  // The running scan is identified in the URL. That makes "leave the page and
  // come back" work with no browser storage, and the link is shareable.
  const router = useRouter();
  const params = useSearchParams();
  const scanId = params.get("scan");
  const setScanId = React.useCallback(
    (id: string | null) => {
      router.replace(id ? `/app/report?scan=${encodeURIComponent(id)}` : "/app/report");
    },
    [router],
  );
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ["report-sources"],
    queryFn: () => listRelationshipSources(),
  });
  const health = googleHealth(sourcesQuery.data ?? []);

  const scanQuery = useQuery({
    queryKey: ["report-scan", scanId],
    queryFn: () => getScan(scanId as string),
    enabled: Boolean(scanId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2_000;
    },
  });
  const scanDone = scanQuery.data?.status === "completed";

  const reportQuery = useQuery({
    queryKey: ["report", scanId],
    queryFn: () => getOpenPromisesReport(scanId as string),
    enabled: Boolean(scanId) && scanDone,
  });

  React.useEffect(() => {
    if (reportQuery.data) {
      capture(RevenueEvents.ReportViewed, {
        outbound: reportQuery.data.outboundCount,
        inbound: reportQuery.data.inboundCount,
      });
    }
  }, [reportQuery.data]);

  const run = React.useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const scan = await startScan(90);
      setScanId(scan.id);
      capture(RevenueEvents.ScanStarted, { lookbackDays: 90, surface: "report" });
    } catch (e) {
      setError(friendlyRevenueError(e instanceof Error ? e.message : "Could not start the scan."));
    } finally {
      setStarting(false);
    }
  }, [setScanId]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        {/* This page renders outside the app shell, so without this there is no
            way back into the product from it. */}
        <Link
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-primary/50 hover:text-primary"
          href="/app"
        >
          <ArrowLeftIcon className="size-3.5" /> Back to Oppulence
        </Link>
        <h1 className="text-[28px] font-medium leading-tight text-primary">Open promises</h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-primary/60">
          The commitments your team made in the last 90 days that have no evidence of fulfilment,
          and the exact message that created each one.
        </p>
      </header>

      {error ? (
        <p className="flex items-start gap-2 border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
          <WarningIcon className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}

      {health === "not_connected" && !sourcesQuery.isLoading ? (
        <ConnectStep />
      ) : health === "needs_reconnect" && !sourcesQuery.isLoading ? (
        <ReconnectStep />
      ) : !scanId ? (
        <StartStep
          onRun={() => {
            void run();
          }}
          busy={starting}
        />
      ) : !scanDone ? (
        <ScanningStep
          threads={scanQuery.data?.threadsSeen ?? 0}
          failed={scanQuery.data?.status === "failed"}
          reason={scanQuery.data?.error}
          onRetry={() => {
            setScanId(null);
          }}
        />
      ) : reportQuery.data ? (
        <Report report={reportQuery.data} scanId={scanId} />
      ) : reportQuery.isError ? (
        <section className="border border-destructive/40 bg-destructive/5 p-5" role="alert">
          <h2 className="text-[15px] font-medium text-destructive">The report could not load</h2>
          <p className="mt-1.5 text-[13px] text-primary/70">
            {friendlyRevenueError(
              reportQuery.error instanceof Error ? reportQuery.error.message : "Please try again.",
            )}
          </p>
          <Button
            className="mt-4"
            onClick={() => void reportQuery.refetch()}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </section>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-primary/55">
          <CircleNotchIcon className="size-4 animate-spin" /> Building the report.
        </p>
      )}
    </main>
  );
}

// Step one, and the only thing asked for. No model key, no workspace setup.
function ConnectStep() {
  return (
    <section className="border border-border bg-background-50 p-5">
      <h2 className="text-[15px] font-medium text-primary">Connect Gmail to begin</h2>
      <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-primary/60">
        Oppulence reads the last 90 days to find promises. Nothing is sent, written, or replied to
        on your behalf.
      </p>
      <Button asChild className="mt-4 bg-[#3478f6] text-white hover:bg-[#2f6fe6]">
        <Link href="/app/settings">
          <PlugsIcon /> Connect Gmail &amp; Calendar
        </Link>
      </Button>
    </section>
  );
}

// The grant died. Offering "find my open promises" here would invite a scan
// that cannot read anything.
function ReconnectStep() {
  return (
    <section className="border border-destructive/40 bg-destructive/[0.04] p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-primary">
        <WarningIcon className="size-4 text-destructive" /> Google needs reconnecting
      </h2>
      <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-primary/60">
        Google stopped accepting the authorization, so we cannot read your mail. Reconnect to
        run the audit.
      </p>
      <Button asChild className="mt-4 bg-[#3478f6] text-white hover:bg-[#2f6fe6]">
        <Link href="/app/settings">
          <PlugsIcon /> Reconnect Google
        </Link>
      </Button>
    </section>
  );
}

function StartStep({ onRun, busy }: { onRun: () => void; busy: boolean }) {
  return (
    <section className="border border-border bg-background-50 p-5">
      <h2 className="text-[15px] font-medium text-primary">Read the last 90 days</h2>
      <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-primary/60">
        This takes a few minutes. You can leave the page and come back.
      </p>
      <Button
        className="mt-4 bg-[#3478f6] text-white hover:bg-[#2f6fe6]"
        disabled={busy}
        onClick={() => {
          onRun();
        }}
        type="button"
      >
        {busy ? <CircleNotchIcon className="animate-spin" /> : <ArrowRightIcon />}
        {busy ? "Starting" : "Find my open promises"}
      </Button>
    </section>
  );
}

function ScanningStep({
  threads,
  failed,
  reason,
  onRetry,
}: {
  threads: number;
  failed: boolean;
  reason?: string;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <section className="border border-destructive/40 bg-destructive/5 p-5">
        <h2 className="text-[15px] font-medium text-destructive">The scan did not finish</h2>
        <p className="mt-1.5 text-[13px] text-primary/70">{reason || "No reason was recorded."}</p>
        <Button className="mt-4" onClick={onRetry} type="button" variant="outline">
          Try again
        </Button>
      </section>
    );
  }
  return (
    <section className="border border-border bg-background-50 p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-primary">
        <CircleNotchIcon className="size-4 animate-spin" /> Reading your last 90 days
      </h2>
      <p className="mt-1.5 text-[13px] text-primary/60">
        {threads > 0 ? `${String(threads)} conversations read so far.` : "Starting up."}
      </p>
    </section>
  );
}

function Report({ report, scanId }: { report: OpenPromisesReport; scanId: string }) {
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const download = React.useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      downloadMarkdown("open-promises.md", await getOpenPromisesReportMarkdown(scanId));
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "The report could not be downloaded.",
      );
    } finally {
      setDownloading(false);
    }
  }, [scanId]);

  if (report.items.length === 0) {
    return (
      <section className="border border-border bg-background-50 p-5">
        <h2 className="text-[15px] font-medium text-primary">No open promises found</h2>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-primary/60">
          We read {report.threadsSeen} conversations and found nothing outstanding. That is either
          good news, or a sign that more sources need connecting.
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/app/settings">Connect more sources</Link>
        </Button>
      </section>
    );
  }

  return (
    <>
      <section className="grid grid-cols-3 gap-3">
        <Stat label="We promised" value={report.outboundCount} />
        <Stat label="They promised us" value={report.inboundCount} />
        <Stat label="Conversations read" value={report.threadsSeen} />
      </section>

      <div className="flex items-center gap-2">
        <Button
          disabled={downloading}
          onClick={() => void download()}
          type="button"
          variant="outline"
        >
          {downloading ? <CircleNotchIcon className="animate-spin" /> : <ExportIcon />}
          {downloading ? "Downloading" : "Download the report"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/revenue">
            Open the register <ArrowRightIcon />
          </Link>
        </Button>
      </div>

      {downloadError ? <p className="text-[13px] text-destructive">{downloadError}</p> : null}
      {report.truncated ? (
        <p className="border border-amber-500/40 bg-amber-500/5 p-3 text-[13px] text-primary/70">
          This report shows the first 200 open promises. Open the register for the complete ledger.
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {report.items.map((item) => (
          <li key={item.commitmentId} className="border border-border bg-background p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[13px] font-medium text-primary">{item.account}</span>
              <span className="text-[12px] text-primary/45">
                {item.direction === "promised_by_them" ? "they owe us" : "we owe them"}
              </span>
              {item.state === "at_risk" ? (
                <span className="border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-500">
                  at risk
                </span>
              ) : null}
              <span className="ml-auto text-[12px] text-primary/45">
                {item.dueAt ? `due ${item.dueAt.slice(0, 10)}` : "due unspecified"}
              </span>
            </div>
            <p className="mt-1.5 text-[14px] leading-snug text-primary">{item.text}</p>
            {/* Every claim carries its citation, or it is not made. */}
            {item.sourceQuote ? (
              <blockquote className="mt-2.5 border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-primary/55">
                {item.sourceQuote}
              </blockquote>
            ) : null}
            {item.occurredAt || safeResearchCitationURL(item.sourceUri ?? "") ? (
              <p className="mt-2 text-[12px] text-primary/45">
                {item.occurredAt
                  ? `Source observed ${new Date(item.occurredAt).toLocaleString()}`
                  : "Source"}
                {safeResearchCitationURL(item.sourceUri ?? "") ? (
                  <>
                    {" · "}
                    <a
                      className="underline underline-offset-2 hover:text-primary"
                      href={safeResearchCitationURL(item.sourceUri ?? "") as string}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open source
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-background-50 p-3">
      <div className="text-[24px] font-medium leading-none text-primary">{value}</div>
      <div className="mt-1.5 text-[12px] text-primary/50">{label}</div>
    </div>
  );
}

import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

export type SimChangelogEntry = {
  version: string;
  date?: string;
  title: string;
  body: string;
  url?: string;
};

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

/** Sim changelog — GitHub release notes, no invented versions. */
export function SimChangelogPage({
  entries,
  repoLabel,
}: {
  entries: SimChangelogEntry[];
  repoLabel: string;
}) {
  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <SimSubpageHero
          description={`These notes come from GitHub Releases for ${repoLabel}. Drafts and pre-releases are omitted. If the list is empty, the upstream call did not return published notes — we will not invent a version.`}
          eyebrow="[changelog]"
          title="What shipped in the desktop app."
          titleId="changelog-heading"
        />
      </div>

      <SimPageDivider />

      <SimBorderedColumn>
        <section className="px-6 py-10">
          {entries.length === 0 ? (
            <p className="max-w-[60ch] text-[15px] text-[var(--text-body)] leading-[1.55]">
              No published releases are available to show right now. You can still{" "}
              <Link className="underline-offset-4 hover:underline" href="/download">
                download the latest installer
              </Link>{" "}
              when GitHub has one.
            </p>
          ) : (
            <ol className="flex flex-col gap-6">
              {entries.map((entry) => (
                <li className={cn(SIM_SURFACE_CARD, "flex flex-col gap-3 p-6")} key={entry.version}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-0.5 font-mono text-[12px] text-[var(--text-secondary)]">
                      {entry.version}
                    </span>
                    {entry.date ? (
                      <time className="text-[13px] text-[var(--text-muted)]" dateTime={entry.date}>
                        {formatDate(entry.date)}
                      </time>
                    ) : null}
                  </div>
                  <h2 className="text-[18px] text-[var(--text-primary)] leading-[1.2]">
                    {entry.title}
                  </h2>
                  <p className="text-[15px] text-[var(--text-secondary)] leading-[1.55]">
                    {entry.body}
                  </p>
                  {entry.url ? (
                    <a
                      className="text-[14px] text-[var(--text-body)] underline-offset-4 hover:underline"
                      href={entry.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Open the GitHub release
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </SimBorderedColumn>

      <SimPageFooterRule />
    </div>
  );
}

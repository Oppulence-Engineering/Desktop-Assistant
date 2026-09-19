import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { faqJsonLd } from "../../metadata";
import { SimCtaLink } from "../primitives";
import { HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SimSubpageFaqSection } from "./sim-subpage-faq";

const faqs = [
  {
    question: "Is Oppulence local-only?",
    answer:
      "It can be. Bring your own model keys and keep the vault on disk. Signing in syncs relationship state to the API so web and desktop match. Those are different setups.",
  },
  {
    question: "Where are OAuth tokens?",
    answer:
      "The Go API holds connector credentials. The web BFF keeps session tokens in HTTP-only encrypted cookies. The browser never gets the WorkOS access token.",
  },
  {
    question: "Do you upload crash dumps?",
    answer:
      "Native crash dumps stay on the machine. Crash metadata can go to PostHog if analytics is enabled.",
  },
] as const;

const rows = [
  {
    title: "What the desktop can see",
    body: "A workspace folder you choose, meeting audio you start, the in-app browser pages you open, and the MCP servers you add. It does not get a silent tour of the whole disk.",
  },
  {
    title: "What stays on the machine",
    body: "Markdown vault files, capture audio, on-device Whisper transcripts, local embeddings, and ~/.rowboat/ config. Delete the folder and those copies are gone.",
  },
  {
    title: "What reaches Oppulence servers",
    body: "When you sign in: account identity via WorkOS, relationship observations you allow, and credit-gated model calls if you use the hosted gateway instead of your own keys.",
  },
  {
    title: "What reaches a model provider",
    body: "BYOK goes to the provider you configured. Signed-in hosted LLM calls go through the credit-gated /v1/llm routes. Prompts can contain relationship context you asked the assistant to use.",
  },
  {
    title: "Permissions and writes",
    body: "Connectors start as reads. Gmail, Slack, and HubSpot writes are proposed and held. Slack DMs are out of the first beta. Finance MCP write scopes are limited to development and staging.",
  },
  {
    title: "Telemetry",
    body: "PostHog analytics is fail-closed until you enable it. You can turn it off. We do not invent a SOC 2 badge or a HIPAA claim on this page.",
  },
] as const;

const trustLinks = [
  {
    title: "Privacy",
    href: "/privacy",
    body: "What we collect when you sign in, and what can stay on the desktop.",
  },
  {
    title: "Responsible disclosure",
    href: "/responsible-disclosure",
    body: "Report a vulnerability through the published channel.",
  },
  {
    title: "What stays on device",
    href: "/guides/what-stays-on-device",
    body: "A walkthrough of the three pipes.",
  },
] as const;

/** Full `/security` page — Sim split headline + card grid, no invented compliance marks. */
export function SimSecurityPage() {
  return (
    <>
      <JsonLd data={faqJsonLd([...faqs])} />
      <section
        aria-labelledby="security-page-heading"
        className={cn(
          "flex w-full flex-col gap-16 pb-16 max-sm:gap-10 max-sm:pb-12",
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER,
        )}
        id="security-page"
      >
        <div className="flex w-full items-start justify-between gap-10 max-sm:gap-5 max-xl:flex-col">
          <div className="flex flex-col gap-3 max-xl:w-full md:w-1/2">
            <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [security]
            </p>
            <h1
              className={cn("max-w-[16ch] text-balance text-[var(--text-primary)]", HOME_TYPE.h2)}
              id="security-page-heading"
            >
              The data is yours. Connections are explicit. Sends wait.
            </h1>
          </div>
          <div className="flex w-[min(28rem,40%)] flex-col items-start max-xl:w-full">
            <p className={cn("max-w-[40ch] text-pretty text-[var(--text-body)]", HOME_TYPE.lead)}>
              This page is the adoption objection, written as the implementation actually behaves.
              The legal language lives on <Link href="/privacy">Privacy</Link> and{" "}
              <Link href="/responsible-disclosure">responsible disclosure</Link>.
            </p>
            <SimCtaLink className="mt-5" href="/guides/approval-before-send" variant="outline">
              Approval before send
            </SimCtaLink>
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.title}>
              <article className="flex h-full flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-6 py-8 max-sm:px-5">
                <h2 className="text-[18px] text-[var(--text-primary)] leading-[1.3]">
                  {row.title}
                </h2>
                <p className="text-[15px] text-[var(--text-secondary)] leading-[1.45]">
                  {row.body}
                </p>
              </article>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-6 border-t border-[var(--border)] pt-10">
          <h2 className="text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
            Docs to read next
          </h2>
          <ul className="grid grid-cols-3 gap-6 max-sm:grid-cols-1 max-sm:gap-4">
            {trustLinks.map((item) => (
              <li key={item.href}>
                <Link
                  className={cn(
                    "group flex h-full flex-col items-start bg-[var(--surface-2)] px-8 pt-10 pb-10",
                    "rounded-[10px] border border-[var(--border)] max-sm:px-6 max-sm:pb-8",
                    "transition-[border-color] duration-200 ease-out hover-hover:hover:border-[var(--text-muted)] motion-reduce:transition-none",
                    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4",
                  )}
                  href={item.href}
                >
                  <span className="text-[18px] text-[var(--text-primary)] leading-[1.3]">
                    {item.title}
                  </span>
                  <span className="mt-2 max-w-[32ch] text-[15px] text-[var(--text-secondary)] leading-[1.45]">
                    {item.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <SimSubpageFaqSection faqs={[...faqs]} heading="The short versions" />

        <RelatedPages
          items={[
            {
              label: "Approval before send",
              href: "/guides/approval-before-send",
              description: "The write gate.",
            },
            {
              label: "Responsible disclosure",
              href: "/responsible-disclosure",
              description: "How to report a vulnerability.",
            },
          ]}
        />
      </section>
    </>
  );
}

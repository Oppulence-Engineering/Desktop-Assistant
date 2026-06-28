import { ArrowRight, Check, ChevronDown, CircleDot, FileText, Github, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  alternativeLinks,
  blogPages,
  customerPages,
  featureDetails,
  featureLinks,
  pricingPlans,
  productLinks,
  resourceLinks,
  socialLinks,
  toolLinks,
  type LinkItem,
  type MarketingPage,
} from "./marketing-data";

const integrationGroups = [
  "Gmail",
  "Google Calendar",
  "Fireflies",
  "Slack",
  "Linear",
  "GitHub",
  "Exa search",
  "Composio",
  "Custom MCP",
];

const desktopScreenshots = {
  chat: "/marketing/desktop-chat.png",
  connections: "/marketing/desktop-connections.png",
  email: "/marketing/desktop-email.png",
  home: "/marketing/desktop-home.png",
  knowledge: "/marketing/desktop-knowledge.png",
  meetings: "/marketing/desktop-meetings.png",
  tasks: "/marketing/desktop-background-tasks.png",
};

function screenshotForPage(page: MarketingPage) {
  const path = page.path.toLowerCase();

  if (
    path.includes("email") ||
    path.includes("gmail") ||
    path.includes("inbox") ||
    path.includes("reply")
  ) {
    return desktopScreenshots.email;
  }

  if (
    path.includes("calendar") ||
    path.includes("meeting") ||
    path.includes("fireflies") ||
    path.includes("granola") ||
    path.includes("transcript")
  ) {
    return desktopScreenshots.meetings;
  }

  if (
    path.includes("integration") ||
    path.includes("connect") ||
    path.includes("chrome") ||
    path.includes("browser") ||
    path.includes("slack") ||
    path.includes("github") ||
    path.includes("linear") ||
    path.includes("exa") ||
    path.includes("composio") ||
    path.includes("migration") ||
    path.includes("localization")
  ) {
    return desktopScreenshots.connections;
  }

  if (
    path.includes("customer") ||
    path.includes("support") ||
    path.includes("service") ||
    path.includes("widget") ||
    path.includes("agent") ||
    path.includes("assistant") ||
    path.includes("chat")
  ) {
    return desktopScreenshots.chat;
  }

  if (
    path.includes("background") ||
    path.includes("automated") ||
    path.includes("automation") ||
    path.includes("screenshots") ||
    path.includes("tools") ||
    path.includes("workflow") ||
    path.includes("code-to-docs") ||
    path.includes("mcp") ||
    path.includes("validator") ||
    path.includes("api") ||
    path.includes("platform") ||
    path.includes("sdk") ||
    path.includes("webhook") ||
    path.includes("worker")
  ) {
    return desktopScreenshots.tasks;
  }

  if (
    path.includes("knowledge") ||
    path.includes("documentation") ||
    path.includes("docs") ||
    path.includes("help") ||
    path.includes("faq") ||
    path.includes("notes") ||
    path.includes("runbook") ||
    path.includes("private") ||
    path.includes("search")
  ) {
    return desktopScreenshots.knowledge;
  }

  return desktopScreenshots.home;
}

function InlineLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Image
        alt=""
        className={cn("rounded-[3px]", compact ? "size-5" : "size-6")}
        height={24}
        src="/marketing/oppulence-icon.png"
        width={24}
      />
      {!compact ? (
        <span className="font-f37-stout text-[24px] leading-[24px] text-primary">oppulence</span>
      ) : null}
    </span>
  );
}

function MenuLink({ item }: { item: LinkItem }) {
  const content = (
    <>
      <span className="text-sm font-medium text-foreground">{item.label}</span>
      {item.description ? (
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {item.description}
        </span>
      ) : null}
    </>
  );

  if (item.external) {
    return (
      <a
        className="block px-2 py-2 transition-colors hover:bg-background-200"
        href={item.href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return (
    <Link className="block px-2 py-2 transition-colors hover:bg-background-200" href={item.href}>
      {content}
    </Link>
  );
}

function DropdownMenu({
  label,
  items,
  width = "w-[560px]",
}: {
  label: string;
  items: LinkItem[];
  width?: string;
}) {
  return (
    <div className="group relative">
      <button
        className="inline-flex h-8 items-center gap-1 px-2 py-1 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
        type="button"
      >
        {label}
        <ChevronDown className="size-3.5 transition-transform group-hover:rotate-180" />
      </button>
      <div className="invisible absolute top-full left-0 z-50 pt-3 opacity-0 transition group-hover:visible group-hover:opacity-100">
        <div
          className={cn(
            "border border-primary/10 border-dashed bg-background p-4 shadow-xl",
            width,
          )}
        >
          <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {items.map((item) => (
              <MenuLink item={item} key={item.href} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopBar() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-grid-x border-b border-dashed bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container-wrapper mx-auto">
        <div className="container mx-auto flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 flex-1 items-center">
            <Link aria-label="Oppulence home" className="flex items-center" href="/">
              <InlineLogo />
            </Link>
            <p className="ml-4 hidden border-primary/10 border-l pl-4 font-mono text-[10px] text-foreground/50 uppercase tracking-wider xl:block">
              Local-first AI coworker + agent platform
            </p>
          </div>

          <nav className="hidden items-center gap-2 xl:flex">
            <DropdownMenu items={featureLinks} label="Features" />
            <DropdownMenu items={resourceLinks} label="Resources" width="w-[420px]" />
            {[
              ["Product", "/api-documentation-software"],
              ["Docs", "/blog"],
              ["Plans", "/pricing"],
              ["Company", "/customers"],
            ].map(([label, href]) => (
              <Link
                className="px-2.5 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                href={href}
                key={href}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-1 md:flex xl:hidden">
            <Link
              className="px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
              href="/blog"
            >
              Docs
            </Link>
            <Link
              className="px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
              href="/pricing"
            >
              Plans
            </Link>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Button
              asChild
              className="hidden h-9 border border-primary/10 px-4 font-medium md:inline-flex"
              variant="ghost"
            >
              <Link href="/app">Dashboard</Link>
            </Button>
            <Button asChild className="h-9 border border-transparent px-4 font-medium">
              <Link href="/book-a-demo">Book a demo</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-clip border-grid-x bg-background text-foreground">
      <TopBar />
      <main className="flex flex-1 flex-col">
        <div className="container-wrapper mx-auto">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 flex-col border-primary/10 border-t border-dashed md:mt-0 md:border-transparent">
      <div className="container-wrapper z-0 mx-auto px-2 py-12 md:pt-36 lg:px-0">
        <div className="container grid grid-cols-1 gap-8 px-2 md:grid-cols-4 md:px-4">
          <div className="col-span-1 md:col-span-2">
            <Link className="inline-flex" href="/">
              <InlineLogo />
            </Link>
            <p className="mt-4 mb-6 max-w-md font-mono text-foreground/60 text-sm leading-relaxed">
              Oppulence turns email, calendar, meetings, and operations into one owned knowledge
              graph, then lets agents act through reviewable tools.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-2">
              {socialLinks.map((item) => (
                <Button asChild key={item.href} size="sm" variant="secondary">
                  <a href={item.href} rel="noopener noreferrer" target="_blank">
                    <Github className="size-4 text-muted-foreground" />
                    {item.label}
                  </a>
                </Button>
              ))}
            </div>
          </div>

          <FooterGroup items={featureLinks.slice(0, 8)} title="Features" />
          <FooterGroup
            items={[
              ...productLinks,
              ...toolLinks,
              ...resourceLinks,
              { label: "Privacy", href: "/legal/privacy-policy" },
              { label: "Terms", href: "/legal/terms-of-service" },
            ]}
            title="Links"
          />
        </div>
      </div>
      <div className="flex flex-col items-center justify-between border-primary/10 border-t border-dashed md:items-start">
        <div className="container-wrapper mx-auto flex flex-col items-center justify-between gap-6 px-4 pt-4 pb-20 md:flex-row md:items-start md:gap-0">
          <p className="px-6 text-center font-mono text-foreground/60 text-sm md:text-left lg:px-0">
            © 2026 oppulence. Open source under the MIT license.
          </p>
        </div>
        <div className="container-wrapper mx-auto w-full px-4 pb-16">
          <div className="flex items-center justify-center border-primary/10 border-t border-dashed pt-6 md:justify-start">
            <p className="font-mono text-[11px] text-foreground/45 uppercase tracking-wider">
              Oppulence — local-first AI coworker and agent platform
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({ title, items }: { title: string; items: LinkItem[] }) {
  return (
    <div>
      <h3 className="mb-4 font-mono font-semibold text-foreground text-sm">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={`${title}-${item.href}`}>
            {item.external ? (
              <a
                className="font-mono text-foreground/60 text-sm transition-colors hover:text-foreground"
                href={item.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                {item.label}
              </a>
            ) : (
              <Link
                className="font-mono text-foreground/60 text-sm transition-colors hover:text-foreground"
                href={item.href}
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const homeProblemCards = [
  {
    title: "You briefed from stale memory",
    body: "The latest email, meeting note, or commitment was somewhere else, so the prep doc missed the point that mattered.",
  },
  {
    title: "Your assistant has no continuity",
    body: "Every new prompt starts cold unless someone pastes context from inboxes, calendars, docs, tickets, and private notes.",
  },
  {
    title: "A follow-up got stuck in a tool",
    body: "The work crossed Gmail, Slack, Linear, GitHub, and a spreadsheet, but no single system knew what needed to happen next.",
  },
];

const homeIncludedFeatures = [
  {
    title: "Public help center",
    body: "Publish searchable, branded knowledge from the same graph that agents use internally.",
  },
  {
    title: "In-app widget",
    body: "Embed a grounded assistant into a product or internal tool without rebuilding the agent runtime.",
  },
  {
    title: "AI answers",
    body: "Answer from source-linked memory instead of one-off prompt history or disconnected docs.",
  },
  {
    title: "Gmail and Calendar",
    body: "Bring relationship context, meetings, decisions, and commitments into the operating graph.",
  },
  {
    title: "API documentation",
    body: "Expose projects, workflows, widget sessions, RAG, and worker jobs through the platform.",
  },
  {
    title: "Private docs",
    body: "Keep internal operational memory editable, portable, and ready for reviewable agent action.",
  },
  {
    title: "Translations",
    body: "Federate sources across teams and languages while keeping provenance attached.",
  },
  {
    title: "Analytics and agent trails",
    body: "Inspect what agents used, what changed, and which actions are waiting for approval.",
  },
  {
    title: "Zero downtime migration",
    body: "Start from the systems your team already uses and build the graph without a rewrite.",
  },
];

export function HomePage() {
  return (
    <div className="flex flex-col gap-8 pt-36 lg:min-h-screen xl:pt-40">
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex flex-col items-start gap-5 px-4 pb-8">
          <p className="inline-flex w-fit max-w-full rounded-full border border-primary/15 bg-primary/5 px-3 py-1 font-mono text-[10px] text-primary/75 uppercase tracking-wider">
            Local-first AI coworker + self-hosted agent platform
          </p>
          <h1 className="max-w-5xl text-balance text-left font-f37-stout text-4xl leading-tight md:text-5xl xl:text-6xl">
            Give every operator live work context before they write, meet, or act.
          </h1>
          <p className="max-w-3xl text-balance text-left text-base text-primary/70 leading-relaxed md:text-lg">
            Mirror email, calendar, meetings, files, and tools into an owned operations graph, then
            let agents brief, draft, update, and execute through reviewable workflows.
          </p>
          <div className="grid w-full grid-cols-1 gap-3 py-2 sm:grid-cols-3">
            {[
              ["Data Plane", "Gmail, Calendar, meetings, files, and tools."],
              ["Intelligence", "Briefs, live notes, runbooks, and source-linked answers."],
              ["Execution", "MCP actions with review and audit boundaries."],
            ].map(([label, value]) => (
              <div
                className="rounded-md border border-primary/10 bg-background/60 px-4 py-3"
                key={label}
              >
                <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-wider">
                  {label}
                </p>
                <p className="mt-1 text-sm text-foreground/75">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex w-full flex-col gap-3 md:max-w-[75%] md:gap-4 lg:max-w-full lg:flex-row lg:items-center">
            <Button
              asChild
              className="h-12 border border-transparent px-6 font-medium text-md has-[>svg]:px-4 lg:w-[250px]"
            >
              <Link href="/book-a-demo">Start with Oppulence</Link>
            </Button>
            <Button
              asChild
              className="h-12 justify-between border border-primary/10 px-4 font-medium text-md"
              variant="ghost"
            >
              <Link href="/ai-help-center">Explore the graph</Link>
            </Button>
          </div>
        </div>

        <DesktopScreenshotPreview
          alt="Oppulence desktop home screen with work context, tasks, and chat"
          className="hidden w-full rounded-sm border border-primary/10 bg-background/50 lg:block"
          src={desktopScreenshots.home}
        />

        <div className="mt-10 flex w-full flex-col-reverse items-center justify-center gap-8 px-6 lg:mt-auto lg:flex-row lg:justify-between lg:px-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <p className="font-mono text-foreground/60 text-xs">Works well with</p>
            {integrationGroups.slice(0, 6).map((item) => (
              <span
                className="rounded border border-primary/10 bg-background-100 px-2 py-1 font-mono text-[10px] text-foreground/60"
                key={item}
              >
                {item}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-foreground/45 uppercase tracking-wider">
            <span className="size-2 rounded-full bg-oppulence-green" />
            Live context layer
          </div>
        </div>
      </div>

      <section className="grid border-primary/10 border-y border-dashed md:grid-cols-3">
        {homeProblemCards.map((card) => (
          <article
            className="border-primary/10 border-b border-dashed bg-background-100/40 p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
            key={card.title}
          >
            <h2 className="font-semibold text-xl">{card.title}</h2>
            <p className="mt-3 text-foreground/80 text-sm leading-relaxed">{card.body}</p>
          </article>
        ))}
      </section>

      <section className="px-4 py-16 md:py-24">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div>
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              Product surface
            </p>
            <h2 className="mt-3 max-w-3xl font-f37-stout text-3xl leading-tight md:text-5xl">
              One graph for desktop, API, widgets, and background agents.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Oppulence follows the same operating model as the sync engine: an owned data plane, a
              context layer, and controlled execution surfaces for real teams.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {homeIncludedFeatures.slice(0, 6).map((item) => (
              <article
                className="border border-primary/10 border-dashed bg-background-100/40 p-5"
                key={item.title}
              >
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-primary/10 border-t border-dashed px-4 py-16 md:py-24">
        <div className="grid gap-6 md:grid-cols-3">
          {pricingPlans.map((plan) => (
            <article
              className={cn(
                "border border-primary/10 border-dashed bg-background-100/40 p-6",
                plan.recommended && "bg-oppulence-yellow-100/30",
              )}
              key={plan.name}
            >
              <h2 className="font-semibold text-xl">{plan.name}</h2>
              <p className="mt-5 text-3xl font-semibold">{plan.price}</p>
              <p className="mt-3 min-h-16 text-muted-foreground text-sm leading-relaxed">
                {plan.description}
              </p>
              <ul className="mt-6 space-y-2 text-foreground/80 text-sm leading-relaxed">
                {plan.features.map((feature) => (
                  <li key={feature}>- {feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DesktopScreenshotPreview({
  alt,
  className,
  src,
}: {
  alt: string;
  className?: string;
  src: string;
}) {
  return (
    <div
      className={cn("relative flex w-full items-center justify-center overflow-hidden", className)}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--background-100),transparent_34%,var(--background-300)),radial-gradient(circle_at_18%_22%,var(--oppulence-yellow)_0,transparent_18%),radial-gradient(circle_at_84%_76%,var(--oppulence-blue)_0,transparent_22%)] opacity-55" />
      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-center p-2 sm:p-6">
        <Image
          alt={alt}
          className="w-full min-w-0 max-w-6xl rounded-lg border border-primary/10 bg-background object-cover shadow-2xl"
          height={1000}
          priority={src === desktopScreenshots.home}
          sizes="(max-width: 768px) 100vw, 1120px"
          src={src}
          width={1440}
        />
      </div>
    </div>
  );
}

export function GenericPage({ page }: { page: MarketingPage }) {
  const details =
    featureDetails[page.path] ??
    (page.path === "lp/ai-help-center" ? featureDetails["ai-help-center"] : undefined);

  if (details) {
    return <FeatureMirrorPage details={details} page={page} />;
  }

  return (
    <PageShell page={page}>
      <section className="grid gap-6 md:grid-cols-3">
        {page.bullets.map((bullet, index) => (
          <article
            className="border border-dashed border-primary/10 bg-background-100/40 p-5"
            key={bullet}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              0{index + 1}
            </span>
            <p className="mt-4 text-sm leading-relaxed text-foreground/78">{bullet}</p>
          </article>
        ))}
      </section>
      <ProofGrid page={page} />
      {page.path === "integrations" ? <IntegrationsPanel /> : null}
      {page.category === "tool" ? <ToolPanel page={page} /> : null}
    </PageShell>
  );
}

function FeatureMirrorPage({
  page,
  details,
}: {
  page: MarketingPage;
  details: (typeof featureDetails)[string];
}) {
  return (
    <div className="flex flex-col pt-40 pb-20">
      <div className="mx-auto w-full max-w-6xl px-4">
        <header className="max-w-4xl">
          <p className="w-fit max-w-full rounded-full border border-primary/15 bg-primary/5 px-3 py-1 font-mono text-[10px] text-primary/75 uppercase tracking-wider">
            {page.eyebrow}
          </p>
          <h1 className="mt-5 text-balance font-f37-stout text-4xl leading-tight md:text-6xl">
            {page.title}
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
          <FeatureActionButtons
            primary={page.path === "ai-help-center" ? "Create your knowledge graph" : "Book a demo"}
          />
        </header>

        <section className="mt-12 grid gap-3 sm:grid-cols-3">
          {page.bullets.slice(0, 3).map((bullet, index) => (
            <article
              className="rounded-md border border-primary/10 bg-background/60 px-4 py-3"
              key={bullet}
            >
              <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-wider">
                0{index + 1}
              </p>
              <p className="mt-1 text-sm text-foreground/75">{bullet}</p>
            </article>
          ))}
        </section>

        <DesktopScreenshotPreview
          alt={`Oppulence desktop app screenshot for ${page.eyebrow}`}
          className="mt-10 rounded-sm border border-primary/10 bg-background/50"
          src={screenshotForPage(page)}
        />

        <section className="mt-14 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <article className="border border-primary/10 border-dashed bg-background-100/40 p-6">
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              Capability detail
            </p>
            <p className="mt-4 text-foreground/80 text-sm leading-relaxed">{details.summary}</p>
            <h2 className="mt-8 font-semibold text-xl">Workflow</h2>
            <ol className="mt-4 space-y-3">
              {details.workflow.map((step, index) => (
                <li className="flex gap-3 text-sm leading-relaxed" key={step}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded border border-primary/10 bg-background font-mono text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-foreground/75">{step}</span>
                </li>
              ))}
            </ol>
          </article>

          <div className="grid gap-4">
            {details.sections.map((section) => (
              <article
                className="border border-primary/10 border-dashed bg-background-100/40 p-6"
                key={section.title}
              >
                <h2 className="font-semibold text-xl">{section.title}</h2>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{section.body}</p>
              </article>
            ))}
            <article className="border border-primary/10 border-dashed bg-background p-6">
              <h2 className="font-semibold text-xl">Operational outcomes</h2>
              <div className="mt-4 grid gap-3">
                {details.outcomes.map((outcome) => (
                  <div className="flex gap-3 text-sm leading-relaxed" key={outcome}>
                    <Check className="mt-0.5 size-4 shrink-0 text-oppulence-green" />
                    <span className="text-foreground/75">{outcome}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <ProofGrid page={page} />
        {page.path === "integrations" ? <IntegrationsPanel /> : null}
        <section className="mt-14 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={page.ctaHref ?? "/book-a-demo"}>{page.ctaLabel ?? "Book a demo"}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/app">Open dashboard</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}

function FeatureActionButtons({
  primary = "Get started free",
  secondary = "Read docs",
}: {
  primary?: string;
  secondary?: string;
}) {
  return (
    <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button
        asChild
        className="h-12 border border-transparent px-6 font-medium text-md has-[>svg]:px-4"
      >
        <Link href="/book-a-demo">
          {primary}
          <ArrowRight className="size-4" />
        </Link>
      </Button>
      <Button
        asChild
        className="h-12 justify-between border border-primary/10 px-4 font-medium text-md"
        variant="ghost"
      >
        <Link href="/blog">{secondary}</Link>
      </Button>
    </div>
  );
}

function PageShell({ page, children }: { page: MarketingPage; children: ReactNode }) {
  return (
    <div className="flex flex-col pt-40 pb-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <header className="max-w-4xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
            {page.eyebrow}
          </p>
          <h1 className="mt-3 text-balance font-f37-stout text-4xl leading-tight md:text-6xl">
            {page.title}
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={page.ctaHref ?? "/book-a-demo"}>
                {page.ctaLabel ?? "Book a demo"}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app">Open dashboard</Link>
            </Button>
          </div>
        </header>
        <div className="mt-14 space-y-14">{children}</div>
      </div>
    </div>
  );
}

function ProofGrid({ page }: { page: MarketingPage }) {
  return (
    <section className="border-y border-dashed border-primary/10 py-10">
      <div className="grid gap-4 md:grid-cols-3">
        {page.proof.map((item) => (
          <div className="flex gap-3" key={item}>
            <Check className="mt-0.5 size-4 text-oppulence-green" />
            <p className="text-sm leading-relaxed text-foreground/72">{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function IntegrationsPanel() {
  return (
    <section>
      <h2 className="text-2xl font-semibold">Connector surface</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {integrationGroups.map((item) => (
          <div
            className="border border-dashed border-primary/10 bg-background-100/40 px-4 py-3 font-mono text-sm"
            key={item}
          >
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}

function ToolPanel({ page }: { page: MarketingPage }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <h2 className="text-2xl font-semibold">Tool workflow</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This is a static marketing representation of the tool route. The production validator or
          quiz logic can be wired behind the same URL when ready.
        </p>
      </div>
      <div className="border border-dashed border-primary/10 bg-background-100/50 p-5">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <CircleDot className="size-3 text-oppulence-orange" />
          {page.path}
        </div>
        <div className="mt-5 space-y-3">
          {page.bullets.map((bullet) => (
            <div className="border border-primary/10 bg-background px-4 py-3 text-sm" key={bullet}>
              {bullet}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PricingPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid border-y border-dashed border-primary/10 md:grid-cols-3">
        {pricingPlans.map((plan) => (
          <article
            className="border-b border-dashed border-primary/10 p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
            key={plan.name}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">{plan.name}</h2>
              {plan.recommended ? (
                <span className="font-mono text-xs text-oppulence-orange">Recommended</span>
              ) : null}
            </div>
            <p className="mt-5 text-3xl font-semibold">{plan.price}</p>
            <p className="mt-3 min-h-16 text-sm leading-relaxed text-muted-foreground">
              {plan.description}
            </p>
            <ul className="mt-8 space-y-3">
              {plan.features.map((feature) => (
                <li className="flex gap-2 text-sm" key={feature}>
                  <Check className="mt-0.5 size-4 text-oppulence-green" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </PageShell>
  );
}

export function BlogIndexPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {blogPages.slice(0, 18).map((post) => (
          <Link
            className="border border-dashed border-primary/10 bg-background-100/40 p-5 transition-colors hover:bg-background-200"
            href={`/${post.path}`}
            key={post.path}
          >
            <FileText className="size-4 text-oppulence-orange" />
            <h2 className="mt-4 line-clamp-2 font-semibold">{post.title}</h2>
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {post.description}
            </p>
          </Link>
        ))}
      </section>
    </PageShell>
  );
}

export function BlogArticlePage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <article className="max-w-3xl space-y-8 text-base leading-relaxed text-foreground/78">
        <p>
          Most knowledge-base and documentation categories assume the answer is a better publishing
          surface. Oppulence starts one layer lower: the corpus that agents and operators rely on
          before anything is published.
        </p>
        <p>
          The practical shift is ownership. Email threads, meeting notes, local files, product
          context, and tool events become durable Markdown memory with sources attached. The agent
          can search it, update it, and act from it without turning each workflow into a fresh
          prompt.
        </p>
        <p>
          That makes comparison pages less about which static help center looks better and more
          about which system keeps context alive, portable, and usable for controlled execution.
        </p>
      </article>
      <ProofGrid page={page} />
    </PageShell>
  );
}

export function CustomerIndexPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-4 md:grid-cols-2">
        {customerPages.map((story) => (
          <Link
            className="border border-dashed border-primary/10 bg-background-100/40 p-6 transition-colors hover:bg-background-200"
            href={`/${story.path}`}
            key={story.path}
          >
            <Github className="size-4 text-oppulence-blue" />
            <h2 className="mt-4 text-xl font-semibold">{story.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {story.description}
            </p>
          </Link>
        ))}
      </section>
    </PageShell>
  );
}

export function CustomerStoryPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-6 md:grid-cols-3">
        {["Before Oppulence", "With Oppulence", "Operational result"].map((title, index) => (
          <article className="border border-dashed border-primary/10 p-5" key={title}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-foreground/76">
              {page.bullets[index] ?? page.description}
            </p>
          </article>
        ))}
      </section>
      <ProofGrid page={page} />
    </PageShell>
  );
}

export function DemoPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border border-dashed border-primary/10 bg-background-100/40 p-6">
          <h2 className="text-2xl font-semibold">Demo agenda</h2>
          <ul className="mt-6 space-y-4">
            {page.bullets.map((bullet) => (
              <li className="flex gap-3 text-sm leading-relaxed" key={bullet}>
                <Play className="mt-0.5 size-4 text-oppulence-orange" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-primary/10 bg-background p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Request form placeholder
          </p>
          <div className="mt-5 grid gap-3">
            {["Work email", "Company", "Primary workflow"].map((field) => (
              <div
                className="border border-dashed border-primary/10 bg-background-100 px-4 py-3 text-sm text-muted-foreground"
                key={field}
              >
                {field}
              </div>
            ))}
          </div>
          <Button asChild className="mt-5">
            <Link href="/book-a-demo/success">Submit request</Link>
          </Button>
        </div>
      </section>
    </PageShell>
  );
}

export function LegalPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <article className="max-w-3xl space-y-6 text-sm leading-relaxed text-foreground/76">
        {page.bullets.map((bullet) => (
          <p key={bullet}>{bullet}</p>
        ))}
        <p>
          This route is intentionally present for launch-readiness and should be reviewed by counsel
          before production use.
        </p>
      </article>
    </PageShell>
  );
}

export function NotFoundMarketingPage() {
  return (
    <div className="px-6 pt-40 pb-20 md:px-8">
      <h1 className="font-f37-stout text-4xl leading-tight md:text-6xl">Page not found</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        This route is not in the Oppulence marketing surface.
      </p>
      <Button asChild className="mt-8">
        <Link href="/">Return home</Link>
      </Button>
    </div>
  );
}

export function RouteMapSummary() {
  return (
    <section className="border-t border-dashed border-primary/10 px-4 py-12 md:px-8">
      <div className="grid gap-8 md:grid-cols-3">
        <FooterGroup items={toolLinks} title="Tools" />
        <FooterGroup items={alternativeLinks} title="Alternatives" />
        <FooterGroup items={productLinks} title="Product" />
      </div>
    </section>
  );
}

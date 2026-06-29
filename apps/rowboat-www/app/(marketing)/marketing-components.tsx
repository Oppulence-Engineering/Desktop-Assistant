import {
  ArrowRightIcon,
  BrainIcon,
  BriefcaseIcon,
  CalendarDotsIcon,
  CaretDownIcon,
  ChartLineIcon,
  CheckCircleIcon,
  CircleIcon,
  CodeIcon,
  DatabaseIcon,
  EnvelopeIcon,
  FileTextIcon,
  FlowArrowIcon,
  GithubLogoIcon,
  GlobeIcon,
  HardDrivesIcon,
  HeadsetIcon,
  MagnifyingGlassIcon,
  MonitorIcon,
  NetworkIcon,
  PathIcon,
  PlayIcon,
  PlugsConnectedIcon,
  SealCheckIcon,
  SparkleIcon,
  StackIcon,
  TrayIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
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

const mobileNavLinks = [
  { label: "Docs", href: "/blog" },
  { label: "Plans", href: "/pricing" },
  { label: "Product", href: "/api-documentation-software" },
  { label: "Dashboard", href: "/app" },
];

type IconTone = "neutral" | "blue" | "green" | "orange" | "yellow";

const iconToneClasses: Record<IconTone, string> = {
  neutral: "text-foreground/78",
  blue: "text-oppulence-blue",
  green: "text-oppulence-green",
  orange: "text-oppulence-orange",
  yellow: "text-oppulence-yellow",
};

function MarketingIcon({
  className,
  compact = false,
  icon: Icon,
  weight,
  tone = "neutral",
}: {
  className?: string;
  compact?: boolean;
  icon: PhosphorIcon;
  weight?: IconWeight;
  tone?: IconTone;
}) {
  return (
    <span
      className={cn(
        "marketing-icon-frame",
        compact ? "size-7 rounded" : "size-9 rounded-md",
        iconToneClasses[tone],
        className,
      )}
    >
      <Icon
        className={compact ? "size-3.5" : "size-4"}
        weight={weight ?? (compact ? "regular" : "duotone")}
      />
    </span>
  );
}

function iconForLink(item: LinkItem): { icon: PhosphorIcon; tone?: IconTone } {
  const key = `${item.href} ${item.label} ${item.description ?? ""}`.toLowerCase();

  if (key.includes("gmail") || key.includes("email") || key.includes("inbox")) {
    return { icon: EnvelopeIcon, tone: "blue" };
  }

  if (key.includes("calendar") || key.includes("meeting") || key.includes("fireflies")) {
    return { icon: CalendarDotsIcon, tone: "yellow" };
  }

  if (key.includes("api") || key.includes("sdk") || key.includes("code")) {
    return { icon: CodeIcon, tone: "green" };
  }

  if (key.includes("github")) {
    return { icon: GithubLogoIcon, tone: "neutral" };
  }

  if (key.includes("widget") || key.includes("chat") || key.includes("support")) {
    return { icon: HeadsetIcon, tone: "blue" };
  }

  if (
    key.includes("integration") ||
    key.includes("connect") ||
    key.includes("slack") ||
    key.includes("github") ||
    key.includes("linear") ||
    key.includes("mcp")
  ) {
    return { icon: PlugsConnectedIcon, tone: "orange" };
  }

  if (key.includes("browser") || key.includes("chrome") || key.includes("multilingual")) {
    return { icon: GlobeIcon, tone: "blue" };
  }

  if (key.includes("customer") || key.includes("company")) {
    return { icon: BriefcaseIcon, tone: "yellow" };
  }

  if (key.includes("tool") || key.includes("validator") || key.includes("privacy")) {
    return { icon: SealCheckIcon, tone: "green" };
  }

  if (key.includes("docs") || key.includes("blog") || key.includes("article")) {
    return { icon: FileTextIcon, tone: "neutral" };
  }

  if (key.includes("knowledge") || key.includes("help") || key.includes("memory")) {
    return { icon: BrainIcon, tone: "green" };
  }

  return { icon: SparkleIcon, tone: "neutral" };
}

function iconForTitle(title: string): { icon: PhosphorIcon; tone?: IconTone } {
  const key = title.toLowerCase();

  if (key.includes("help") || key.includes("answer") || key.includes("docs")) {
    return { icon: MagnifyingGlassIcon, tone: "green" };
  }

  if (key.includes("widget") || key.includes("agent") || key.includes("assistant")) {
    return { icon: HeadsetIcon, tone: "blue" };
  }

  if (key.includes("gmail") || key.includes("email") || key.includes("inbox")) {
    return { icon: TrayIcon, tone: "blue" };
  }

  if (key.includes("calendar") || key.includes("meeting")) {
    return { icon: CalendarDotsIcon, tone: "yellow" };
  }

  if (key.includes("api") || key.includes("code") || key.includes("platform")) {
    return { icon: CodeIcon, tone: "green" };
  }

  if (key.includes("private") || key.includes("zero downtime")) {
    return { icon: HardDrivesIcon, tone: "neutral" };
  }

  if (key.includes("translation") || key.includes("source")) {
    return { icon: NetworkIcon, tone: "orange" };
  }

  if (key.includes("analytic") || key.includes("trail")) {
    return { icon: PathIcon, tone: "yellow" };
  }

  return { icon: StackIcon, tone: "neutral" };
}

function iconForPage(page: MarketingPage): { icon: PhosphorIcon; tone?: IconTone } {
  const fromLink = iconForLink({
    href: page.path,
    label: page.title,
    description: `${page.eyebrow} ${page.description}`,
  });

  if (fromLink.icon !== SparkleIcon) {
    return fromLink;
  }

  if (page.category === "blog") {
    return { icon: FileTextIcon, tone: "neutral" };
  }

  if (page.category === "customer") {
    return { icon: BriefcaseIcon, tone: "yellow" };
  }

  if (page.category === "demo") {
    return { icon: PlayIcon, tone: "orange" };
  }

  if (page.category === "legal") {
    return { icon: SealCheckIcon, tone: "green" };
  }

  if (page.category === "tool") {
    return { icon: FlowArrowIcon, tone: "orange" };
  }

  if (page.category === "landing") {
    return { icon: MonitorIcon, tone: "blue" };
  }

  return iconForTitle(page.title);
}

function EyebrowPill({
  children,
  className,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  icon: PhosphorIcon;
  tone?: IconTone;
}) {
  return (
    <p
      className={cn(
        "marketing-eyebrow inline-flex w-fit max-w-full items-center gap-2 rounded-full py-1 pr-3 pl-1.5 font-mono text-[10px] uppercase tracking-wider",
        className,
      )}
    >
      <MarketingIcon className="size-5 rounded-[3px]" compact icon={icon} tone={tone} />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

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
    path.includes("integrations") ||
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
        className={cn("rounded-[3px] dark:invert", compact ? "size-5" : "size-6")}
        height={24}
        src="/marketing/oppulence-icon.png"
        width={24}
      />
      {!compact ? (
        <span className="font-display text-[24px] leading-[24px] font-semibold text-primary">
          oppulence
        </span>
      ) : null}
    </span>
  );
}

function MenuLink({ item }: { item: LinkItem }) {
  const { icon, tone } = iconForLink(item);
  const content = (
    <>
      <MarketingIcon compact icon={icon} tone={tone} />
      <span className="min-w-0">
        <span className="text-sm font-medium text-foreground">{item.label}</span>
        {item.description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </>
  );

  if (item.external) {
    return (
      <a
        className="group/menu flex gap-3 rounded-md border border-transparent px-2.5 py-2.5 transition-colors hover:border-primary/10 hover:bg-background-100/80"
        href={item.href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      className="group/menu flex gap-3 rounded-md border border-transparent px-2.5 py-2.5 transition-colors hover:border-primary/10 hover:bg-background-100/80"
      href={item.href}
    >
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
        className="inline-flex h-8 items-center gap-1 rounded px-2.5 py-1 text-sm font-medium text-foreground/78 transition-colors hover:bg-background-100/80 hover:text-foreground"
        type="button"
      >
        {label}
        <CaretDownIcon className="size-3.5 transition-transform group-hover:rotate-180" />
      </button>
      <div className="invisible absolute top-full left-0 z-50 pt-3 opacity-0 transition group-hover:visible group-hover:opacity-100">
        <div
          className={cn(
            "marketing-surface-strong rounded-md border border-primary/10 bg-background p-3 shadow-xl shadow-black/30",
            width,
          )}
        >
          <div className="mb-2 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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

function MobileMenu() {
  return (
    <details className="group/mobile-menu relative md:hidden">
      <summary className="marketing-cta-secondary inline-flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-primary/10 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Menu
        <CaretDownIcon className="size-3.5 transition-transform group-open/mobile-menu:rotate-180" />
      </summary>
      <div className="marketing-surface-strong absolute top-11 right-0 z-50 w-48 border p-2">
        {mobileNavLinks.map((item) => (
          <Link
            className="flex items-center justify-between rounded px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-background-100/80 hover:text-foreground"
            href={item.href}
            key={item.href}
          >
            {item.label}
            <ArrowRightIcon className="size-3.5 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </details>
  );
}

export function TopBar() {
  return (
    <header className="marketing-topbar fixed top-0 right-0 left-0 z-50 border-grid-x border-b bg-background/90 shadow-xl shadow-black/20 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
      <div className="container-wrapper mx-auto">
        <div className="container mx-auto flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 flex-1 items-center">
            <Link aria-label="Oppulence home" className="flex items-center" href="/">
              <span className="inline-flex max-[359px]:hidden">
                <InlineLogo />
              </span>
              <span className="hidden max-[359px]:inline-flex">
                <InlineLogo compact />
              </span>
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
                className="rounded px-2.5 py-1.5 text-sm font-medium text-foreground/78 transition-colors hover:bg-background-100/80 hover:text-foreground"
                href={href}
                key={href}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-1 md:flex xl:hidden">
            <Link
              className="rounded px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:bg-background-100/80 hover:text-foreground"
              href="/blog"
            >
              Docs
            </Link>
            <Link
              className="rounded px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:bg-background-100/80 hover:text-foreground"
              href="/pricing"
            >
              Plans
            </Link>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <MobileMenu />
            <Button
              asChild
              className="marketing-cta-secondary hidden h-9 border border-primary/10 px-4 font-medium md:inline-flex"
              variant="ghost"
            >
              <Link href="/app">Dashboard</Link>
            </Button>
            <Button asChild className="marketing-cta-primary h-9 border border-transparent px-4 font-medium">
              <Link href="/book-a-demo">
                <span className="hidden sm:inline">Book a demo</span>
                <span className="sm:hidden">Demo</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-polar dark relative flex min-h-svh flex-col overflow-clip border-grid-x bg-background text-foreground">
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
    <footer className="mt-16 flex-col border-primary/10 border-t md:mt-0 md:border-transparent">
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
                    <MarketingIcon compact icon={GithubLogoIcon} />
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
      <div className="flex flex-col items-center justify-between border-primary/10 border-t md:items-start">
        <div className="container-wrapper mx-auto flex flex-col items-center justify-between gap-6 px-4 pt-4 pb-20 md:flex-row md:items-start md:gap-0">
          <p className="px-6 text-center font-mono text-foreground/60 text-sm md:text-left lg:px-0">
            © 2026 oppulence. Open source under the MIT license.
          </p>
        </div>
        <div className="container-wrapper mx-auto w-full px-4 pb-16">
          <div className="flex items-center justify-center border-primary/10 border-t pt-6 md:justify-start">
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
        {items.map((item) => {
          const { icon, tone } = iconForLink(item);
          const content = (
            <>
              <MarketingIcon className="size-5 rounded-[3px]" compact icon={icon} tone={tone} />
              <span className="min-w-0">{item.label}</span>
            </>
          );

          return (
            <li key={`${title}-${item.href}`}>
              {item.external ? (
                <a
                  className="flex items-center gap-2 font-mono text-foreground/60 text-sm transition-colors hover:text-foreground"
                  href={item.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {content}
                </a>
              ) : (
                <Link
                  className="flex items-center gap-2 font-mono text-foreground/60 text-sm transition-colors hover:text-foreground"
                  href={item.href}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
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

const homeHeroCards: {
  label: string;
  value: string;
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  {
    label: "Data Plane",
    value: "Gmail, Calendar, meetings, files, and tools.",
    icon: DatabaseIcon,
    tone: "blue",
  },
  {
    label: "Intelligence",
    value: "Briefs, live notes, runbooks, and source-linked answers.",
    icon: BrainIcon,
    tone: "green",
  },
  {
    label: "Execution",
    value: "MCP actions with review and audit boundaries.",
    icon: FlowArrowIcon,
    tone: "orange",
  },
];

const homeContextRows: {
  source: string;
  detail: string;
  state: string;
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  {
    source: "Inbox",
    detail: "Security notes before the pilot reply",
    state: "2 new",
    icon: EnvelopeIcon,
    tone: "blue",
  },
  {
    source: "Meetings",
    detail: "Renewal call summary attached",
    state: "live",
    icon: CalendarDotsIcon,
    tone: "yellow",
  },
  {
    source: "Knowledge",
    detail: "Acme account brief updated",
    state: "synced",
    icon: FileTextIcon,
    tone: "green",
  },
];

const homeContextStats = [
  { label: "Sources", value: "9" },
  { label: "Boundary", value: "MCP" },
  { label: "Memory", value: "MD" },
];

const homeProblemIcons: {
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  { icon: ChartLineIcon, tone: "yellow" },
  { icon: HeadsetIcon, tone: "blue" },
  { icon: PlugsConnectedIcon, tone: "orange" },
];

const bulletIconCycle: {
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  { icon: SparkleIcon, tone: "yellow" },
  { icon: FlowArrowIcon, tone: "orange" },
  { icon: SealCheckIcon, tone: "green" },
  { icon: BrainIcon, tone: "blue" },
];

const pricingPlanIcons: {
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  { icon: HardDrivesIcon, tone: "blue" },
  { icon: FlowArrowIcon, tone: "orange" },
  { icon: SealCheckIcon, tone: "green" },
];

const customerStoryIcons: {
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  { icon: ChartLineIcon, tone: "yellow" },
  { icon: FlowArrowIcon, tone: "blue" },
  { icon: CheckCircleIcon, tone: "green" },
];

function PlanCtaButton({ plan }: { plan: (typeof pricingPlans)[number] }) {
  const isDesktop = plan.name === "Desktop";
  const href = isDesktop ? "/app" : "/book-a-demo";
  const label = isDesktop ? "Open dashboard" : plan.recommended ? "Plan rollout" : "Book a demo";

  return (
    <Button
      asChild
      className={cn(
        "mt-7 h-10 w-full justify-between px-4 font-medium",
        plan.recommended ? "marketing-cta-primary" : "marketing-cta-secondary",
      )}
      variant={plan.recommended ? "default" : "ghost"}
    >
      <Link href={href}>
        {label}
        <ArrowRightIcon className="size-4" />
      </Link>
    </Button>
  );
}

function HomeContextPanel() {
  return (
    <aside className="marketing-surface-strong hidden border p-5 lg:block">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <MarketingIcon icon={NetworkIcon} tone="green" />
          <div>
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              Live context
            </p>
            <h2 className="mt-1 font-semibold text-lg">Operations graph</h2>
          </div>
        </div>
        <span className="rounded border border-oppulence-green/25 bg-oppulence-green/10 px-2 py-1 font-mono text-[10px] text-oppulence-green uppercase tracking-wider">
          Online
        </span>
      </div>

      <div className="mt-5 divide-y divide-primary/10 border-y border-primary/10">
        {homeContextRows.map(({ detail, icon, source, state, tone }) => (
          <div className="flex items-center gap-3 py-3" key={source}>
            <MarketingIcon compact icon={icon} tone={tone} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-wider">
                {source}
              </p>
              <p className="mt-1 truncate text-sm text-foreground/80">{detail}</p>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              {state}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        {homeContextStats.map((item) => (
          <div key={item.label}>
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

function heroPanelForPage(page: MarketingPage): {
  eyebrow: string;
  heading: string;
  icon: PhosphorIcon;
  items: string[];
  tone: IconTone;
} {
  if (page.path === "pricing") {
    return {
      eyebrow: "Plan fit",
      heading: "Buyer paths",
      icon: HardDrivesIcon,
      items: page.bullets,
      tone: "blue",
    };
  }

  if (page.category === "blog") {
    return {
      eyebrow: "Reading paths",
      heading: "Resource map",
      icon: FileTextIcon,
      items: page.bullets,
      tone: "neutral",
    };
  }

  if (page.category === "customer") {
    return {
      eyebrow: "Customer fit",
      heading: "Operator stories",
      icon: BriefcaseIcon,
      items: page.bullets,
      tone: "yellow",
    };
  }

  if (page.category === "demo") {
    return {
      eyebrow: "Demo path",
      heading: "What we cover",
      icon: PlayIcon,
      items: page.bullets,
      tone: "orange",
    };
  }

  if (page.category === "tool") {
    return {
      eyebrow: "Tool path",
      heading: "Workflow checks",
      icon: SealCheckIcon,
      items: page.bullets,
      tone: "green",
    };
  }

  return {
    eyebrow: "Capability path",
    heading: page.eyebrow,
    icon: iconForPage(page).icon,
    items: page.bullets.length > 0 ? page.bullets : page.proof,
    tone: iconForPage(page).tone ?? "green",
  };
}

function HeroProofPanel({ page }: { page: MarketingPage }) {
  const panel = heroPanelForPage(page);

  return (
    <aside className="marketing-surface hidden border p-5 lg:block">
      <div className="flex items-center gap-3">
        <MarketingIcon icon={panel.icon} tone={panel.tone} />
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {panel.eyebrow}
          </p>
          <h2 className="mt-1 font-semibold text-lg">{panel.heading}</h2>
        </div>
      </div>
      <div className="mt-5 divide-y divide-primary/10 border-y border-primary/10">
        {panel.items.slice(0, 3).map((item, index) => (
          <div className="flex gap-3 py-3 text-sm leading-relaxed" key={item}>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              0{index + 1}
            </span>
            <p className="text-foreground/78">{item}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function HomePage() {
  return (
    <div className="flex flex-col gap-8 pt-28 lg:min-h-screen xl:pt-32">
      <div className="flex flex-1 flex-col gap-6">
        <div className="px-4 pb-8">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] lg:items-center">
            <div className="flex w-full min-w-0 flex-col items-start gap-5">
              <EyebrowPill icon={DatabaseIcon} tone="blue">
                Local-first AI coworker + self-hosted agent platform
              </EyebrowPill>
              <h1 className="marketing-hero-title w-full min-w-0 max-w-5xl text-balance text-left font-display text-5xl leading-[1.03] font-normal md:text-6xl xl:text-[4.1rem]">
                Give every operator live work context before they write, meet, or act.
              </h1>
              <p className="max-w-3xl text-balance text-left text-base text-muted-foreground leading-relaxed md:text-xl">
                Mirror email, calendar, meetings, files, and tools into an owned operations graph,
                then let agents brief, draft, update, and execute through reviewable workflows.
              </p>
              <div className="mt-2 flex w-full flex-col gap-3 md:max-w-[75%] md:gap-4 lg:max-w-full lg:flex-row lg:items-center">
                <Button
                  asChild
                  className="marketing-cta-primary h-12 border border-transparent px-6 font-medium text-md has-[>svg]:px-4 lg:w-[250px]"
                >
                  <Link href="/book-a-demo">
                    Start with Oppulence
                    <ArrowRightIcon className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  className="marketing-cta-secondary h-12 justify-between border border-primary/10 px-4 font-medium text-md"
                  variant="ghost"
                >
                  <Link href="/ai-help-center">
                    Explore the graph
                    <ArrowRightIcon className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
            <HomeContextPanel />
          </div>

          <div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            {homeHeroCards.map(({ icon, label, tone, value }) => (
              <div
                className="marketing-surface flex items-start gap-3 rounded-md border px-4 py-3"
                key={label}
              >
                <MarketingIcon compact icon={icon} tone={tone} />
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-wider">
                    {label}
                  </p>
                  <p className="mt-1 text-sm text-foreground/75">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DesktopScreenshotPreview
          alt="Oppulence desktop home screen with work context, tasks, and chat"
          className="hidden w-full lg:block"
          src={desktopScreenshots.home}
        />

        <div className="mt-10 flex w-full flex-col-reverse items-center justify-center gap-8 px-6 lg:mt-auto lg:flex-row lg:justify-between lg:px-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <p className="font-mono text-foreground/60 text-xs">Works well with</p>
            {integrationGroups.slice(0, 6).map((item) => {
              const { icon, tone } = iconForLink({ href: item, label: item });

              return (
                <span
                  className="marketing-chip inline-flex items-center gap-1.5 rounded border py-1 pr-2 pl-1 font-mono text-[10px] text-foreground/65"
                  key={item}
                >
                  <MarketingIcon className="size-5 rounded-[3px]" compact icon={icon} tone={tone} />
                  {item}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-foreground/45 uppercase tracking-wider">
            <span className="size-2 rounded-full bg-oppulence-green" />
            Live context layer
          </div>
        </div>
      </div>

      <section className="grid border-primary/10 border-y md:grid-cols-3">
        {homeProblemCards.map((card, index) => (
          <article
            className="marketing-surface border-primary/10 border-b p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
            key={card.title}
          >
            <MarketingIcon
              icon={homeProblemIcons[index]?.icon ?? ChartLineIcon}
              tone={homeProblemIcons[index]?.tone ?? "neutral"}
            />
            <h2 className="mt-5 font-semibold text-xl">{card.title}</h2>
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
            <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight font-normal md:text-6xl">
              One graph for desktop, API, widgets, and background agents.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Oppulence follows the same operating model as the sync engine: an owned data plane, a
              context layer, and controlled execution surfaces for real teams.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {homeIncludedFeatures.slice(0, 6).map((item) => {
              const { icon, tone } = iconForTitle(item.title);

              return (
                <article className="marketing-surface border p-5" key={item.title}>
                  <MarketingIcon icon={icon} tone={tone} />
                  <h3 className="mt-5 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-primary/10 border-t px-4 py-16 md:py-24">
        <div className="grid gap-6 md:grid-cols-3">
          {pricingPlans.map((plan, index) => {
            const { icon, tone } = pricingPlanIcons[index % pricingPlanIcons.length];

            return (
              <article
                className={cn(
                  "marketing-surface border p-6",
                  plan.recommended && "marketing-surface-strong",
                )}
                key={plan.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <MarketingIcon icon={icon} tone={tone} />
                  {plan.recommended ? (
                    <span className="rounded border border-oppulence-orange/30 bg-oppulence-orange/10 px-2 py-1 font-mono text-[10px] text-oppulence-orange uppercase tracking-wider">
                      Recommended
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-5 font-semibold text-xl">{plan.name}</h2>
                <p className="mt-5 text-3xl font-semibold">{plan.price}</p>
                <p className="mt-3 min-h-16 text-muted-foreground text-sm leading-relaxed">
                  {plan.description}
                </p>
                <ul className="mt-6 space-y-3 text-foreground/80 text-sm leading-relaxed">
                  {plan.features.map((feature) => (
                    <li className="flex gap-3" key={feature}>
                      <MarketingIcon compact icon={CheckCircleIcon} tone="green" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <PlanCtaButton plan={plan} />
              </article>
            );
          })}
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
      className={cn(
        "marketing-preview relative flex w-full flex-col items-stretch justify-center overflow-hidden border border-primary/10 bg-background/50",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--background-50),var(--background)_58%,var(--background-100))]" />
      <div className="relative z-10 flex items-center justify-between border-primary/10 border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-oppulence-orange/70" />
          <span className="size-2 rounded-full bg-oppulence-yellow/70" />
          <span className="size-2 rounded-full bg-oppulence-green/70" />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
          Oppulence Desktop
        </span>
        <span className="hidden font-mono text-[10px] text-muted-foreground uppercase tracking-wider sm:inline">
          Local graph
        </span>
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-center p-2 sm:p-6">
        <Image
          alt={alt}
          className="marketing-preview-image w-full min-w-0 max-w-6xl rounded-md border border-primary/10 bg-background object-cover shadow-2xl shadow-black/30"
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
        {page.bullets.map((bullet, index) => {
          const { icon, tone } = bulletIconCycle[index % bulletIconCycle.length];

          return (
            <article className="marketing-surface border p-5" key={bullet}>
              <div className="flex items-center justify-between gap-3">
                <MarketingIcon icon={icon} tone={tone} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-foreground/78">{bullet}</p>
            </article>
          );
        })}
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
    <div className="flex flex-col pt-32 pb-20">
      <div className="mx-auto w-full max-w-6xl px-4">
        <header className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 max-w-4xl">
            <EyebrowPill {...iconForPage(page)}>
              {page.eyebrow}
            </EyebrowPill>
            <h1 className="marketing-hero-title mt-5 w-full min-w-0 text-balance font-display text-5xl leading-[1.03] font-normal md:text-6xl xl:text-[4rem]">
              {page.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
            <FeatureActionButtons
              primary={
                page.path === "ai-help-center" ? "Create your knowledge graph" : "Book a demo"
              }
            />
          </div>
          <HeroProofPanel page={page} />
        </header>

        <section className="mt-12 grid gap-3 sm:grid-cols-3">
          {page.bullets.slice(0, 3).map((bullet, index) => {
            const { icon, tone } = bulletIconCycle[index % bulletIconCycle.length];

            return (
              <article
                className="marketing-surface flex gap-3 rounded-md border px-4 py-3"
                key={bullet}
              >
                <MarketingIcon compact icon={icon} tone={tone} />
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-foreground/55 uppercase tracking-wider">
                    0{index + 1}
                  </p>
                  <p className="mt-1 text-sm text-foreground/75">{bullet}</p>
                </div>
              </article>
            );
          })}
        </section>

        <DesktopScreenshotPreview
          alt={`Oppulence desktop app screenshot for ${page.eyebrow}`}
          className="mt-10"
          src={screenshotForPage(page)}
        />

        <section className="mt-14 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <article className="marketing-surface border p-6">
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              Capability detail
            </p>
            <p className="mt-4 text-foreground/80 text-sm leading-relaxed">{details.summary}</p>
            <h2 className="mt-8 font-semibold text-xl">Workflow</h2>
            <ol className="mt-4 space-y-3">
              {details.workflow.map((step, index) => (
                <li className="flex gap-3 text-sm leading-relaxed" key={step}>
                  <span className="marketing-icon-frame size-7 rounded font-mono text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-foreground/75">{step}</span>
                </li>
              ))}
            </ol>
          </article>

          <div className="grid gap-4">
            {details.sections.map((section) => {
              const { icon, tone } = iconForTitle(section.title);

              return (
                <article className="marketing-surface border p-6" key={section.title}>
                  <MarketingIcon icon={icon} tone={tone} />
                  <h2 className="mt-5 font-semibold text-xl">{section.title}</h2>
                  <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                    {section.body}
                  </p>
                </article>
              );
            })}
            <article className="marketing-surface-strong border p-6">
              <h2 className="font-semibold text-xl">Operational outcomes</h2>
              <div className="mt-4 grid gap-3">
                {details.outcomes.map((outcome) => (
                  <div className="flex gap-3 text-sm leading-relaxed" key={outcome}>
                    <MarketingIcon compact icon={CheckCircleIcon} tone="green" />
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
          <Button asChild className="marketing-cta-primary">
            <Link href={page.ctaHref ?? "/book-a-demo"}>{page.ctaLabel ?? "Book a demo"}</Link>
          </Button>
          <Button asChild className="marketing-cta-secondary" variant="ghost">
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
        className="marketing-cta-primary h-12 border border-transparent px-6 font-medium text-md has-[>svg]:px-4"
      >
        <Link href="/book-a-demo">
          {primary}
          <ArrowRightIcon className="size-4" />
        </Link>
      </Button>
      <Button
        asChild
        className="marketing-cta-secondary h-12 justify-between border border-primary/10 px-4 font-medium text-md"
        variant="ghost"
      >
        <Link href="/blog">{secondary}</Link>
      </Button>
    </div>
  );
}

function PageShell({ page, children }: { page: MarketingPage; children: ReactNode }) {
  return (
    <div className="flex flex-col pt-32 pb-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <header className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 max-w-4xl">
            <EyebrowPill {...iconForPage(page)}>
              {page.eyebrow}
            </EyebrowPill>
            <h1 className="marketing-hero-title mt-3 w-full min-w-0 text-balance font-display text-5xl leading-[1.03] font-normal md:text-6xl xl:text-[4rem]">
              {page.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/book-a-demo"}>
                  {page.ctaLabel ?? "Book a demo"}
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
              <Button asChild className="marketing-cta-secondary" variant="outline">
                <Link href="/app">Open dashboard</Link>
              </Button>
            </div>
          </div>
          <HeroProofPanel page={page} />
        </header>
        <div className="mt-14 space-y-14">{children}</div>
      </div>
    </div>
  );
}

function ProofGrid({ page }: { page: MarketingPage }) {
  return (
    <section className="border-y border-primary/10 py-10">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
            Operational proof
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Built for owned context.</h2>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {page.eyebrow} routes keep the same standards: portable memory, reviewable actions, and
          static deployment paths.
        </p>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {page.proof.map((item, index) => (
          <article className="marketing-surface flex gap-3 border p-4" key={item}>
            <MarketingIcon compact icon={CheckCircleIcon} tone="green" />
            <div className="min-w-0">
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                0{index + 1}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/72">{item}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function IntegrationsPanel() {
  return (
    <section>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
            Connector surface
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Sources stay visible and reviewable.</h2>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Oppulence keeps each connected source legible while agents work across the graph.
        </p>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {integrationGroups.map((item) => {
          const { icon, tone } = iconForLink({ href: item, label: item });

          return (
            <div
              className="marketing-surface flex items-center gap-3 border px-4 py-3 font-mono text-sm"
              key={item}
            >
              <MarketingIcon compact icon={icon} tone={tone} />
              {item}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ToolPanel({ page }: { page: MarketingPage }) {
  return (
    <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
          Tool workflow
        </p>
        <h2 className="mt-2 text-2xl font-semibold">A clear path from check to action.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This is a static marketing representation of the tool route. The production validator or
          quiz logic can be wired behind the same URL when ready.
        </p>
      </div>
      <div className="marketing-surface border p-5">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <MarketingIcon compact icon={CircleIcon} tone="orange" />
          {page.path}
        </div>
        <div className="mt-5 space-y-3">
          {page.bullets.map((bullet) => (
            <div
              className="marketing-chip flex gap-3 border px-4 py-3 text-sm"
              key={bullet}
            >
              <MarketingIcon compact icon={SealCheckIcon} tone="green" />
              <span>{bullet}</span>
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
      <section className="grid border-y border-primary/10 md:grid-cols-3">
        {pricingPlans.map((plan, index) => {
          const { icon, tone } = pricingPlanIcons[index % pricingPlanIcons.length];

          return (
            <article
              className="marketing-surface border-b border-primary/10 p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
              key={plan.name}
            >
              <div className="flex items-start justify-between gap-3">
                <MarketingIcon icon={icon} tone={tone} />
                {plan.recommended ? (
                  <span className="rounded border border-oppulence-orange/30 bg-oppulence-orange/10 px-2 py-1 font-mono text-[10px] text-oppulence-orange uppercase tracking-wider">
                    Recommended
                  </span>
                ) : null}
              </div>
              <h2 className="mt-5 text-2xl font-semibold">{plan.name}</h2>
              <p className="mt-5 text-3xl font-semibold">{plan.price}</p>
              <p className="mt-3 min-h-16 text-sm leading-relaxed text-muted-foreground">
                {plan.description}
              </p>
              <ul className="mt-8 space-y-3">
                {plan.features.map((feature) => (
                  <li className="flex gap-3 text-sm" key={feature}>
                    <MarketingIcon compact icon={CheckCircleIcon} tone="green" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <PlanCtaButton plan={plan} />
            </article>
          );
        })}
      </section>
    </PageShell>
  );
}

export function BlogIndexPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {blogPages.slice(0, 18).map((post, index) => (
          <Link
            className="marketing-surface flex min-h-56 flex-col border p-5 transition-colors hover:bg-background-200"
            href={`/${post.path}`}
            key={post.path}
          >
            <div className="flex items-start justify-between gap-3">
              <MarketingIcon icon={FileTextIcon} tone="orange" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Guide {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h2 className="mt-4 line-clamp-2 font-semibold">{post.title}</h2>
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {post.description}
            </p>
            <div className="mt-auto flex items-center justify-between border-primary/10 border-t pt-4 font-mono text-[10px] text-foreground/60 uppercase tracking-wider">
              <span>Read guide</span>
              <ArrowRightIcon className="size-3.5" />
            </div>
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
            className="marketing-surface flex min-h-48 flex-col border p-6 transition-colors hover:bg-background-200"
            href={`/${story.path}`}
            key={story.path}
          >
            <div className="flex items-start justify-between gap-3">
              <MarketingIcon icon={GithubLogoIcon} tone="blue" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                Story
              </span>
            </div>
            <h2 className="mt-4 text-xl font-semibold">{story.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {story.description}
            </p>
            <div className="mt-auto flex items-center justify-between border-primary/10 border-t pt-4 font-mono text-[10px] text-foreground/60 uppercase tracking-wider">
              <span>Open story</span>
              <ArrowRightIcon className="size-3.5" />
            </div>
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
          <article className="marketing-surface border p-5" key={title}>
            <div className="flex items-start justify-between gap-3">
              <MarketingIcon
                icon={customerStoryIcons[index]?.icon ?? BriefcaseIcon}
                tone={customerStoryIcons[index]?.tone ?? "neutral"}
              />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                0{index + 1}
              </span>
            </div>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
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
        <div className="marketing-surface border p-6">
          <h2 className="text-2xl font-semibold">Demo agenda</h2>
          <ul className="mt-6 space-y-4">
            {page.bullets.map((bullet) => (
              <li className="flex gap-3 text-sm leading-relaxed" key={bullet}>
                <MarketingIcon compact icon={PlayIcon} tone="orange" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="marketing-surface-strong border p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Request form placeholder
          </p>
          <div className="mt-5 grid gap-3">
            {["Work email", "Company", "Primary workflow"].map((field) => (
              <div
                className="marketing-chip border px-4 py-3 text-sm text-muted-foreground"
                key={field}
              >
                {field}
              </div>
            ))}
          </div>
          <Button asChild className="marketing-cta-primary mt-5">
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
      <h1 className="font-display text-5xl leading-none font-normal md:text-7xl">
        Page not found
      </h1>
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
    <section className="border-t border-primary/10 px-4 py-12 md:px-8">
      <div className="grid gap-8 md:grid-cols-3">
        <FooterGroup items={toolLinks} title="Tools" />
        <FooterGroup items={alternativeLinks} title="Alternatives" />
        <FooterGroup items={productLinks} title="Product" />
      </div>
    </section>
  );
}

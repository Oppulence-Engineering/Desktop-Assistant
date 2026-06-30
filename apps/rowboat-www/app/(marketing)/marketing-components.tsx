// Material icons via @mui/icons-material — the same icon library polar.sh uses.
// Aliased to the previous local names so the icon-mapping logic stays untouched.
import type { SvgIconComponent } from "@mui/icons-material";
import ArrowRightIcon from "@mui/icons-material/ArrowForwardOutlined";
import BrainIcon from "@mui/icons-material/PsychologyOutlined";
import BriefcaseIcon from "@mui/icons-material/BusinessCenterOutlined";
import CalendarDotsIcon from "@mui/icons-material/CalendarMonthOutlined";
import CaretDownIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import ChartLineIcon from "@mui/icons-material/ShowChartOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CircleIcon from "@mui/icons-material/CircleOutlined";
import CodeIcon from "@mui/icons-material/CodeOutlined";
import DownloadIcon from "@mui/icons-material/DownloadOutlined";
import EnvelopeIcon from "@mui/icons-material/MailOutlineOutlined";
import FileTextIcon from "@mui/icons-material/DescriptionOutlined";
import FlowArrowIcon from "@mui/icons-material/SchemaOutlined";
import GithubLogoIcon from "@mui/icons-material/GitHub";
import GlobeIcon from "@mui/icons-material/LanguageOutlined";
import HardDrivesIcon from "@mui/icons-material/StorageOutlined";
import HeadsetIcon from "@mui/icons-material/SupportAgentOutlined";
import MagnifyingGlassIcon from "@mui/icons-material/SearchOutlined";
import MonitorIcon from "@mui/icons-material/DesktopWindowsOutlined";
import NetworkIcon from "@mui/icons-material/HubOutlined";
import PathIcon from "@mui/icons-material/RouteOutlined";
import PlayIcon from "@mui/icons-material/PlayCircleOutlined";
import PlugsConnectedIcon from "@mui/icons-material/CableOutlined";
import SealCheckIcon from "@mui/icons-material/VerifiedOutlined";
import SparkleIcon from "@mui/icons-material/AutoAwesomeOutlined";
import StackIcon from "@mui/icons-material/LayersOutlined";
import TrayIcon from "@mui/icons-material/InboxOutlined";
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
  type FeatureDetail,
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
  { label: "Product", href: "/product" },
  { label: "Resources", href: "/blog" },
  { label: "Plans", href: "/pricing" },
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
  tone = "neutral",
}: {
  className?: string;
  compact?: boolean;
  icon: SvgIconComponent;
  tone?: IconTone;
}) {
  return (
    <span
      className={cn(
        "marketing-icon-frame",
        compact ? "size-7 rounded-md" : "size-9 rounded-[8px]",
        iconToneClasses[tone],
        className,
      )}
    >
      <Icon style={{ fontSize: compact ? "0.875rem" : "1rem" }} />
    </span>
  );
}

function iconForLink(item: LinkItem): { icon: SvgIconComponent; tone?: IconTone } {
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

function iconForTitle(title: string): { icon: SvgIconComponent; tone?: IconTone } {
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

function iconForPage(page: MarketingPage): { icon: SvgIconComponent; tone?: IconTone } {
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
  icon: SvgIconComponent;
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
        <CaretDownIcon
          className="transition-transform group-hover:rotate-180"
          style={{ fontSize: "0.875rem" }}
        />
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
        <CaretDownIcon
          className="transition-transform group-open/mobile-menu:rotate-180"
          style={{ fontSize: "0.875rem" }}
        />
      </summary>
      <div className="marketing-surface-strong absolute top-11 right-0 z-50 w-48 border p-2">
        {mobileNavLinks.map((item) => (
          <Link
            className="flex items-center justify-between rounded px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-background-100/80 hover:text-foreground"
            href={item.href}
            key={item.href}
          >
            {item.label}
            <ArrowRightIcon className="text-muted-foreground" style={{ fontSize: "0.875rem" }} />
          </Link>
        ))}
      </div>
    </details>
  );
}

export function TopBar() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50">
      <div className="marketing-topbar border-grid-x border-b backdrop-blur-xl">
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
                The living work graph
              </p>
            </div>

            <nav className="hidden items-center gap-2 xl:flex">
              <Link
                className="rounded px-2.5 py-1.5 text-sm font-medium text-foreground/78 transition-colors hover:bg-background-100/80 hover:text-foreground"
                href="/product"
              >
                Product
              </Link>
              <DropdownMenu items={featureLinks} label="Features" />
              <DropdownMenu items={resourceLinks} label="Resources" width="w-[420px]" />
              <Link
                className="rounded px-2.5 py-1.5 text-sm font-medium text-foreground/78 transition-colors hover:bg-background-100/80 hover:text-foreground"
                href="/pricing"
              >
                Plans
              </Link>
            </nav>

            <div className="hidden items-center gap-1 md:flex xl:hidden">
              <Link
                className="rounded px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:bg-background-100/80 hover:text-foreground"
                href="/product"
              >
                Product
              </Link>
              <Link
                className="rounded px-2 py-1 text-sm font-medium text-foreground/75 transition-colors hover:bg-background-100/80 hover:text-foreground"
                href="/blog"
              >
                Resources
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
              <Button
                asChild
                className="marketing-cta-primary h-9 border border-transparent px-4 font-medium"
              >
                <Link href="/book-a-demo">
                  <span className="hidden sm:inline">Book a demo</span>
                  <span className="sm:hidden">Demo</span>
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-polar relative flex min-h-svh flex-col overflow-clip border-grid-x bg-background text-foreground">
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
              Oppulence turns email, calendar, meetings, files, and tools into a living work graph
              that agents can inspect before they brief, draft, update, or act.
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
              Oppulence — the living work graph for agents
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

const homeProblems = [
  {
    title: "The history is scattered.",
    body: "The email that changed the deal, the promise from last quarter, and the note from the last meeting all live in different places.",
  },
  {
    title: "Agents start cold.",
    body: "Every new prompt needs the same setup: who this person is, what happened, what was promised, and which source can be trusted.",
  },
  {
    title: "Actions lose their trail.",
    body: "The work crosses Gmail, Slack, Linear, GitHub, and docs, but no shared graph knows what changed or what should happen next.",
  },
];

const homeSteps = [
  {
    title: "Capture the traces",
    body: "Connect the inboxes, calendars, meetings, files, and tools where real work already leaves a trail.",
  },
  {
    title: "Build the graph",
    body: "Oppulence structures those traces into people, projects, companies, decisions, commitments, and open questions.",
  },
  {
    title: "Let agents use it",
    body: "Agents brief, draft, update notes, and propose actions from the graph while users keep the review boundary clear.",
  },
];

const capabilityTiles: { label: string; icon: SvgIconComponent; tone: IconTone }[] = [
  { label: "Living work graph", icon: NetworkIcon, tone: "green" },
  { label: "Compounding context", icon: BrainIcon, tone: "blue" },
  { label: "Meeting briefs", icon: CalendarDotsIcon, tone: "yellow" },
  { label: "Email & calendar", icon: EnvelopeIcon, tone: "blue" },
  { label: "Live notes", icon: SparkleIcon, tone: "yellow" },
  { label: "Background runs", icon: FlowArrowIcon, tone: "orange" },
  { label: "Slack workflows", icon: PlugsConnectedIcon, tone: "blue" },
  { label: "Reviewable actions", icon: SealCheckIcon, tone: "green" },
  { label: "Agent trails", icon: PathIcon, tone: "yellow" },
  { label: "Connectors & MCP", icon: StackIcon, tone: "orange" },
  { label: "Web research", icon: GlobeIcon, tone: "green" },
  { label: "Voice & meetings", icon: HeadsetIcon, tone: "orange" },
  { label: "Bring your own models", icon: CodeIcon, tone: "green" },
  { label: "Local-first", icon: MonitorIcon, tone: "blue" },
  { label: "Self-hosted", icon: HardDrivesIcon, tone: "neutral" },
];

const homeProblemIcons: {
  icon: SvgIconComponent;
  tone: IconTone;
}[] = [
  { icon: CalendarDotsIcon, tone: "yellow" },
  { icon: BrainIcon, tone: "blue" },
  { icon: PathIcon, tone: "orange" },
];

const homeStepIcons: {
  icon: SvgIconComponent;
  tone: IconTone;
}[] = [
  { icon: PlugsConnectedIcon, tone: "blue" },
  { icon: NetworkIcon, tone: "green" },
  { icon: FlowArrowIcon, tone: "orange" },
];

const bulletIconCycle: {
  icon: SvgIconComponent;
  tone: IconTone;
}[] = [
  { icon: SparkleIcon, tone: "yellow" },
  { icon: FlowArrowIcon, tone: "orange" },
  { icon: SealCheckIcon, tone: "green" },
  { icon: BrainIcon, tone: "blue" },
];

const pricingPlanIcons: {
  icon: SvgIconComponent;
  tone: IconTone;
}[] = [
  { icon: HardDrivesIcon, tone: "blue" },
  { icon: FlowArrowIcon, tone: "orange" },
  { icon: SealCheckIcon, tone: "green" },
];

const customerStoryIcons: {
  icon: SvgIconComponent;
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
        <ArrowRightIcon style={{ fontSize: "1rem" }} />
      </Link>
    </Button>
  );
}

function heroPanelForPage(page: MarketingPage): {
  eyebrow: string;
  heading: string;
  icon: SvgIconComponent;
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
    <div className="flex flex-col">
      <HomeHero />
      <HeroVisual />
      <LogoBand />
      <ProblemSection />
      <StatementBand />
      <HowItWorks />
      <DownloadSection />
      <ProductSurfaceSection />
      <IntegrationsShowcase />
      {homeSpotlights.map((spotlight, index) => (
        <FeatureSpotlight key={spotlight.heading} reverse={index % 2 === 1} spotlight={spotlight} />
      ))}
      <FaqSection />
      <FinalCta />
    </div>
  );
}

function HomeHero() {
  return (
    <section className="px-4 pt-32 pb-16 md:pt-36 md:pb-20">
      <div className="flex w-full min-w-0 max-w-3xl flex-col items-start gap-6">
        <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          The living work graph
        </p>
        <h1 className="marketing-hero-title w-full min-w-0 max-w-3xl text-balance text-left font-display text-5xl leading-[1.04] font-light md:text-6xl xl:text-[4.25rem]">
          Your work, as one living <span className="serif-accent">graph.</span>
        </h1>
        <p className="max-w-xl text-balance text-left text-lg text-muted-foreground leading-relaxed">
          Oppulence turns email, calendar, meetings, files, and tools into an owned graph of the
          people, projects, decisions, and commitments that matter. Agents use that graph before
          they brief, draft, update, or act.
        </p>
        <div className="mt-1 flex w-full flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            asChild
            className="marketing-cta-primary h-12 border border-transparent px-7 font-medium text-md has-[>svg]:px-5"
          >
            <Link href="/book-a-demo">
              Book a demo
              <ArrowRightIcon style={{ fontSize: "1rem" }} />
            </Link>
          </Button>
          <Button
            asChild
            className="marketing-cta-secondary h-12 border px-6 font-medium text-md"
            variant="ghost"
          >
            <Link href="/app">Open dashboard</Link>
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2">
          {["Graph you own", "Sources stay inspectable", "Actions stay reviewable"].map((item) => (
            <span className="flex items-center gap-2 text-sm text-muted-foreground" key={item}>
              <CheckCircleIcon className="text-oppulence-green" style={{ fontSize: "1rem" }} />
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <section className="px-4 pb-16 md:pb-24">
      <DesktopScreenshotPreview
        alt="The Oppulence desktop app — work context, tasks, and copilot in one place"
        className="mx-auto w-full"
        src={desktopScreenshots.home}
      />
    </section>
  );
}

function LogoBand() {
  return (
    <section className="border-y border-dashed border-primary/10 bg-background-50">
      <div className="container mx-auto flex flex-col items-center gap-6 px-4 py-7 md:flex-row md:gap-10">
        <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/45">
          Works with the tools
          <br className="hidden md:block" /> you already use
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 md:justify-start">
          {integrationGroups.slice(0, 7).map((item) => {
            const { icon: Icon } = iconForLink({ href: item, label: item });

            return (
              <span
                className="flex items-center gap-2 text-sm font-medium text-foreground/70"
                key={item}
              >
                <Icon className="text-foreground/50" style={{ fontSize: "1.25rem" }} />
                {item}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon
            className="size-5 rounded-[6px]"
            compact
            icon={MagnifyingGlassIcon}
            tone="yellow"
          />
          The problem
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          Your context is everywhere. Your agents need one graph.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
          Useful AI does not start with a better prompt. It starts with a durable model of the work:
          who is involved, what changed, what was decided, and what still needs to happen.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {homeProblems.map((card, index) => (
          <article className="marketing-surface border p-6" key={card.title}>
            <MarketingIcon
              icon={homeProblemIcons[index]?.icon ?? ChartLineIcon}
              tone={homeProblemIcons[index]?.tone ?? "neutral"}
            />
            <h3 className="mt-5 font-display text-xl font-medium">{card.title}</h3>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatementBand() {
  return (
    <section className="border-y border-dashed border-primary/10 bg-background-50 px-4 py-20 md:py-28">
      <div className="mx-auto max-w-4xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon className="size-5 rounded-[6px]" compact icon={SparkleIcon} tone="green" />
          The fix
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          The graph is the asymmetry.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
          Most agent products compete on prompts, models, or UI. Oppulence starts one layer lower:
          the owned, inspectable work graph that gives every agent the same source of truth.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon
            className="size-5 rounded-[6px]"
            compact
            icon={FlowArrowIcon}
            tone="blue"
          />
          How it works
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          From scattered traces to useful agents.
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {homeSteps.map((step, index) => (
          <article className="marketing-surface border p-6" key={step.title}>
            <div className="flex items-center justify-between gap-3">
              <MarketingIcon
                icon={homeStepIcons[index]?.icon ?? ChartLineIcon}
                tone={homeStepIcons[index]?.tone ?? "neutral"}
              />
              <span className="font-mono text-2xl font-light text-foreground/25">0{index + 1}</span>
            </div>
            <h3 className="mt-5 font-display text-xl font-medium">{step.title}</h3>
            <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProductSurfaceSection() {
  return (
    <section className="border-y border-dashed border-primary/10 bg-background-50 px-4 py-20 md:py-28">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon className="size-5 rounded-[6px]" compact icon={StackIcon} tone="green" />
          One platform
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          Everything the graph needs to stay useful.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
          Capture sources, structure context, run background updates, and expose graph-backed agents
          through desktop workflows, Slack, widgets, and APIs.
        </p>
      </div>
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {capabilityTiles.map((tile) => (
          <div
            className="marketing-surface flex flex-col items-center gap-3 border bg-card px-3 py-6 text-center"
            key={tile.label}
          >
            <MarketingIcon icon={tile.icon} tone={tile.tone} />
            <span className="text-sm font-medium leading-tight text-foreground/80">
              {tile.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const homeSpotlights: {
  eyebrow: string;
  icon: SvgIconComponent;
  tone: IconTone;
  heading: string;
  body: string;
  bullets: string[];
  src: string;
  alt: string;
}[] = [
  {
    eyebrow: "Living graph",
    icon: NetworkIcon,
    tone: "green",
    heading: "The graph keeps the work connected.",
    body: "Oppulence turns email, meetings, files, and messages into linked context around the people, projects, decisions, and commitments that matter.",
    bullets: [
      "Built from Gmail, Calendar, and meeting transcripts as you work",
      "People, projects, decisions, and open questions, all linked",
      "Plain Markdown you own, search, and edit",
    ],
    src: desktopScreenshots.knowledge,
    alt: "Oppulence living work graph of people, projects, and notes",
  },
  {
    eyebrow: "Briefs & drafts",
    icon: SparkleIcon,
    tone: "blue",
    heading: "Every draft starts from the same source of truth.",
    body: "Ask for a meeting brief or a reply and the agent looks up the relevant person, project, and source trail before writing.",
    bullets: [
      "Prep assembled from real history before every call",
      "Drafts in your voice, never generic",
      "Nothing is auto-sent — you approve every send",
    ],
    src: desktopScreenshots.chat,
    alt: "Oppulence copilot drafting a grounded reply",
  },
  {
    eyebrow: "Background work",
    icon: FlowArrowIcon,
    tone: "orange",
    heading: "The graph can update without another prompt.",
    body: "Background workflows can refresh live notes, prepare recurring briefs, or watch high-value subjects from schedules and events.",
    bullets: [
      "Durable runs on a schedule or trigger",
      "Updates notes and drafts next steps",
      "Behind a clear read, draft, review, and action boundary",
    ],
    src: desktopScreenshots.tasks,
    alt: "Oppulence background tasks running in the cloud",
  },
];

function FeatureSpotlight({
  spotlight,
  reverse,
}: {
  spotlight: (typeof homeSpotlights)[number];
  reverse: boolean;
}) {
  return (
    <section className="px-4 py-16 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div className={cn("flex flex-col items-start gap-5", reverse && "lg:order-2")}>
          <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
            <MarketingIcon
              className="size-5 rounded-[6px]"
              compact
              icon={spotlight.icon}
              tone={spotlight.tone}
            />
            {spotlight.eyebrow}
          </p>
          <h2 className="text-balance font-display text-3xl leading-[1.08] font-light tracking-[-0.03em] md:text-4xl">
            {spotlight.heading}
          </h2>
          <p className="text-balance text-lg leading-relaxed text-muted-foreground">
            {spotlight.body}
          </p>
          <ul className="mt-1 flex flex-col gap-3">
            {spotlight.bullets.map((bullet) => (
              <li className="flex items-start gap-3 text-sm text-foreground/80" key={bullet}>
                <CheckCircleIcon
                  className="mt-0.5 shrink-0 text-oppulence-green"
                  style={{ fontSize: "1rem" }}
                />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
        <DesktopScreenshotPreview
          alt={spotlight.alt}
          className={cn("w-full", reverse && "lg:order-1")}
          src={spotlight.src}
        />
      </div>
    </section>
  );
}

function IntegrationsShowcase() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon
            className="size-5 rounded-[6px]"
            compact
            icon={PlugsConnectedIcon}
            tone="orange"
          />
          Integrations
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          Connect everything you already use.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
          Native connectors plus MCP and API tools let sources feed the graph and actions stay
          behind explicit review boundaries.
        </p>
      </div>
      <div className="mx-auto max-w-4xl">
        <div className="marketing-dots grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrationGroups.map((item) => {
            const { icon, tone } = iconForLink({ href: item, label: item });

            return (
              <div
                className="marketing-surface flex items-center gap-3 border bg-card px-4 py-4"
                key={item}
              >
                <MarketingIcon compact icon={icon} tone={tone} />
                <span className="text-sm font-medium text-foreground/80">{item}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const downloadPlatforms: { label: string; platform: string }[] = [
  { label: "macOS (Apple Silicon)", platform: "mac-arm64" },
  { label: "macOS (Intel)", platform: "mac-x64" },
  { label: "Windows", platform: "windows-x64" },
  { label: "Linux", platform: "linux-deb-x64" },
];

function DownloadSection() {
  return (
    <section className="border-y border-dashed border-primary/10 px-4 py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
          <MarketingIcon
            className="size-5 rounded-[6px]"
            compact
            icon={DownloadIcon}
            tone="green"
          />
          Download
        </p>
        <h2 className="mt-5 text-balance font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
          Run Oppulence on your machine.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
          Local-first and open source. Your work graph lives on your own device — nothing leaves
          unless you wire a tool to send it.
        </p>
        <div className="mt-8 flex flex-col items-center gap-5">
          <Button
            asChild
            className="marketing-cta-primary h-12 border border-transparent px-7 font-medium text-md has-[>svg]:px-5"
          >
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route 302-redirects to the installer; needs a full navigation */}
            <a href="/api/download">
              <DownloadIcon style={{ fontSize: "1rem" }} />
              Download for free
            </a>
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-xs text-muted-foreground">
            {downloadPlatforms.map((item, index) => (
              <span className="flex items-center gap-3" key={item.platform}>
                {index > 0 ? <span className="text-foreground/20">·</span> : null}
                <a
                  className="transition-colors hover:text-foreground"
                  href={`/api/download?platform=${item.platform}`}
                >
                  {item.label}
                </a>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const homeFaqs = [
  {
    q: "How is this different from ChatGPT or Claude?",
    a: "Chat assistants start cold and wait for context. Oppulence builds the context layer first: a graph of your real work that agents can inspect before generating or acting.",
  },
  {
    q: "Do agents keep working when my laptop is closed?",
    a: "Background workflows can run from schedules and events, including cloud-backed tasks where configured. The important point is that the output writes back into graph context instead of vanishing into a chat.",
  },
  {
    q: "Can agents take actions on their own?",
    a: "Actions should sit behind clear boundaries. Oppulence is designed so reading, drafting, review, and external execution can be separated instead of blended into one opaque agent step.",
  },
  {
    q: "Where does my data live?",
    a: "The desktop graph is local-first and file-backed. Platform deployments can be self-hosted when teams need control over storage, providers, and integration boundaries.",
  },
  {
    q: "Which AI models can I use?",
    a: "Bring your own provider keys — OpenAI, Anthropic, Google, OpenRouter, the AI Gateway, or a local model. You control routing and spend.",
  },
  {
    q: "Which tools does it connect to?",
    a: "The marketing surface centers Gmail, Calendar, meetings, Slack, GitHub, Linear, web search, and MCP/API tools. Exact availability depends on the configured deployment.",
  },
];

function FaqSection() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-muted-foreground">
            FAQ
          </p>
          <h2 className="mt-5 font-display text-4xl leading-[1.08] font-light tracking-[-0.03em] md:text-5xl">
            Frequently asked <span className="serif-accent">questions</span>
          </h2>
        </div>
        <div className="divide-y divide-primary/10 border-y border-primary/10">
          {homeFaqs.map((faq) => (
            <details className="group/faq py-5" key={faq.q}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium [&::-webkit-details-marker]:hidden">
                {faq.q}
                <CaretDownIcon
                  className="shrink-0 text-muted-foreground transition-transform group-open/faq:rotate-180"
                  style={{ fontSize: "1rem" }}
                />
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-24">
      <div className="marketing-panel relative overflow-hidden rounded-3xl border border-primary/5 px-6 py-16 text-center md:py-24">
        <h2 className="mx-auto max-w-3xl text-balance font-display text-4xl leading-[1.04] font-light tracking-[-0.03em] md:text-6xl">
          Build the graph first. Let agents use it second.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed text-foreground/70">
          Connect the sources that matter, make the context inspectable, and give agents a safer
          place to brief, draft, update, and act.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            className="marketing-cta-primary h-12 border border-transparent px-7 font-medium text-md has-[>svg]:px-5"
          >
            <Link href="/book-a-demo">
              Book a demo
              <ArrowRightIcon style={{ fontSize: "1rem" }} />
            </Link>
          </Button>
          <Button
            asChild
            className="marketing-cta-secondary h-12 border px-6 font-medium text-md"
            variant="ghost"
          >
            <Link href="/app">Open dashboard</Link>
          </Button>
        </div>
      </div>
    </section>
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

function FeatureMirrorPage({ page, details }: { page: MarketingPage; details: FeatureDetail }) {
  const proofItems = details.heroProof ?? page.bullets;
  const capabilitySections = details.capabilities ?? details.sections;
  const relatedPages =
    details.relatedPages ??
    featureLinks.filter((item) => item.href !== `/${page.path}`).slice(0, 3);

  return (
    <div className="flex flex-col pt-32 pb-20">
      <div className="mx-auto w-full max-w-6xl px-4">
        <header className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="min-w-0 max-w-4xl">
            <EyebrowPill {...iconForPage(page)}>{page.eyebrow}</EyebrowPill>
            <h1 className="marketing-hero-title mt-5 w-full min-w-0 text-balance font-display text-5xl leading-[1.03] font-light md:text-6xl xl:text-[4rem]">
              {page.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
            <FeatureActionButtons
              primary={page.ctaLabel ?? "Book a demo"}
              secondary="Read guides"
            />
          </div>
          <FeatureHeroProofPanel items={proofItems} page={page} />
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
              Why it matters
            </p>
            <p className="mt-4 text-foreground/80 text-sm leading-relaxed">{details.summary}</p>
            <h2 className="mt-8 font-semibold text-xl">How it works</h2>
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
            {capabilitySections.map((section) => {
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

        {details.useCases && details.useCases.length > 0 ? (
          <section className="mt-14">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
                  Use cases
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Where the graph changes the workflow.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                The feature pages stay concrete: each capability maps back to work traces, graph
                context, and a reviewable next step.
              </p>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {details.useCases.map((useCase, index) => {
                const { icon, tone } = bulletIconCycle[(index + 1) % bulletIconCycle.length];

                return (
                  <article className="marketing-surface border p-5" key={useCase.title}>
                    <MarketingIcon icon={icon} tone={tone} />
                    <h3 className="mt-4 font-semibold">{useCase.title}</h3>
                    <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                      {useCase.body}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {page.path === "api-documentation-software" ? <ApiReferenceEmbed /> : null}

        <ProofGrid page={page} />
        {page.path === "integrations" ? <IntegrationsPanel /> : null}

        <section className="mt-14 border-t border-primary/10 pt-10">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
                Related
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Keep following the graph.</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/book-a-demo"}>{page.ctaLabel ?? "Book a demo"}</Link>
              </Button>
              <Button asChild className="marketing-cta-secondary" variant="ghost">
                <Link href="/app">Open dashboard</Link>
              </Button>
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {relatedPages.map((item) => {
              const { icon, tone } = iconForLink(item);

              return (
                <Link
                  className="marketing-surface flex items-start gap-3 border p-4 transition-colors hover:bg-background-200"
                  href={item.href}
                  key={item.href}
                >
                  <MarketingIcon compact icon={icon} tone={tone} />
                  <span className="min-w-0">
                    <span className="block font-medium text-sm">{item.label}</span>
                    {item.description ? (
                      <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function FeatureHeroProofPanel({ items, page }: { items: string[]; page: MarketingPage }) {
  const { icon, tone } = iconForPage(page);

  return (
    <aside className="marketing-surface hidden border p-5 lg:block">
      <div className="flex items-center gap-3">
        <MarketingIcon icon={icon} tone={tone ?? "green"} />
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Feature path
          </p>
          <h2 className="mt-1 font-semibold text-lg">{page.eyebrow}</h2>
        </div>
      </div>
      <div className="mt-5 divide-y divide-primary/10 border-y border-primary/10">
        {items.slice(0, 3).map((item, index) => (
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
          <ArrowRightIcon style={{ fontSize: "1rem" }} />
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
            <EyebrowPill {...iconForPage(page)}>{page.eyebrow}</EyebrowPill>
            <h1 className="marketing-hero-title mt-3 w-full min-w-0 text-balance font-display text-5xl leading-[1.03] font-light md:text-6xl xl:text-[4rem]">
              {page.title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-muted-foreground">{page.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/book-a-demo"}>
                  {page.ctaLabel ?? "Book a demo"}
                  <ArrowRightIcon style={{ fontSize: "1rem" }} />
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
          {page.eyebrow} routes keep the same standards: inspectable graph context, reviewable
          actions, and stable deployment paths.
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
            <div className="marketing-chip flex gap-3 border px-4 py-3 text-sm" key={bullet}>
              <MarketingIcon compact icon={SealCheckIcon} tone="green" />
              <span>{bullet}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ApiReferenceEmbed() {
  return (
    <section className="mt-14">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
            API reference
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Explore the live Rowboat API contract.</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="marketing-cta-secondary" variant="ghost">
            <a href="/api/reference" rel="noopener noreferrer" target="_blank">
              Open full reference
            </a>
          </Button>
          <Button asChild className="marketing-cta-secondary" variant="ghost">
            <a href="/api/openapi" rel="noopener noreferrer" target="_blank">
              Download OpenAPI
            </a>
          </Button>
        </div>
      </div>
      <div className="marketing-surface-strong mt-6 overflow-hidden border">
        <iframe
          className="h-[680px] w-full bg-background md:h-[780px]"
          loading="lazy"
          referrerPolicy="no-referrer"
          src="/api/reference"
          title="Rowboat API reference"
        />
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
              <ArrowRightIcon style={{ fontSize: "0.875rem" }} />
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
          surface. Oppulence starts one layer lower: the living graph agents and operators rely on
          before anything is published.
        </p>
        <p>
          The practical shift is ownership. Email threads, meeting notes, local files, product
          context, and tool events become durable graph context with sources attached. The agent can
          search it, update it, and act from it without turning each workflow into a fresh prompt.
        </p>
        <p>
          That makes comparison pages less about which static surface looks better and more about
          which system keeps context alive, portable, and usable for controlled execution.
        </p>
      </article>
      <ProofGrid page={page} />
    </PageShell>
  );
}

export function CustomerIndexPage({ page }: { page: MarketingPage }) {
  if (customerPages.length === 0) {
    return (
      <PageShell page={page}>
        <section className="marketing-surface-strong flex flex-col items-center gap-5 border p-10 text-center">
          <MarketingIcon icon={SparkleIcon} tone="green" />
          <h2 className="font-display text-2xl font-medium">
            We&rsquo;d rather show real stories than invented ones.
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Oppulence is early. We&rsquo;re onboarding our first operators and teams now — when they
            have a story worth telling, it will live here. No placeholder logos in the meantime.
          </p>
          <Button asChild className="marketing-cta-primary mt-1">
            <Link href="/book-a-demo">
              Become an early customer
              <ArrowRightIcon style={{ fontSize: "1rem" }} />
            </Link>
          </Button>
        </section>
      </PageShell>
    );
  }

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
              <ArrowRightIcon style={{ fontSize: "0.875rem" }} />
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
      <h1 className="font-display text-5xl leading-none font-normal md:text-7xl">Page not found</h1>
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

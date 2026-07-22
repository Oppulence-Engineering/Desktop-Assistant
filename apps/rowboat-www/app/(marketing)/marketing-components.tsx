// Material icons keep the route-driven marketing data compact and consistent.
import type { SvgIconComponent } from "@mui/icons-material";
import ArrowRightIcon from "@mui/icons-material/ArrowForwardOutlined";
import BrainIcon from "@mui/icons-material/PsychologyOutlined";
import BriefcaseIcon from "@mui/icons-material/BusinessCenterOutlined";
import CalendarDotsIcon from "@mui/icons-material/CalendarMonthOutlined";
import ChartLineIcon from "@mui/icons-material/ShowChartOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CircleIcon from "@mui/icons-material/CircleOutlined";
import CodeIcon from "@mui/icons-material/CodeOutlined";
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
import { MarketingEffects } from "./marketing-effects";

const integrationGroups = [
  "Email",
  "Calendar",
  "Meetings",
  "CRM",
  "Verification",
  "Sending",
  "Research",
  "Policies",
  "Custom tools",
];

const mobileNavLinks = [
  { label: "Product", href: "/product" },
  { label: "Revenue Leak Scan", href: "/ai-help-center" },
  { label: "Action Queue", href: "/ai-documentation-agent" },
  { label: "Customers", href: "/customers" },
  { label: "Plans", href: "/pricing" },
  { label: "Blog", href: "/blog" },
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

function InlineLogo({
  compact = false,
  prominent = false,
}: {
  compact?: boolean;
  prominent?: boolean;
}) {
  const iconSize = compact ? 20 : prominent ? 40 : 28;

  return (
    <span className="flex items-center gap-2">
      <Image
        alt=""
        className={cn(
          "rounded-[3px] dark:invert",
          compact ? "size-5" : prominent ? "size-10" : "size-7",
        )}
        height={iconSize}
        src="/marketing/oppulence-icon.png"
        width={iconSize}
      />
      {!compact ? (
        <span className="font-display text-[24px] leading-6 font-semibold text-primary">
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
    <details className="group relative" data-marketing-dropdown>
      <summary aria-haspopup="menu" className="linear-nav-trigger">
        {label}
      </summary>
      <div className="linear-dropdown-panel invisible absolute top-full left-0 z-50 pt-3 opacity-0 transition group-hover:visible group-hover:opacity-100">
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
              <MenuLink item={item} key={`${label}-${item.label}-${item.href}`} />
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

function MobileMenu() {
  return (
    <details className="relative lg:hidden" data-marketing-mobile-menu>
      <summary aria-label="Toggle navigation" className="linear-mobile-summary">
        <span />
        <span />
      </summary>
      <nav className="linear-mobile-panel">
        {mobileNavLinks.map((item) => (
          <Link href={item.href} key={`${item.label}-${item.href}`}>
            {item.label} <span className="text-foreground/40">→</span>
          </Link>
        ))}
        <div className="mt-auto grid gap-2 pt-8">
          <Link className="linear-button-secondary !h-11" href="/sign-in">
            Sign in
          </Link>
          <Link className="linear-button-primary !h-11" href="/book-a-demo">
            Book a scan
          </Link>
        </div>
      </nav>
    </details>
  );
}

export function TopBar() {
  return (
    <header className="linear-header">
      <div className="linear-header-inner">
        <div className="flex flex-1 justify-start">
          <Link aria-label="Oppulence home" className="linear-logo !h-12" href="/">
            <InlineLogo prominent />
          </Link>
        </div>

        <nav className="hidden items-center gap-2 lg:flex">
          <DropdownMenu items={productLinks} label="Product" width="w-[560px]" />
          <div className="hidden xl:block">
            <DropdownMenu items={featureLinks} label="Features" />
          </div>
          <DropdownMenu items={resourceLinks} label="Resources" width="w-[420px]" />
          <Link className="linear-nav-link" href="/customers">
            Customers
          </Link>
          <Link className="linear-nav-link" href="/pricing">
            Plans
          </Link>
          <Link className="linear-nav-link hidden xl:inline-flex" href="/blog">
            Blog
          </Link>
        </nav>

        <div className="linear-header-divider hidden lg:block" />

        <div className="flex flex-1 items-center justify-end gap-2">
          <Link className="linear-nav-link hidden md:inline-flex" href="/sign-in">
            Sign in
          </Link>
          <Link className="linear-button-primary hidden md:inline-flex" href="/book-a-demo">
            Book a scan
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-polar relative flex min-h-svh flex-col overflow-clip bg-background text-foreground">
      <MarketingEffects />
      <Link className="linear-skip-link" href="#marketing-content">
        Skip to content →
      </Link>
      <TopBar />
      <main className="flex flex-1 flex-col" id="marketing-content">
        <div className="linear-shell linear-guides">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="linear-footer">
      <div className="linear-shell">
        <div className="linear-footer-grid">
          <div className="linear-footer-column">
            <Link className="linear-logo" href="/">
              <InlineLogo />
            </Link>
          </div>
          <LinearFooterGroup items={productLinks.slice(0, 6)} title="Product" />
          <LinearFooterGroup items={featureLinks.slice(0, 7)} title="Features" />
          <LinearFooterGroup items={[...resourceLinks, ...toolLinks]} title="Resources" />
          <LinearFooterGroup items={socialLinks} title="Connect" />
          <LinearFooterGroup
            items={[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Book a Revenue Leak Scan", href: "/book-a-demo" },
            ]}
            title="Company"
          />
          <p className="linear-footer-note">
            Oppulence finds the money slipping away in your inbox and chases it in your voice, with
            your approval. © 2026 Oppulence. Open source under the MIT license.
          </p>
        </div>
      </div>
    </footer>
  );
}

function LinearFooterGroup({ title, items }: { title: string; items: LinkItem[] }) {
  return (
    <div className="linear-footer-column">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => {
          return (
            <li key={`${title}-${item.label}-${item.href}`}>
              {item.external ? (
                <a href={item.href} rel="noopener noreferrer" target="_blank">
                  {item.label}
                </a>
              ) : (
                <Link href={item.href}>{item.label}</Link>
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
    title: "The proposal goes quiet.",
    body: "You send a $40k proposal. The client does not reply. Following up feels pushy, so you wait. Almost half of sellers never send a single follow-up. The deal dies in the silence.",
  },
  {
    title: "The invoice goes unpaid.",
    body: "Most small businesses carry unpaid invoices. The average pile is about $17,500. Chasing a client you like feels awkward. So money you already earned just sits there.",
  },
  {
    title: "The client fades away.",
    body: "A good client starts to reply slower. They skip a check-in. Nobody notices the fade until the cancellation email arrives. By then, the save is months late.",
  },
];

const homeSteps = [
  {
    title: "Connect your inbox",
    body: "Link Gmail in two minutes. Access is read-only at the start. Your mail stays yours.",
  },
  {
    title: "Watch the leak",
    body: "Get a weekly report of each deal, invoice, and relationship going quiet, with dollar amounts attached.",
  },
  {
    title: "Approve the chase",
    body: "Review each drafted nudge and approve it with one click. A monthly receipt shows what came back.",
  },
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

const customerStoryIcons: {
  icon: SvgIconComponent;
  tone: IconTone;
}[] = [
  { icon: ChartLineIcon, tone: "yellow" },
  { icon: FlowArrowIcon, tone: "blue" },
  { icon: CheckCircleIcon, tone: "green" },
];

function PlanCtaButton({ plan }: { plan: (typeof pricingPlans)[number] }) {
  const href = "/book-a-demo";
  const label =
    plan.name === "Founder" ? "Book a scan" : plan.recommended ? "Plan rollout" : "Talk to us";

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

export function HomePage() {
  return (
    <div className="flex flex-col">
      <HomeHero />
      <HeroVisual />
      <LogoBand />
      <ProblemSection />
      {linearHomeSections.map((section, index) => (
        <LinearProductSection index={index} key={section.title} section={section} />
      ))}
      <HomeUpdates />
      <CapabilityIndex />
      <HomeProofBand />
      <HomeFaqSection />
      <FinalCta />
    </div>
  );
}

function HomeHero() {
  return (
    <section className="linear-hero linear-inset">
      <div>
        <p className="mb-5 font-mono text-xs text-oppulence-orange">
          [revenue memory and execution]
        </p>
        <h1 className="linear-hero-title">
          The most expensive thing
          <br className="hidden sm:block" /> in your pipeline is silence.
        </h1>
        <div className="linear-hero-meta">
          <p className="linear-body max-w-[620px]">
            Oppulence watches your inbox, calendar, and billing. It finds money that is about to
            slip: a proposal with no reply, an invoice with no payment, a client who has gone quiet.
            It writes the chase in your voice. Nothing sends until you click Approve.
          </p>
          <Link className="linear-inline-link shrink-0" href="/book-a-demo">
            <span className="linear-new-pill">New</span>
            Revenue Leak Scan <span className="text-foreground/40">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <section className="linear-hero-visual">
      <div className="linear-hero-glow" />
      <div className="linear-app-frame">
        <Image
          alt="The Oppulence revenue action queue with relationship context and recommended actions"
          height={960}
          priority
          sizes="(max-width: 640px) 780px, (max-width: 1440px) 92vw, 1320px"
          src={desktopScreenshots.home}
          width={1440}
        />
      </div>
    </section>
  );
}

function LogoBand() {
  return (
    <section aria-label="Connected tools" className="linear-logo-band">
      <div className="linear-logo-cell linear-logo-caption">
        One loop across your revenue systems
      </div>
      {integrationGroups.slice(0, 6).map((item) => {
        const { icon: Icon } = iconForLink({ href: item, label: item });

        return (
          <div className="linear-logo-cell" key={item}>
            <Icon style={{ fontSize: "1rem" }} />
            {item}
          </div>
        );
      })}
    </section>
  );
}

function ProblemSection() {
  return (
    <section>
      <div className="linear-statement linear-inset">
        <h2 className="linear-statement-title">
          <strong>Few deals die from a &ldquo;no.&rdquo;</strong> Most die waiting. A proposal sits
          unanswered. Finished work goes unbilled. An old client drifts away. No one decides to lose
          this money. It leaks.
        </h2>
      </div>
      <div className="linear-benefits linear-inset">
        {homeProblems.map((card, index) => (
          <article className="linear-benefit" key={card.title}>
            <span className="linear-benefit-figure">FIG 0.{index + 2}</span>
            <ProblemVisual index={index} />
            <h3>{card.title}</h3>
            <p className="linear-body">{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProblemVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div aria-hidden="true" className="linear-problem-art linear-problem-orbit">
        <span className="linear-problem-orbit-ring" />
        <span className="linear-problem-node linear-problem-node-a" />
        <span className="linear-problem-node linear-problem-node-b" />
        <span className="linear-problem-node linear-problem-node-c" />
        <span className="linear-problem-orbit-break" />
      </div>
    );
  }

  if (index === 1) {
    return (
      <div aria-hidden="true" className="linear-problem-art linear-problem-stack">
        <span className="linear-problem-plane linear-problem-plane-back" />
        <span className="linear-problem-plane linear-problem-plane-middle" />
        <span className="linear-problem-plane linear-problem-plane-front">
          <i />
          <i />
          <i />
        </span>
        <span className="linear-problem-thread" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="linear-problem-art linear-problem-path">
      <span className="linear-problem-path-rail" />
      <span className="linear-problem-path-signal" />
      <span className="linear-problem-path-gate">
        <i />
      </span>
      <span className="linear-problem-path-echo" />
    </div>
  );
}

const linearHomeSections = [
  {
    title: "See the money that is slipping.",
    description:
      "Oppulence scans your last 60–90 days of email, calendar, and billing. It finds ghosted proposals, dormant clients, unbilled work, and unpaid invoices. Each finding shows a dollar amount and a link to its source.",
    label: "Revenue Leak Scan",
    href: "/ai-help-center",
    src: desktopScreenshots.knowledge,
    alt: "Oppulence Revenue Leak Scan showing warm opportunities and source evidence",
    bullets: [
      "Ghosted proposals, with the deal value attached",
      "Dormant clients and unpaid invoices",
      "Each finding links to the source email",
    ],
  },
  {
    title: "Get a short list, not another inbox.",
    description:
      "Each week, Oppulence hands you the three to five actions worth money right now. Each one shows who needs attention, why now, and how much is at stake. You approve, edit, snooze, or reject.",
    label: "Revenue Action Queue",
    href: "/ai-documentation-agent",
    src: desktopScreenshots.chat,
    alt: "Oppulence daily revenue action queue ranked by value and urgency",
    bullets: [
      "The highest-value moves of the week",
      "Who, why now, and how much on each item",
      "Approve, edit, snooze, or reject in one click",
    ],
  },
  {
    title: "The chase is written in your voice.",
    description:
      "The nudge arrives already drafted and matched to the relationship. A one-off client gets a firm reminder. A $100k repeat client gets a softer note. It sends from your own address, under your own name.",
    label: "Drafts in your voice",
    href: "/automated-screenshots-for-docs",
    src: desktopScreenshots.tasks,
    alt: "Oppulence drafting a follow-up in the owner's own voice with evidence attached",
    bullets: [
      "Drafts follow your writing style",
      "Tone adapts to the value of the relationship",
      "Messages send from your own address",
    ],
  },
  {
    title: "Nothing sends without your click.",
    description:
      "Each message waits for your approval. The system never emails a contact who bounced, opted out, or changed roles. Actions that touch money need a second confirmation. When a check fails, the system stops.",
    label: "Policy & sender protection",
    href: "/integrations",
    src: desktopScreenshots.connections,
    alt: "Oppulence policy checks and sender protection before execution",
    bullets: [
      "You approve every send",
      "Bounced and opted-out contacts are blocked",
      "Money actions need step-up approval",
    ],
  },
  {
    title: "Each chase teaches the next one.",
    description:
      "Replies, meetings, edits, and payments flow back into one relationship memory. The system learns what works for your business. Your data stays yours. We do not pool it, and we do not train shared models on it.",
    label: "Memory that compounds",
    href: "/product",
    src: desktopScreenshots.home,
    alt: "Oppulence relationship timeline updated by replies, meetings, and revenue outcomes",
    bullets: [
      "Replies and payments update the memory",
      "Your edits teach it your voice",
      "We never pool or share your data",
    ],
  },
] as const;

function LinearProductSection({
  index,
  section,
}: {
  index: number;
  section: (typeof linearHomeSections)[number];
}) {
  const sectionNumber = `${index + 1}.0`;
  const action = (
    <span className="linear-product-link">
      <span className="linear-index">{sectionNumber}</span>
      <span className="linear-body !text-[var(--linear-text-tertiary)]">{section.label}</span>
      <span className="text-foreground/35">→</span>
    </span>
  );

  return (
    <section className="linear-product-section">
      <header className="linear-product-header linear-inset">
        <div>
          <h2 className="linear-product-title">{section.title}</h2>
        </div>
        <div className="linear-product-description">
          <p>{section.description}</p>
          {section.href.startsWith("/api/") ? (
            <a href={section.href}>{action}</a>
          ) : (
            <Link href={section.href}>{action}</Link>
          )}
        </div>
      </header>
      <div className="linear-product-visual">
        <div className="linear-product-panel">
          <Image
            alt={section.alt}
            height={960}
            sizes="(max-width: 640px) 100vw, (max-width: 1440px) 92vw, 1344px"
            src={section.src}
            width={1440}
          />
        </div>
        <div className="linear-product-tabs">
          {section.bullets.map((bullet, bulletIndex) => (
            <div className="linear-product-tab" key={bullet}>
              <span className="linear-index mr-3">
                {index + 1}.{bulletIndex + 1}
              </span>
              {bullet}
              <span className="ml-2 text-foreground/30">+</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeUpdates() {
  return (
    <section className="linear-updates">
      <div className="linear-inset">
        <h2 className="linear-statement-title !max-w-[1180px]">
          <strong>The memory is the moat.</strong> Anyone can draft a message. Only Oppulence knows
          every promise, chase, objection, and outcome across your relationships. No one can rebuild
          that history anywhere else.
        </h2>
      </div>
      <div className="linear-updates-grid linear-inset">
        {homeSteps.map((step, index) => (
          <article className="linear-update" key={step.title}>
            <span className="linear-index">0{index + 1}</span>
            <HomeStepVisual index={index} />
            <div className="linear-update-copy">
              <h3>{step.title}</h3>
              <p className="linear-body mt-2">{step.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HomeStepVisual({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div aria-hidden="true" className="linear-step-art linear-step-capture">
        <span className="linear-step-capture-ring" />
        <span className="linear-step-capture-core" />
        <span className="linear-step-ray linear-step-ray-a" />
        <span className="linear-step-ray linear-step-ray-b" />
        <span className="linear-step-ray linear-step-ray-c" />
      </div>
    );
  }

  if (index === 1) {
    return (
      <div aria-hidden="true" className="linear-step-art linear-step-priority">
        <span className="linear-step-slab linear-step-slab-a" />
        <span className="linear-step-slab linear-step-slab-b" />
        <span className="linear-step-slab linear-step-slab-c" />
        <span className="linear-step-focus" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="linear-step-art linear-step-loop">
      <span className="linear-step-loop-ring" />
      <span className="linear-step-loop-node linear-step-loop-node-a" />
      <span className="linear-step-loop-node linear-step-loop-node-b" />
      <span className="linear-step-loop-node linear-step-loop-node-c" />
      <span className="linear-step-loop-core" />
    </div>
  );
}

const capabilityTiles: { label: string; icon: SvgIconComponent }[] = [
  { label: "Revenue Leak Scan", icon: MagnifyingGlassIcon },
  { label: "Revenue Action Queue", icon: TrayIcon },
  { label: "Relationship memory", icon: BrainIcon },
  { label: "Commitment tracking", icon: CalendarDotsIcon },
  { label: "Source evidence", icon: FileTextIcon },
  { label: "Contact verification", icon: SealCheckIcon },
  { label: "Account research", icon: GlobeIcon },
  { label: "Suppression checks", icon: CircleIcon },
  { label: "Frequency policies", icon: PathIcon },
  { label: "Sender health", icon: ChartLineIcon },
  { label: "Human approvals", icon: CheckCircleIcon },
  { label: "Execution telemetry", icon: FlowArrowIcon },
  { label: "Meeting briefs", icon: CalendarDotsIcon },
  { label: "CRM outcome sync", icon: PlugsConnectedIcon },
  { label: "Audit history", icon: HardDrivesIcon },
];

function CapabilityIndex() {
  return (
    <section className="linear-capabilities linear-inset">
      <header>
        <h2>Everything a safe chase needs.</h2>
        <p>
          Detection, evidence, drafting, approval, verified sending, and the receipt that shows what
          came back.
        </p>
      </header>
      <div>
        {capabilityTiles.map(({ icon: Icon, label }, index) => (
          <div key={label}>
            <span className="linear-index">{String(index + 1).padStart(2, "0")}</span>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HomeProofBand() {
  const proof = [
    {
      title: "Each finding shows its dollar amount and its source.",
      label: "Evidence before action",
    },
    {
      title: "Nothing sends without your click. Money actions need extra approval.",
      label: "You stay in control",
    },
    {
      title: "Replies, meetings, and payments make the memory sharper.",
      label: "Learns from outcomes",
    },
  ];

  return (
    <section aria-label="Product principles" className="linear-proof-band linear-inset">
      {proof.map((item) => (
        <article className="linear-proof" key={item.label}>
          <p>{item.title}</p>
          <p>{item.label}</p>
        </article>
      ))}
    </section>
  );
}

const homeFaqs = [
  {
    question: "Is Oppulence another CRM?",
    answer:
      "No. Your CRM stays the system of record. Oppulence remembers the conversations, promises, and outcomes around each relationship. Then it turns them into the next chase, ready for your approval.",
  },
  {
    question: "Is this a cold-email tool?",
    answer:
      "No. Oppulence sends zero cold email. It only works the warm relationships you already have: ghosted proposals, quiet clients, unpaid invoices, and neglected referrals.",
  },
  {
    question: "Will it send messages without me?",
    answer:
      "No. Each message waits for your click. Actions that touch money need a second confirmation. You can approve, edit, snooze, or reject anything in the queue.",
  },
  {
    question: "How does it decide what matters?",
    answer:
      "It looks at the relationship history, the commitment that was made, the dollar value at stake, and the time since the last reply. Each recommendation shows its evidence.",
  },
  {
    question: "What does it cost?",
    answer:
      "Watch is free: a weekly report of what is slipping, with dollar amounts. Chase is $99 per month: drafted nudges, one-click approval, and recovery receipts. One saved deal pays for years.",
  },
  {
    question: "What happens to my data?",
    answer:
      "We read your mail to serve you and no one else. We do not pool it with other customers, and we do not train shared models on it. You can disconnect at any time.",
  },
];

function HomeFaqSection() {
  return (
    <section className="linear-faq linear-inset">
      <header>
        <h2>Frequently asked questions</h2>
        <p className="linear-body">What owners ask before they connect their inbox.</p>
      </header>
      <div>
        {homeFaqs.map((item) => (
          <details key={item.question}>
            <summary>
              {item.question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="linear-final-cta linear-inset">
      <h2>Find out what silence is costing you.</h2>
      <p className="linear-body max-w-xl text-balance">
        Connect your inbox. See the deals, invoices, and clients going quiet, each with a dollar
        amount. Then let Oppulence chase them, one approval at a time.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link className="linear-button-primary !h-10 !px-5" href="/book-a-demo">
          See what is slipping
        </Link>
        <Link className="linear-button-secondary !h-10 !px-5" href="/product">
          See how it works
        </Link>
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
  const capabilitySections = details.capabilities ?? details.sections;
  const relatedPages =
    details.relatedPages ??
    featureLinks.filter((item) => item.href !== `/${page.path}`).slice(0, 3);

  return (
    <div className="linear-subpage">
      <div className="linear-inset">
        <header className="linear-subpage-hero">
          <div className="min-w-0">
            <EyebrowPill {...iconForPage(page)}>{page.eyebrow}</EyebrowPill>
            <h1 className="linear-subpage-title mt-5">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.description}</p>
            <FeatureActionButtons
              primary={page.ctaLabel ?? "Book a Revenue Leak Scan"}
              secondary="See product"
            />
          </div>
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
              <h2 className="mt-2 text-2xl font-semibold">Keep following the revenue loop.</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/book-a-demo"}>
                  {page.ctaLabel ?? "Book a Revenue Leak Scan"}
                </Link>
              </Button>
              <Button asChild className="marketing-cta-secondary" variant="ghost">
                <Link href="/app">Open action queue</Link>
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
                  key={`${item.label}-${item.href}`}
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

function FeatureActionButtons({
  primary = "Book a Revenue Leak Scan",
  secondary = "See product",
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
        <Link href="/product">{secondary}</Link>
      </Button>
    </div>
  );
}

function PageShell({ page, children }: { page: MarketingPage; children: ReactNode }) {
  return (
    <div className="linear-subpage">
      <div className="linear-inset">
        <header className="linear-subpage-hero">
          <div className="min-w-0">
            <EyebrowPill {...iconForPage(page)}>{page.eyebrow}</EyebrowPill>
            <h1 className="linear-subpage-title mt-5">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/book-a-demo"}>
                  {page.ctaLabel ?? "Book a Revenue Leak Scan"}
                  <ArrowRightIcon style={{ fontSize: "1rem" }} />
                </Link>
              </Button>
              <Button asChild className="marketing-cta-secondary" variant="outline">
                <Link href="/app">Open action queue</Link>
              </Button>
            </div>
          </div>
        </header>
        <div className="linear-subpage-content">{children}</div>
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
            Why teams trust the queue
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Built for evidence-backed action.</h2>
        </div>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Each workflow keeps the same standards: source evidence, current relationship context,
          explicit policy decisions, and reviewable execution.
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
          <h2 className="mt-2 text-2xl font-semibold">Explore the live Oppulence API contract.</h2>
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
          title="Oppulence API reference"
        />
      </div>
    </section>
  );
}

export function PricingPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid border-y border-primary/10 md:grid-cols-3">
        {pricingPlans.map((plan) => (
          <article
            className="border-b border-primary/10 bg-background-50/40 p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
            key={plan.name}
          >
            <div className="flex min-h-8 items-start justify-between gap-3">
              <h2 className="text-lg font-medium">{plan.name}</h2>
              {plan.recommended ? (
                <span className="rounded-full border border-[#828fff]/25 bg-[#828fff]/10 px-2 py-1 font-mono text-[10px] text-[#aeb6ff] uppercase tracking-wider">
                  Recommended
                </span>
              ) : null}
            </div>
            <p className="mt-6 text-3xl font-medium tracking-[-0.022em]">{plan.price}</p>
            <p className="mt-3 min-h-16 text-sm leading-relaxed text-muted-foreground">
              {plan.description}
            </p>
            <ul className="mt-8 space-y-3 border-primary/10 border-t pt-6">
              {plan.features.map((feature) => (
                <li className="flex gap-3 text-sm text-foreground/80" key={feature}>
                  <CheckCircleIcon className="mt-0.5 shrink-0 text-[#8a8f98]" fontSize="small" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <PlanCtaButton plan={plan} />
          </article>
        ))}
      </section>
      <ProofGrid page={page} />
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
            Oppulence is early. We&rsquo;re onboarding our first operators and teams now. When they
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
          <h2 className="text-2xl font-semibold">Your Revenue Leak Scan walkthrough</h2>
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
            Book your scan
          </p>
          <div className="mt-5 grid gap-3">
            {["Work email", "Company", "CRM or sales system"].map((field) => (
              <div
                className="marketing-chip border px-4 py-3 text-sm text-muted-foreground"
                key={field}
              >
                {field}
              </div>
            ))}
          </div>
          <Button asChild className="marketing-cta-primary mt-5">
            <Link href="/book-a-demo/success">Book my scan</Link>
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
        <LinearFooterGroup items={toolLinks} title="Tools" />
        <LinearFooterGroup items={alternativeLinks} title="Alternatives" />
        <LinearFooterGroup items={productLinks} title="Product" />
      </div>
    </section>
  );
}

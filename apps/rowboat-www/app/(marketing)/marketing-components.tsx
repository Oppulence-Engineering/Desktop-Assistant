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
import GlobeIcon from "@mui/icons-material/LanguageOutlined";
import HardDrivesIcon from "@mui/icons-material/StorageOutlined";
import HeadsetIcon from "@mui/icons-material/SupportAgentOutlined";
import MagnifyingGlassIcon from "@mui/icons-material/SearchOutlined";
import MonitorIcon from "@mui/icons-material/DesktopWindowsOutlined";
import NetworkIcon from "@mui/icons-material/HubOutlined";
import PathIcon from "@mui/icons-material/RouteOutlined";
import PlugsConnectedIcon from "@mui/icons-material/CableOutlined";
import SealCheckIcon from "@mui/icons-material/VerifiedOutlined";
import SparkleIcon from "@mui/icons-material/AutoAwesomeOutlined";
import StackIcon from "@mui/icons-material/LayersOutlined";
import TrayIcon from "@mui/icons-material/InboxOutlined";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@oppulence/ui/components/button";
import { cn } from "@/lib/utils";
import { DesktopDownloadChooser } from "./desktop-download-chooser";
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
  platformPages,
  type MarketingPage,
  type PlatformPage,
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
  { label: "How it works", href: "/#how-it-works" },
  { label: "Integrations", href: "/integrations" },
  { label: "Pricing", href: "/pricing" },
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
        compact ? "size-7 rounded-none" : "size-9 rounded-[8px]",
        iconToneClasses[tone],
        className,
      )}
    >
      <Icon style={{ fontSize: compact ? "0.875rem" : "1.25rem" }} />
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
        "marketing-eyebrow inline-flex w-fit max-w-full items-center gap-2 rounded-full py-1 pr-3 pl-1.5 font-mono text-xs uppercase tracking-wider",
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
  header = false,
  prominent = false,
}: {
  compact?: boolean;
  header?: boolean;
  prominent?: boolean;
}) {
  // The header mark is rendered at its box size now that the lockup no longer
  // crops an oversized image down to a narrow window.
  const iconSize = header ? 20 : compact ? 20 : prominent ? 40 : 28;

  return (
    <span className={header ? "oppulence-compact-lockup" : "flex items-center gap-2"}>
      {header ? (
        <span aria-hidden="true" className="oppulence-compact-lockup__mark">
          <Image
            alt=""
            className="oppulence-compact-lockup__mark-image"
            height={iconSize}
            src="/marketing/oppulence-icon.png"
            width={iconSize}
          />
        </span>
      ) : (
        <Image
          alt=""
          className={cn("rounded-[3px]", compact ? "size-5" : prominent ? "size-10" : "size-7")}
          height={iconSize}
          src="/marketing/oppulence-icon.png"
          width={iconSize}
        />
      )}
      {!compact ? (
        <span
          className={cn(
            header
              ? "oppulence-compact-lockup__wordmark"
              : "font-display text-[24px] leading-6 font-medium text-primary",
          )}
        >
          {header ? "Oppulence" : "oppulence"}
        </span>
      ) : null}
    </span>
  );
}

function MobileMenu() {
  return (
    <details className="relative lg:hidden" data-marketing-mobile-menu>
      <summary aria-label="Toggle navigation" className="linear-mobile-summary">
        <span />
        <span />
      </summary>
      <nav className="linear-mobile-panel sm-mobile-panel">
        {mobileNavLinks.map((item) => (
          <Link href={item.href} key={`${item.label}-${item.href}`}>
            {item.label}
          </Link>
        ))}
        <p className="sm-mobile-kicker">Products</p>
        {platformPages.map((platform) => (
          <Link className="sm-mobile-product" href={`/${platform.slug}`} key={platform.slug}>
            {platform.name}
          </Link>
        ))}
        <Link className="sm-mobile-product" href="/product">
          How it all works
        </Link>
        <div className="mt-auto grid gap-2 pt-8">
          <Link className="sm-button sm-button-light" href="/sign-in">
            Sign in
          </Link>
          <Link className="sm-button sm-button-blue" href="/sign-up">
            Start building <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
      </nav>
    </details>
  );
}

export function TopBar() {
  return (
    <header className="linear-header sm-header">
      <div className="linear-header-inner">
        <div className="flex flex-1 justify-start">
          <Link aria-label="Oppulence home" className="linear-logo linear-header-logo" href="/">
            <InlineLogo header />
          </Link>
        </div>

        <nav aria-label="Primary navigation" className="sm-desktop-nav hidden lg:flex">
          {/* One Products menu, led by the three ways to run Oppulence. A
              separate "Product" link next to a "Products" menu read as two
              different things when it was really one. */}
          <details className="sm-nav-products" data-marketing-dropdown>
            <summary>Products</summary>
            <div className="linear-dropdown-panel sm-product-menu">
              {platformPages.map((platform) => (
                <Link href={`/${platform.slug}`} key={platform.slug}>
                  <span>{platform.name}</span>
                  <small>{platform.summary}</small>
                </Link>
              ))}
              <Link href="/product">
                <span>How it all works</span>
                <small>The relationship model behind all three</small>
              </Link>
            </div>
          </details>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/integrations">Integrations</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/blog">Blog</Link>
        </nav>

        <div className="flex flex-1 items-center justify-end">
          <Link className="sm-login hidden md:inline-flex" href="/sign-in">
            Sign in
          </Link>
          <Link className="sm-header-cta hidden md:inline-flex" href="/sign-up">
            Start building <ArrowRightIcon aria-hidden="true" />
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-polar sm-site relative flex min-h-svh flex-col overflow-clip bg-background text-foreground">
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
    <footer className="sm-footer">
      <div className="linear-shell sm-footer-shell">
        <div className="sm-footer-statement">
          <InlineLogo prominent />
          <h2>
            Relationship intelligence
            <br />
            for customer-facing teams.
          </h2>
          <p>One living model. Every source. Every next move explained.</p>
        </div>
        <div className="sm-footer-links">
          <LinearFooterGroup items={productLinks.slice(0, 6)} title="Product" />
          <LinearFooterGroup items={[...resourceLinks, ...toolLinks]} title="Resources" />
          <LinearFooterGroup
            items={[
              { label: "Customers", href: "/customers" },
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Responsible disclosure", href: "/responsible-disclosure" },
            ]}
            title="Company"
          />
          <LinearFooterGroup items={socialLinks} title="Connect" />
        </div>
        <div className="sm-footer-bottom">
          <p>© 2026 Playbook Media · Oppulence</p>
          <p>Evidence before action.</p>
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

const homeSteps = [
  {
    title: "Connect the relationship history",
    body: "Link Gmail in two minutes, then add calendar and billing context. Access is read-only at the start. Your mail stays yours.",
  },
  {
    title: "Ask the Monday question",
    body: "See which relationship could cost you money if ignored this week, why it matters now, and the evidence behind it.",
  },
  {
    title: "Close the loop",
    body: "Review the next move, approve it with one click, and let the reply, meeting, or payment make the relationship memory sharper.",
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

export function ProductPage({ page }: { page: MarketingPage }) {
  return (
    <div className="flex flex-col">
      <section className="linear-hero linear-inset">
        <p className="mb-5 font-mono text-xs text-oppulence-orange">[product]</p>
        <h1 className="linear-hero-title">{page.title}</h1>
        <div className="linear-hero-meta">
          <p className="linear-body max-w-[620px]">{page.description}</p>
        </div>
      </section>
      {linearHomeSections.map((section, index) => (
        <LinearProductSection index={index} key={section.title} section={section} />
      ))}
      <HomeUpdates />
      <FinalCta />
    </div>
  );
}

const relationshipCatalog = [
  {
    label: "Know who needs attention",
    kicker: "01 · PRIORITIZE",
    title: "See the relationships most likely to slip.",
    body: "Oppulence turns email, calendar, meetings, and CRM history into a short list of accounts that need attention now.",
    bullets: [
      "A focused queue instead of another dashboard",
      "Promises, risks, and quiet accounts in one place",
    ],
    src: "/marketing/relationship-desktop.png",
  },
  {
    label: "Understand why",
    kicker: "02 · EXPLAIN",
    title: "Every recommendation shows its evidence.",
    body: "See what changed, what is at stake, and the email or meeting behind the recommendation before deciding what to do.",
    bullets: ["Source links on every material claim", "Missing or uncertain context stays visible"],
    src: "/marketing/relationship-web-detail.png",
  },
  {
    label: "Approve the next move",
    kicker: "03 · ACT",
    title: "Review the follow-up before anything is sent.",
    body: "Oppulence prepares the next move with the relevant history attached. You can edit, approve, snooze, or reject it.",
    bullets: [
      "Human approval before external action",
      "Replies and outcomes improve future suggestions",
    ],
    src: "/marketing/relationship-desktop-detail.png",
  },
] as const;

const operatingLoop = [
  [
    "01 / CONNECT",
    "It reads what already happened.",
    "Connect email, calendar, meetings, and CRM. Oppulence builds the relationship history from work your team already did.",
  ],
  [
    "02 / REVIEW",
    "See what changed and why it matters.",
    "Your queue highlights the relationships worth attention and links each recommendation back to its source.",
  ],
  [
    "03 / APPROVE",
    "Nothing goes out without you.",
    "Edit, approve, snooze, or reject the next move. Replies, meetings, and outcomes make the relationship history sharper.",
  ],
] as const;

const useCases = [
  {
    eyebrow: "Founder-led sales",
    title: "The deal that just went quiet.",
    body: "That proposal you sent, the intro someone offered, the person who was keen and then stopped writing. We surface it and tell you why it's worth another go now.",
  },
  {
    eyebrow: "Customer success and accounts",
    title: "Walk into the renewal already knowing.",
    body: "See what you promised, what changed, and which accounts deserve a real reply before the renewal or next check-in.",
  },
  {
    eyebrow: "Partnerships and services",
    title: "Relationships that outlast the paperwork.",
    body: "Long engagements collect decisions, intros, and favours owed in both directions. That history stays readable years later, whoever is running the account.",
  },
] as const;

function SectionMarker({ label }: { label: string }) {
  return (
    <div className="sm-section-marker">
      <span>{label}</span>
    </div>
  );
}

const homepageSources = [
  "Gmail",
  "Calendar",
  "Meetings",
  "CRM",
  "Notes",
  "Voice",
  "Browser",
] as const;

const homepageProblems = [
  {
    label: "Quiet deals",
    title: "The account stopped replying.",
    body: "Oppulence finds the promise, proposal, or invoice sitting inside the history before the relationship goes cold.",
  },
  {
    label: "Renewals",
    title: "The context was never in the CRM.",
    body: "It reads the actual emails, meetings, and notes that explain what changed since the last check-in.",
  },
  {
    label: "Handoffs",
    title: "The memory left with the person.",
    body: "A new owner gets the relationship record, source links, and the safest next move instead of starting over.",
  },
] as const;

const homepageProof = [
  "Source linked",
  "Human approved",
  "Built around your existing systems",
] as const;

export function HomePage() {
  const individualPlans = pricingPlans.filter((plan) =>
    ["Watch", "Chase", "Intelligence"].includes(plan.name),
  );

  return (
    <div className="op-home">
      <section className="op-hero">
        <div className="op-hero-copy">
          <Link className="op-pill" href="/product">
            Account Mission Control is live <ArrowRightIcon aria-hidden="true" />
          </Link>
          <h1>Know which customer relationships need you today.</h1>
          <p>
            Oppulence reads your team&rsquo;s email, calendar, meetings, and CRM history, then turns
            scattered context into the next relationship move, with the evidence attached.
          </p>
          <div className="op-actions">
            <Link className="op-button op-button-primary" href="/sign-up">
              Start building <ArrowRightIcon aria-hidden="true" />
            </Link>
            <Link className="op-button op-button-secondary" href="#how-it-works">
              See how it works
            </Link>
          </div>
          <div className="op-proof-row" aria-label="Product promises">
            {homepageProof.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div className="op-hero-visual" aria-label="Oppulence relationship queue preview">
          <div className="op-browser-bar">
            <span />
            <span />
            <span />
            <strong>Relationship queue</strong>
          </div>
          <Image
            alt="Oppulence relationship queue showing accounts that need action"
            height={960}
            priority
            sizes="(max-width: 900px) 100vw, 560px"
            src="/marketing/relationship-desktop.png"
            width={1440}
          />
          <div className="op-insight-card">
            <span>Today</span>
            <strong>3 relationships need attention</strong>
            <p>Each one links back to the email, meeting, or CRM change that explains why.</p>
          </div>
        </div>
      </section>

      <section className="op-source-band" aria-label="Supported context sources">
        <p>Connect the systems your team already uses</p>
        <div>
          {homepageSources.map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </section>

      <section className="op-section op-problem">
        <div className="op-section-header">
          <span>The problem</span>
          <h2>Important customer context is everywhere except the place you need it.</h2>
          <p>
            The work is already written down. It is just scattered across inboxes, calls, notes,
            calendars, and CRM fields nobody keeps current.
          </p>
        </div>
        <div className="op-card-grid op-card-grid-three">
          {homepageProblems.map((item) => (
            <article className="op-card" key={item.label}>
              <p>{item.label}</p>
              <h3>{item.title}</h3>
              <span>{item.body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="op-section op-product" id="how-it-works">
        <div className="op-product-copy">
          <span>How it works</span>
          <h2>Connect your systems. Get the queue. Approve the next move.</h2>
          <p>
            It watches for silence, missed promises, departed contacts, renewal risk, and
            money-state changes, then explains what happened and suggests a move for approval.
          </p>
          <div className="op-feature-list">
            {relationshipCatalog.map((item) => (
              <article key={item.label}>
                <small>{item.kicker}</small>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
        <div className="op-product-shot">
          <Image
            alt="Oppulence account intelligence dashboard"
            fill
            sizes="(max-width: 900px) 100vw, 620px"
            src="/marketing/relationship-desktop-detail.png"
          />
        </div>
      </section>

      <section className="op-section op-trust">
        <div className="op-section-header">
          <span>Built for trust</span>
          <h2>You can always see where the answer came from.</h2>
          <p>
            Every recommendation stays tied to the source material. If the system is wrong, correct
            it and the record gets sharper.
          </p>
        </div>
        <div className="op-trust-grid">
          <article>
            <Image
              alt="Evidence detail view in Oppulence"
              height={960}
              sizes="(max-width: 900px) 100vw, 520px"
              src="/marketing/relationship-web-detail.png"
              width={1440}
            />
            <h3>Click through to the actual email.</h3>
            <p>Every event, change, and suggestion stays wired to the thing it came from.</p>
          </article>
          <article>
            <Image
              alt="Relationship health list in Oppulence"
              height={960}
              sizes="(max-width: 900px) 100vw, 520px"
              src="/marketing/relationship-web-list.png"
              width={1440}
            />
            <h3>Nothing goes out without you.</h3>
            <p>Approve, edit, snooze, or reject the next move. The history stays inspectable.</p>
          </article>
        </div>
      </section>

      <section className="op-section op-pricing" id="pricing">
        <div className="op-section-header op-pricing-header">
          <span>Pricing</span>
          <h2>Start small. Upgrade when the queue is worth it.</h2>
          <p>From a free weekly report to full account intelligence for active teams.</p>
        </div>
        <div className="op-plan-grid">
          {individualPlans.map((plan) => (
            <article className={cn("op-plan", plan.recommended && "is-featured")} key={plan.name}>
              <div>
                <h3>{plan.name}</h3>
                {plan.recommended ? <span>Most picked</span> : null}
              </div>
              <p>{plan.description}</p>
              <strong>
                {plan.price}
                <small>{plan.period}</small>
              </strong>
              <Link
                className={cn(
                  "op-button",
                  plan.recommended ? "op-button-primary" : "op-button-secondary",
                )}
                href={plan.ctaHref}
              >
                {plan.ctaLabel}
              </Link>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <Link className="op-text-link" href="/pricing">
          See full pricing and plan details <ArrowRightIcon aria-hidden="true" />
        </Link>
      </section>

      <section className="op-section op-faq">
        <div className="op-section-header op-section-header-compact">
          <span>FAQ</span>
          <h2>The stuff people usually ask.</h2>
        </div>
        <div className="op-faq-list">
          {homeFaqs.map((item, index) => (
            <details key={item.question} open={index === 0 ? true : undefined}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.question}
                <strong aria-hidden="true">+</strong>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="op-final">
        <div>
          <span>Oppulence</span>
          <h2>Find the customer context your team has been missing.</h2>
          <p>
            Connect your work systems and start with the relationships that need attention today.
          </p>
        </div>
        <Link className="op-button op-button-light" href="/sign-up">
          Start building <ArrowRightIcon aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

function RelationshipHomeHero() {
  return (
    <section className="sm-hero">
      <div className="sm-hero-copy">
        <Link className="sm-announcement" href="/product">
          <span>New</span>
          Account Mission Control is live
          <ArrowRightIcon aria-hidden="true" />
        </Link>
        <h1 aria-label="You’re losing deals you already won.">
          <span aria-hidden="true" className="sm-hero-title-wide">
            You&rsquo;re losing deals you{" "}
            <Image
              alt=""
              className="sm-inline-mark"
              height={58}
              src="/marketing/oppulence-icon.png"
              width={58}
            />{" "}
            already won<span className="sm-hero-title-period">.</span>
          </span>
          <span aria-hidden="true" className="sm-hero-title-mobile">
            You&rsquo;re losing
            <br />
            deals you{" "}
            <Image
              alt=""
              className="sm-inline-mark"
              height={58}
              src="/marketing/oppulence-icon.png"
              width={58}
            />{" "}
            already won<span className="sm-hero-title-period">.</span>
          </span>
        </h1>
        <p>
          That thing you promised on a call back in March. The renewal that&rsquo;s been quiet for a
          month and a half. The champion who left and nobody noticed. It&rsquo;s all sitting in your
          inbox somewhere. Oppulence actually reads it, and tells you who needs you today.
        </p>
        <div className="sm-hero-actions">
          <Link className="sm-button sm-button-blue" href="/sign-up">
            Start building <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
        <Link className="sm-command" href="/app">
          <span>$</span>
          ask Oppulence what changed this week
          <ArrowRightIcon aria-hidden="true" />
        </Link>
        <Link className="sm-personal-link" href="/product">
          Explore relationship intelligence <ArrowRightIcon aria-hidden="true" />
        </Link>
      </div>
      <div className="sm-source-strip" role="group" aria-label="Supported evidence sources">
        <p>Built around the systems your team already uses</p>
        <div>
          {[
            "Gmail",
            "Google Calendar",
            "Slack",
            "HubSpot",
            "Meetings",
            "Notes",
            "Voice",
            "Browser",
          ].map((source) => (
            <span key={source}>{source}</span>
          ))}
        </div>
      </div>
      <div className="sm-hero-art">
        <Image
          alt="Connected work systems feeding one Oppulence relationship model"
          height={1254}
          priority
          sizes="(max-width: 760px) 95vw, 900px"
          src="/marketing/relationship-system/observe.webp"
          unoptimized
          width={1254}
        />
        <Image
          alt=""
          aria-hidden="true"
          className="sm-hero-art-mark"
          height={84}
          src="/marketing/oppulence-icon.png"
          width={84}
        />
      </div>
    </section>
  );
}

/**
 * States the problem before any product claim. Everything here is a failure
 * mode a customer-facing team recognizes from their own week, not a category
 * description.
 */
function TheProblemSection() {
  return (
    <section className="sm-section sm-problem">
      <SectionMarker label="The problem" />
      <header className="sm-section-intro">
        <h2>It&rsquo;s all written down. Nobody has time to read it.</h2>
        <p>
          One account can span a couple thousand emails, a year of calls, and whatever made it into
          the CRM. So people wing it from memory five minutes before the call and hope they
          didn&rsquo;t forget anything.
        </p>
      </header>
      <div className="sm-problem-grid">
        {[
          {
            stat: "Monday morning",
            title: "You start the week guessing.",
            body: "Half an hour scrolling your inbox and the pipeline report, trying to work out what moved over the weekend and who\u2019s been waiting on you since Thursday.",
          },
          {
            stat: "Six weeks later",
            title: "Quiet accounts look fine.",
            body: "Nothing pings you when a deal goes cold or your main contact stops writing back. You find out on the renewal call, once they\u2019ve already decided.",
          },
          {
            stat: "Never written down",
            title: "You said you\u2019d send that thing.",
            body: "It came up on a call, or halfway down a thread. It never made it into a field anywhere, so the moment everyone moved on it stopped existing.",
          },
          {
            stat: "Every handoff",
            title: "The context walks out the door.",
            body: "Someone changes territory or leaves, and two years of knowing this account goes with them. Whoever picks it up starts from nothing.",
          },
        ].map((item) => (
          <article key={item.title}>
            <p className="sm-problem-stat">{item.stat}</p>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
      <p className="sm-problem-turn">
        Every CRM ever made has one fix for this: type more. Nobody does. So we built something that
        just reads the work you already did.
      </p>
    </section>
  );
}

function ProductCatalogSection() {
  return (
    <section className="sm-section sm-catalog" id="product">
      <SectionMarker label="What Oppulence does" />
      <header className="sm-section-intro">
        <h2>Everything you&rsquo;d do yourself, if you had the time.</h2>
        <p>
          It watches the accounts, spots what changed, tells you why that matters, and writes the
          follow-up. You decide if it goes.
        </p>
      </header>
      <fieldset className="sm-catalog-fieldset">
        <legend className="sr-only">Explore Oppulence capabilities</legend>
        <div className="sm-catalog-shell">
          <div className="sm-catalog-tabs">
            {relationshipCatalog.map((item, index) => (
              <label className="sm-catalog-tab" htmlFor={`catalog-${index + 1}`} key={item.label}>
                <input
                  aria-label={item.label}
                  className="sm-catalog-radio sr-only"
                  defaultChecked={index === 0}
                  id={`catalog-${index + 1}`}
                  name="relationship-catalog"
                  type="radio"
                />
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </label>
            ))}
          </div>
          <div className="sm-catalog-panels">
            {relationshipCatalog.map((item, index) => (
              <article
                className={`sm-catalog-panel sm-catalog-panel-${index + 1}`}
                key={item.title}
              >
                <div className="sm-catalog-panel-copy">
                  <p>{item.kicker}</p>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <ul>
                    {item.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </div>
                <div className="sm-catalog-image">
                  <Image
                    alt={`Oppulence product view for ${item.label}`}
                    fill
                    sizes="(max-width: 860px) 100vw, 780px"
                    src={item.src}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </fieldset>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="sm-section sm-how" id="how-it-works">
      <SectionMarker label="How it works" />
      <div className="sm-how-grid">
        <div className="sm-how-copy">
          <h2>How it actually works.</h2>
          <p>
            Watch the work, sort fact from guess, keep one picture of the account, say what changed,
            suggest a move, wait for you. Every step leaves a record.
          </p>
        </div>
        <div className="sm-loop-list">
          {operatingLoop.map(([eyebrow, title, body]) => (
            <article key={eyebrow}>
              <p>{eyebrow}</p>
              <h3>{title}</h3>
              <span>{body}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="sm-section sm-trust">
      <SectionMarker label="Built for trust" />
      <header className="sm-section-intro">
        <h2>If you can&rsquo;t check it, you won&rsquo;t trust it.</h2>
        <p>
          Oppulence is designed to say what it knows, where it learned it, and what is still
          missing.
        </p>
      </header>
      <div className="sm-trust-cards">
        <article>
          <div className="sm-trust-image">
            <Image
              alt="Oppulence account detail with evidence and source health"
              fill
              sizes="(max-width: 800px) 100vw, 650px"
              src="/marketing/relationship-web-detail.png"
            />
          </div>
          <h3>Click through to the actual email.</h3>
          <p>
            Every event, change, and suggestion stays wired to the thing it came from. You can go
            look.
          </p>
        </article>
        <article>
          <div className="sm-trust-image">
            <Image
              alt="Oppulence account list with qualitative relationship health"
              fill
              sizes="(max-width: 800px) 100vw, 650px"
              src="/marketing/relationship-web-list.png"
            />
          </div>
          <h3>Tell it when it&rsquo;s wrong.</h3>
          <p>
            Your correction beats whatever the system thought. You can undo it, and there&rsquo;s a
            record of who changed what.
          </p>
        </article>
      </div>
    </section>
  );
}

function UseCasesSection() {
  return (
    <section className="sm-section sm-use-cases" id="use-cases">
      <SectionMarker label="Use cases" />
      <header className="sm-section-intro">
        <h2>Money you already earned, kept.</h2>
        <p>
          Different teams, same story. The relationship lasts longer than the tool, the territory,
          or whoever used to remember it.
        </p>
      </header>
      <nav aria-label="Use case navigation" className="sm-use-case-nav">
        {useCases.map((_, index) => (
          <a aria-label={`View use case ${index + 1}`} href={`#use-case-${index + 1}`} key={index}>
            {String(index + 1).padStart(2, "0")}
          </a>
        ))}
      </nav>
      <div aria-label="Use cases" className="sm-use-case-track" role="region">
        {useCases.map((item, index) => (
          <article id={`use-case-${index + 1}`} key={item.eyebrow}>
            <p>{item.eyebrow}</p>
            <h3>{item.title}</h3>
            <span>{item.body}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function PricingSection() {
  const individualPlans = pricingPlans.filter((plan) =>
    ["Watch", "Chase", "Intelligence"].includes(plan.name),
  );

  return (
    <section className="sm-section sm-pricing" id="pricing">
      <SectionMarker label="Pricing" />
      <header className="sm-centered-intro">
        <h2>Start with the deals already slipping.</h2>
        <p>Clear monthly plans—from a free weekly report to full account intelligence.</p>
      </header>
      <div className="sm-plan-grid">
        {individualPlans.map((plan) => (
          <article className={cn(plan.recommended && "is-featured")} key={plan.name}>
            <div>
              <h3>{plan.name}</h3>
              {plan.recommended ? <span>Most picked</span> : null}
            </div>
            <p>{plan.description}</p>
            <strong>
              {plan.price}
              <small>{plan.period}</small>
            </strong>
            <Link
              className={cn("sm-button", plan.recommended ? "sm-button-blue" : "sm-button-light")}
              href={plan.ctaHref}
            >
              {plan.ctaLabel}
            </Link>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <Link className="sm-pricing-link" href="/pricing">
        See full pricing and plan details <ArrowRightIcon aria-hidden="true" />
      </Link>
    </section>
  );
}

function RelationshipFaqSection() {
  return (
    <section className="sm-section sm-faq">
      <SectionMarker label="FAQ" />
      <header className="sm-section-intro">
        <h2>The stuff people usually ask.</h2>
        <p>What teams ask before connecting their customer systems.</p>
      </header>
      <div className="sm-faq-list">
        {homeFaqs.map((item, index) => (
          <details key={item.question} open={index === 0 ? true : undefined}>
            <summary>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item.question}
              <strong aria-hidden="true">+</strong>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function RelationshipFinalCta() {
  return (
    <section className="sm-final-cta">
      <h2>
        Go find what you&rsquo;ve been missing<span>.</span>
      </h2>
      <div>
        <Link className="sm-button sm-button-blue" href="/sign-up">
          Start building <ArrowRightIcon aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

const linearHomeSections = [
  {
    title: "It finds the loose ends nobody wrote down.",
    description:
      "Oppulence scans the last 60–90 days of email, calendar, and billing to build a living ledger of promises, proposals, invoices, and open loops. It finds where a valuable relationship lost its next step, with the dollar amount and source attached.",
    label: "Relationship State Engine",
    href: "/ai-help-center",
    src: desktopScreenshots.knowledge,
    alt: "Oppulence relationship memory showing warm opportunities and source evidence",
    bullets: [
      "Promises, objections, and open loops in one ledger",
      "Ghosted proposals, dormant clients, and unpaid invoices",
      "Every finding links back to its source",
    ],
  },
  {
    title: "Run every account from one mission control.",
    description:
      "Each week, Oppulence ranks the three to five relationships where silence, a missed commitment, or a money-state change makes the next move worth attention. Each item explains why now, what is at stake, and what to do next.",
    label: "Account Mission Control",
    href: "/ai-documentation-agent",
    src: desktopScreenshots.chat,
    alt: "Oppulence relationship action queue ranked by value and urgency",
    bullets: [
      "The relationships most likely to slip this week",
      "Why now, what changed, and how much is at stake",
      "A next move drafted from the real history",
    ],
  },
  {
    title: "Protect the relationship when you act.",
    description:
      "Oppulence verifies the contact, checks the relationship and policy context, and waits for your approval. It never emails a contact who bounced, opted out, or changed roles. Actions that touch money need a second confirmation.",
    label: "Governed Execution",
    href: "/integrations",
    src: desktopScreenshots.connections,
    alt: "Oppulence policy checks and sender protection before execution",
    bullets: [
      "You approve every send",
      "Bounced and opted-out contacts are blocked",
      "Money actions need step-up approval",
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
          <p className="linear-eyebrow">[{section.label.toLowerCase()}]</p>
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
        <p className="linear-eyebrow">[how it works]</p>
        <h2 className="linear-statement-title !max-w-[1180px]">
          <strong>Relationship memory compounds.</strong> Generic AI can draft a message. It cannot
          recreate the history that makes the next move timely, specific, and trusted. Every
          promise, objection, reply, meeting, edit, and outcome makes your ledger more useful.
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

const homeFaqs = [
  {
    question: "Is Oppulence another CRM?",
    answer:
      "No. Your CRM stays the system of record. Oppulence is the relationship-memory layer around it: the conversations, promises, objections, and outcomes that explain what should happen next.",
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
    question: "What happens to my data?",
    answer:
      "We read your mail to serve you and no one else. We do not pool it with other customers, and we do not train shared models on it. You can disconnect at any time.",
  },
];

function FinalCta() {
  return (
    <section className="linear-final-cta linear-inset">
      <p className="linear-eyebrow !mb-0">[get started]</p>
      <h2>Give your team one shared truth about every customer relationship.</h2>
      <p className="linear-body max-w-xl text-balance">
        Connect the systems that observe the relationship. Oppulence shows what changed, what needs
        action, and the evidence behind the recommended next move.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link className="linear-button-primary !h-10 !px-5" href="/sign-up">
          Start building
        </Link>
        <Link className="linear-button-secondary !h-10 !px-5" href="/product">
          Explore relationship intelligence
        </Link>
      </div>
      <p className="linear-cta-note">[watch is free · chase is $99/mo]</p>
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
        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
          Oppulence Desktop
        </span>
        <span className="hidden font-mono text-xs text-muted-foreground uppercase tracking-wider sm:inline">
          Local graph
        </span>
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-center p-2 sm:p-6">
        <Image
          alt={alt}
          className="marketing-preview-image w-full min-w-0 max-w-6xl rounded-none border border-primary/10 bg-background object-cover shadow-2xl shadow-black/30"
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

/**
 * One of the three ways to run Oppulence (web, desktop, voice). Same shape for
 * all three so they read as siblings; the installer picker only appears for
 * the two that actually ship a binary.
 */
export function PlatformProductPage({ page }: { page: PlatformPage }) {
  return (
    <div className="sm-platform">
      <section className="sm-platform-hero">
        <p className="sm-platform-eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        <p className="sm-platform-lede">{page.lede}</p>
        <div className="sm-platform-actions">
          {page.download ? (
            <DesktopDownloadChooser
              app={page.slug === "voice-app" ? "voice" : "desktop"}
              blurb={page.summary}
              name={page.name}
            />
          ) : (
            <>
              <Link className="sm-button sm-button-blue" href="/sign-up">
                Start free <ArrowRightIcon aria-hidden="true" />
              </Link>
              <Link className="sm-button sm-button-light" href="/app">
                Open the dashboard
              </Link>
            </>
          )}
        </div>
        <p className="sm-platform-summary">{page.summary}</p>
      </section>

      <div className="sm-platform-shot">
        <Image
          alt={page.screenshotAlt}
          height={1200}
          sizes="(max-width: 1100px) 100vw, 1100px"
          src={page.screenshot}
          width={1900}
        />
      </div>

      {page.sections.map((section, index) => (
        <section className="sm-platform-section" key={section.title}>
          <div className="sm-platform-section-copy">
            <p className="sm-platform-index">{String(index + 1).padStart(2, "0")}</p>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
          <div className="sm-platform-section-shot">
            <Image
              alt={section.alt}
              height={900}
              sizes="(max-width: 900px) 100vw, 620px"
              src={section.screenshot}
              width={1400}
            />
          </div>
        </section>
      ))}

      <section className="sm-platform-specs">
        <h2>The practical bits.</h2>
        <dl>
          {page.specs.map((spec) => (
            <div key={spec.term}>
              <dt>{spec.term}</dt>
              <dd>{spec.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="sm-platform-siblings">
        <h2>The other two.</h2>
        <div>
          {platformPages
            .filter((other) => other.slug !== page.slug)
            .map((other) => (
              <Link href={`/${other.slug}`} key={other.slug}>
                <strong>{other.name}</strong>
                <span>{other.summary}</span>
                <small>
                  Take a look <ArrowRightIcon aria-hidden="true" />
                </small>
              </Link>
            ))}
        </div>
      </section>

      <RelationshipFinalCta />
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
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-foreground/78">{bullet}</p>
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
              primary={page.ctaLabel ?? "Start building"}
              primaryHref={page.ctaHref ?? "/sign-up"}
              secondary="See product"
            />
          </div>
        </header>

        <section className="mt-12 grid gap-3 sm:grid-cols-3">
          {page.bullets.slice(0, 3).map((bullet, index) => {
            const { icon, tone } = bulletIconCycle[index % bulletIconCycle.length];

            return (
              <article
                className="marketing-surface flex gap-3 rounded-none border px-4 py-3"
                key={bullet}
              >
                <MarketingIcon compact icon={icon} tone={tone} />
                <div className="min-w-0">
                  <p className="font-mono text-xs text-foreground/55 uppercase tracking-wider">
                    0{index + 1}
                  </p>
                  <p className="mt-1 text-[13px] text-foreground/75">{bullet}</p>
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
            <p className="mt-4 text-foreground/80 text-[13px] leading-relaxed">{details.summary}</p>
            <h2 className="mt-8 font-medium text-sm">How it works</h2>
            <ol className="mt-4 space-y-3">
              {details.workflow.map((step, index) => (
                <li className="flex gap-3 text-[13px] leading-relaxed" key={step}>
                  <span className="marketing-icon-frame size-7 rounded font-mono text-xs text-muted-foreground">
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
                  <h2 className="mt-5 font-medium text-sm">{section.title}</h2>
                  <p className="mt-3 text-muted-foreground text-[13px] leading-relaxed">
                    {section.body}
                  </p>
                </article>
              );
            })}
            <article className="marketing-surface-strong border p-6">
              <h2 className="font-medium text-sm">Operational outcomes</h2>
              <div className="mt-4 grid gap-3">
                {details.outcomes.map((outcome) => (
                  <div className="flex gap-3 text-[13px] leading-relaxed" key={outcome}>
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
                <h2 className="mt-2 text-2xl font-medium">Where the graph changes the workflow.</h2>
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
                    <h3 className="mt-4 font-medium">{useCase.title}</h3>
                    <p className="mt-2 text-muted-foreground text-[13px] leading-relaxed">
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
              <h2 className="mt-2 text-2xl font-medium">Keep following the revenue loop.</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild className="marketing-cta-primary">
                <Link href={page.ctaHref ?? "/sign-up"}>{page.ctaLabel ?? "Start building"}</Link>
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
  primary = "Start building",
  primaryHref = "/sign-up",
  secondary = "See product",
}: {
  primary?: string;
  primaryHref?: string;
  secondary?: string;
}) {
  return (
    <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Button
        asChild
        className="marketing-cta-primary h-12 border border-transparent px-6 font-medium text-sm has-[>svg]:px-4"
      >
        <Link href={primaryHref}>
          {primary}
          <ArrowRightIcon style={{ fontSize: "0.875rem" }} />
        </Link>
      </Button>
      <Button
        asChild
        className="marketing-cta-secondary h-12 justify-between border border-primary/10 px-4 font-medium text-sm"
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
                <Link href={page.ctaHref ?? "/sign-up"}>
                  {page.ctaLabel ?? "Start building"}
                  <ArrowRightIcon style={{ fontSize: "0.875rem" }} />
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
          <h2 className="mt-2 text-2xl font-medium">Built for evidence-backed action.</h2>
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
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                0{index + 1}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/72">{item}</p>
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
          <h2 className="mt-2 text-2xl font-medium">Sources stay visible and reviewable.</h2>
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
              className="marketing-surface flex items-center gap-3 border px-4 py-3 font-mono text-[13px]"
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
        <h2 className="mt-2 text-2xl font-medium">A clear path from check to action.</h2>
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
            <div className="marketing-chip flex gap-3 border px-4 py-3 text-[13px]" key={bullet}>
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
          <h2 className="mt-2 text-2xl font-medium">Explore the live Oppulence API contract.</h2>
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
          sandbox="allow-downloads allow-forms allow-popups allow-scripts"
          src="/api/reference"
          title="Oppulence API reference"
        />
      </div>
    </section>
  );
}

export function PricingPage({ page }: { page: MarketingPage }) {
  return (
    <div className="linear-subpage-simple linear-inset">
      <header className="linear-page-hero">
        <p className="linear-eyebrow-red">[pricing]</p>
        <h1 className="linear-page-title">{page.title}</h1>
        <p className="linear-body max-w-[560px]">{page.description}</p>
      </header>
      <section className="linear-plan-grid">
        {pricingPlans.map((plan) => (
          <article
            className={cn("linear-plan", plan.recommended && "linear-plan-featured")}
            key={plan.name}
          >
            <p className="linear-plan-name">[{plan.name.toLowerCase()}]</p>
            <p className="linear-plan-price">
              {plan.price}
              {plan.period ? <span>{plan.period}</span> : null}
            </p>
            <p className="linear-body">{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link
              className={cn(
                plan.recommended ? "linear-button-primary" : "linear-button-secondary",
                "!h-10 w-full",
              )}
              href={plan.ctaHref}
            >
              {plan.ctaLabel}
            </Link>
          </article>
        ))}
      </section>
      <p className="linear-cta-note mt-6">
        [flat monthly price · never per seat, per email, or per lookup · one saved deal pays for
        years]
      </p>
    </div>
  );
}

export function BlogIndexPage({ page }: { page: MarketingPage }) {
  const [featured, ...rest] = blogPages;

  return (
    <div className="linear-subpage-simple linear-inset">
      <header className="linear-page-hero">
        <p className="linear-eyebrow-red">[blog]</p>
        <h1 className="linear-page-title">{page.title}</h1>
        <p className="linear-body max-w-[560px]">{page.description}</p>
      </header>
      {featured ? (
        <Link className="linear-blog-featured" href={`/${featured.path}`}>
          <div className="flex flex-wrap gap-2">
            <span className="linear-chip">guide</span>
            <span className="linear-chip">featured</span>
          </div>
          <h2>{featured.title}</h2>
          <p className="linear-body max-w-[640px]">{featured.description}</p>
          <span className="linear-blog-read">read the guide →</span>
        </Link>
      ) : null}
      <section className="linear-blog-grid">
        {rest.slice(0, 11).map((post) => (
          <Link className="linear-blog-card" href={`/${post.path}`} key={post.path}>
            <span className="linear-chip">guide</span>
            <h3 className="line-clamp-2">{post.title}</h3>
            <p className="line-clamp-3">{post.description}</p>
            <span className="linear-blog-read">read →</span>
          </Link>
        ))}
      </section>
    </div>
  );
}

export function BlogArticlePage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <article className="max-w-3xl space-y-8 text-sm leading-relaxed text-foreground/78">
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
            <Link href="/sign-up">
              Become an early customer
              <ArrowRightIcon style={{ fontSize: "0.875rem" }} />
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
              <MarketingIcon icon={BriefcaseIcon} tone="blue" />
              <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Story
              </span>
            </div>
            <h2 className="mt-4 text-sm font-medium">{story.title}</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {story.description}
            </p>
            <div className="mt-auto flex items-center justify-between border-primary/10 border-t pt-4 font-mono text-xs text-foreground/60 uppercase tracking-wider">
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
              <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                0{index + 1}
              </span>
            </div>
            <p className="mt-5 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-foreground/76">
              {page.bullets[index] ?? page.description}
            </p>
          </article>
        ))}
      </section>
      <ProofGrid page={page} />
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
      <h1 className="font-display text-[24px] font-medium">Page not found</h1>
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

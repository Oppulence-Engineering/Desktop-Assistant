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
import PlayIcon from "@mui/icons-material/PlayCircleOutlined";
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
import { DesktopDownloadChooser } from "./desktop-download-chooser";
import { MarketingEffects } from "./marketing-effects";
import { RelationshipProductWindow, RelationshipSystemSection } from "./relationship-system";

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
  { label: "Customers", href: "/customers" },
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
        compact ? "size-7 rounded-md" : "size-9 rounded-[8px]",
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
  const iconSize = header ? 38 : compact ? 20 : prominent ? 40 : 28;

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
          className={cn(
            "rounded-[3px] dark:invert",
            compact ? "size-5" : prominent ? "size-10" : "size-7",
          )}
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
          <Link aria-label="Oppulence home" className="linear-logo linear-header-logo" href="/">
            <InlineLogo header />
          </Link>
        </div>

        <nav className="hidden items-center gap-2 lg:flex">
          <Link className="linear-nav-link" href="/product">
            Product
          </Link>
          <Link className="linear-nav-link" href="/customers">
            Customers
          </Link>
          <Link className="linear-nav-link" href="/pricing">
            Pricing
          </Link>
          <Link className="linear-nav-link" href="/blog">
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
            Oppulence maintains a living model of every customer relationship and tells your team
            what needs action. A Playbook Media product. © 2026 Playbook Media.
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

export function HomePage() {
  return (
    <div className="flex flex-col">
      <HomeHero />
      <ProblemSection />
      <RelationshipSystemSection />
      <HomeProofBand />
      <HomeFaqSection />
      <FinalCta />
    </div>
  );
}

function HomeHero() {
  return (
    <section className="linear-hero linear-inset">
      <p className="mb-5 font-mono text-xs text-oppulence-orange">[relationship intelligence]</p>
      <h1 className="linear-hero-title">
        Know every customer relationship.
        <br className="hidden sm:block" /> Know what needs action.
      </h1>
      <p className="linear-body mt-6 max-w-[680px] text-[16px]">
        Oppulence maintains a living model across email, meetings, Slack, CRM, and revenue systems:
        who matters, what was promised, what changed, and what should happen next. Every
        recommendation shows its evidence. You approve every action. Use the same relationship
        intelligence on the web or from the desktop app.
      </p>
      <DesktopDownloadChooser />
      <div className="linear-hero-band">
        <RelationshipProductWindow surface="desktop" view="prioritize" />
      </div>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="font-mono text-xs text-[var(--linear-text-tertiary)]">
          watches gmail · calendar · billing
        </p>
        <Link className="linear-inline-link shrink-0" href="/book-a-demo">
          <span className="linear-new-pill">New</span>
          Revenue Leak Scan <span className="text-foreground/40">→</span>
        </Link>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="linear-manifesto linear-inset">
      <h2>
        <strong>
          Every Monday, your team should know which relationship needs action—and why.
        </strong>
        <br />
        <br />
        CRMs record contacts and transactions. They do not remember the promise buried in a thread,
        the objection raised in a meeting, or the reason a good client went quiet. That history
        stays scattered until a relationship failure becomes a revenue failure.
        <br />
        <br />
        Oppulence keeps living relationship state across{" "}
        <strong>promises, objections, chases, and outcomes.</strong> Then it turns that memory into
        the next safe action. <strong>Nothing sends until you click Approve.</strong>
      </h2>
    </section>
  );
}

const linearHomeSections = [
  {
    title: "Turn fragmented evidence into living relationship state.",
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

function HomeProofBand() {
  const proof = [
    {
      title: "Every recommendation points back to the promise, thread, invoice, or meeting.",
      label: "Evidence before action",
    },
    {
      title: "Nothing sends without your click. Money actions need extra approval.",
      label: "You stay in control",
    },
    {
      title: "Replies, meetings, and payments update the same relationship ledger.",
      label: "Memory compounds",
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
      "No. Your CRM stays the system of record. Oppulence is the relationship-memory layer around it: the conversations, promises, objections, and outcomes that explain what should happen next.",
  },
  {
    question: "What is relationship memory?",
    answer:
      "It is a living record of what was promised, what changed, what happened next, and which open loop still matters for each person, company, client, opportunity, referral, or partner. Oppulence keeps that record tied to source evidence and turns it into a reviewable next action.",
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
        <p className="linear-eyebrow">[faq]</p>
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
      <p className="linear-eyebrow !mb-0">[get started]</p>
      <h2>Give your team one shared truth about every customer relationship.</h2>
      <p className="linear-body max-w-xl text-balance">
        Connect the systems that observe the relationship. Oppulence shows what changed, what needs
        action, and the evidence behind the recommended next move.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link className="linear-button-primary !h-10 !px-5" href="/book-a-demo">
          See account mission control
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
        className="marketing-cta-primary h-12 border border-transparent px-6 font-medium text-sm has-[>svg]:px-4"
      >
        <Link href="/book-a-demo">
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
                <Link href={page.ctaHref ?? "/book-a-demo"}>
                  {page.ctaLabel ?? "Book a Revenue Leak Scan"}
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
        [flat monthly price · never per seat, per email, or per lookup · one saved deal pays for years]
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
            <Link href="/book-a-demo">
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

export function DemoPage({ page }: { page: MarketingPage }) {
  return (
    <PageShell page={page}>
      <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="marketing-surface border p-6">
          <h2 className="text-2xl font-medium">Your Revenue Leak Scan walkthrough</h2>
          <ul className="mt-6 space-y-4">
            {page.bullets.map((bullet) => (
              <li className="flex gap-3 text-[13px] leading-relaxed" key={bullet}>
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
                className="marketing-chip border px-4 py-3 text-[13px] text-muted-foreground"
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

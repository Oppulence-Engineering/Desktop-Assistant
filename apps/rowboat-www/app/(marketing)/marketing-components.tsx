import {
  ArrowRight as ArrowRightIcon,
  Brain as BrainIcon,
  Briefcase as BriefcaseIcon,
  CalendarDots as CalendarDotsIcon,
  ChartLineUp as ChartLineIcon,
  CheckCircle as CheckCircleIcon,
  Circle as CircleIcon,
  Code as CodeIcon,
  EnvelopeSimple as EnvelopeIcon,
  FileText as FileTextIcon,
  FlowArrow as FlowArrowIcon,
  Globe as GlobeIcon,
  HardDrives as HardDrivesIcon,
  Headset as HeadsetIcon,
  MagnifyingGlass as MagnifyingGlassIcon,
  Monitor as MonitorIcon,
  Path as PathIcon,
  PlugsConnected as PlugsConnectedIcon,
  SealCheck as SealCheckIcon,
  ShareNetwork as NetworkIcon,
  Sparkle as SparkleIcon,
  Stack as StackIcon,
  Tray as TrayIcon,
  type Icon as PhosphorIcon,
} from "@/lib/icons";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { CardDescription, CardTitle } from "@oppulence/ui/components/card";
import { ItemMedia } from "@oppulence/ui/components/item";
import {
  MarketingBreadcrumbs,
  MarketingButtonLink,
  MarketingCta,
  MarketingSpan,
  ProductFrame,
  RelatedPages,
  SectionHeading,
  marketingSpanClass,
} from "./marketing-primitives";
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
  toolLinks,
  type FeatureDetail,
  type LinkItem,
  platformPages,
  type MarketingPage,
  type PlatformPage,
} from "./marketing-data";
import { MarketingLayoutClient } from "./marketing-layout-client";
import { MarketingFaq } from "./marketing-faq";
import {
  SeoAlternativeSections,
  SeoLanderChips,
  SeoLanderSections,
} from "./seo-lander";
import { alternativeFromSlug, getSeoLander } from "./seo-theme";
import { footerGroups, headerNav, headerUtilityLinks } from "./site";

const pricingFaqs = [
  {
    question: "What is Watch, exactly?",
    answer:
      "The free plan: the first kickoff list, with source links. Chase is for staying on the account after you start the work.",
  },
  {
    question: "When do I need Chase?",
    answer:
      "When you need the same account after kickoff: a new commercial sentence, a date going stale, or a file they still have not sent.",
  },
  {
    question: "What does Intelligence add?",
    answer:
      "Change summaries and exportable records on top of Chase. Useful for renewals, escalations, and handovers.",
  },
  {
    question: "Is there a seat tax?",
    answer:
      "The published plans are flat monthly. We are not adding a per-seat line to look more like enterprise software.",
  },
];

const mobileNavLinks = [
  { label: "Products", href: "/products" },
  { label: "Features", href: "/features" },
  { label: "Use cases", href: "/use-cases" },
  { label: "How it works", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download", href: "/download" },
  { label: "Resources", href: "/resources" },
  { label: "Security", href: "/security" },
];

const productSuiteCards = [
  {
    eyebrow: "Core",
    title: "The rows",
    body: "Find the promise, confirm it, keep it after kickoff.",
    href: "/product",
    cta: "See the loop",
    src: "/marketing/relationship-system/observe.webp",
    alt: "Connected systems feeding Oppulence commitment state",
  },
  ...platformPages.map((platform) => ({
    eyebrow: platform.eyebrow.replace("Oppulence ", ""),
    title: platform.name,
    body: platform.summary,
    href: `/${platform.slug}`,
    cta: "Open product",
    src: platform.screenshot,
    alt: platform.screenshotAlt,
  })),
] as const;

const pricingPrinciples = ["Flat monthly price", "No seat tax", "Cancel any time"] as const;

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
  icon: PhosphorIcon;
  tone?: IconTone;
}) {
  return (
    <ItemMedia
      variant="icon"
      className={cn(
        "marketing-icon-frame",
        compact ? "size-7 rounded-none" : "size-9 rounded-[8px]",
        iconToneClasses[tone],
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn("app-icon", compact ? "size-3.5" : "size-5")}
        weight="regular"
      />
    </ItemMedia>
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
        "marketing-eyebrow inline-flex w-fit max-w-full items-center gap-2 rounded-full py-1 pr-3 pl-1.5 font-mono text-xs uppercase tracking-wider",
        className,
      )}
    >
      <MarketingIcon className="size-5 rounded-[3px]" compact icon={icon} tone={tone} />
      <MarketingSpan className="min-w-0 truncate font-normal">{children}</MarketingSpan>
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

export function InlineLogo({
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
    <Badge
      className={cn(
        header ? "oppulence-compact-lockup" : "flex items-center gap-2",
        marketingSpanClass,
      )}
      variant="ghost"
    >
      {header ? (
        <Badge
          aria-hidden="true"
          className={cn("oppulence-compact-lockup__mark", marketingSpanClass)}
          variant="ghost"
        >
          <Image
            alt=""
            className="oppulence-compact-lockup__mark-image"
            height={iconSize}
            src="/marketing/oppulence-icon.png"
            width={iconSize}
          />
        </Badge>
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
        <MarketingSpan
          className={cn(
            header
              ? "oppulence-compact-lockup__wordmark"
              : "font-display text-[24px] leading-6 font-medium text-primary",
          )}
        >
          {header ? "Oppulence" : "oppulence"}
        </MarketingSpan>
      ) : null}
    </Badge>
  );
}

export function MobileMenu() {
  return (
    <details className="relative lg:hidden" data-marketing-mobile-menu>
      <summary aria-label="Toggle navigation" className="linear-mobile-summary">
        <Badge className={marketingSpanClass} variant="ghost" />
        <Badge className={marketingSpanClass} variant="ghost" />
      </summary>
      <nav className="linear-mobile-panel sm-mobile-panel">
        {mobileNavLinks.map((item) => (
          <Link href={item.href} key={`${item.label}-${item.href}`}>
            {item.label}
          </Link>
        ))}
        {headerNav.map((group) => (
          <div key={group.label}>
            <p className="sm-mobile-kicker">{group.label}</p>
            {group.items.slice(0, 6).map((item) => (
              <Link className="sm-mobile-product" href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="mt-auto grid gap-2 pt-8">
          <Link className="sm-button sm-button-light" href="/sign-in">
            Sign in
          </Link>
          <Link className="sm-button sm-button-blue" href="/sign-up">
            Start for free <ArrowRightIcon aria-hidden="true" />
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
          {headerNav.map((group) => (
            <div className="sm-nav-item" key={group.label}>
              {group.href ? (
                <Link className="sm-nav-trigger" href={group.href}>
                  {group.label}
                </Link>
              ) : (
                <span className="sm-nav-trigger">{group.label}</span>
              )}
              <div
                className={cn("sm-nav-panel", group.items.length > 6 && "is-wide")}
                role="group"
                aria-label={group.label}
              >
                <div className="sm-nav-panel-card">
                  {group.items.map((item) => (
                    <Link href={item.href} key={item.href}>
                      <MarketingSpan>{item.label}</MarketingSpan>
                      {item.description ? <small>{item.description}</small> : null}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {headerUtilityLinks.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end">
          <Link className="sm-login hidden md:inline-flex" href="/sign-in">
            Sign in
          </Link>
          <Link className="sm-header-cta hidden md:inline-flex" href="/sign-up">
            Start for free <ArrowRightIcon aria-hidden="true" />
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingLayoutClient>{children}</MarketingLayoutClient>;
}

export function Footer() {
  return (
    <footer className="sm-footer">
      <div className="linear-shell sm-footer-shell">
        <div className="sm-footer-statement">
          <InlineLogo prominent />
          <h2>
            What you promised. <br />
            What they promised.
          </h2>
          <p>Each row opens the email or the call that created it.</p>
        </div>
        <div className="sm-footer-links">
          {footerGroups.map((group) => (
            <LinearFooterGroup items={group.items} key={group.title} title={group.title} />
          ))}
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
    title: "Connect the mail you already have",
    body: "Start with Gmail. Add Calendar, Slack, or HubSpot if the deal lived there. We read first. We do not send.",
  },
  {
    title: "Pick one closed customer",
    body: "You get a list of things that look like promises. Confirm the ones that are real, fix the wording, drop the rest. Take that list into kickoff.",
  },
  {
    title: "Keep the same list after you start the work",
    body: "New mail still attaches to those rows. A date with no finish evidence shows up. So does a late file they said they would send.",
  },
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

const customerStoryIcons: {
  icon: PhosphorIcon;
  tone: IconTone;
}[] = [
  { icon: ChartLineIcon, tone: "yellow" },
  { icon: FlowArrowIcon, tone: "blue" },
  { icon: CheckCircleIcon, tone: "green" },
];

export function ProductPage({ page }: { page: MarketingPage }) {
  return (
    <article className="mk-capability linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Product" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[product]</p>
            <h1 className="linear-subpage-title mt-4">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.description}</p>
            <p className="sm-hero-chips">
              <span>Free first report</span>
              <span>Approval before anything leaves</span>
              <span>Not a second CRM</span>
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <MarketingButtonLink href="/sign-up">Start for free</MarketingButtonLink>
              <MarketingButtonLink href="/download" variant="outline">
                Download desktop
              </MarketingButtonLink>
            </div>
          </div>
        </header>

        <section className="mk-capability-grid">
          <SectionHeading
            eyebrow="[what it is]"
            title="Three jobs people file us under. Only one is right."
          />
          <div>
            <article>
              <h3>CRM</h3>
              <p>HubSpot remembers the deal. It does not remember the sentence from Friday&apos;s call.</p>
            </article>
            <article>
              <h3>Inbox</h3>
              <p>Gmail and Slack are where the promise was made. They are a bad system of record.</p>
            </article>
            <article>
              <h3>Commitment ledger</h3>
              <p>A two-sided list with the source attached. That is the Oppulence object.</p>
            </article>
          </div>
        </section>

        <ProductFrame alt={linearHomeSections[0].alt} priority src={linearHomeSections[0].src} />

        <section className="mk-workflow">
          <SectionHeading eyebrow="[the loop]" title="Detect. Watch. Confirm." />
          <ol>
            {linearHomeSections.map((section, index) => (
              <li key={section.title}>
                <Badge className="rounded-none font-mono" variant="outline">
                  {String(index + 1).padStart(2, "0")}
                </Badge>
                <p>
                  <Link className="mk-text-link" href={section.href}>
                    {section.label}
                  </Link>
                  {" — "}
                  {section.title}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mk-capability-grid">
          <SectionHeading
            eyebrow="[what the loop does]"
            title="The promises, the mail after kickoff, and the row you confirm."
          />
          <div>
            {linearHomeSections.map((section) => (
              <article key={section.title}>
                <h3>{section.label}</h3>
                <p>{section.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mk-capability-grid">
          <SectionHeading
            eyebrow="[how it works]"
            title="The useful part is the row you confirmed."
          />
          <div>
            {homeSteps.map((step) => (
              <article key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <RelatedPages
          items={[
            {
              label: "Commitment register",
              href: "/features/commitment-register",
              description: "The two-sided list of what you owe and what they owe.",
            },
            {
              label: "Account mission control",
              href: "/features/account-mission-control",
              description: "The same account after implementation starts.",
            },
            {
              label: "Governed actions",
              href: "/features/governed-actions",
              description: "Nothing sends because a model found a sentence.",
            },
          ]}
        />
        <MarketingCta
          body="Run it on one customer you closed this quarter. If a row surprises the person who has to deliver the work, keep the account open afterward."
          title="Read one closed customer. Confirm the rows."
        />
      </div>
    </article>
  );
}

export function ProductsPage() {
  return (
    <SuiteSidebarLayout activeHref="/products">
      <div className="sm-products-page">
        <section className="sm-products-hero">
          <p className="linear-eyebrow">[products]</p>
          <h1>Web, desktop, and voice over the same rows.</h1>
          <p>
            Use the browser for kickoff and the weeks after. Use the desktop app in the meeting.
            Voice is how you capture what was said.
          </p>
          <div>
            <Link className="sm-memory-button sm-memory-button-primary" href="/sign-up">
              Start for free <ArrowRightIcon aria-hidden="true" />
            </Link>
            <Link className="sm-memory-button" href="/product">
              See the loop <ArrowRightIcon aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section aria-label="Oppulence product suite" className="sm-products-grid">
          {productSuiteCards.map((product) => (
            <Link className="sm-products-card" href={product.href} key={product.href}>
              <div>
                <Badge className="rounded-none font-normal uppercase" variant="outline">
                  {product.eyebrow}
                </Badge>
                <ArrowRightIcon aria-hidden="true" />
              </div>
              <h2>{product.title}</h2>
              <p>{product.body}</p>
              <figure>
                <Image alt={product.alt} height={760} src={product.src} width={980} />
              </figure>
              <strong>{product.cta}</strong>
            </Link>
          ))}
        </section>
      </div>
    </SuiteSidebarLayout>
  );
}

/**
 * Product surfaces used to sit in the homepage rail, which hid the public
 * header. Keep one shell so /products, /web, and /desktop match the rest of
 * the site.
 */
function SuiteSidebarLayout({ children }: { activeHref: string; children: ReactNode }) {
  return <div className="sm-suite-public">{children}</div>;
}

function RelationshipFinalCta() {
  return (
    <section className="sm-final-cta">
      <h2>Go find what you&rsquo;ve been missing.</h2>
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
    title: "The promises nobody typed into HubSpot.",
    description:
      "Pick one closed customer. We read the mail, calendar, Slack, HubSpot notes, and meetings you already authorized. Each row is a sentence that looks like a promise, with a link back to it.",
    label: "Handoff report",
    href: "/features/commitment-register",
    src: desktopScreenshots.knowledge,
    alt: "A sourced kickoff list with evidence on each row",
    bullets: [
      "What we said we would do, and what they said they would do",
      "Dates, and places the sources disagree",
      "You confirm a row before anyone treats it as real",
    ],
  },
  {
    title: "The email three weeks after kickoff.",
    description:
      "Implementation has started. They write “as discussed, attachments are included.” That sentence should land on the same account, next to the rows you already confirmed.",
    label: "Watch after kickoff",
    href: "/features/account-mission-control",
    src: desktopScreenshots.chat,
    alt: "An account still open after implementation has started",
    bullets: [
      "New commercial sentences after the kickoff deck",
      "Dates getting close with nothing finished",
      "Files they said they would send and have not",
    ],
  },
  {
    title: "An extracted sentence does not leave the building.",
    description:
      "You keep, rewrite, or drop every row. You can export the list into kickoff. Mail and CRM writes wait for a person.",
    label: "Confirm and export",
    href: "/features/governed-actions",
    src: desktopScreenshots.connections,
    alt: "A row held at keep, rewrite, or drop, with the evidence in view",
    bullets: [
      "You decide before it is on the account",
      "Forward the list to the AE or the PM",
      "Nothing sends on its own",
    ],
  },
] as const;

/**
 * One of the three ways to run Oppulence (web, desktop, voice). Same shape for
 * all three so they read as siblings; the installer picker only appears for
 * the two that actually ship a binary.
 */
export function PlatformProductPage({ page }: { page: PlatformPage }) {
  return (
    <SuiteSidebarLayout activeHref={`/${page.slug}`}>
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
                  <Badge className={marketingSpanClass} variant="ghost">
                    {other.summary}
                  </Badge>
                  <small>
                    Take a look <ArrowRightIcon aria-hidden="true" />
                  </small>
                </Link>
              ))}
          </div>
        </section>

        <RelationshipFinalCta />
      </div>
    </SuiteSidebarLayout>
  );
}

export function GenericPage({ page }: { page: MarketingPage }) {
  const details =
    featureDetails[page.path] ??
    (page.path === "lp/ai-help-center" ? featureDetails["ai-help-center"] : undefined);

  if (details) {
    return <FeatureMirrorPage details={details} page={page} />;
  }

  const lander = getSeoLander(page.path);
  if (lander) {
    return (
      <PageShell className="mk-seo-lander" page={page}>
        <SeoLanderChips chips={lander.chips} />
        <SeoLanderSections lander={lander} />
      </PageShell>
    );
  }

  const pageContent = (
    <PageShell page={page}>
      <section className="mk-capability-grid">
        <div>
          {page.bullets.map((bullet, index) => (
            <article key={bullet}>
              <h3>{String(index + 1).padStart(2, "0")}</h3>
              <p>{bullet}</p>
            </article>
          ))}
        </div>
      </section>
      <ProofGrid page={page} />
      {page.category === "tool" ? <ToolPanel page={page} /> : null}
    </PageShell>
  );

  return pageContent;
}

function FeatureMirrorPage({ page, details }: { page: MarketingPage; details: FeatureDetail }) {
  const lander = getSeoLander(page.path);
  const capabilitySections = details.capabilities ?? details.sections;
  const relatedPages =
    lander?.cluster ??
    details.relatedPages ??
    featureLinks.filter((item) => item.href !== `/${page.path}`).slice(0, 3);

  return (
    <article className={cn("mk-capability linear-subpage", lander && "mk-seo-lander")}>
      <div className="linear-inset">
        <MarketingBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            ...(lander ? [{ label: "Answers", href: "/answers" }] : []),
            { label: page.eyebrow },
          ]}
        />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[{page.eyebrow.toLowerCase()}]</p>
            <h1 className="linear-subpage-title mt-4">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.description}</p>
            {lander ? <SeoLanderChips chips={lander.chips} /> : null}
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <MarketingButtonLink href={page.ctaHref ?? "/sign-up"}>
                {page.ctaLabel ?? "Start for free"}
              </MarketingButtonLink>
              <MarketingButtonLink href="/product" variant="outline">
                See the loop
              </MarketingButtonLink>
            </div>
          </div>
        </header>

        {lander ? (
          <SeoLanderSections lander={lander} />
        ) : (
          <>
            <ProductFrame
              alt={`Oppulence desktop for ${page.eyebrow}`}
              priority
              src={screenshotForPage(page)}
            />

            <section className="mk-capability-split">
              <div>
                <SectionHeading eyebrow="[why]" title="Why it matters" />
                <p>{details.summary}</p>
              </div>
              <div>
                <SectionHeading eyebrow="[how it works]" title="The sequence." />
                <ol>
                  {details.workflow.map((step, index) => (
                    <li key={step}>
                      {String(index + 1).padStart(2, "0")} {step}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            {page.bullets.length > 0 ? (
              <section className="mk-capability-grid">
                <SectionHeading eyebrow="[in short]" title="What this page is about." />
                <div>
                  {page.bullets.slice(0, 3).map((bullet, index) => (
                    <article key={bullet}>
                      <h3>{String(index + 1).padStart(2, "0")}</h3>
                      <p>{bullet}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {capabilitySections.length > 0 ? (
              <section className="mk-capability-grid">
                <SectionHeading eyebrow="[capabilities]" title="What it actually does." />
                <div>
                  {capabilitySections.map((section) => (
                    <article key={section.title}>
                      <h3>{section.title}</h3>
                      <p>{section.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {details.useCases && details.useCases.length > 0 ? (
              <section className="mk-examples">
                <SectionHeading eyebrow="[examples]" title="Where it shows up." />
                <div>
                  {details.useCases.map((useCase) => (
                    <article key={useCase.title}>
                      <h3>{useCase.title}</h3>
                      <p>{useCase.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {details.outcomes.length > 0 ? (
              <section className="mk-security-note">
                <h2>What you keep</h2>
                {details.outcomes.map((outcome) => (
                  <p key={outcome}>{outcome}</p>
                ))}
              </section>
            ) : null}

            {page.path === "api-documentation-software" ? <ApiReferenceEmbed /> : null}

            <RelatedPages
              items={relatedPages.map((item) => ({
                label: item.label,
                href: item.href,
                description: item.description,
              }))}
            />
          </>
        )}
        <MarketingCta
          primary={{
            href: page.ctaHref ?? "/sign-up",
            label: page.ctaLabel ?? "Start for free",
          }}
          title="See the ledger against your own history."
        />
      </div>
    </article>
  );
}

function PageShell({
  page,
  children,
  className,
}: {
  page: MarketingPage;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("mk-capability linear-subpage", className)}>
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: page.eyebrow }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[{page.eyebrow.toLowerCase()}]</p>
            <h1 className="linear-subpage-title mt-4">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.description}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <MarketingButtonLink href={page.ctaHref ?? "/sign-up"}>
                {page.ctaLabel ?? "Start for free"}
              </MarketingButtonLink>
              <MarketingButtonLink href="/product" variant="outline">
                See the loop
              </MarketingButtonLink>
            </div>
          </div>
        </header>
        <div className="linear-subpage-content">{children}</div>
      </div>
    </article>
  );
}

function ProofGrid({ page }: { page: MarketingPage }) {
  return (
    <section className="mk-capability-grid">
      <SectionHeading eyebrow="[why it holds]" title="Built for evidence-backed action." />
      <div>
        {page.proof.map((item, index) => (
          <article key={item}>
            <h3>{String(index + 1).padStart(2, "0")}</h3>
            <p>{item}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ToolPanel({ page }: { page: MarketingPage }) {
  return (
    <section className="mk-capability-split">
      <div>
        <SectionHeading eyebrow="[tool]" title="A clear path from check to action." />
        <p>
          This is a static marketing representation of the tool route. The production validator or
          quiz logic can be wired behind the same URL when ready.
        </p>
      </div>
      <div>
        <SectionHeading eyebrow={`[${page.path}]`} title="What it checks." />
        <ul>
          {page.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
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
    <SuiteSidebarLayout activeHref="/pricing">
      <div className="sm-pricing">
        <header className="sm-pricing-hero">
          <p className="linear-eyebrow">[pricing]</p>
          <h1>{page.title}</h1>
          <p>{page.description}</p>
          <div aria-label="Pricing principles">
            {pricingPrinciples.map((item) => (
              <Badge className={marketingSpanClass} key={item} variant="ghost">
                {item}
              </Badge>
            ))}
          </div>
        </header>

        <section aria-label="Oppulence pricing plans" className="sm-pricing-board">
          {pricingPlans.map((plan) => (
            <article
              className={cn("sm-pricing-plan", plan.recommended && "sm-pricing-plan-featured")}
              key={plan.name}
            >
              <div>
                <p>{plan.name}</p>
                {plan.recommended ? (
                  <Badge className={marketingSpanClass} variant="ghost">
                    Recommended
                  </Badge>
                ) : null}
              </div>
              <strong>
                {plan.price}
                {plan.period ? <small>{plan.period}</small> : null}
              </strong>
              <p>{plan.description}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link
                className={cn(
                  "sm-memory-button",
                  plan.recommended && "sm-memory-button-primary",
                  "w-full",
                )}
                href={plan.ctaHref}
              >
                {plan.ctaLabel} <ArrowRightIcon aria-hidden="true" />
              </Link>
            </article>
          ))}
        </section>

        <section className="sm-pricing-note">
          <p>One saved renewal can pay for years.</p>
          <Link href="/products">
            See the suite <ArrowRightIcon aria-hidden="true" />
          </Link>
        </section>
        <MarketingFaq
          heading="How the published plans work"
          items={pricingFaqs}
          lede="These names are the public plans. We are not inventing a fourth tier to look more enterprise."
        />
      </div>
    </SuiteSidebarLayout>
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
            <Badge className="linear-chip rounded-none font-normal" variant="outline">
              guide
            </Badge>
            <Badge className="linear-chip rounded-none font-normal" variant="outline">
              featured
            </Badge>
          </div>
          <h2>{featured.title}</h2>
          <p className="linear-body max-w-[640px]">{featured.description}</p>
          <MarketingSpan className="linear-blog-read font-normal">read the guide →</MarketingSpan>
        </Link>
      ) : null}
      <section className="linear-blog-grid">
        {rest.slice(0, 11).map((post) => (
          <Link className="linear-blog-card" href={`/${post.path}`} key={post.path}>
            <Badge className="linear-chip rounded-none font-normal" variant="outline">
              guide
            </Badge>
            <h3 className="line-clamp-2">{post.title}</h3>
            <p className="line-clamp-3">{post.description}</p>
            <MarketingSpan className="linear-blog-read font-normal">read →</MarketingSpan>
          </Link>
        ))}
      </section>
    </div>
  );
}

export function BlogArticlePage({ page }: { page: MarketingPage }) {
  const alternative = alternativeFromSlug(page.path.replace(/^blog\//, ""));

  if (alternative) {
    return (
      <PageShell className="mk-seo-lander" page={page}>
        <SeoLanderChips chips={["No invented vendor ranking", "Keep the search URL", "Honest seam"]} />
        <SeoAlternativeSections alternative={alternative} />
      </PageShell>
    );
  }

  return (
    <PageShell page={page}>
      <article className="mk-article-body">
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
              <MarketingSpan className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Story
              </MarketingSpan>
            </div>
            <h2 className="mt-4 text-sm font-medium">{story.title}</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {story.description}
            </p>
            <div className="mt-auto flex items-center justify-between border-primary/10 border-t pt-4 font-mono text-xs text-foreground/60 uppercase tracking-wider">
              <MarketingSpan className="font-normal">Open story</MarketingSpan>
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
              <MarketingSpan className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                0{index + 1}
              </MarketingSpan>
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
      <article className="mk-article-body">
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
    <div className="linear-inset px-6 pt-32 pb-20">
      <p className="linear-eyebrow">[404]</p>
      <h1 className="linear-subpage-title mt-4">This page is not on the public site.</h1>
      <p className="linear-body mt-5 max-w-xl">
        It may have moved. The header and footer list every public route we actually ship.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <MarketingButtonLink href="/">Return home</MarketingButtonLink>
        <MarketingButtonLink href="/resources" variant="outline">
          Browse resources
        </MarketingButtonLink>
      </div>
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

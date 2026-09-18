import { comparePages } from "./compare-catalog";
import type { LinkItem } from "./marketing-data";

/** Public origin used for canonical URLs, sitemap, and structured data. */
export const SITE_URL = "https://oppulence.io";

export const SITE_NAME = "Oppulence";

export const ORGANIZATION_NAME = "Playbook Media";

export type NavLink = LinkItem & {
  href: string;
};

export type NavGroup = {
  label: string;
  href?: string;
  description?: string;
  items: NavLink[];
};

/**
 * Header groups for the public site. Every href here must resolve to a real
 * route. The list is intentionally smaller than the full footer map so the
 * bar stays scannable.
 */
export const headerNav: NavGroup[] = [
  {
    label: "Product",
    href: "/products",
    description: "The ledger and the three surfaces that use it.",
    items: [
      {
        label: "Commitment Ledger",
        href: "/product",
        description: "What was promised, what is owed, and what changed.",
      },
      {
        label: "Oppulence Web",
        href: "/web",
        description: "The book of business in a browser tab.",
      },
      {
        label: "Oppulence Desktop",
        href: "/desktop",
        description: "The native app that sits next to the work.",
      },
      {
        label: "Oppulence Voice",
        href: "/voice-app",
        description: "Dictate and capture meetings on the machine.",
      },
      {
        label: "Download",
        href: "/download",
        description: "macOS, Windows, and Linux installers.",
      },
    ],
  },
  {
    label: "Features",
    href: "/features",
    description: "How the ledger actually works.",
    items: [
      {
        label: "Commitment register",
        href: "/features/commitment-register",
        description: "A two-sided record of what you owe and what they owe.",
      },
      {
        label: "Account mission control",
        href: "/features/account-mission-control",
        description: "One account, one timeline, the next move.",
      },
      {
        label: "Attention queue",
        href: "/features/attention-queue",
        description: "The few relationships that need a person this week.",
      },
      {
        label: "Governed actions",
        href: "/features/governed-actions",
        description: "Drafts wait for approval before anything is sent.",
      },
      {
        label: "Meeting capture",
        href: "/features/meeting-capture",
        description: "Local audio, on-device transcripts, commitments kept.",
      },
      {
        label: "Live notes",
        href: "/features/live-notes",
        description: "Notes that refresh themselves from a schedule or event.",
      },
      {
        label: "Local vault",
        href: "/features/local-vault",
        description: "Markdown you own, on your machine.",
      },
      {
        label: "Agents and workflows",
        href: "/features/agents",
        description: "Copilot, MCP tools, and background runs.",
      },
    ],
  },
  {
    label: "Use cases",
    href: "/use-cases",
    items: [
      {
        label: "Founder-operator",
        href: "/use-cases/founder-operator",
        description: "Recover the promises still sitting in your sent folder.",
      },
      {
        label: "Account management",
        href: "/use-cases/account-management",
        description: "Renewals, handovers, and the history that should travel.",
      },
      {
        label: "Meetings",
        href: "/use-cases/meetings",
        description: "Walk in briefed. Walk out with the commitments written down.",
      },
      {
        label: "Research and verification",
        href: "/use-cases/research",
        description: "Confirm who you are talking to before you act.",
      },
    ],
  },
];

export const headerUtilityLinks: NavLink[] = [
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
];

export const footerGroups: { title: string; items: NavLink[] }[] = [
  {
    title: "Product",
    items: [
      { label: "Products", href: "/products" },
      { label: "Commitment Ledger", href: "/product" },
      { label: "Web", href: "/web" },
      { label: "Desktop", href: "/desktop" },
      { label: "Voice", href: "/voice-app" },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
    ],
  },
  {
    title: "Features",
    items: [
      { label: "Commitment register", href: "/features/commitment-register" },
      { label: "Account mission control", href: "/features/account-mission-control" },
      { label: "Attention queue", href: "/features/attention-queue" },
      { label: "Governed actions", href: "/features/governed-actions" },
      { label: "Meeting capture", href: "/features/meeting-capture" },
      { label: "Live notes", href: "/features/live-notes" },
      { label: "Local vault", href: "/features/local-vault" },
      { label: "Agents", href: "/features/agents" },
    ],
  },
  {
    title: "Use cases",
    items: [
      { label: "Founder-operator", href: "/use-cases/founder-operator" },
      { label: "Account management", href: "/use-cases/account-management" },
      { label: "Meetings", href: "/use-cases/meetings" },
      { label: "Research", href: "/use-cases/research" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Resource hub", href: "/resources" },
      { label: "Guides", href: "/guides" },
      { label: "Changelog", href: "/changelog" },
      { label: "Integrations", href: "/integrations" },
      { label: "Security", href: "/security" },
      { label: "Compare", href: "/compare" },
      { label: "Answer hub", href: "/answers" },
      { label: "Blog", href: "/blog" },
      { label: "Customers", href: "/customers" },
    ],
  },
  {
    title: "Compare",
    items: comparePages.map((page) => ({
      label: page.eyebrow,
      href: page.path,
    })),
  },
  {
    title: "Company",
    items: [
      { label: "Contact", href: "/contact" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Responsible disclosure", href: "/responsible-disclosure" },
      {
        label: "Discord",
        href: "https://discord.gg/wajrgmJQ6b",
        external: true,
      },
    ],
  },
];

/** Dedicated marketing routes that live outside the catch-all slug table. */
export const dedicatedMarketingPaths = [
  "product",
  "products",
  "web",
  "desktop",
  "voice-app",
  "download",
  "security",
  "changelog",
  "contact",
  "resources",
  "features",
  "features/commitment-register",
  "features/account-mission-control",
  "features/attention-queue",
  "features/governed-actions",
  "features/meeting-capture",
  "features/live-notes",
  "features/local-vault",
  "features/agents",
  "use-cases",
  "use-cases/founder-operator",
  "use-cases/account-management",
  "use-cases/meetings",
  "use-cases/research",
  "integrations",
  "integrations/gmail",
  "integrations/calendar",
  "integrations/slack",
  "integrations/hubspot",
  "integrations/mcp",
  "guides",
  "guides/desktop-vs-web",
  "guides/what-stays-on-device",
  "guides/approval-before-send",
  "guides/install-oppulence",
  "pricing",
  "blog",
  "customers",
  "compare",
  "answers",
  ...comparePages.map((page) => page.path.slice(1)),
] as const;

export function absoluteUrl(path = ""): string {
  if (!path || path === "/") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

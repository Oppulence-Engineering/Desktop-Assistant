import type { LinkItem, MarketingPage } from "./marketing-data";

/**
 * Ferndesk's ranking engine, extracted and remapped to Oppulence.
 *
 * What actually ranks on ferndesk.com is not a slogan. It is a lander shape:
 * keyword-first title, a one-paragraph definition, three terms Google blurs,
 * who it is / is not for, a related cluster, and FAQPage JSON-LD. We keep that
 * shape. We do not keep Ferndesk's product claims, quotes, or case studies.
 */
export type SeoDistinction = {
  title: string;
  body: string;
  chip: string;
};

export type SeoLander = {
  path: string;
  query: string;
  title: string;
  description: string;
  chips: string[];
  definitionTitle: string;
  definition: string;
  distinctions: SeoDistinction[];
  for: string[];
  notFor: string[];
  faqs: { question: string; answer: string }[];
  cluster: LinkItem[];
};

export type SeoAlternative = {
  slug: string;
  competitor: string;
  category: string;
  title: string;
  description: string;
  whatTheyAre: string;
  whatWeAre: string;
  keepThemWhen: string[];
  chooseUsWhen: string[];
  faqs: { question: string; answer: string }[];
};

const CHIPS = [
  "Free first report",
  "Approval before anything leaves",
  "No invented case studies",
] as const;

const CLUSTER: LinkItem[] = [
  {
    label: "Help center software",
    href: "/help-center-software",
    description: "The public answer layer, and the memory that has to sit under it.",
  },
  {
    label: "AI help center",
    href: "/ai-help-center",
    description: "AI answers are only as current as the graph underneath them.",
  },
  {
    label: "Self-updating help center",
    href: "/self-updating-help-center",
    description: "Context that improves between sessions instead of rotting.",
  },
  {
    label: "Self-service widget",
    href: "/self-service-help-widget",
    description: "Embedded answers still need a next move and a person.",
  },
  {
    label: "Internal knowledge base",
    href: "/internal-knowledge-base",
    description: "Private team memory agents can inspect and update.",
  },
  {
    label: "Commitment register",
    href: "/features/commitment-register",
    description: "The two-sided record those pages are actually about.",
  },
];

function lander(
  path: string,
  query: string,
  title: string,
  description: string,
  definition: string,
  distinctions: SeoDistinction[],
  faqs: SeoLander["faqs"],
  extras?: Partial<Pick<SeoLander, "for" | "notFor" | "cluster" | "definitionTitle">>,
): SeoLander {
  return {
    path,
    query,
    title,
    description,
    chips: [...CHIPS],
    definitionTitle: extras?.definitionTitle ?? `What “${query}” actually means`,
    definition,
    distinctions,
    for: extras?.for ?? [
      "You already write promises in mail, Slack, and calls, and they disappear.",
      "You want a register with sources, not another place to type notes.",
      "Customer-facing sends should wait for a person.",
    ],
    notFor: extras?.notFor ?? [
      "You need a public help center, article CMS, or ticketing inbox. That is a different product.",
      "You want a bot that sends as you without approval.",
      "You want a wall of logos and invented time-saved numbers. We will not publish those.",
    ],
    faqs,
    cluster: extras?.cluster ?? CLUSTER,
  };
}

const helpVsDeskVsKb: SeoDistinction[] = [
  {
    title: "Help center",
    body: "A public, searchable site where customers find answers instead of contacting you. Ferndesk, Zendesk Guide, and Intercom Articles live here. Oppulence does not.",
    chip: "Public articles, search, deflection",
  },
  {
    title: "Help desk",
    body: "The ticketing and inbox side: where conversations land when self-service fails. Zendesk and Freshdesk lead here. Oppulence does not replace them.",
    chip: "Tickets, routing, SLAs",
  },
  {
    title: "Commitment ledger",
    body: "A two-sided record of what you owe and what they owe, with a source. That is the Oppulence object. It is not an article and it is not a ticket.",
    chip: "Promises, dates, evidence",
  },
];

export const seoLanders: Record<string, SeoLander> = {
  "help-center-software": lander(
    "help-center-software",
    "help center software",
    "Help center software is the public answer layer. Oppulence is the memory underneath it.",
    "Help center software publishes articles customers can search. Oppulence keeps the promises, objections, and next moves those articles never see.",
    "Help center software is the tool you use to build a customer-facing knowledge base: a public, searchable site where people find answers instead of opening a ticket. Good ones add search, a custom domain, SEO, a widget, and analytics. Oppulence starts one layer lower. The sent folder and the call are where the dates live. The article is what you publish later, if you publish at all.",
    helpVsDeskVsKb,
    [
      {
        question: "What is help center software?",
        answer:
          "A customer-facing knowledge base: public articles, search, and usually a widget. It is not a help desk, and it is not a commitment ledger.",
      },
      {
        question: "Is Oppulence help center software?",
        answer:
          "No. We do not host your /help subfolder, migrate Zendesk Guide, or recapture screenshots into articles. If that is the job, use a help center. If the job is remembering what was promised in mail and meetings, that is the register.",
      },
      {
        question: "Why does this URL exist then?",
        answer:
          "People land here looking for a help center. We answer the category honestly, then show the seam. Keeping the old slug is how we do not throw away the ranking path.",
      },
      {
        question: "Can I migrate a help center into Oppulence?",
        answer:
          "No. Connect Gmail, Calendar, Slack, or HubSpot if you want the register. Docs stay in your docs tool.",
      },
    ],
  ),
  "ai-help-center": lander(
    "ai-help-center",
    "AI help center",
    "An AI help center answers from articles. Oppulence answers from the last six months of mail.",
    "AI help centers retrieve published docs. Oppulence scans recent communication, meetings, calendar, and CRM history for missed commitments — then waits for approval.",
    "An AI help center is search plus a grounded answer over your published articles. It is useful when the articles are current. It is a guess when they are not. Oppulence does not train on a help center. The first pass is a 6-month read of the systems you already connected.",
    [
      {
        title: "AI help center",
        body: "Answers from the article store. Fine when the article is right. Silent when the promise never became an article.",
        chip: "Docs in, answer out",
      },
      {
        title: "Generic assistant",
        body: "A chat window with a model. Memory is the thread. Sends, if they exist, are a toggle.",
        chip: "Prompt, reply, hope",
      },
      {
        title: "Revenue leak scan",
        body: "The Oppulence first pass: missed commitments and quiet relationships, with source links. Not a published FAQ.",
        chip: "Mail, meetings, CRM",
      },
    ],
    [
      {
        question: "What is an AI help center?",
        answer:
          "A help center with natural-language answers grounded in published articles. The answers are only as current as those articles.",
      },
      {
        question: "Does Oppulence answer from my help center?",
        answer:
          "No. The hosted path reads connected Gmail, Calendar, Slack, and HubSpot. Desktop can also use a local vault. We will not invent a docs corpus we do not have.",
      },
    ],
  ),
  "self-updating-help-center": lander(
    "self-updating-help-center",
    "self-updating help center",
    "A self-updating help center refreshes articles. Oppulence refreshes the register.",
    "Self-updating help centers watch code and tickets to draft article fixes. Oppulence watches mail, meetings, and CRM so the next owner does not start from folklore.",
    "A self-updating help center is software that notices when an article went stale and drafts the fix. Ferndesk's agent does that against a product. Oppulence does a different refresh: live notes and a signed-in ledger that pick up new promises, objections, and silence.",
    [
      {
        title: "Article freshness",
        body: "A screenshot or a default changed. The help article is wrong until someone republishes it.",
        chip: "Docs rot",
      },
      {
        title: "Promise freshness",
        body: "A date was conceded on a Friday call. The CRM still says healthy. That is the Oppulence problem.",
        chip: "Commitments rot",
      },
      {
        title: "Live notes",
        body: "A local Markdown page that can refresh from a schedule or a matching event. Not a public help center.",
        chip: "Desktop vault",
      },
    ],
    [
      {
        question: "What is a self-updating help center?",
        answer:
          "A help center whose articles are checked against the product and drafted back to you. Nothing should publish without a person.",
      },
      {
        question: "Does Oppulence update my help articles?",
        answer:
          "No. Live notes and the signed-in register update relationship state. Your public docs stay in your docs tool.",
      },
    ],
  ),
  "self-service-help-widget": lander(
    "self-service-help-widget",
    "self-service help widget",
    "A self-service help widget answers in-product. The next move still needs a person.",
    "Help widgets search articles inside your product. Oppulence can embed graph-backed conversations — and still holds customer-facing writes until you approve them.",
    "A self-service help widget is a script tag that puts search, articles, and sometimes AI chat inside the product, where people get stuck. Oppulence's widget path, when you use it, is backed by a configured graph and a governed action gate. It is not a Zendesk or Intercom messenger replacement.",
    [
      {
        title: "Help widget",
        body: "Search and articles in the product. Deflection is the job. Tickets still go to the help desk.",
        chip: "In-app answers",
      },
      {
        title: "Messenger",
        body: "Live chat and an inbox. Intercom and Help Scout live here.",
        chip: "Conversations",
      },
      {
        title: "Governed action",
        body: "A draft to mail, Slack, calendar, or HubSpot that waits. That is the Oppulence write path.",
        chip: "Approve, then send",
      },
    ],
    [
      {
        question: "What is a self-service help widget?",
        answer:
          "An embed that lets customers search or ask without leaving the page. Most are wired to a help center, not to a commitment ledger.",
      },
      {
        question: "Is this Intercom?",
        answer:
          "No. We do not sell a messenger. Escalation to Intercom, Zendesk, or Help Scout is a help-center job, not ours.",
      },
    ],
  ),
  "internal-knowledge-base": lander(
    "internal-knowledge-base",
    "internal knowledge base",
    "An internal knowledge base stores runbooks. Oppulence stores the promise those runbooks forget.",
    "Internal knowledge bases keep team articles private. Oppulence keeps operational notes and relationship state in a graph you can inspect — not in opaque model memory.",
    "An internal knowledge base is the article store your team uses and customers cannot see. Notion, Confluence, and a private GitBook site are the usual answers. Oppulence is a different private store: readable notes, live subjects, and a signed-in register. It is not a wiki replacement.",
    [
      {
        title: "Internal KB",
        body: "Private articles for the team. Useful. Incomplete when the answer is in a thread, not a page.",
        chip: "Runbooks",
      },
      {
        title: "Model memory",
        body: "Whatever the chat happened to keep. You cannot inspect it. You cannot hand it to the next owner.",
        chip: "Opaque",
      },
      {
        title: "Local vault + register",
        body: "Markdown on disk, and signed-in commitments with sources. That is the Oppulence pair.",
        chip: "Inspectable",
      },
    ],
    [
      {
        question: "What is an internal knowledge base?",
        answer:
          "A private article store for the team. Sometimes it is the same software as the public help center, gated.",
      },
      {
        question: "Should I move Confluence into Oppulence?",
        answer:
          "No. Point the desktop vault at a folder you already have if you want notes next to the assistant. Do not treat this as a wiki migration.",
      },
    ],
  ),
  "multilingual-knowledge-base": lander(
    "multilingual-knowledge-base",
    "multilingual knowledge base",
    "A multilingual knowledge base syncs languages. Oppulence federates sources.",
    "Multilingual knowledge bases keep every language in sync as articles change. Oppulence federates mail, meetings, files, and CRM into one graph with provenance — it does not translate a help center.",
    "A multilingual knowledge base is a help center or wiki with language-prefixed routes and a glossary. Ferndesk sells that. Oppulence does not. This URL is here because the leftover cluster used it. The honest adjacent job is source federation: one graph across the tools around the work.",
    [
      {
        title: "Translated articles",
        body: "The same help article in Spanish and English, kept in sync. A help-center job.",
        chip: "Locales",
      },
      {
        title: "Scattered sources",
        body: "The promise is in Gmail. The date is on the calendar. The stage is in HubSpot.",
        chip: "The usual mess",
      },
      {
        title: "Federated graph",
        body: "Oppulence cites those sources instead of asking you to paste them into a page.",
        chip: "Provenance",
      },
    ],
    [
      {
        question: "Does Oppulence translate my help center?",
        answer: "No. Use a help center that does translations. We will not list that as a feature.",
      },
    ],
  ),
  "ai-documentation-agent": lander(
    "ai-documentation-agent",
    "AI documentation agent",
    "An AI documentation agent drafts articles. Oppulence drafts the next move.",
    "Documentation agents watch code and write help articles. Oppulence ranks who needs attention and drafts a follow-up with the source attached — then waits.",
    "An AI documentation agent turns a pull request, a ticket, or a changelog into a draft article. That is a docs job. The leftover slug here maps to the revenue action queue: who needs attention, why now, and what to do next. We will not pretend those are the same product.",
    [
      {
        title: "Docs agent",
        body: "Code or tickets in, article draft out. You approve the publish.",
        chip: "Help articles",
      },
      {
        title: "Action queue",
        body: "History in, ranked next move out. You approve the send.",
        chip: "Commitments",
      },
      {
        title: "The shared rule",
        body: "Nothing customer-facing, and nothing published, should leave on a guess.",
        chip: "A person first",
      },
    ],
    [
      {
        question: "What is an AI documentation agent?",
        answer:
          "Software that drafts help articles from product change. Useful if you run a help center. That is not Oppulence.",
      },
      {
        question: "What does this page sell then?",
        answer:
          "The attention queue: a short list of relationships with evidence and a draft you can reject.",
      },
    ],
  ),
  "ai-faq-generator": lander(
    "ai-faq-generator",
    "AI FAQ generator",
    "An AI FAQ generator writes questions. Oppulence keeps the answers that already exist.",
    "FAQ generators invent a page of questions from a site or a dump. Oppulence turns repeated explanations into notes with sources, so the next pass does not start from a blank chat.",
    "An AI FAQ generator is a page that proposes questions and answers, usually from a crawl. Most of them read like filler. Oppulence does not generate a public FAQ. Recurring explanations become notes in the graph. If you need a public FAQ, publish it in a help center.",
    [
      {
        title: "Generated FAQ",
        body: "A crawl, a model, a list of questions. Often generic. Rarely sourced.",
        chip: "Invented Q&A",
      },
      {
        title: "Repeated answer",
        body: "The same explanation you already typed in three threads. That should become a note.",
        chip: "Reuse",
      },
      {
        title: "Public FAQ",
        body: "A help-center article. Not this product.",
        chip: "Publish elsewhere",
      },
    ],
    [
      {
        question: "Will Oppulence generate my FAQ page?",
        answer: "No. We will not invent a public FAQ from a crawl of your marketing site.",
      },
    ],
  ),
  "api-documentation-software": lander(
    "api-documentation-software",
    "API documentation software",
    "API documentation software is a reference. Oppulence is a write gate.",
    "API docs software hosts OpenAPI, a try-it playground, and a changelog. Oppulence separates recommendation, policy, approval, execution, and outcome so a write to mail or CRM stays auditable.",
    "API documentation software publishes a reference next to your product docs. Mintlify, Redoc, and Ferndesk's API docs surface do that. Oppulence does not host your OpenAPI. This leftover slug is the governed-execution page: verification, suppression, permission, and approval before a connector writes.",
    [
      {
        title: "API reference",
        body: "Endpoints, schemas, a playground. Developers read it. A docs job.",
        chip: "OpenAPI",
      },
      {
        title: "Connector write",
        body: "gmail_send, a Slack message, a HubSpot note. Customer-facing. Gated.",
        chip: "Governed actions",
      },
      {
        title: "MCP contract",
        body: "A tool you added. Review inputs and failure modes before an agent calls it. The validator route is a frame, not a hosted spec site.",
        chip: "Contracts",
      },
    ],
    [
      {
        question: "Does Oppulence host API docs?",
        answer:
          "No. docs.oppulence.io is the API reference for Oppulence itself. We are not an OpenAPI publisher for your product.",
      },
    ],
  ),
  "automated-screenshots-for-docs": lander(
    "automated-screenshots-for-docs",
    "automated screenshots for docs",
    "Automated screenshots keep help articles honest. Oppulence verifies the person before the draft.",
    "Screenshot pipelines recapture UI into docs. Oppulence confirms role, address, and evidence before a recommended message becomes an action.",
    "Automated screenshots for docs watch a live product and replace stale images in articles. That is a help-center maintenance job. The leftover slug here is research and verification: do not spend a follow-up on a champion who left in June.",
    [
      {
        title: "Screenshot pipeline",
        body: "The UI changed. The article still shows the old button. A docs agent recaptures it.",
        chip: "Help articles",
      },
      {
        title: "Contact check",
        body: "The CRM title is a year old. The thread shows they left. The gate should refuse the send.",
        chip: "Verification",
      },
      {
        title: "Source before story",
        body: "If Oppulence cannot cite the role change, it should not invent one.",
        chip: "Missing is labelled",
      },
    ],
    [
      {
        question: "Will Oppulence recapture screenshots in my docs?",
        answer: "No. That is a help-center feature. We verify relationship facts, not UI images.",
      },
    ],
  ),
  "chrome-extension-for-documentation": lander(
    "chrome-extension-for-documentation",
    "Chrome extension for documentation",
    "A docs Chrome extension clips UI. Oppulence keeps web research with its source trail.",
    "Documentation extensions grab screenshots and snippets into a help center. Oppulence treats external research as source material for the graph, not disposable browsing context.",
    "A Chrome extension for documentation is usually a clipper: select, capture, file in an article. Oppulence's adjacent job is research capture — attach a public page to an account or a live note with the URL intact. It is not a Ferndesk or Snagit replacement.",
    [
      {
        title: "Docs clipper",
        body: "Capture the UI into an article. A help-center workflow.",
        chip: "Articles",
      },
      {
        title: "In-app browser",
        body: "Desktop can open a public page next to the account. Research stays local until you put it on the graph.",
        chip: "Desktop",
      },
      {
        title: "Source trail",
        body: "If it goes into the register or a note, the URL comes with it.",
        chip: "Provenance",
      },
    ],
    [
      {
        question: "Is there an Oppulence Chrome extension?",
        answer:
          "The leftover slug is not a published extension listing. Desktop is the research surface we actually ship.",
      },
    ],
  ),
  "code-to-docs": lander(
    "code-to-docs",
    "code to docs",
    "Code-to-docs turns a pull request into an article. Oppulence turns a role into a reviewable workflow.",
    "Code-to-docs agents draft help articles from merges. Oppulence models prompts, tools, and action boundaries before an agent can write to a customer system.",
    "Code to docs is the Ferndesk move: a PR merges, an article is drafted. Oppulence does not watch your repo to write help. This leftover slug is workflow design — roles, MCP, simulations, and the same approval boundary as everything else.",
    [
      {
        title: "PR to article",
        body: "Product change becomes a help article. A docs job.",
        chip: "Help center",
      },
      {
        title: "Agent workflow",
        body: "A definition you can inspect: tools, prompts, who it may write to.",
        chip: "Reviewable",
      },
      {
        title: "Money-moving MCP",
        body: "The managed registry can list finance scopes. That is not a production claim.",
        chip: "Not a promise",
      },
    ],
    [
      {
        question: "Does Oppulence write docs from my GitHub repo?",
        answer: "No. Connect the repo as an MCP tool if you want the desktop agent to call it. That is not a help-center publisher.",
      },
    ],
  ),
  "generative-ai-customer-service": lander(
    "generative-ai-customer-service",
    "generative AI customer service",
    "Generative AI customer service drafts replies. Oppulence keeps the history behind the reply.",
    "AI customer-service tools answer tickets from a help center. Oppulence gives operators relationship history, source-backed memory, and a reviewable handoff — not an autopilot inbox.",
    "Generative AI customer service is a ticket assistant: draft the reply from macros and articles. Oppulence is not a help desk. The adjacent job is customer operations with memory — the last promise, the last objection, the draft you can reject.",
    [
      {
        title: "Ticket AI",
        body: "Inbox plus a model plus a help center. Zendesk and Intercom sell this.",
        chip: "Help desk",
      },
      {
        title: "Autopilot send",
        body: "A toggle. The first bad send is the last time a careful team leaves it on.",
        chip: "We will not",
      },
      {
        title: "Operator memory",
        body: "Open the account. Read both sides. Approve the follow-up or do not.",
        chip: "The register",
      },
    ],
    [
      {
        question: "Does Oppulence replace Zendesk?",
        answer:
          "No. Tickets stay in your help desk. The register sits next to it the way it sits next to HubSpot.",
      },
    ],
  ),
};

seoLanders["lp/ai-help-center"] = {
  ...seoLanders["ai-help-center"],
  path: "lp/ai-help-center",
};

const ALTERNATIVE_META: Record<string, { competitor: string; category: string }> = {
  "best-helpdocs-alternatives": { competitor: "HelpDocs", category: "help center" },
  "best-mintlify-alternatives": { competitor: "Mintlify", category: "developer docs" },
  "best-zendesk-help-center-alternatives": { competitor: "Zendesk Guide", category: "help center" },
  "best-intercom-help-center-alternatives": {
    competitor: "Intercom Articles",
    category: "help center",
  },
  "best-docusaurus-alternatives": { competitor: "Docusaurus", category: "developer docs" },
  "best-gitbook-alternatives": { competitor: "GitBook", category: "docs / knowledge base" },
  "best-document360-alternatives": { competitor: "Document360", category: "knowledge base" },
  "best-help-scout-alternatives": { competitor: "Help Scout Docs", category: "help center" },
  "best-helpjuice-alternatives": { competitor: "Helpjuice", category: "knowledge base" },
  "best-knowledgeowl-alternatives": { competitor: "KnowledgeOwl", category: "knowledge base" },
  "best-proprofs-knowledge-base-alternatives": {
    competitor: "ProProfs KB",
    category: "knowledge base",
  },
  "best-zoho-desk-alternatives": { competitor: "Zoho Desk", category: "help desk" },
  "best-archbee-alternatives": { competitor: "Archbee", category: "docs" },
  "best-stonly-alternatives": { competitor: "Stonly", category: "in-app guidance" },
  "best-help-center-software": { competitor: "help center platforms", category: "help center" },
  "best-help-center-software-for-saas": {
    competitor: "SaaS help center platforms",
    category: "help center",
  },
  "best-ai-powered-help-center-software-4-of-the-best": {
    competitor: "AI help centers",
    category: "help center",
  },
  "best-free-knowledge-base-software": {
    competitor: "free knowledge bases",
    category: "knowledge base",
  },
  "best-api-documentation-tools": { competitor: "API doc tools", category: "API docs" },
  "best-software-documentation-tools": {
    competitor: "software documentation tools",
    category: "docs",
  },
  "best-technical-writing-tools": { competitor: "technical writing tools", category: "docs" },
  "best-it-documentation-software": { competitor: "IT documentation tools", category: "docs" },
  "best-knowledge-base-for-small-teams": {
    competitor: "small-team knowledge bases",
    category: "knowledge base",
  },
};

function buildAlternative(competitor: string, category: string, slug: string): SeoAlternative {
  return {
    slug,
    competitor,
    category,
    title: `${competitor} alternatives, and the job they do not do.`,
    description: `${competitor} is ${category} software. Oppulence is a commitment ledger. This page keeps the search URL and tells the truth about the seam.`,
    whatTheyAre: `${competitor} is ${category} software. People search this URL when they want a replacement in that category — a place to publish articles, host a help center, or run a docs site.`,
    whatWeAre:
      "Oppulence is not that replacement. The register stores what you promised and what they promised, with a source. It does not host /help, migrate Guide, or recapture screenshots.",
    keepThemWhen: [
      `You still need ${category} software. Keep ${competitor} or pick another tool in that category.`,
      "You need public SEO articles, a widget, or a ticket inbox. Those jobs do not move here.",
      "You want a ranked list of help-center vendors. Ferndesk already writes those. We will not fake one.",
    ],
    chooseUsWhen: [
      "The expensive misses are promises in mail and meetings, not missing articles.",
      "You want a draft follow-up with a source, and a person still has to approve it.",
      "You will keep your help center or CRM and sit the register next to it.",
    ],
    faqs: [
      {
        question: `Is Oppulence a ${competitor} alternative?`,
        answer: `Not for the ${category} job. If you need ${competitor}'s category, stay there. If you need a two-sided commitment record, that is this product.`,
      },
      {
        question: "Why keep this URL?",
        answer:
          "The leftover cluster already ranks for alternative queries. Deleting the slug throws the path away. Rewriting it as an honest seam is the SEO move we can defend.",
      },
    ],
  };
}

export function alternativeFromSlug(slug: string): SeoAlternative | null {
  const meta = ALTERNATIVE_META[slug];
  if (meta) return buildAlternative(meta.competitor, meta.category, slug);
  if (!/alternative|best-.*-(software|tools|docs|center)/.test(slug)) return null;
  const competitor = slug
    .replace(/^best-/, "")
    .replace(/-alternatives?$/, "")
    .replace(/-/g, " ");
  return buildAlternative(competitor, "docs", slug);
}

export function getSeoLander(path: string): SeoLander | undefined {
  return seoLanders[path];
}

export function applySeoTheme(page: MarketingPage): MarketingPage {
  const landerForPage = getSeoLander(page.path);
  if (landerForPage) {
    return {
      ...page,
      title: landerForPage.title,
      description: landerForPage.description,
      eyebrow: landerForPage.query,
      ctaLabel: page.ctaLabel && /support memory/i.test(page.ctaLabel) ? "Start for free" : page.ctaLabel,
      ctaHref: page.ctaHref && /help-center|support/i.test(page.ctaHref) ? "/sign-up" : page.ctaHref,
    };
  }

  const slug = page.path.replace(/^blog\//, "");
  const alternative = page.path.startsWith("blog/") ? alternativeFromSlug(slug) : null;
  if (!alternative) return page;
  return {
    ...page,
    title: alternative.title,
    description: alternative.description,
  };
}

export const seoLanderList = Object.values(seoLanders).filter(
  (page, index, all) =>
    !page.path.startsWith("lp/") &&
    all.findIndex((item) => item.query === page.query) === index,
);

export const seoAlternativeList = Object.keys(ALTERNATIVE_META)
  .map((slug) => alternativeFromSlug(slug))
  .filter((page): page is SeoAlternative => page !== null);

/**
 * AEO companion to the sitemap. Ferndesk publishes llms.txt so answer engines
 * can quote definitions without scraping the whole marketing tree.
 */
export function buildLlmsTxt(): string {
  const product = [
    ["Commitment ledger", "/product", "The two-sided record of what you owe and what they owe."],
    ["Oppulence Web", "/web", "The book of business in a browser tab."],
    ["Oppulence Desktop", "/desktop", "The native app that sits next to the work."],
    ["Oppulence Voice", "/voice-app", "Dictate and capture meetings on the machine."],
    ["Pricing", "/pricing", "Published plans. No invented enterprise tier."],
    ["Security", "/security", "What stays on the machine, what syncs, what waits."],
    ["Answer hub", "/answers", "Definitions for leftover search URLs, written honestly."],
  ] as const;

  const lines = [
    "# Oppulence",
    "",
    "> Oppulence is the independent record of business promises: what you owe, what they owe, what changed, and the proof behind it.",
    "",
    "Oppulence is not help center software. Leftover search URLs on this site answer the category, then show the seam. We do not invent case studies, SOC 2, or HIPAA.",
    "",
    "## Product",
    "",
    ...product.map(([label, href, blurb]) => `- [${label}](https://oppulence.io${href}): ${blurb}`),
    "",
    "## Definitions",
    "",
    ...seoLanderList.map(
      (lander) => `- [${lander.query}](https://oppulence.io/${lander.path}): ${lander.description}`,
    ),
    "",
    "## Alternatives",
    "",
    "These URLs keep leftover alternative queries. They are not ranked vendor lists.",
    "",
    ...seoAlternativeList.map(
      (page) =>
        `- [${page.competitor} alternatives](https://oppulence.io/blog/${page.slug}): ${page.description}`,
    ),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

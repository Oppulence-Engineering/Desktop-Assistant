export type LinkItem = {
  label: string;
  href: string;
  description?: string;
  external?: boolean;
};

export type MarketingPage = {
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  category: "feature" | "product" | "tool" | "blog" | "customer" | "legal" | "demo" | "landing";
  bullets: string[];
  proof: string[];
  ctaLabel?: string;
  ctaHref?: string;
};

export type FeatureDetail = {
  summary: string;
  sections: {
    title: string;
    body: string;
  }[];
  workflow: string[];
  outcomes: string[];
};

export const featureLinks: LinkItem[] = [
  {
    label: "Knowledge graph",
    href: "/ai-help-center",
    description: "Self-updating corpus for email, calendar, and meetings",
  },
  {
    label: "AI coworker",
    href: "/ai-documentation-agent",
    description: "Agents that write, brief, and act with owned context",
  },
  {
    label: "Live notes",
    href: "/automated-screenshots-for-docs",
    description: "Scheduled and event-triggered notes that keep themselves current",
  },
  {
    label: "Embeddable widget",
    href: "/self-service-help-widget",
    description: "Drop grounded agents into a product or internal tool",
  },
  {
    label: "Code to agents",
    href: "/code-to-docs",
    description: "Turn specs, APIs, and MCP tools into working workflows",
  },
  {
    label: "Platform API",
    href: "/api-documentation-software",
    description: "Self-hosted API, SDK, RAG, and workflow runtime",
  },
  {
    label: "Source federation",
    href: "/multilingual-knowledge-base",
    description: "Bring Gmail, Calendar, Fireflies, Slack, Linear, GitHub, and MCP together",
  },
  {
    label: "Internal memory",
    href: "/internal-knowledge-base",
    description: "Private Markdown knowledge bases for teams and operators",
  },
  {
    label: "Operator agents",
    href: "/generative-ai-customer-service",
    description: "Grounded support, revenue, and ops agents with reviewable actions",
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Connect tools through native connectors and MCP servers",
  },
  {
    label: "Browser context",
    href: "/chrome-extension-for-documentation",
    description: "Capture useful web context into the graph without losing provenance",
  },
];

export const productLinks: LinkItem[] = [
  { label: "How it works", href: "/" },
  { label: "Integrations", href: "/integrations" },
  { label: "Pricing", href: "/pricing" },
  { label: "Book a demo", href: "/book-a-demo" },
  { label: "Dashboard", href: "/app" },
];

export const resourceLinks: LinkItem[] = [
  { label: "Blog", href: "/blog", description: "Guides and comparisons" },
  { label: "Customers", href: "/customers", description: "Use-case stories" },
  {
    label: "Self-updating graph",
    href: "/self-updating-help-center",
    description: "Why memory should stay alive",
  },
  {
    label: "API docs",
    href: "/api-documentation-software",
    description: "Platform surface and SDK",
  },
];

export const toolLinks: LinkItem[] = [
  {
    label: "MCP manifest validator",
    href: "/tools/openapi-validator",
    description: "Check agent-tool schemas before wiring them into workflows",
  },
  {
    label: "Memory debt quiz",
    href: "/tools/docs-debt-quiz",
    description: "Estimate how much context work is still manual",
  },
];

export const alternativeLinks: LinkItem[] = [
  { label: "HelpDocs alternatives", href: "/blog/best-helpdocs-alternatives" },
  { label: "Mintlify alternatives", href: "/blog/best-mintlify-alternatives" },
  { label: "Zendesk alternatives", href: "/blog/best-zendesk-help-center-alternatives" },
  { label: "Intercom alternatives", href: "/blog/best-intercom-help-center-alternatives" },
  { label: "Docusaurus alternatives", href: "/blog/best-docusaurus-alternatives" },
  { label: "GitBook alternatives", href: "/blog/best-gitbook-alternatives" },
  { label: "Document360 alternatives", href: "/blog/best-document360-alternatives" },
  { label: "Help Scout alternatives", href: "/blog/best-help-scout-alternatives" },
];

export const socialLinks: LinkItem[] = [
  {
    label: "GitHub",
    href: "https://github.com/Oppulence-Engineering",
    external: true,
  },
  {
    label: "Discord",
    href: "https://discord.gg/wajrgmJQ6b",
    external: true,
  },
];

const baseProof = [
  "Local-first storage for sensitive operator context.",
  "Reviewable tool actions before they land.",
  "Static deployment friendly marketing pages in Oppulence.",
];

export const featureDetails: Record<string, FeatureDetail> = {
  "ai-help-center": {
    summary:
      "Oppulence treats the knowledge base as a living operating graph, not a folder of static articles. Every useful source becomes structured, editable memory that agents can inspect before they answer or act.",
    sections: [
      {
        title: "Durable relationship memory",
        body: "People, projects, companies, decisions, commitments, and open questions become durable Markdown nodes with backlinks. The result is a work graph that survives across meetings, inbox threads, and agent sessions.",
      },
      {
        title: "Inspectable source trails",
        body: "Generated context stays tied to the material it came from. Operators can open, correct, delete, or extend the notes instead of trusting an opaque model memory layer.",
      },
      {
        title: "Shared substrate for agents",
        body: "The same corpus can feed the desktop coworker, platform workflows, RAG-backed widgets, and background jobs, so teams do not rebuild context for every surface.",
      },
    ],
    workflow: [
      "Connect inbox, calendar, meeting-note, document, and tool sources.",
      "Normalize source material into entity and project notes.",
      "Attach provenance so each note can be audited and edited.",
      "Let agents retrieve from the graph before drafting, briefing, or acting.",
    ],
    outcomes: [
      "Less repeated context-setting before every AI task.",
      "A portable memory layer that operators own.",
      "More accurate briefs because relationships and decisions accumulate over time.",
    ],
  },
  "ai-documentation-agent": {
    summary:
      "Oppulence agents start from the work graph. They can draft, brief, summarize, plan, and execute workflows with the context of past decisions, communication history, and connected tools.",
    sections: [
      {
        title: "Briefs before meetings",
        body: "Agents can assemble the relevant people, prior promises, unresolved decisions, recent emails, and meeting history into a focused prep document or voice-ready summary.",
      },
      {
        title: "Drafts with continuity",
        body: "Email replies, docs, decks, and runbooks are generated from the user's own corpus, making them less generic and easier to verify before sending.",
      },
      {
        title: "Action with review",
        body: "Tool calls can be routed through MCP servers and platform APIs, but sensitive work remains visible and reviewable before it lands in external systems.",
      },
    ],
    workflow: [
      "Choose the person, project, account, or objective.",
      "Pull the relevant graph context and source references.",
      "Generate a brief, draft, plan, or artifact.",
      "Review any proposed action before external tools are called.",
    ],
    outcomes: [
      "Faster meeting prep and follow-up creation.",
      "Drafts that preserve commitments and relationship context.",
      "A safer path from assistant output to real operational action.",
    ],
  },
  "automated-screenshots-for-docs": {
    summary:
      "Live notes are Oppulence's delegated-awareness primitive. A note can track a person, account, project, competitor, or operational risk and refresh itself on a schedule or event.",
    sections: [
      {
        title: "Scheduled awareness",
        body: "Daily, weekly, or time-windowed refreshes keep important notes current without requiring the user to remember to ask for updates.",
      },
      {
        title: "Event-triggered updates",
        body: "Incoming emails, webhook events, platform activity, or matching tool signals can wake the responsible agent and update the relevant note.",
      },
      {
        title: "File-backed continuity",
        body: "Updates are written back into the local Markdown corpus, so the result is durable operational memory rather than a transient chat answer.",
      },
    ],
    workflow: [
      "Create or select a note for the subject being tracked.",
      "Define the objective and the schedule or event match criteria.",
      "Let the live note gather fresh context and rewrite itself.",
      "Review the updated note and any proposed follow-up actions.",
    ],
    outcomes: [
      "Ongoing awareness for deals, projects, relationships, and market topics.",
      "Less manual status-checking across email and meetings.",
      "A clear history of what changed and when.",
    ],
  },
  "self-service-help-widget": {
    summary:
      "The Oppulence widget gives teams a product-embedded agent surface backed by the same project, source, workflow, and tool configuration as the platform.",
    sections: [
      {
        title: "Embedded support surface",
        body: "Teams can add a grounded agent to a product, portal, or internal tool without rebuilding conversation state, source retrieval, or workflow routing from scratch.",
      },
      {
        title: "Project-aware routing",
        body: "Widget sessions can connect to configured projects and workflows so the answer path matches the domain, customer, or operational process.",
      },
      {
        title: "Tool-ready escalation",
        body: "When answers are not enough, the platform can propose actions, handoffs, or tool calls under the same review model used elsewhere.",
      },
    ],
    workflow: [
      "Create a project with sources, workflows, and tools.",
      "Embed the widget script or iframe in the target surface.",
      "Bootstrap sessions against the widget API.",
      "Route conversations to the right workflow and escalation path.",
    ],
    outcomes: [
      "A faster path to product-embedded AI support.",
      "Consistent answers across product and internal operator tools.",
      "Room to grow from Q&A into controlled action workflows.",
    ],
  },
  "code-to-docs": {
    summary:
      "Oppulence turns technical context into agent workflows: specs, API contracts, MCP tools, webhook handlers, and simulations all become part of the execution substrate.",
    sections: [
      {
        title: "Workflow modeling",
        body: "The visual builder lets teams define agent roles, handoffs, prompts, tools, and test scenarios as an operational system rather than an ad hoc prompt chain.",
      },
      {
        title: "Tool contracts",
        body: "Agents can call MCP servers, signed tool webhooks, and API-backed actions when inputs, outputs, and failure behavior are clear enough to review.",
      },
      {
        title: "Simulation before launch",
        body: "Role-played test runs help validate whether a workflow responds correctly before it is exposed in a widget or background job.",
      },
    ],
    workflow: [
      "Describe the workflow and agent boundaries.",
      "Attach tools, schemas, and source collections.",
      "Run simulated conversations or task scenarios.",
      "Deploy to API, widget, or background execution once the behavior is stable.",
    ],
    outcomes: [
      "Less custom glue code for every new agent.",
      "Clearer review of tool behavior before production use.",
      "Reusable workflows across support, operations, and internal automation.",
    ],
  },
  "api-documentation-software": {
    summary:
      "Oppulence exposes the platform as self-hosted agent infrastructure: projects, workflows, RAG, widget sessions, workers, and APIs run together as one deployment.",
    sections: [
      {
        title: "Project and workflow APIs",
        body: "Teams can manage sources, workflows, conversations, test runs, and widget sessions without coupling every integration to the desktop app.",
      },
      {
        title: "Async worker model",
        body: "Jobs and ingestion run outside the request lifecycle, with Mongo, Redis, and Qdrant supporting state, queues, and vector search.",
      },
      {
        title: "Self-hosted control",
        body: "The deployment model is built for teams that need control over data residency, provider keys, runtime configuration, and integration boundaries.",
      },
    ],
    workflow: [
      "Deploy the platform stack with storage, queues, and vector search.",
      "Create projects and configure sources.",
      "Define workflows and tool boundaries.",
      "Expose agents through the public API, widget, or scheduled jobs.",
    ],
    outcomes: [
      "A complete starting point for owned agent infrastructure.",
      "Clear separation between request handling and long-running work.",
      "A deployment posture that can match stricter customer environments.",
    ],
  },
  "multilingual-knowledge-base": {
    summary:
      "Oppulence is designed for source federation: communication, documents, meetings, local files, and tool events can become one graph even when they originate in different systems or languages.",
    sections: [
      {
        title: "Source-normalized context",
        body: "The graph abstracts over where a fact came from while preserving enough provenance for a user to inspect the original source.",
      },
      {
        title: "Cross-tool continuity",
        body: "A project can span Gmail, Calendar, Fireflies, Slack, GitHub, Linear, web search, and custom MCP servers without asking the user to paste context between tools.",
      },
      {
        title: "Model flexibility",
        body: "Teams can bring hosted or local models and still keep the graph as the stable memory layer above provider-specific capabilities.",
      },
    ],
    workflow: [
      "Connect each source system with clear scope.",
      "Map events and documents into the owned graph.",
      "Keep original references attached for review.",
      "Use agents to synthesize across source boundaries.",
    ],
    outcomes: [
      "Less siloed memory across teams and tools.",
      "Better context for cross-functional workflows.",
      "A more portable knowledge layer than vendor-specific AI memory.",
    ],
  },
  "internal-knowledge-base": {
    summary:
      "Oppulence internal memory is private, editable, and operational. It is built for teams that need knowledge bases agents can update, not just pages employees can search.",
    sections: [
      {
        title: "Private operational memory",
        body: "Internal context can live in plain Markdown so operators can read, edit, and version the knowledge that agents depend on.",
      },
      {
        title: "Entity-based organization",
        body: "Backlinks make relationships explicit across people, accounts, projects, decisions, incidents, and policies.",
      },
      {
        title: "Agent-maintained notes",
        body: "Scheduled and event-triggered workflows can refresh internal notes as facts change, reducing stale runbooks and abandoned docs.",
      },
    ],
    workflow: [
      "Choose the internal domain or team memory to model.",
      "Seed the graph from source documents and communication history.",
      "Create live notes for high-change workflows.",
      "Review updates and correct the corpus directly.",
    ],
    outcomes: [
      "Internal knowledge that stays closer to the actual work.",
      "A safer way for agents to rely on team-specific context.",
      "Fewer hidden assumptions trapped in chat transcripts or private inboxes.",
    ],
  },
  "generative-ai-customer-service": {
    summary:
      "Oppulence customer-facing agents can answer with relationship history, product context, billing or operational records, and controlled action paths instead of only static docs.",
    sections: [
      {
        title: "Relationship-aware responses",
        body: "Agents can account for prior conversations, open commitments, account-specific notes, and recent meetings before drafting an answer.",
      },
      {
        title: "Operational escalation",
        body: "When a workflow needs more than an answer, agents can propose tickets, messages, updates, or handoffs through configured tools.",
      },
      {
        title: "Human review boundaries",
        body: "Sensitive actions remain gated so teams can choose which steps are automatic, assisted, or manual.",
      },
    ],
    workflow: [
      "Connect the product, support, and relationship sources that matter.",
      "Define the customer-service workflow and fallback policy.",
      "Expose the workflow through the widget or operator dashboard.",
      "Review suggested actions before they touch external systems.",
    ],
    outcomes: [
      "More grounded customer answers.",
      "Less context switching for support and success teams.",
      "A path from assistance to safe operational automation.",
    ],
  },
  integrations: {
    summary:
      "Oppulence integrations are the intake and action layer for the graph. Sources feed durable memory, while MCP and API tools give agents controlled ways to act.",
    sections: [
      {
        title: "Communication sources",
        body: "Gmail, Calendar, meeting notes, and chat systems provide the relationship and decision history that generic AI tools usually miss.",
      },
      {
        title: "Operational systems",
        body: "Linear, GitHub, CRMs, databases, support tools, and internal APIs can become both context sources and action targets.",
      },
      {
        title: "MCP-native extension",
        body: "Teams can bring their own tools through MCP instead of waiting for every workflow to become a first-party integration.",
      },
    ],
    workflow: [
      "Start with the sources that hold the highest-value context.",
      "Connect action tools only after review boundaries are clear.",
      "Use live notes and workflows to keep important state current.",
      "Audit agent runs and source updates as usage expands.",
    ],
    outcomes: [
      "A practical path from read-only context to controlled execution.",
      "Fewer one-off integrations for each agent workflow.",
      "A clearer boundary between source ingestion and external action.",
    ],
  },
  "chrome-extension-for-documentation": {
    summary:
      "Oppulence browser context capture helps users bring useful web material into the graph without losing where it came from or why it mattered.",
    sections: [
      {
        title: "Capture in flow",
        body: "Operators can pull relevant web context into the corpus while researching competitors, customers, vendors, market changes, or technical references.",
      },
      {
        title: "Provenance-first memory",
        body: "Captured context should remain tied to the original page or search result so later agents can distinguish source material from synthesis.",
      },
      {
        title: "Live research notes",
        body: "Captured web context can seed live notes that continue tracking a topic through scheduled refreshes or search-backed workflows.",
      },
    ],
    workflow: [
      "Capture a page, search result, or excerpt into the relevant note.",
      "Attach it to a person, project, account, or topic.",
      "Let agents synthesize across captured context and existing memory.",
      "Refresh live research notes when the topic changes.",
    ],
    outcomes: [
      "Research that becomes reusable operational memory.",
      "Less source ambiguity in generated summaries.",
      "A smoother path from web discovery to agent action.",
    ],
  },
  "ai-faq-generator": {
    summary:
      "Oppulence turns repeated answers into living operational artifacts. A frequently asked question can become a source-linked note, a runbook, or a live workflow that keeps improving.",
    sections: [
      {
        title: "From answer to artifact",
        body: "Instead of leaving repeated explanations in chat history, agents can promote them into editable notes with enough context for the next operator.",
      },
      {
        title: "Runbooks with sources",
        body: "Generated runbooks can include the people, decisions, systems, and source references behind the answer so they remain useful under pressure.",
      },
      {
        title: "Refreshable knowledge",
        body: "High-change answers can become live notes that refresh when the underlying project, account, or policy changes.",
      },
    ],
    workflow: [
      "Identify recurring questions in conversations or support work.",
      "Generate a source-linked note or runbook.",
      "Assign refresh criteria where the answer changes often.",
      "Let agents reuse the artifact in future workflows.",
    ],
    outcomes: [
      "Less duplicate explanation work.",
      "Reusable answers that remain inspectable.",
      "A bridge from Q&A to maintained operational memory.",
    ],
  },
  "help-center-software": {
    summary:
      "Oppulence reframes help-center software as agent memory infrastructure. The published answer is only one output of a graph that can also brief operators and trigger workflows.",
    sections: [
      {
        title: "Beyond static publishing",
        body: "A static help center answers known questions. The graph can also capture relationship history, internal process state, and action context.",
      },
      {
        title: "Operator plus customer surfaces",
        body: "The same source graph can support an embedded customer widget, an internal operator dashboard, and background agent workflows.",
      },
      {
        title: "Action-aware support",
        body: "When a support answer implies a follow-up, the platform can draft, route, or propose the next action instead of ending at a link.",
      },
    ],
    workflow: [
      "Model the knowledge graph before designing the public article surface.",
      "Connect support sources, product docs, and internal runbooks.",
      "Expose customer-facing and operator-facing views.",
      "Add tool actions once policies and review boundaries are clear.",
    ],
    outcomes: [
      "Answers that improve as the operating graph improves.",
      "Less duplication between customer docs and internal runbooks.",
      "A path from self-service to assisted resolution.",
    ],
  },
  "self-updating-help-center": {
    summary:
      "Oppulence memory compounds because important notes can update themselves. That makes the graph useful for long-running relationships, projects, and operational risks.",
    sections: [
      {
        title: "Long-lived subjects",
        body: "People, accounts, projects, competitors, incidents, and policies can remain first-class subjects that accumulate context over time.",
      },
      {
        title: "Trigger-driven freshness",
        body: "Scheduled refreshes and matching events keep notes current without relying on someone to remember a manual update.",
      },
      {
        title: "Agent-ready state",
        body: "Fresh notes give agents a stronger starting point for briefs, recommendations, and proposed actions.",
      },
    ],
    workflow: [
      "Pick the subject that needs persistent awareness.",
      "Define what the note should track and when it should refresh.",
      "Let the agent update the note from the source graph.",
      "Use the refreshed state in future workflows.",
    ],
    outcomes: [
      "Less stale context around high-value work.",
      "A graph that improves between user sessions.",
      "Better long-horizon agent performance.",
    ],
  },
};

export const primaryPages: MarketingPage[] = [
  {
    path: "ai-documentation-agent",
    eyebrow: "AI Coworker",
    title: "An AI coworker that writes from the work graph, not an empty prompt.",
    description:
      "Oppulence can brief meetings, draft replies, create artifacts, and run workflows using the context accumulated from email, calendar, meeting notes, and local files.",
    category: "feature",
    bullets: [
      "Generate meeting briefs from prior decisions, commitments, and open threads.",
      "Draft email and documents in a voice grounded in your own corpus.",
      "Route actions through MCP tools with reviewable execution boundaries.",
    ],
    proof: baseProof,
  },
  {
    path: "ai-faq-generator",
    eyebrow: "Runbook Generation",
    title: "Turn repeated questions into living notes, briefs, and runbooks.",
    description:
      "Instead of a static FAQ, Oppulence produces editable Markdown that can keep tracking the people, projects, and decisions behind the answer.",
    category: "feature",
    bullets: [
      "Capture recurring answers as source-linked notes.",
      "Promote important notes into live notes with schedules or event triggers.",
      "Keep generated artifacts inspectable and editable in plain files.",
    ],
    proof: baseProof,
  },
  {
    path: "ai-help-center",
    eyebrow: "Knowledge Graph",
    title: "A self-updating knowledge graph for the work you already do.",
    description:
      "Oppulence ingests Gmail, Calendar, meetings, and notes into one Obsidian-compatible vault so every agent starts with durable context.",
    category: "feature",
    bullets: [
      "Build people, project, company, decision, and commitment files automatically.",
      "Keep sources visible so claims can be opened, corrected, or extended.",
      "Use the same corpus from the desktop app and the self-hosted platform.",
    ],
    proof: baseProof,
  },
  {
    path: "api-documentation-software",
    eyebrow: "Platform API",
    title: "Self-hosted agent infrastructure with APIs, RAG, and a widget surface.",
    description:
      "The Oppulence platform hosts projects, workflows, the visual agent builder, RAG, and chat widget APIs for teams that need agents inside their own product or internal tools.",
    category: "product",
    bullets: [
      "Next.js platform runtime backed by Mongo, Redis, and Qdrant.",
      "Public API and SDK surface for project, workflow, and widget use cases.",
      "Workers for background jobs and ingestion outside request lifecycles.",
    ],
    proof: baseProof,
  },
  {
    path: "automated-screenshots-for-docs",
    eyebrow: "Live Notes",
    title: "Notes that refresh on a schedule, event, or trigger.",
    description:
      "Live notes are Oppulence's primitive for delegated awareness: a note can track a person, deal, competitor, project, or topic and rewrite itself as new context appears.",
    category: "feature",
    bullets: [
      "Use cron windows for daily, weekly, or time-bound context refreshes.",
      "Wake agents from matching email, calendar, webhook, or platform events.",
      "Write every update back to the local Markdown vault.",
    ],
    proof: baseProof,
  },
  {
    path: "chrome-extension-for-documentation",
    eyebrow: "Browser Context",
    title: "Capture web context without losing source provenance.",
    description:
      "Oppulence is designed around source-aware memory. Browser and web-search context can become editable notes that keep references attached for later review.",
    category: "feature",
    bullets: [
      "Attach web findings to projects, people, and live notes.",
      "Use Exa or MCP-powered search providers where configured.",
      "Keep citations and context in files the user owns.",
    ],
    proof: baseProof,
  },
  {
    path: "code-to-docs",
    eyebrow: "Code To Agents",
    title: "Convert specs, APIs, and tool definitions into agent workflows.",
    description:
      "Oppulence's platform side exposes the workflow builder, tool webhooks, simulation harness, and SDK surface needed to turn implementation context into usable agents.",
    category: "feature",
    bullets: [
      "Model workflows visually and test them against role-played scenarios.",
      "Attach MCP servers and signed tool webhooks to agent actions.",
      "Ship an embeddable widget or API-backed internal agent.",
    ],
    proof: baseProof,
  },
  {
    path: "generative-ai-customer-service",
    eyebrow: "Operator Agents",
    title: "Ground customer-facing agents in the real operating corpus.",
    description:
      "Support, success, revenue, and operations teams can deploy agents that know the relationship history and execute through controlled tool paths.",
    category: "feature",
    bullets: [
      "Answer from email, meeting notes, product docs, and connected systems.",
      "Escalate or draft actions with human review before sending.",
      "Use the widget API for product-embedded support experiences.",
    ],
    proof: baseProof,
  },
  {
    path: "help-center-software",
    eyebrow: "Agent Platform",
    title: "Help-center patterns rebuilt as an owned agent memory layer.",
    description:
      "Oppulence is not only a help center. It is the owned graph and runtime that lets support and product teams answer, act, and keep institutional memory current.",
    category: "product",
    bullets: [
      "Use the embeddable chat widget for product support.",
      "Back answers with RAG over owned documents and synced sources.",
      "Keep operational knowledge in a portable Markdown layer.",
    ],
    proof: baseProof,
  },
  {
    path: "integrations",
    eyebrow: "Integrations",
    title: "Connect the systems where work actually happens.",
    description:
      "Oppulence builds context from Gmail, Google Calendar, meeting notes, Fireflies, local files, web search, and any tool exposed through MCP.",
    category: "product",
    bullets: [
      "Gmail and Calendar ingestion for relationship and schedule context.",
      "Meeting-note and Fireflies workflows for decisions and commitments.",
      "MCP and managed integration paths for Slack, Linear, GitHub, CRMs, databases, and more.",
    ],
    proof: [
      "Provider keys stay user-controlled.",
      "External tool execution can be reviewed.",
      "Platform workers support ingestion and long-running jobs.",
    ],
  },
  {
    path: "internal-knowledge-base",
    eyebrow: "Internal Memory",
    title: "Private knowledge bases that agents can inspect and update.",
    description:
      "Teams can keep internal memory in transparent notes instead of opaque model memory or scattered SaaS search results.",
    category: "feature",
    bullets: [
      "Store important context in plain Markdown.",
      "Use backlinks to make relationships explicit.",
      "Let agents update notes when new events arrive.",
    ],
    proof: baseProof,
  },
  {
    path: "lp/ai-help-center",
    eyebrow: "Landing Page",
    title: "Launch a grounded AI support surface without renting your memory layer.",
    description:
      "This campaign page positions Oppulence around owned memory, agent workflows, and self-hosted runtime.",
    category: "landing",
    bullets: [
      "Start with the knowledge graph.",
      "Expose answers through the widget or API.",
      "Scale into event-triggered agents and workflow automation.",
    ],
    proof: baseProof,
  },
  {
    path: "multilingual-knowledge-base",
    eyebrow: "Source Federation",
    title: "One corpus across the tools, teams, and languages around the work.",
    description:
      "Oppulence's graph model is built for federation: source-specific context becomes one editable corpus with provenance intact.",
    category: "feature",
    bullets: [
      "Normalize context from communication, documents, and tool events.",
      "Keep source links available for review and correction.",
      "Let teams bring their own model providers and deployment posture.",
    ],
    proof: baseProof,
  },
  {
    path: "self-service-help-widget",
    eyebrow: "Embeddable Widget",
    title: "Put a grounded agent inside your product or internal tool.",
    description:
      "The Oppulence platform includes widget APIs for product-embedded conversations backed by projects, workflows, sources, and tools.",
    category: "feature",
    bullets: [
      "Bootstrap sessions through the widget API.",
      "Route conversations to configured project workflows.",
      "Use RAG and tool calls without rebuilding the agent stack.",
    ],
    proof: baseProof,
  },
  {
    path: "self-updating-help-center",
    eyebrow: "Self-Updating Graph",
    title: "Memory that compounds instead of resetting on every prompt.",
    description:
      "Oppulence's durable graph keeps the important context alive, editable, and ready for the next agent run.",
    category: "feature",
    bullets: [
      "Turn sources into durable notes instead of temporary retrieval results.",
      "Track people, projects, deals, and topics over time.",
      "Use scheduled and evented agents to keep important notes fresh.",
    ],
    proof: baseProof,
  },
  {
    path: "pricing",
    eyebrow: "Pricing",
    title: "Start locally, then scale into self-hosted platform workflows.",
    description:
      "Oppulence is open source. The marketing pricing surface frames the buyer paths for Desktop, Platform, and enterprise deployment discussions.",
    category: "product",
    bullets: [
      "Desktop for individuals who want an owned AI coworker.",
      "Platform for teams embedding grounded agents.",
      "Enterprise for deployment, controls, and integration support.",
    ],
    proof: baseProof,
  },
  {
    path: "tools/docs-debt-quiz",
    eyebrow: "Tool",
    title: "Measure how much of your operating context still lives in people's heads.",
    description:
      "Use the memory debt quiz as a planning artifact for deciding where live notes, source ingestion, and agents should start.",
    category: "tool",
    bullets: [
      "Score sources that are scattered across inboxes, calls, and docs.",
      "Identify workflows where agents lack enough durable context.",
      "Prioritize the first live notes and integrations to configure.",
    ],
    proof: baseProof,
  },
  {
    path: "tools/openapi-validator",
    eyebrow: "Tool",
    title: "Validate tool contracts before agents depend on them.",
    description:
      "This validator route focuses on Oppulence's need for clear MCP, webhook, and API contracts around agent action paths.",
    category: "tool",
    bullets: [
      "Check that tools expose clear inputs, outputs, and failure modes.",
      "Keep agent actions reviewable and auditable.",
      "Use stable contracts across platform and desktop workflows.",
    ],
    proof: baseProof,
  },
  {
    path: "book-a-demo",
    eyebrow: "Demo",
    title: "See how Oppulence turns scattered work into an agent-ready graph.",
    description: "Use this page as the demo request route for the platform marketing site.",
    category: "demo",
    bullets: [
      "Walk through Desktop knowledge graph workflows.",
      "Review platform agent, RAG, and widget deployment paths.",
      "Identify first integrations and success criteria.",
    ],
    proof: baseProof,
  },
  {
    path: "book-a-demo/success",
    eyebrow: "Demo Request",
    title: "Demo request received.",
    description:
      "This static success page keeps the demo flow in place while the form backend is wired separately.",
    category: "demo",
    bullets: [
      "Review the knowledge graph and platform API pages while waiting.",
      "Prepare a few source systems and workflows to discuss.",
      "Bring deployment constraints, model preferences, and tool requirements.",
    ],
    proof: baseProof,
  },
  {
    path: "legal/privacy-policy",
    eyebrow: "Legal",
    title: "Privacy policy",
    description:
      "Oppulence is designed around user-owned data, local-first storage, and explicit tool connections. This page provides the public privacy route expected from the marketing site.",
    category: "legal",
    bullets: [
      "User data should remain portable and inspectable.",
      "External providers are only used when configured by the user or deployment.",
      "Sensitive workflows should preserve review and audit trails.",
    ],
    proof: baseProof,
  },
  {
    path: "legal/terms-of-service",
    eyebrow: "Legal",
    title: "Terms of service",
    description: "This public terms route should be replaced with final legal copy before launch.",
    category: "legal",
    bullets: [
      "Use Oppulence in accordance with configured provider terms.",
      "Review generated content and tool actions before relying on them.",
      "Self-hosted operators own deployment, access, and data-control decisions.",
    ],
    proof: baseProof,
  },
];

const blogSlugs = [
  "14-stunning-zendesk-help-center-examples",
  "ai-documentation-generators-the-ultimate-guide",
  "automated-knowledge-base-the-complete-guide",
  "automatic-documentation-made-easy-for-your-business",
  "best-ai-powered-help-center-software-4-of-the-best",
  "best-api-documentation-tools",
  "best-archbee-alternatives",
  "best-document360-alternatives",
  "best-docusaurus-alternatives",
  "best-free-knowledge-base-software",
  "best-gitbook-alternatives",
  "best-help-center-software",
  "best-help-center-software-for-saas",
  "best-help-scout-alternatives",
  "best-helpdocs-alternatives",
  "best-helpjuice-alternatives",
  "best-intercom-help-center-alternatives",
  "best-it-documentation-software",
  "best-knowledge-base-for-small-teams",
  "best-knowledgeowl-alternatives",
  "best-mintlify-alternatives",
  "best-proprofs-knowledge-base-alternatives",
  "best-software-documentation-tools",
  "best-stonly-alternatives",
  "best-technical-writing-tools",
  "best-zendesk-help-center-alternatives",
  "best-zoho-desk-alternatives",
  "building-embeddable-widgets-with-svelte",
  "documentation-drift",
  "docusaurus-pricing",
  "docusaurus-review",
  "freshdesk-pricing",
  "freshdesk-vs-zendesk-review",
  "giorgas-help-center-examples-ecommerce",
  "gitbook-pricing",
  "gitbook-review",
  "gitbook-vs-mintlify",
  "help-desk-providers",
  "help-documentation-software",
  "help-scout-pricing",
  "helpdocs-pricing",
  "helpdocs-review",
  "helpjuice-pricing",
  "helpjuice-review",
  "how-to-hire-a-technical-writer",
  "how-to-keep-knowledge-base-up-to-date-automatically",
  "how-to-price-your-ai-saas-2-mistakes-we-made",
  "how-to-refresh-out-of-date-help-center",
  "how-to-scale-customer-support",
  "how-to-talk-to-users-without-getting-overwhelmed-my-system",
  "knowledge-base-for-saas-startups",
  "knowledge-base-maintenance-checklist",
  "knowledgeowl-pricing",
  "knowledgeowl-review",
  "mintlify-pricing",
  "mintlify-review",
  "open-source-knowledge-base-software",
  "proprofs-kb-pricing",
  "proprofs-kb-review",
  "saas-self-service-strategies",
  "screenshot-size-for-documentation",
  "technical-writer-interview-questions",
  "technical-writer-job-description-template",
  "user-manual-software",
];

const customerSlugs = [
  "cap",
  "client-portal",
  "gummysearch",
  "isms-copilot",
  "mallow",
  "metricool",
  "pixelflow",
  "rightmessage",
  "seogets",
  "we-are-distributed",
];

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const known: Record<string, string> = {
        ai: "AI",
        api: "API",
        dso: "DSO",
        it: "IT",
        kb: "KB",
        saas: "SaaS",
        seo: "SEO",
        vs: "vs.",
      };
      return known[part] ?? part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export const blogPages: MarketingPage[] = blogSlugs.map((slug) => ({
  path: `blog/${slug}`,
  eyebrow: "Oppulence Blog",
  title: `${titleFromSlug(slug)} through the Oppulence lens`,
  description:
    "An Oppulence-oriented page focused on owned memory, source federation, and agent workflows instead of static documentation software.",
  category: "blog",
  bullets: [
    "What breaks when operational context stays scattered across tools.",
    "How an owned Markdown graph changes the buyer and operator workflow.",
    "Where self-hosted agents, MCP tools, and reviewable actions fit.",
  ],
  proof: baseProof,
  ctaLabel: "Explore the knowledge graph",
  ctaHref: "/ai-help-center",
}));

export const customerPages: MarketingPage[] = customerSlugs.map((slug) => ({
  path: `customers/${slug}`,
  eyebrow: "Customer Story",
  title: `${titleFromSlug(slug)}: a Oppulence-style agent memory story`,
  description:
    "A mapped customer-story route showing how a team could use Oppulence to connect relationship context, internal knowledge, and agent action paths.",
  category: "customer",
  bullets: [
    "Unify source material across conversations, meetings, and project notes.",
    "Create live notes for the people, accounts, and workflows that matter.",
    "Use the platform runtime for embedded or always-on agent workflows.",
  ],
  proof: [
    "Faster brief creation from durable context.",
    "Less manual copy-paste between AI tools.",
    "Owned memory that remains portable.",
  ],
  ctaLabel: "Read platform overview",
  ctaHref: "/api-documentation-software",
}));

export const indexPages: MarketingPage[] = [
  {
    path: "blog",
    eyebrow: "Resources",
    title: "Guides for owned memory, knowledge graphs, and practical agents.",
    description:
      "The blog index collects Oppulence-oriented pages for comparisons, guides, and implementation themes.",
    category: "blog",
    bullets: [
      "Alternatives and comparison pages.",
      "Knowledge-base and documentation strategy.",
      "Agent, API, and widget implementation ideas.",
    ],
    proof: baseProof,
  },
  {
    path: "customers",
    eyebrow: "Customers",
    title: "Stories for teams turning scattered work into agent-ready memory.",
    description:
      "The customer index frames the Oppulence product story: build the graph, keep it alive, and let agents act.",
    category: "customer",
    bullets: [
      "Founders and EAs preparing executive context.",
      "Sales and revenue teams tracking commitments.",
      "Operators who need local-first and portable knowledge.",
    ],
    proof: baseProof,
  },
];

export const marketingPages = [...primaryPages, ...indexPages, ...blogPages, ...customerPages];

export const marketingPaths = marketingPages.map((page) => page.path);

export function getMarketingPage(path: string) {
  return marketingPages.find((page) => page.path === path);
}

export const pricingPlans = [
  {
    name: "Desktop",
    price: "Open source",
    description: "For individuals who want an owned AI coworker on their machine.",
    features: ["Local Markdown vault", "Gmail and Calendar context", "BYO model providers"],
  },
  {
    name: "Platform",
    price: "Self-hosted",
    description: "For teams embedding grounded agents into products and internal tools.",
    features: ["Visual workflow builder", "RAG and widget APIs", "Mongo, Redis, Qdrant stack"],
    recommended: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    description: "For deployment support, connector strategy, and controlled agent rollout.",
    features: ["Integration planning", "Security and rollout support", "Custom workflow design"],
  },
];

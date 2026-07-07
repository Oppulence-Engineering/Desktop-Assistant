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
  heroProof?: string[];
  capabilities?: {
    title: string;
    body: string;
  }[];
  sections: {
    title: string;
    body: string;
  }[];
  workflow: string[];
  useCases?: {
    title: string;
    body: string;
  }[];
  outcomes: string[];
  relatedPages?: LinkItem[];
};

export const featureLinks: LinkItem[] = [
  {
    label: "Living work graph",
    href: "/ai-help-center",
    description: "People, projects, decisions, and commitments in one owned graph",
  },
  {
    label: "Briefs and drafts",
    href: "/ai-documentation-agent",
    description: "Agents write from the graph instead of manual prompt prep",
  },
  {
    label: "Live notes",
    href: "/automated-screenshots-for-docs",
    description: "Notes that refresh when work changes",
  },
  {
    label: "Embedded agents",
    href: "/self-service-help-widget",
    description: "Put graph-backed help inside products and internal tools",
  },
  {
    label: "Workflow design",
    href: "/code-to-docs",
    description: "Model agent roles, tools, handoffs, and simulations",
  },
  {
    label: "Runtime and API",
    href: "/api-documentation-software",
    description: "Self-hosted projects, RAG, widgets, workers, and APIs",
  },
  {
    label: "Source federation",
    href: "/multilingual-knowledge-base",
    description: "Turn communication, meetings, files, and tools into graph context",
  },
  {
    label: "Team memory",
    href: "/internal-knowledge-base",
    description: "Private Markdown memory agents can inspect and update",
  },
  {
    label: "Customer operations",
    href: "/generative-ai-customer-service",
    description: "Support and success agents with relationship history",
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Connect sources for context and tools for action",
  },
  {
    label: "Research capture",
    href: "/chrome-extension-for-documentation",
    description: "Save web context with provenance before agents use it",
  },
];

export const productLinks: LinkItem[] = [
  {
    label: "Product overview",
    href: "/product",
    description: "See how Oppulence turns work traces into an owned graph for agents",
  },
  {
    label: "Runtime and API",
    href: "/api-documentation-software",
    description: "Run graph-backed workflows with projects, RAG, widgets, workers, and APIs",
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Connect inboxes, calendars, meetings, files, tools, and action surfaces",
  },
  {
    label: "Pricing",
    href: "/pricing",
    description: "Pick the plan for your team, deployment model, and graph usage",
  },
  {
    label: "Book a demo",
    href: "/book-a-demo",
    description: "Walk through your sources, workflows, and agent action boundaries",
  },
  {
    label: "Dashboard",
    href: "/app",
    description: "Open the product workspace",
  },
];

export const resourceLinks: LinkItem[] = [
  { label: "Docs", href: "/blog", description: "Guides for graph-backed agents" },
  { label: "Customers", href: "/customers", description: "Early operator stories" },
  {
    label: "Compounding memory",
    href: "/self-updating-help-center",
    description: "Why useful context should update between sessions",
  },
  {
    label: "Runtime API",
    href: "/api-documentation-software",
    description: "Platform surface for graph-backed workflows",
  },
];

export const toolLinks: LinkItem[] = [
  {
    label: "Tool contract validator",
    href: "/tools/openapi-validator",
    description: "Check action contracts before agents depend on them",
  },
  {
    label: "Context debt quiz",
    href: "/tools/docs-debt-quiz",
    description: "Find where important work still lives outside the graph",
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
  "Context stays inspectable before it becomes agent input.",
  "Actions can be drafted, reviewed, or executed behind clear boundaries.",
  "The same graph can power desktop workflows, hosted agents, and embedded surfaces.",
];

export const featureDetails: Record<string, FeatureDetail> = {
  "ai-help-center": {
    summary:
      "Oppulence turns work traces into an owned graph that agents can inspect before they brief, draft, update, or act. The graph is organized around people, projects, companies, decisions, commitments, and open questions instead of static articles.",
    heroProof: [
      "Built from inbox, calendar, meetings, local notes, and connected tools.",
      "Stored as readable context users can inspect and correct.",
      "Used by agents before they generate drafts or propose actions.",
    ],
    sections: [
      {
        title: "Capture work traces",
        body: "Email, meetings, calendar events, files, and tool activity become source material for the graph instead of disappearing into separate apps.",
      },
      {
        title: "Structure real relationships",
        body: "People, projects, accounts, decisions, commitments, and open questions become linked context that agents can retrieve across sessions.",
      },
      {
        title: "Keep provenance visible",
        body: "Users can inspect where context came from, correct stale assumptions, and keep the graph useful without trusting opaque model memory.",
      },
    ],
    workflow: [
      "Connect the sources that create the most important work traces.",
      "Normalize those traces into graph notes and relationships.",
      "Attach source references so claims can be reviewed.",
      "Let agents retrieve graph context before briefing, drafting, or acting.",
    ],
    useCases: [
      {
        title: "Meeting prep",
        body: "See the person, project history, last commitments, and unresolved questions before a call starts.",
      },
      {
        title: "Account continuity",
        body: "Carry relationship context across email threads, meetings, notes, and follow-up work.",
      },
      {
        title: "Agent grounding",
        body: "Give every draft or workflow stable graph context before the model starts writing.",
      },
    ],
    outcomes: [
      "Less repeated context-setting before every AI task.",
      "Portable graph context operators can own and inspect.",
      "Better briefs because relationships and decisions accumulate over time.",
    ],
    relatedPages: [
      { label: "Live notes", href: "/automated-screenshots-for-docs" },
      { label: "Source federation", href: "/multilingual-knowledge-base" },
      { label: "Team memory", href: "/internal-knowledge-base" },
    ],
  },
  "ai-documentation-agent": {
    summary:
      "Oppulence agents start from the living work graph, so briefs and drafts can carry prior decisions, relationship history, source references, and connected-tool context without another round of manual prompt prep.",
    heroProof: [
      "Briefs pull from real relationship and project history.",
      "Drafts keep source context visible for review.",
      "Actions stay separated from generation until the user approves the path.",
    ],
    sections: [
      {
        title: "Brief before the work",
        body: "Agents can assemble people, promises, decisions, emails, and meeting history into a prep document before a call or follow-up.",
      },
      {
        title: "Draft with continuity",
        body: "Replies, summaries, notes, and internal docs can reuse the user's own graph instead of sounding like generic assistant output.",
      },
      {
        title: "Act after review",
        body: "When a draft implies a next step, the workflow can propose a tool action while keeping sensitive execution visible.",
      },
    ],
    workflow: [
      "Pick the person, project, account, or objective.",
      "Retrieve graph context and source references.",
      "Generate the brief, draft, plan, or artifact.",
      "Review any proposed action before it touches another system.",
    ],
    useCases: [
      {
        title: "Executive briefs",
        body: "Prepare for meetings from the latest emails, prior calls, and unresolved commitments.",
      },
      {
        title: "Follow-up drafts",
        body: "Draft replies and recap notes from what actually happened, with the user still in control.",
      },
      {
        title: "Decision support",
        body: "Bring the relevant history into planning instead of hunting through tools mid-task.",
      },
    ],
    outcomes: [
      "Faster meeting prep and follow-up creation.",
      "Drafts that preserve commitments and relationship context.",
      "A safer path from assistant output to real operational action.",
    ],
    relatedPages: [
      { label: "Living work graph", href: "/ai-help-center" },
      { label: "Live notes", href: "/automated-screenshots-for-docs" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  "automated-screenshots-for-docs": {
    summary:
      "Live notes are the way Oppulence keeps the graph current. A note can track a person, account, project, topic, or risk and refresh when a schedule or event says the context may have changed.",
    heroProof: [
      "Track long-lived subjects without starting a new chat.",
      "Refresh from schedules, events, or matching source changes.",
      "Write updates back into the owned graph for future agents.",
    ],
    sections: [
      {
        title: "Scheduled awareness",
        body: "Daily, weekly, or time-windowed refreshes keep important notes alive without relying on a user to remember another check-in.",
      },
      {
        title: "Event-triggered context",
        body: "Incoming emails, calendar changes, webhooks, or platform events can wake the right workflow and update the relevant subject.",
      },
      {
        title: "Graph-backed results",
        body: "The output becomes durable memory for the next brief, draft, or workflow instead of a transient answer in a chat window.",
      },
    ],
    workflow: [
      "Create or select a note for the subject being tracked.",
      "Define the objective and the schedule or event match criteria.",
      "Let the live note gather fresh context and rewrite itself.",
      "Review the updated note and any proposed follow-up actions.",
    ],
    useCases: [
      {
        title: "Deal watching",
        body: "Track the state of a relationship as messages, meetings, and next steps change.",
      },
      {
        title: "Project status",
        body: "Keep project notes aligned with decisions, risks, owners, and open work.",
      },
      {
        title: "Market research",
        body: "Refresh a topic note when new research or connected-source context appears.",
      },
    ],
    outcomes: [
      "Ongoing awareness for deals, projects, relationships, and market topics.",
      "Less manual status-checking across email and meetings.",
      "A clear history of what changed and when.",
    ],
    relatedPages: [
      { label: "Research capture", href: "/chrome-extension-for-documentation" },
      { label: "Compounding memory", href: "/self-updating-help-center" },
      { label: "Briefs and drafts", href: "/ai-documentation-agent" },
    ],
  },
  "self-service-help-widget": {
    summary:
      "The Oppulence widget exposes a graph-backed agent inside a product, portal, or internal tool. It uses configured projects, sources, workflows, and tool boundaries instead of a separate support bot memory.",
    heroProof: [
      "Embed a conversation surface backed by the same project graph.",
      "Route answers and escalations through configured workflows.",
      "Keep action boundaries consistent with the rest of the platform.",
    ],
    sections: [
      {
        title: "Embedded graph access",
        body: "Customers or teammates can ask questions from inside the product while the answer path stays tied to the configured graph.",
      },
      {
        title: "Project-aware routing",
        body: "Sessions can route to the right project, workflow, and source set so answers match the domain instead of a generic assistant.",
      },
      {
        title: "Escalation-ready",
        body: "When an answer is not enough, the same workflow can propose a handoff, draft, ticket, or tool call with review boundaries intact.",
      },
    ],
    workflow: [
      "Create a project with sources, workflows, and tools.",
      "Embed the widget script or iframe in the target surface.",
      "Bootstrap sessions against the widget API.",
      "Route conversations to the right workflow and escalation path.",
    ],
    useCases: [
      {
        title: "In-product help",
        body: "Answer product questions from a graph that can include docs, support context, and known workflows.",
      },
      {
        title: "Internal tools",
        body: "Give operators a focused agent inside the system where they already do the work.",
      },
      {
        title: "Assisted resolution",
        body: "Move from answer to proposed next step when the workflow requires action.",
      },
    ],
    outcomes: [
      "A faster path to product-embedded AI support.",
      "Consistent answers across product and internal operator tools.",
      "Room to grow from Q&A into controlled action workflows.",
    ],
    relatedPages: [
      { label: "Runtime and API", href: "/api-documentation-software" },
      { label: "Customer operations", href: "/generative-ai-customer-service" },
      { label: "Workflow design", href: "/code-to-docs" },
    ],
  },
  "code-to-docs": {
    summary:
      "Oppulence turns technical context into reviewable workflows. Specs, prompts, roles, tool contracts, MCP servers, webhook actions, and simulations become part of the agent system instead of living in disconnected docs.",
    heroProof: [
      "Model roles, handoffs, sources, and tools in one place.",
      "Use contracts before agents call external systems.",
      "Test workflows before exposing them through APIs, widgets, or jobs.",
    ],
    sections: [
      {
        title: "Workflow modeling",
        body: "Define agent responsibilities, handoffs, prompts, tools, and test cases as an operational flow instead of a pile of prompts.",
      },
      {
        title: "Tool contracts",
        body: "MCP servers, webhooks, and API-backed actions can be attached only where inputs, outputs, and failure behavior are explicit enough to review.",
      },
      {
        title: "Simulation before launch",
        body: "Role-played runs help validate behavior before a workflow is exposed through the widget, API, or background execution.",
      },
    ],
    workflow: [
      "Describe the workflow and agent boundaries.",
      "Attach tools, schemas, and source collections.",
      "Run simulated conversations or task scenarios.",
      "Deploy to API, widget, or background execution once the behavior is stable.",
    ],
    useCases: [
      {
        title: "Support workflows",
        body: "Model answer, escalation, and follow-up paths before exposing a customer-facing surface.",
      },
      {
        title: "Ops automation",
        body: "Connect recurring work to tools while keeping review policy explicit.",
      },
      {
        title: "Internal agent systems",
        body: "Reuse the same workflow through desktop, API, widget, or scheduled execution.",
      },
    ],
    outcomes: [
      "Less custom glue code for every new agent.",
      "Clearer review of tool behavior before production use.",
      "Reusable workflows across support, operations, and internal automation.",
    ],
    relatedPages: [
      { label: "Tool contract validator", href: "/tools/openapi-validator" },
      { label: "Runtime and API", href: "/api-documentation-software" },
      { label: "Embedded agents", href: "/self-service-help-widget" },
    ],
  },
  "api-documentation-software": {
    summary:
      "Oppulence exposes the living work graph through a platform runtime: projects, workflows, RAG, widget sessions, workers, and APIs run together for teams that need owned infrastructure instead of a closed assistant.",
    heroProof: [
      "Self-host projects, sources, workflows, and widget sessions.",
      "Run ingestion and jobs outside the request lifecycle.",
      "Keep provider keys, storage, and runtime boundaries under deployment control.",
    ],
    sections: [
      {
        title: "Project and workflow APIs",
        body: "Teams can manage projects, sources, workflows, conversations, test runs, and widget sessions without coupling every integration to the desktop app.",
      },
      {
        title: "Async worker model",
        body: "Ingestion and long-running jobs run outside the request lifecycle, with Mongo, Redis, and Qdrant supporting state, queues, and vector search.",
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
    useCases: [
      {
        title: "Embedded agents",
        body: "Expose graph-backed conversations inside products and internal portals.",
      },
      {
        title: "Background workflows",
        body: "Run scheduled or event-triggered jobs that update context or propose actions.",
      },
      {
        title: "Controlled deployment",
        body: "Match stricter environments with owned storage, queues, vector search, and provider configuration.",
      },
    ],
    outcomes: [
      "A complete starting point for owned agent infrastructure.",
      "Clear separation between request handling and long-running work.",
      "A deployment posture that can match stricter customer environments.",
    ],
    relatedPages: [
      { label: "Workflow design", href: "/code-to-docs" },
      { label: "Embedded agents", href: "/self-service-help-widget" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
  "multilingual-knowledge-base": {
    summary:
      "Oppulence is designed for source federation: communication, documents, meetings, local files, and tool events can become one work graph even when they start in different systems.",
    heroProof: [
      "Unify communication, meetings, files, and tool events.",
      "Keep source links available for review.",
      "Let agents synthesize across tools without copy-paste.",
    ],
    sections: [
      {
        title: "Source-normalized context",
        body: "The graph abstracts over where a fact came from while preserving the original reference for inspection.",
      },
      {
        title: "Cross-tool continuity",
        body: "A project can span Gmail, Calendar, Fireflies, Slack, GitHub, Linear, web search, and custom MCP servers without manual context transfer.",
      },
      {
        title: "Model flexibility",
        body: "Teams can bring hosted or local models and still keep the graph as the stable context layer above provider-specific capabilities.",
      },
    ],
    workflow: [
      "Connect each source system with clear scope.",
      "Map events and documents into the owned graph.",
      "Keep original references attached for review.",
      "Use agents to synthesize across source boundaries.",
    ],
    useCases: [
      {
        title: "Relationship context",
        body: "Connect emails, meetings, and notes around a person or account.",
      },
      {
        title: "Engineering context",
        body: "Bring GitHub, Linear, docs, and discussions into one project memory.",
      },
      {
        title: "Research context",
        body: "Combine captured web material with internal history before agents summarize or act.",
      },
    ],
    outcomes: [
      "Less siloed memory across teams and tools.",
      "Better context for cross-functional workflows.",
      "A more portable knowledge layer than vendor-specific AI memory.",
    ],
    relatedPages: [
      { label: "Integrations", href: "/integrations" },
      { label: "Research capture", href: "/chrome-extension-for-documentation" },
      { label: "Living work graph", href: "/ai-help-center" },
    ],
  },
  "internal-knowledge-base": {
    summary:
      "Oppulence internal memory is private, editable, and operational. It is built for teams that need a graph agents can update and inspect, not another static page library.",
    heroProof: [
      "Store operational context in readable notes.",
      "Make relationships explicit across people, projects, and decisions.",
      "Let workflows refresh notes when facts change.",
    ],
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
    useCases: [
      {
        title: "Team runbooks",
        body: "Keep procedures tied to the decisions, owners, and systems behind them.",
      },
      {
        title: "Account memory",
        body: "Preserve customer context across operators without hiding it in private chats.",
      },
      {
        title: "Incident context",
        body: "Attach people, systems, decisions, and open follow-ups to the same graph.",
      },
    ],
    outcomes: [
      "Internal knowledge that stays closer to the actual work.",
      "A safer way for agents to rely on team-specific context.",
      "Fewer hidden assumptions trapped in chat transcripts or private inboxes.",
    ],
    relatedPages: [
      { label: "Living work graph", href: "/ai-help-center" },
      { label: "Live notes", href: "/automated-screenshots-for-docs" },
      { label: "Source federation", href: "/multilingual-knowledge-base" },
    ],
  },
  "generative-ai-customer-service": {
    summary:
      "Oppulence customer-facing agents can answer from relationship history, product context, support knowledge, and controlled action paths instead of only static help docs.",
    heroProof: [
      "Use customer and product history before answering.",
      "Escalate into drafts, tickets, or handoffs when needed.",
      "Keep sensitive actions inside review boundaries.",
    ],
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
    useCases: [
      {
        title: "Support answers",
        body: "Answer from product and customer context without losing the relationship history.",
      },
      {
        title: "Success follow-up",
        body: "Draft the next message or task using commitments from prior conversations.",
      },
      {
        title: "Operational escalation",
        body: "Propose a ticket, handoff, or tool call when the answer is not enough.",
      },
    ],
    outcomes: [
      "More grounded customer answers.",
      "Less context switching for support and success teams.",
      "A path from assistance to safe operational automation.",
    ],
    relatedPages: [
      { label: "Embedded agents", href: "/self-service-help-widget" },
      { label: "Support memory", href: "/help-center-software" },
      { label: "Workflow design", href: "/code-to-docs" },
    ],
  },
  integrations: {
    summary:
      "Oppulence integrations are both the intake layer and the action layer for the living work graph. Sources feed durable context; MCP and API tools give agents controlled ways to act.",
    heroProof: [
      "Connect high-value sources before adding action tools.",
      "Preserve source visibility as context becomes graph memory.",
      "Use MCP and APIs for controlled execution paths.",
    ],
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
    useCases: [
      {
        title: "Context intake",
        body: "Bring inbox, calendar, meeting, file, and tool context into the graph.",
      },
      {
        title: "Action targets",
        body: "Attach tools only where the workflow and review boundary are clear.",
      },
      {
        title: "Custom systems",
        body: "Use MCP or API-backed tools when first-party integrations do not cover the work.",
      },
    ],
    outcomes: [
      "A practical path from read-only context to controlled execution.",
      "Fewer one-off integrations for each agent workflow.",
      "A clearer boundary between source ingestion and external action.",
    ],
    relatedPages: [
      { label: "Source federation", href: "/multilingual-knowledge-base" },
      { label: "Runtime and API", href: "/api-documentation-software" },
      { label: "Tool contract validator", href: "/tools/openapi-validator" },
    ],
  },
  "chrome-extension-for-documentation": {
    summary:
      "Oppulence browser context capture helps users bring useful web material into the graph without losing where it came from or why it mattered.",
    heroProof: [
      "Capture research while it is still fresh.",
      "Attach web context to people, projects, accounts, or topics.",
      "Keep provenance visible for later synthesis.",
    ],
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
    useCases: [
      {
        title: "Competitive research",
        body: "Attach web findings to a topic note that can keep tracking the market.",
      },
      {
        title: "Customer research",
        body: "Save company or account context before a meeting, follow-up, or support workflow.",
      },
      {
        title: "Technical references",
        body: "Bring relevant docs or examples into the graph with their source trail intact.",
      },
    ],
    outcomes: [
      "Research that becomes reusable operational memory.",
      "Less source ambiguity in generated summaries.",
      "A smoother path from web discovery to agent action.",
    ],
    relatedPages: [
      { label: "Live notes", href: "/automated-screenshots-for-docs" },
      { label: "Source federation", href: "/multilingual-knowledge-base" },
      { label: "Living work graph", href: "/ai-help-center" },
    ],
  },
  "ai-faq-generator": {
    summary:
      "Oppulence turns repeated answers into living operational artifacts. A recurring explanation can become a source-linked note, a runbook, or a live workflow that keeps improving.",
    heroProof: [
      "Promote repeated answers into graph notes.",
      "Keep generated artifacts editable and source-linked.",
      "Refresh high-change answers through live notes.",
    ],
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
    useCases: [
      {
        title: "Support runbooks",
        body: "Turn repeated support explanations into source-linked internal artifacts.",
      },
      {
        title: "Team FAQs",
        body: "Move recurring internal questions out of chat history and into maintained memory.",
      },
      {
        title: "Policy answers",
        body: "Refresh answers when the underlying project, customer, or policy context changes.",
      },
    ],
    outcomes: [
      "Less duplicate explanation work.",
      "Reusable answers that remain inspectable.",
      "A bridge from Q&A to maintained operational memory.",
    ],
    relatedPages: [
      { label: "Team memory", href: "/internal-knowledge-base" },
      { label: "Compounding memory", href: "/self-updating-help-center" },
      { label: "Support memory", href: "/help-center-software" },
    ],
  },
  "help-center-software": {
    summary:
      "Oppulence reframes help-center software as graph-backed operations infrastructure. The published answer is one output of a living graph that can also brief operators, power widgets, and trigger workflows.",
    heroProof: [
      "Start from the graph, not the article surface.",
      "Use the same memory for customer and operator workflows.",
      "Move from answer to next action when the process requires it.",
    ],
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
      "Model the living work graph before designing the public article surface.",
      "Connect support sources, product docs, and internal runbooks.",
      "Expose customer-facing and operator-facing views.",
      "Add tool actions once policies and review boundaries are clear.",
    ],
    useCases: [
      {
        title: "Self-service support",
        body: "Answer customer questions from a graph that can include docs and operational context.",
      },
      {
        title: "Operator assist",
        body: "Help support teams understand the customer, issue, and next step in one place.",
      },
      {
        title: "Workflow handoff",
        body: "Draft or route the follow-up instead of ending at a static answer.",
      },
    ],
    outcomes: [
      "Answers that improve as the operating graph improves.",
      "Less duplication between customer docs and internal runbooks.",
      "A path from self-service to assisted resolution.",
    ],
    relatedPages: [
      { label: "Embedded agents", href: "/self-service-help-widget" },
      { label: "Customer operations", href: "/generative-ai-customer-service" },
      { label: "Runtime and API", href: "/api-documentation-software" },
    ],
  },
  "self-updating-help-center": {
    summary:
      "Oppulence memory compounds because important notes can update between user sessions. That makes the graph useful for long-running relationships, projects, and operational risks.",
    heroProof: [
      "Track subjects that matter longer than one chat.",
      "Refresh notes from schedules and source changes.",
      "Give future agents fresher context before they start.",
    ],
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
    useCases: [
      {
        title: "Relationship tracking",
        body: "Keep the state of a person, account, or deal current as new work happens.",
      },
      {
        title: "Project memory",
        body: "Refresh owners, decisions, risks, and open questions as a project evolves.",
      },
      {
        title: "Operational watchlists",
        body: "Track topics or risks without remembering to ask for another summary.",
      },
    ],
    outcomes: [
      "Less stale context around high-value work.",
      "A graph that improves between user sessions.",
      "Better long-horizon agent performance.",
    ],
    relatedPages: [
      { label: "Live notes", href: "/automated-screenshots-for-docs" },
      { label: "Living work graph", href: "/ai-help-center" },
      { label: "Briefs and drafts", href: "/ai-documentation-agent" },
    ],
  },
};

export const primaryPages: MarketingPage[] = [
  {
    path: "product",
    eyebrow: "Product",
    title: "One living work graph for every agent workflow.",
    description:
      "Oppulence connects email, calendar, meetings, files, and tools into an owned graph that agents can inspect before they brief, draft, update, or act.",
    category: "product",
    bullets: [
      "Build durable context around people, projects, decisions, commitments, and open questions.",
      "Let agents use the same graph from desktop workflows, embedded surfaces, APIs, and background jobs.",
      "Keep sources inspectable and external actions reviewable before work leaves the system.",
    ],
    proof: baseProof,
    ctaLabel: "Book a demo",
    ctaHref: "/book-a-demo",
  },
  {
    path: "ai-documentation-agent",
    eyebrow: "Briefs and Drafts",
    title: "Brief, draft, and decide from the same living work graph.",
    description:
      "Oppulence agents start with the people, projects, decisions, and commitments already in your graph, so every brief or draft has the context that usually gets pasted by hand.",
    category: "feature",
    bullets: [
      "Build meeting prep from recent emails, calendar history, notes, and commitments.",
      "Draft replies and summaries with the relevant relationship context in view.",
      "Separate generation from external action until the user reviews the next step.",
    ],
    proof: baseProof,
    ctaLabel: "Book a demo",
  },
  {
    path: "ai-faq-generator",
    eyebrow: "Reusable Answers",
    title: "Turn repeated answers into living notes and runbooks.",
    description:
      "Oppulence helps recurring explanations become source-linked graph artifacts, so the next agent or operator can reuse them instead of starting from another chat transcript.",
    category: "feature",
    bullets: [
      "Capture recurring answers as editable graph notes.",
      "Keep runbooks tied to source context, owners, and decisions.",
      "Promote high-change answers into live notes that refresh over time.",
    ],
    proof: baseProof,
    ctaLabel: "Explore the graph",
    ctaHref: "/ai-help-center",
  },
  {
    path: "ai-help-center",
    eyebrow: "Living Work Graph",
    title: "The living work graph for people, projects, decisions, and commitments.",
    description:
      "Oppulence turns the traces of work across inboxes, calendars, meetings, files, and tools into an owned graph agents can inspect before they answer or act.",
    category: "feature",
    bullets: [
      "Create durable context around people, projects, companies, decisions, and open questions.",
      "Keep source trails visible so context can be checked and corrected.",
      "Use the same graph from desktop workflows, platform agents, and embedded surfaces.",
    ],
    proof: baseProof,
    ctaLabel: "Create the graph",
  },
  {
    path: "api-documentation-software",
    eyebrow: "Runtime and API",
    title: "Ship agents on the same graph your team can inspect.",
    description:
      "The Oppulence platform hosts projects, workflows, RAG, widgets, workers, and APIs for teams that need graph-backed agents inside products or internal tools.",
    category: "product",
    bullets: [
      "Self-host the project, source, workflow, and widget runtime.",
      "Run ingestion and background jobs outside request lifecycles.",
      "Keep model providers, storage, and integration boundaries deployment-owned.",
    ],
    proof: baseProof,
    ctaLabel: "Plan a rollout",
  },
  {
    path: "automated-screenshots-for-docs",
    eyebrow: "Live Notes",
    title: "Notes that update when work changes.",
    description:
      "Live notes keep the graph current by tracking people, deals, projects, topics, and risks on schedules or events.",
    category: "feature",
    bullets: [
      "Refresh high-value notes daily, weekly, or on a defined time window.",
      "Wake workflows from matching emails, calendar changes, webhooks, or source events.",
      "Write updates back into durable graph memory for future agents.",
    ],
    proof: baseProof,
    ctaLabel: "See live notes",
  },
  {
    path: "chrome-extension-for-documentation",
    eyebrow: "Research Capture",
    title: "Bring web research into the graph with its source trail intact.",
    description:
      "Oppulence treats external research as source material for the work graph, not disposable browsing context.",
    category: "feature",
    bullets: [
      "Attach web findings to projects, people, accounts, and topics.",
      "Keep provenance attached before agents summarize or reuse the material.",
      "Seed live research notes that can refresh as the topic changes.",
    ],
    proof: baseProof,
    ctaLabel: "Capture research",
  },
  {
    path: "code-to-docs",
    eyebrow: "Workflow Design",
    title: "Turn roles, tools, and contracts into reviewable agent workflows.",
    description:
      "Oppulence gives teams a place to model prompts, handoffs, tools, simulations, and action boundaries before agents run in a product or process.",
    category: "feature",
    bullets: [
      "Model agent roles, prompts, handoffs, source access, and tools.",
      "Attach MCP servers, API actions, and signed webhooks where contracts are clear.",
      "Test behavior before exposing workflows through widgets, APIs, or jobs.",
    ],
    proof: baseProof,
    ctaLabel: "Design a workflow",
  },
  {
    path: "generative-ai-customer-service",
    eyebrow: "Customer Operations",
    title: "Give customer agents the history behind every answer.",
    description:
      "Support and success workflows can answer with relationship history, product context, source-backed memory, and reviewable escalation paths.",
    category: "feature",
    bullets: [
      "Answer from docs, customer context, email, meetings, and connected systems.",
      "Draft follow-ups, tickets, or handoffs when an answer is not enough.",
      "Keep sensitive actions gated by explicit review boundaries.",
    ],
    proof: baseProof,
    ctaLabel: "Map a customer workflow",
  },
  {
    path: "help-center-software",
    eyebrow: "Support Memory",
    title: "A help surface is only useful when the memory behind it stays alive.",
    description:
      "Oppulence starts below the help center: the source-linked graph that powers customer answers, operator briefs, and controlled follow-up workflows.",
    category: "product",
    bullets: [
      "Back customer-facing answers with owned documents and synced operational context.",
      "Use the same graph for product widgets and internal operator workflows.",
      "Move from self-service answers to assisted resolution when the process needs action.",
    ],
    proof: baseProof,
    ctaLabel: "Explore support memory",
  },
  {
    path: "integrations",
    eyebrow: "Integrations",
    title: "Connect the systems that create context and carry out actions.",
    description:
      "Oppulence builds the graph from Gmail, Calendar, meetings, files, Slack, GitHub, Linear, web search, and tools exposed through MCP or APIs.",
    category: "product",
    bullets: [
      "Use communication and meeting sources for relationship and decision context.",
      "Use operational systems as both context sources and controlled action targets.",
      "Extend with MCP and API-backed tools where first-party integrations stop.",
    ],
    proof: [
      "Provider keys stay user-controlled.",
      "External tool execution can stay reviewable.",
      "Platform workers support ingestion and long-running jobs.",
    ],
    ctaLabel: "Connect sources",
  },
  {
    path: "internal-knowledge-base",
    eyebrow: "Team Memory",
    title: "Private team memory that agents can inspect and update.",
    description:
      "Oppulence keeps operational knowledge in transparent notes and graph relationships instead of opaque model memory or scattered SaaS search results.",
    category: "feature",
    bullets: [
      "Store important context in readable, portable notes.",
      "Make relationships explicit across people, projects, decisions, incidents, and policies.",
      "Let workflows refresh high-change notes as new context arrives.",
    ],
    proof: baseProof,
    ctaLabel: "Build team memory",
  },
  {
    path: "lp/ai-help-center",
    eyebrow: "Living Work Graph",
    title: "Launch graph-backed agents without renting your context layer.",
    description:
      "Oppulence gives teams an owned context layer for agents: source-fed, inspectable, and ready for workflows that need more than a prompt.",
    category: "landing",
    bullets: [
      "Start with the living work graph.",
      "Expose graph-backed answers through widgets, API, or desktop workflows.",
      "Scale into live notes, triggers, and controlled tool actions.",
    ],
    proof: baseProof,
    ctaLabel: "Book a demo",
  },
  {
    path: "multilingual-knowledge-base",
    eyebrow: "Source Federation",
    title: "One graph across the tools and teams around the work.",
    description:
      "Oppulence federates communication, documents, meetings, files, and tool events into one editable graph with provenance intact.",
    category: "feature",
    bullets: [
      "Normalize context from communication, documents, meetings, and tool events.",
      "Keep original references available for review and correction.",
      "Let agents synthesize across source boundaries without manual copy-paste.",
    ],
    proof: baseProof,
    ctaLabel: "Federate sources",
  },
  {
    path: "self-service-help-widget",
    eyebrow: "Embedded Agents",
    title: "Put graph-backed help inside your product or internal tool.",
    description:
      "The Oppulence widget lets product and operations teams expose conversations backed by configured projects, sources, workflows, and tool boundaries.",
    category: "feature",
    bullets: [
      "Bootstrap sessions through the widget API.",
      "Route conversations to the right graph, workflow, and escalation path.",
      "Use RAG and tool calls without rebuilding the agent stack.",
    ],
    proof: baseProof,
    ctaLabel: "Embed an agent",
  },
  {
    path: "self-updating-help-center",
    eyebrow: "Compounding Memory",
    title: "Context that improves between sessions instead of resetting on every prompt.",
    description:
      "Oppulence keeps important subjects alive through live notes and source-fed updates, so future agents start from fresher context.",
    category: "feature",
    bullets: [
      "Track people, projects, deals, topics, and risks over time.",
      "Refresh notes from schedules, events, and source changes.",
      "Use the updated graph in future briefs, drafts, and workflows.",
    ],
    proof: baseProof,
    ctaLabel: "See compounding memory",
  },
  {
    path: "pricing",
    eyebrow: "Pricing",
    title: "Start with owned context. Scale into agents when the graph is useful.",
    description:
      "Oppulence is open source. Start with the desktop graph, then move into self-hosted workflows, widgets, and deployment support when the use case is clear.",
    category: "product",
    bullets: [
      "Desktop for individuals building an owned work graph.",
      "Platform for teams exposing graph-backed agents through APIs and widgets.",
      "Enterprise for deployment controls, rollout planning, and integration support.",
    ],
    proof: baseProof,
  },
  {
    path: "tools/docs-debt-quiz",
    eyebrow: "Tool",
    title: "Find the context debt blocking useful agents.",
    description:
      "Use the context debt quiz to decide which sources, notes, and workflows should enter the graph first.",
    category: "tool",
    bullets: [
      "Score the work traces scattered across inboxes, calls, docs, and tools.",
      "Identify where agents lack enough durable context to be useful.",
      "Prioritize the first sources, live notes, and integrations to configure.",
    ],
    proof: baseProof,
    ctaLabel: "Start the quiz",
  },
  {
    path: "tools/openapi-validator",
    eyebrow: "Tool",
    title: "Validate action contracts before agents depend on them.",
    description:
      "This validator route frames the need for clear MCP, webhook, and API contracts around reviewable agent action paths.",
    category: "tool",
    bullets: [
      "Check that tools expose clear inputs, outputs, and failure modes.",
      "Keep action paths reviewable before agents call external systems.",
      "Use stable contracts across platform and desktop workflows.",
    ],
    proof: baseProof,
    ctaLabel: "Validate a contract",
  },
  {
    path: "book-a-demo",
    eyebrow: "Demo",
    title: "See how Oppulence turns scattered work into a living graph.",
    description:
      "Use this page to plan a demo around your sources, graph shape, workflows, and review boundaries.",
    category: "demo",
    bullets: [
      "Map the sources that should feed the graph first.",
      "Review desktop, platform, widget, and live-note workflows.",
      "Identify review boundaries before agents act through tools.",
    ],
    proof: baseProof,
    ctaLabel: "Submit request",
  },
  {
    path: "book-a-demo/success",
    eyebrow: "Demo Request",
    title: "Demo request received.",
    description:
      "This static success page keeps the demo flow in place while the request backend is wired separately.",
    category: "demo",
    bullets: [
      "Review the living work graph and runtime pages while waiting.",
      "Prepare the source systems and workflows worth mapping first.",
      "Bring deployment constraints, model preferences, and tool requirements.",
    ],
    proof: baseProof,
  },
  {
    path: "legal/privacy-policy",
    eyebrow: "Legal",
    title: "Privacy policy",
    description:
      "Oppulence is designed around user-owned context, local-first storage, and explicit tool connections. This page provides the public privacy route expected from the marketing site.",
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

// No customer stories yet — we won't ship fabricated testimonials. Add real slugs here
// once there are real stories to tell.
const customerSlugs: string[] = [];

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
  title: `${titleFromSlug(slug)} through the living work graph lens`,
  description:
    "An Oppulence-oriented guide about moving from static knowledge and scattered work traces to an owned graph agents can inspect and use.",
  category: "blog",
  bullets: [
    "What breaks when work context stays scattered across tools.",
    "How a living graph changes the operator and buyer workflow.",
    "Where widgets, MCP tools, live notes, and reviewable actions fit.",
  ],
  proof: baseProof,
  ctaLabel: "Explore the graph",
  ctaHref: "/ai-help-center",
}));

export const customerPages: MarketingPage[] = customerSlugs.map((slug) => ({
  path: `customers/${slug}`,
  eyebrow: "Customer Story",
  title: `${titleFromSlug(slug)}: a living work graph story`,
  description:
    "A mapped customer-story route showing how a team could use Oppulence to connect relationship context, internal memory, and reviewable action paths.",
  category: "customer",
  bullets: [
    "Unify source material across conversations, meetings, and project notes.",
    "Create live notes for the people, accounts, and workflows that change often.",
    "Use the platform runtime for embedded or background agent workflows.",
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
    title: "Guides for living work graphs and practical agents.",
    description:
      "The blog index collects Oppulence-oriented pages about owned context, source federation, live notes, and agent workflows.",
    category: "blog",
    bullets: [
      "Alternatives and comparison pages.",
      "Knowledge-base and context strategy.",
      "Agent, API, widget, and integration implementation ideas.",
    ],
    proof: baseProof,
  },
  {
    path: "customers",
    eyebrow: "Customers",
    title: "Customer stories are on the way.",
    description:
      "Oppulence is early. We're working with our first operators and teams now. Real stories will land here when there is something concrete to show.",
    category: "customer",
    bullets: [
      "Founders and EAs preparing executive context.",
      "Sales and revenue teams tracking commitments.",
      "Operators who want owned, inspectable work memory.",
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
    description: "For individuals building a private living graph of their own work.",
    features: ["Local Markdown graph", "Gmail and Calendar context", "BYO model providers"],
  },
  {
    name: "Platform",
    price: "Self-hosted",
    description: "For teams exposing graph-backed agents through products and internal tools.",
    features: ["Workflow builder", "RAG and widget APIs", "Mongo, Redis, Qdrant stack"],
    recommended: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    description: "For deployment support, connector strategy, and controlled graph rollout.",
    features: ["Integration planning", "Security and rollout support", "Custom workflow design"],
  },
];

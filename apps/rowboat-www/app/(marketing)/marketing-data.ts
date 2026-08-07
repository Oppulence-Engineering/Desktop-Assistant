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
    label: "Relationship State Engine",
    href: "/ai-help-center",
    description: "Find missed commitments and warm opportunities in the last 60–90 days",
  },
  {
    label: "Account Mission Control",
    href: "/ai-documentation-agent",
    description: "See who needs attention, why now, and the recommended next move",
  },
  {
    label: "Research and verification",
    href: "/automated-screenshots-for-docs",
    description: "Confirm account context, current roles, and contactability",
  },
  {
    label: "Policy and sender protection",
    href: "/integrations",
    description: "Check suppression, frequency, permissions, and sender health",
  },
  {
    label: "Relationship memory",
    href: "/internal-knowledge-base",
    description: "Preserve promises, objections, evidence, and outcomes over time",
  },
  {
    label: "Closed-loop learning",
    href: "/self-updating-help-center",
    description: "Use replies, meetings, edits, and revenue outcomes to improve the next action",
  },
  {
    label: "Connected revenue systems",
    href: "/multilingual-knowledge-base",
    description: "Unify email, calendar, meetings, CRM, research, and execution",
  },
  {
    label: "Meeting intelligence",
    href: "/generative-ai-customer-service",
    description: "Carry the relationship forward before and after every meeting",
  },
  {
    label: "Governed execution",
    href: "/code-to-docs",
    description: "Keep approval and audit boundaries around every material action",
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Connect memory, research, policy, CRM, and sending systems",
  },
  {
    label: "Source evidence",
    href: "/chrome-extension-for-documentation",
    description: "Keep every recommendation tied to the evidence behind it",
  },
];

export const productLinks: LinkItem[] = [
  {
    label: "Relationship intelligence",
    href: "/product",
    description: "See how living relationship state becomes evidence-backed action",
  },
  {
    label: "Account Mission Control",
    href: "/api-documentation-software",
    description: "Prioritize, verify, govern, approve, execute, and learn in one queue",
  },
  {
    label: "Integrations",
    href: "/integrations",
    description: "Connect email, calendar, meetings, CRM, research, verification, and sending",
  },
  {
    label: "Pricing",
    href: "/pricing",
    description: "Choose the plan for monitored relationships, team access, and governance",
  },
  {
    label: "Book a relationship review",
    href: "/book-a-demo",
    description: "Find the warm revenue slipping through your existing relationships",
  },
  {
    label: "Dashboard",
    href: "/app",
    description: "Open account mission control",
  },
];

export const resourceLinks: LinkItem[] = [
  { label: "Guides", href: "/blog", description: "Revenue memory and governed execution guides" },
  { label: "Customers", href: "/customers", description: "Early operator stories" },
  {
    label: "Relationship memory",
    href: "/self-updating-help-center",
    description: "Why commercial context should compound across every interaction",
  },
  {
    label: "Governed execution",
    href: "/api-documentation-software",
    description: "Approval, policy, action, and outcome workflows",
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
    label: "Discord",
    href: "https://discord.gg/wajrgmJQ6b",
    external: true,
  },
];

const baseProof = [
  "Every recommendation includes a reason and source evidence.",
  "Verification, policy, approval, and execution remain clear boundaries.",
  "Replies, meetings, edits, and revenue outcomes improve future actions.",
];

export const featureDetails: Record<string, FeatureDetail> = {
  "ai-help-center": {
    summary:
      "The Revenue Leak Scan reviews recent communication, meetings, calendar, and CRM history to find valuable commercial relationships that have gone quiet or lost their next step.",
    heroProof: [
      "Scans the previous 60–90 days of commercial history.",
      "Ranks missed commitments and warm opportunities by value and urgency.",
      "Explains every finding with source evidence.",
    ],
    sections: [
      {
        title: "Recover the missed promise",
        body: "Find follow-ups that were promised, proposals that went unanswered, and conversations that lost their next step.",
      },
      {
        title: "Reopen the warm relationship",
        body: "Surface dormant champions, former customers, neglected referrals, and accounts with a real reason to reconnect now.",
      },
      {
        title: "Show the evidence",
        body: "Keep the email, meeting, calendar event, CRM record, and extracted commitment attached to every recommendation.",
      },
    ],
    workflow: [
      "Connect email, calendar, meetings, and CRM history.",
      "Scan the previous 60–90 days for commercial open loops.",
      "Rank findings by relationship value, urgency, and confidence.",
      "Move the best findings into the revenue action queue.",
    ],
    useCases: [
      {
        title: "Unanswered proposals",
        body: "Find proposals and commercial asks that never received a clear response or next step.",
      },
      {
        title: "Dormant champions",
        body: "Reconnect when the timing, role, budget cycle, or relationship history creates a credible reason to reach out.",
      },
      {
        title: "Missed commitments",
        body: "Catch promises such as “contact me again in July” before they disappear into old threads and meeting notes.",
      },
    ],
    outcomes: [
      "More warm opportunities recovered before they go cold.",
      "A clear source trail behind every recommended action.",
      "A useful first queue without mass cold outbound.",
    ],
    relatedPages: [
      { label: "Revenue Action Queue", href: "/ai-documentation-agent" },
      { label: "Research and verification", href: "/automated-screenshots-for-docs" },
      { label: "Relationship memory", href: "/internal-knowledge-base" },
    ],
  },
  "ai-documentation-agent": {
    summary:
      "The Revenue Action Queue turns relationship history into a short, ranked list of who needs attention, why now, and the safest recommended next move.",
    heroProof: [
      "Ranked by relationship value, timing, and evidence.",
      "Prior objections and commitments stay visible beside the draft.",
      "Every action can be approved, edited, snoozed, or rejected.",
    ],
    sections: [
      {
        title: "Explain why now",
        body: "Show the promise, opportunity, relationship history, and timing signal that caused an action to enter the queue.",
      },
      {
        title: "Prepare the next move",
        body: "Draft from the evidence, prior objections, account context, and the user’s actual relationship instead of generic personalization.",
      },
      {
        title: "Keep the human boundary",
        body: "Approve, edit, snooze, or reject high-value actions before execution, with the decision retained in the audit trail.",
      },
    ],
    workflow: [
      "Detect a missed commitment or warm opportunity.",
      "Assemble the relationship history and source evidence.",
      "Research, verify, and run policy checks.",
      "Approve, edit, snooze, or reject the proposed action.",
    ],
    useCases: [
      {
        title: "Daily top ten",
        body: "Start with the ten relationships most likely to recover or advance revenue instead of another unranked inbox.",
      },
      {
        title: "Evidence-backed follow-up",
        body: "Prepare a message that reflects what actually happened, what was promised, and why the timing is credible now.",
      },
      {
        title: "Safe review",
        body: "Keep verification, policy status, sender health, and approval state visible before execution.",
      },
    ],
    outcomes: [
      "Less time reconstructing deal context across tools.",
      "More high-value follow-ups completed at the right moment.",
      "A governed path from recommendation to execution and outcome.",
    ],
    relatedPages: [
      { label: "Revenue Leak Scan", href: "/ai-help-center" },
      { label: "Research and verification", href: "/automated-screenshots-for-docs" },
      { label: "Policy and sender protection", href: "/integrations" },
    ],
  },
  "automated-screenshots-for-docs": {
    summary:
      "Oppulence researches the account, verifies the contact’s current role and address, and keeps the supporting evidence attached before a recommendation becomes an external action.",
    heroProof: [
      "Current account and contact research with source provenance.",
      "Role, address, and contactability verification before drafting.",
      "Verified facts written back into relationship memory.",
    ],
    sections: [
      {
        title: "Research the account",
        body: "Gather current company, role, and commercial context with the source trail preserved for review.",
      },
      {
        title: "Verify the contact",
        body: "Confirm the person’s current role, reachable address, and contactability before the system prepares a message.",
      },
      {
        title: "Preserve the evidence",
        body: "Keep verified facts and sources beside the proposed action and write durable updates back into the relationship memory.",
      },
    ],
    workflow: [
      "Start from a relationship selected by the Revenue Leak Scan.",
      "Research the account and current contact role.",
      "Verify the address and attach evidence to each material claim.",
      "Pass the verified action into policy and approval review.",
    ],
    useCases: [
      {
        title: "Role-change recovery",
        body: "Detect when a former champion moved companies or a contact is no longer in the role stored in the CRM.",
      },
      {
        title: "Dormant-account refresh",
        body: "Bring current account context into an old relationship before deciding whether the timing is credible.",
      },
      {
        title: "Contactability check",
        body: "Avoid wasting an important follow-up on an invalid address, stale role, or unverifiable identity.",
      },
    ],
    outcomes: [
      "Fewer actions prepared for stale or incorrect contacts.",
      "More credible follow-ups backed by current account context.",
      "A durable evidence trail for every verified fact.",
    ],
    relatedPages: [
      { label: "Revenue Leak Scan", href: "/ai-help-center" },
      { label: "Revenue Action Queue", href: "/ai-documentation-agent" },
      { label: "Policy and sender protection", href: "/integrations" },
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
      "Oppulence connects the systems that remember the relationship with the systems that research, verify, govern, execute, and measure the next action.",
    heroProof: [
      "One customer-facing queue across separately owned systems.",
      "Clear source, policy, permission, and action boundaries.",
      "Replies, meetings, delivery telemetry, and CRM outcomes close the loop.",
    ],
    sections: [
      {
        title: "Remember the relationship",
        body: "Email, calendar, meetings, and CRM history provide the promises, objections, timing, and opportunity context behind each recommendation.",
      },
      {
        title: "Verify and govern",
        body: "Research, contact verification, suppression, frequency limits, permissions, and sender health determine whether an action can proceed.",
      },
      {
        title: "Execute and learn",
        body: "Approved actions move through connected channels while replies, meetings, CRM changes, delivery telemetry, and revenue outcomes update the memory.",
      },
    ],
    workflow: [
      "Connect email, calendar, meetings, and CRM history once.",
      "Attach research and verification to the proposed action.",
      "Apply policy, sender, permission, and approval checks.",
      "Return execution telemetry and revenue outcomes to relationship memory.",
    ],
    useCases: [
      {
        title: "Relationship sources",
        body: "Bring communication, meeting, calendar, and CRM history into one commercial timeline.",
      },
      {
        title: "Governance systems",
        body: "Connect verification, suppression, permissions, frequency policy, and sender-health checks before action.",
      },
      {
        title: "Execution and outcomes",
        body: "Use approved sending and CRM actions, then ingest replies, meetings, delivery results, and opportunity changes.",
      },
    ],
    outcomes: [
      "One governed revenue loop instead of disconnected dashboards.",
      "A clear ownership boundary around every system and decision.",
      "Relationship memory that improves from real commercial outcomes.",
    ],
    relatedPages: [
      { label: "Revenue Leak Scan", href: "/ai-help-center" },
      { label: "Governed execution", href: "/api-documentation-software" },
      { label: "Revenue Action Queue", href: "/ai-documentation-agent" },
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
    title: "Relationship memory that turns into action.",
    description:
      "Oppulence remembers what was promised, what changed, and what happened next across every commercial relationship. It finds the open loops that put revenue at risk and prepares the next move for approval.",
    category: "product",
    bullets: [
      "Build a living ledger of promises, objections, chases, and outcomes from the systems you already use.",
      "Rank the relationships that need attention by timing, evidence, value, and risk.",
      "Approve the next action and let replies, meetings, edits, and revenue outcomes improve the memory.",
    ],
    proof: baseProof,
    ctaLabel: "Book a Revenue Leak Scan",
    ctaHref: "/book-a-demo",
  },
  {
    path: "ai-documentation-agent",
    eyebrow: "Revenue Action Queue",
    title: "Know who needs attention, why now, and what to do next.",
    description:
      "Oppulence ranks the ten highest-value actions across warm prospects, dormant opportunities, former customers, and missed commitments, with source evidence attached.",
    category: "feature",
    bullets: [
      "See the relationship history, promise, objection, and opportunity behind every recommendation.",
      "Review an evidence-backed draft instead of reconstructing context from scratch.",
      "Approve, edit, snooze, or reject before anything leaves the system.",
    ],
    proof: baseProof,
    ctaLabel: "See the action queue",
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
    eyebrow: "Revenue Leak Scan",
    title: "Find the warm revenue already hiding in your history.",
    description:
      "Scan the previous 60–90 days across communication, meetings, calendar, and CRM history for missed commitments and neglected commercial relationships.",
    category: "feature",
    bullets: [
      "Surface unanswered proposals, dormant champions, former customers, and neglected referrals.",
      "Explain why each opportunity matters now with source evidence attached.",
      "Turn the best findings into a short, ranked revenue action queue.",
    ],
    proof: baseProof,
    ctaLabel: "Book a Revenue Leak Scan",
  },
  {
    path: "api-documentation-software",
    eyebrow: "Governed Execution",
    title: "Move from recommendation to action without losing control.",
    description:
      "Oppulence separates memory, research, policy, approval, execution, and outcomes so every external action remains explainable and auditable.",
    category: "product",
    bullets: [
      "Apply verification, suppression, frequency, permission, and sender-health rules.",
      "Require approval for high-value or high-risk communications.",
      "Record the rationale, policy decision, edit history, execution result, and outcome.",
    ],
    proof: baseProof,
    ctaLabel: "Plan governed execution",
  },
  {
    path: "automated-screenshots-for-docs",
    eyebrow: "Research and Verification",
    title: "Verify the relationship before preparing the message.",
    description:
      "Confirm account context, the person’s current role and address, and the evidence behind every claim before a recommendation becomes an action.",
    category: "feature",
    bullets: [
      "Research the company and contact with source provenance attached.",
      "Verify current role, address, and contactability before drafting.",
      "Write verified facts back into durable relationship memory.",
    ],
    proof: baseProof,
    ctaLabel: "See verification in context",
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
    eyebrow: "Connected Revenue Systems",
    title: "One governed loop across memory, research, policy, and execution.",
    description:
      "Oppulence connects communication and CRM history with research, verification, suppression, sender protection, and controlled execution behind one revenue action queue.",
    category: "product",
    bullets: [
      "Use email, calendar, meetings, and CRM as relationship-memory sources.",
      "Use research, verification, suppression, and sender health before action.",
      "Return replies, meetings, delivery telemetry, and CRM outcomes to the memory.",
    ],
    proof: [
      "Each connected system has a clear ownership and permission boundary.",
      "External execution stays reviewable and auditable.",
      "Outcomes return to the same relationship timeline.",
    ],
    ctaLabel: "Map your revenue stack",
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
    title: "Watch is free. Chase is $99. Intelligence is $249.",
    description:
      "A flat monthly price — never per seat, per email, or per lookup. One saved deal pays for years. Cancel at any time.",
    category: "product",
    bullets: [
      "Founders recover warm pipeline from existing communication and CRM history.",
      "Revenue teams add collaboration, policy, verification, and execution telemetry.",
      "Enterprise teams add SSO, permissions, auditability, deployment controls, and support.",
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
    eyebrow: "Revenue Leak Scan",
    title: "Find the warm revenue slipping through your existing relationships.",
    description:
      "Walk through how Oppulence scans communication and CRM history, ranks the relationships worth attention, and prepares safe next actions for approval.",
    category: "demo",
    bullets: [
      "Map the email, calendar, meetings, and CRM sources that hold commercial history.",
      "Review the missed commitments and dormant opportunities a scan should detect.",
      "Define verification, policy, and approval boundaries before execution.",
    ],
    proof: baseProof,
    ctaLabel: "Book my scan",
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
  // Canonical legal pages live at /terms and /privacy (app/terms, app/privacy).
  // The old /legal/* paths redirect there (see next.config.ts).
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
  title: titleFromSlug(slug),
  description: "A practical guide from the Oppulence team.",
  category: "blog",
  bullets: [
    "What breaks when relationship history stays scattered across tools.",
    "How durable memory changes prioritization, verification, and follow-through.",
    "Where source evidence, policy, approval, execution, and outcomes fit.",
  ],
  proof: baseProof,
  ctaLabel: "Book a Revenue Leak Scan",
  ctaHref: "/ai-help-center",
}));

export const customerPages: MarketingPage[] = customerSlugs.map((slug) => ({
  path: `customers/${slug}`,
  eyebrow: "Customer Story",
  title: `${titleFromSlug(slug)}: a revenue memory story`,
  description:
    "A mapped customer-story route showing how a team could recover warm pipeline with relationship memory and governed actions.",
  category: "customer",
  bullets: [
    "Unify commercial history across conversations, meetings, calendar, and CRM.",
    "Find missed commitments and rank the relationships worth attention.",
    "Verify, govern, approve, execute, and learn from the outcome.",
  ],
  proof: [
    "More warm opportunities recovered before they go cold.",
    "Less manual reconstruction of commercial history.",
    "Every action backed by evidence and policy.",
  ],
  ctaLabel: "See the product loop",
  ctaHref: "/product",
}));

export const indexPages: MarketingPage[] = [
  {
    path: "blog",
    eyebrow: "Blog",
    title: "Guides on chasing silence.",
    description: "Practical notes on follow-up, invoices, and keeping client relationships warm.",
    category: "blog",
    bullets: [
      "Alternatives and comparison pages.",
      "Relationship memory and warm-revenue strategy.",
      "Research, verification, policy, approval, and execution patterns.",
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
      "Founder sellers recovering dormant opportunities.",
      "Revenue teams tracking promises, objections, and next actions.",
      "Operators protecting reputation with evidence and policy.",
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
    name: "Watch",
    price: "Free",
    period: "",
    description:
      "See what is slipping. A weekly report of the deals, invoices, and clients going quiet.",
    features: [
      "Weekly slip report",
      "Dollar amounts on each finding",
      "Links to the source email",
      "Job-change alerts on your ten closest contacts",
    ],
    ctaLabel: "Get the report",
    ctaHref: "/book-a-demo",
  },
  {
    name: "Starter",
    price: "$49",
    period: "/month",
    description:
      "The whole chase workflow at a smaller volume. For one person with one book of business.",
    features: [
      "Everything in Watch",
      "Drafted chases in your voice",
      "Approve, edit, snooze, or reject",
      "Verified, suppression-checked sends",
      "Lower monthly usage allowance than Chase",
    ],
    ctaLabel: "Start chasing",
    ctaHref: "/sign-up",
  },
  {
    name: "Chase",
    price: "$99",
    period: "/month",
    description: "The chase, done for you. Drafted nudges in your voice, approved with one click.",
    features: [
      "Everything in Starter",
      "Room for a full book of business",
      "Premium connectors",
      "Monthly recovery receipt",
    ],
    recommended: true,
    ctaLabel: "Start chasing",
    ctaHref: "/sign-up",
  },
  {
    name: "Intelligence",
    price: "$249",
    period: "/month",
    description:
      "Why today, not just who is quiet. Watches your accounts for the things that make an email worth sending.",
    features: [
      "Everything in Chase",
      "Funding, launch, acquisition and hiring alerts on your accounts",
      "Where a departed contact went, and who replaced them",
      "Meeting briefs that know what happened this week",
      "Every fact carries a link you can click",
      "Up to 250 monitored accounts",
    ],
    ctaLabel: "Start watching",
    ctaHref: "/sign-up",
  },
  {
    name: "Teams",
    price: "Talk to us",
    period: "",
    description: "A shared queue and governance for small revenue teams.",
    features: ["Everything in Intelligence", "Shared action queue", "Roles and audit trail"],
    ctaLabel: "Talk to us",
    ctaHref: "/book-a-demo",
  },
];

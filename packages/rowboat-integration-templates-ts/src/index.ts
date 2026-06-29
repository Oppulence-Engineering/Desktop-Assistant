import { z } from "zod";

export const IntegrationTrustTierSchema = z.enum(["read", "write", "act", "money-moving"]);
export type IntegrationTrustTier = z.infer<typeof IntegrationTrustTierSchema>;

export const IntegrationAuthTypeSchema = z.enum(["oauth", "api_key"]);
export type IntegrationAuthType = z.infer<typeof IntegrationAuthTypeSchema>;

export const IntegrationTemplateBlockSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  requiredScopes: z.array(z.string().min(1)).default([]),
  mcpTools: z.array(z.string().min(1)).default([]),
  trustTier: IntegrationTrustTierSchema,
  samplePrompt: z.string().min(1).optional(),
});
export type IntegrationTemplateBlock = z.infer<typeof IntegrationTemplateBlockSchema>;

export const IntegrationTemplateSchema = z.object({
  connector: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  authType: IntegrationAuthTypeSchema,
  audience: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([]),
  blocks: z.array(IntegrationTemplateBlockSchema).min(1),
});
export type IntegrationTemplate = z.infer<typeof IntegrationTemplateSchema>;

export const IntegrationTemplateCatalogSchema = z.array(IntegrationTemplateSchema).superRefine((catalog, ctx) => {
  const connectors = new Set<string>();
  for (let templateIndex = 0; templateIndex < catalog.length; templateIndex++) {
    const template = catalog[templateIndex];
    if (connectors.has(template.connector)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [templateIndex, "connector"],
        message: `duplicate connector ${template.connector}`,
      });
    }
    connectors.add(template.connector);

    const blockIds = new Set<string>();
    for (let blockIndex = 0; blockIndex < template.blocks.length; blockIndex++) {
      const block = template.blocks[blockIndex];
      if (blockIds.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [templateIndex, "blocks", blockIndex, "id"],
          message: `duplicate block id ${block.id}`,
        });
      }
      blockIds.add(block.id);
    }
  }
});
export type IntegrationTemplateCatalog = z.infer<typeof IntegrationTemplateCatalogSchema>;

const catalog = IntegrationTemplateCatalogSchema.parse([
  {
    connector: "canvas",
    displayName: "Canvas",
    description: "Banking, invoicing, dunning, and transaction context.",
    authType: "oauth",
    audience: "canvas-api",
    scopes: ["invoices:read", "customers:read", "transactions:read"],
    blocks: [
      {
        id: "invoice-context",
        title: "Invoice context",
        description: "Look up invoices, customers, balances, and current payment status.",
        category: "finance",
        requiredScopes: ["invoices:read", "customers:read"],
        mcpTools: ["invoice.lookup", "customer.lookup"],
        trustTier: "read",
        samplePrompt: "Show me the current invoice status for Acme.",
      },
      {
        id: "transaction-review",
        title: "Transaction review",
        description: "Search transactions and summarize recent customer activity.",
        category: "finance",
        requiredScopes: ["transactions:read"],
        mcpTools: ["transaction.search"],
        trustTier: "read",
        samplePrompt: "Find recent transactions for this customer.",
      },
    ],
  },
  {
    connector: "corinthian",
    displayName: "Corinthian",
    description: "Accounts receivable, collections, and customer communications.",
    authType: "oauth",
    audience: "corinthian-api",
    scopes: ["ar:read", "collections:read"],
    blocks: [
      {
        id: "collections-context",
        title: "Collections context",
        description: "Review collection cases, promises to pay, and customer thread history.",
        category: "finance",
        requiredScopes: ["collections:read"],
        mcpTools: ["case.lookup", "promise.list", "thread.search"],
        trustTier: "read",
        samplePrompt: "Summarize this customer's open collection promises.",
      },
    ],
  },
  {
    connector: "wispr",
    displayName: "Wispr Flow",
    description: "AI dictation transcripts for meeting and voice-note context.",
    authType: "api_key",
    audience: "wispr-api",
    scopes: [],
    blocks: [
      {
        id: "transcript-recall",
        title: "Transcript recall",
        description: "Search and retrieve dictated transcripts for memory and follow-up work.",
        category: "meetings",
        requiredScopes: [],
        mcpTools: ["transcript.search", "transcript.get"],
        trustTier: "read",
        samplePrompt: "Find my latest voice notes about the launch plan.",
      },
    ],
  },
  {
    connector: "hubspot",
    displayName: "HubSpot",
    description: "CRM contacts, deals, companies, tickets, and notes.",
    authType: "api_key",
    audience: "hubspot-api",
    scopes: [],
    blocks: [
      {
        id: "crm-research",
        title: "CRM research",
        description: "Look up contacts, companies, deals, and tickets before customer work.",
        category: "crm",
        requiredScopes: [],
        mcpTools: ["contact.lookup", "company.lookup", "deal.search"],
        trustTier: "read",
        samplePrompt: "Brief me on the current HubSpot deal for Acme.",
      },
      {
        id: "crm-actions",
        title: "CRM actions",
        description: "Create tickets and notes from agent follow-up workflows.",
        category: "crm",
        requiredScopes: [],
        mcpTools: ["ticket.create", "note.create"],
        trustTier: "act",
        samplePrompt: "Create a follow-up note on this HubSpot company.",
      },
    ],
  },
  {
    connector: "github",
    displayName: "GitHub",
    description: "Repositories, issues, pull requests, and review context.",
    authType: "api_key",
    audience: "github-api",
    scopes: [],
    blocks: [
      {
        id: "engineering-context",
        title: "Engineering context",
        description: "Search repositories, issues, and pull requests for project context.",
        category: "development",
        requiredScopes: [],
        mcpTools: ["repository.get", "issue.search", "pull_request.search"],
        trustTier: "read",
        samplePrompt: "Summarize open pull requests related to billing.",
      },
      {
        id: "github-comments",
        title: "GitHub comments",
        description: "Comment on issues or pull requests when a workflow needs to respond.",
        category: "development",
        requiredScopes: [],
        mcpTools: ["issue.comment.create", "pull_request.review.create"],
        trustTier: "act",
        samplePrompt: "Draft and post a status comment on this issue.",
      },
    ],
  },
  {
    connector: "linear",
    displayName: "Linear",
    description: "Issues, projects, comments, and triage workflows.",
    authType: "api_key",
    audience: "linear-api",
    scopes: [],
    blocks: [
      {
        id: "issue-triage",
        title: "Issue triage",
        description: "Search issues and projects to understand scope and ownership.",
        category: "project-management",
        requiredScopes: [],
        mcpTools: ["issue.search", "project.lookup"],
        trustTier: "read",
        samplePrompt: "Find Linear issues related to onboarding integrations.",
      },
      {
        id: "issue-actions",
        title: "Issue actions",
        description: "Create issues and add comments from support or planning workflows.",
        category: "project-management",
        requiredScopes: [],
        mcpTools: ["issue.create", "issue.comment.create"],
        trustTier: "act",
        samplePrompt: "Create a Linear issue for this bug report.",
      },
    ],
  },
  {
    connector: "notion",
    displayName: "Notion",
    description: "Workspace pages, databases, and knowledge bases.",
    authType: "api_key",
    audience: "notion-api",
    scopes: [],
    blocks: [
      {
        id: "workspace-knowledge",
        title: "Workspace knowledge",
        description: "Search pages and databases to ground answers in Notion content.",
        category: "knowledge",
        requiredScopes: [],
        mcpTools: ["page.search", "page.get", "database.query"],
        trustTier: "read",
        samplePrompt: "Search Notion for the latest onboarding notes.",
      },
      {
        id: "page-updates",
        title: "Page updates",
        description: "Update Notion pages after agent workflows produce new context.",
        category: "knowledge",
        requiredScopes: [],
        mcpTools: ["page.update"],
        trustTier: "act",
        samplePrompt: "Append this summary to the launch plan page.",
      },
    ],
  },
  {
    connector: "stripe",
    displayName: "Stripe",
    description: "Customers, charges, invoices, subscriptions, and refunds.",
    authType: "api_key",
    audience: "stripe-api",
    scopes: [],
    blocks: [
      {
        id: "payments-context",
        title: "Payments context",
        description: "Look up customers, charges, and invoices for support and finance work.",
        category: "payments",
        requiredScopes: [],
        mcpTools: ["customer.lookup", "charge.search", "invoice.lookup"],
        trustTier: "read",
        samplePrompt: "Find recent Stripe charges for this customer.",
      },
      {
        id: "payment-actions",
        title: "Payment actions",
        description: "Finalize invoices and create refunds when explicitly requested.",
        category: "payments",
        requiredScopes: [],
        mcpTools: ["invoice.finalize", "refund.create"],
        trustTier: "money-moving",
        samplePrompt: "Prepare the refund workflow for this charge.",
      },
    ],
  },
]);

export const INTEGRATION_TEMPLATES: IntegrationTemplateCatalog = catalog;

export function listIntegrationTemplates(): IntegrationTemplate[] {
  return [...catalog];
}

export function getIntegrationTemplate(connector: string): IntegrationTemplate | undefined {
  return catalog.find((template) => template.connector === connector);
}

export function getTemplateBlocks(connector: string): IntegrationTemplateBlock[] {
  return getIntegrationTemplate(connector)?.blocks ?? [];
}

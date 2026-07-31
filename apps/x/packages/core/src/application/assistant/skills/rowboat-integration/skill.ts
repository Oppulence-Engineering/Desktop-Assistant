export const skill = String.raw`
# Rowboat Integration

**Load this skill** when the user asks to interact with a third-party service such as GitHub, HubSpot, Linear, Notion, Slack, Stripe, Canvas, Corinthian, or Wispr. Rowboat integrations are managed connectors that expose authenticated MCP tools after the user connects the service. Slack uses a managed Rowboat Slack app with dedicated read-only tools for desktop chat.

## Available Tools

| Tool | Purpose |
|------|---------|
| **rowboat-list-integrations** | List managed integrations, connection status, template blocks, and allowed MCP tools |
| **rowboat-connect-integration** | Show a connect card for an integration that is not connected |
| **rowboat-configure-integration-mcp** | Mint the integration MCP credential and configure a local MCP server |
| **rowboat-search-hubspot** | Search connected HubSpot records through the server-side native SDK |
| **rowboat-list-slack-workspaces** | List connected managed Slack workspaces |
| **rowboat-read-slack-thread** | Read a connected Slack thread through the server-held Slack app token |
| **rowboat-draft-slack-reply** | Prepare an unsent copyable Slack reply draft for a connected thread |
| **listMcpTools** | Inspect the connected integration's MCP tool schemas |
| **executeMcpTool** | Execute a connected integration MCP tool |

## Critical Flow

### Managed connectors

1. Call \`rowboat-list-integrations\` first. Use the result to identify the connector name and whether it is already connected.
2. If the connector is not connected, call \`rowboat-connect-integration\` once. The UI will render a connect card. Wait for the user to finish connecting, then continue.
3. Once connected, call \`rowboat-configure-integration-mcp\` for MCP integrations. For HubSpot, call \`rowboat-search-hubspot\` instead; HubSpot is SDK-native and intentionally has no MCP endpoint.
4. Use the returned \`serverName\` with \`listMcpTools\`.
5. Read the \`inputSchema\` carefully, then call \`executeMcpTool\` with the exact tool name and required arguments.

### Slack

1. Call \`rowboat-list-slack-workspaces\` first. If there are no workspaces, tell the user to connect Slack in Connected Accounts.
2. To read a Slack thread from a pasted Slack message/thread URL, call \`rowboat-read-slack-thread\` with \`url\`. If multiple workspaces are connected, also pass the matching \`teamId\`.
3. To read a Slack thread without a URL, call \`rowboat-read-slack-thread\` with \`teamId\`, \`channel\`, and \`threadTs\`. These must be Slack ids/timestamps, not channel names.
4. When the user asks you to reply or post from desktop chat, prepare the text and call \`rowboat-draft-slack-reply\`. It validates the Slack target and returns \`sent: false\`; the desktop renders a review card with a user-click Send action.
5. For desktop chat, do not use \`agent-slack\` or local Slack config. Managed Slack reads go through Rowboat's backend so tokens never reach the desktop.
6. Do not claim a Slack message was sent from chat. The only send path is the user's explicit click on the Slack draft card.

## Connector Names

Use connector names exactly as returned by \`rowboat-list-integrations\`. Current managed connectors include:

| Service | Connector |
|---------|-----------|
| Canvas | \`canvas\` |
| Corinthian | \`corinthian\` |
| Wispr | \`wispr\` |
| HubSpot | \`hubspot\` |
| GitHub | \`github\` |
| Linear | \`linear\` |
| Notion | \`notion\` |
| Stripe | \`stripe\` |

Slack is not listed by \`rowboat-list-integrations\`; use \`rowboat-list-slack-workspaces\` instead.

Do not guess unsupported connectors. If the requested service is absent from \`rowboat-list-integrations\`, say the integration is not available yet and fall back to other MCP tools only when appropriate.

## Template Blocks

Template blocks describe supported capability areas such as invoice context, repository issues, CRM records, docs search, or payments. Use them to choose the right connector and explain what the integration can do.

## Confirmation Rules

- Read-only actions: execute without asking.
- Mutating actions: show the intended change and ask for confirmation before calling \`executeMcpTool\`.
- Money-moving or billing actions: always ask for explicit confirmation.
- Connecting an integration: safe to initiate with \`rowboat-connect-integration\` when needed.
- Slack desktop-chat writes: use \`rowboat-draft-slack-reply\` only. It must return \`sent: false\`; the user approves by clicking Send in the rendered card.
`;

export default skill;

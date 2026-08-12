# RFC 048: Public API, MCP Server, and CLI Bridge

|                    |                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **RFC**            | 048                                                                                                                   |
| **Status**         | Draft                                                                                                                 |
| **Track**          | Ecosystem — OpenWhispr parity                                                                                         |
| **Owners**         | `apps/rowboat-api`, `apps/x` desktop, security                                                                        |
| **Created**        | 2026-08-12                                                                                                            |
| **Depends on**     | [RFC 010](./complete-010-rowboat-api-service-plane.md), [RFC 011](./complete-011-identity-and-authorization-plane.md) |
| **Related**        | [RFC 020](./020-native-third-party-action-engine.md), [RFC 018](./018-a2a-delegation-and-agent-identity.md)           |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                             |

## 1. Decision

Make the product programmable through three surfaces:

1. **Public API** — documented, versioned, token-authenticated access to notes,
   transcriptions, meetings, and relationships.
2. **MCP server** — expose our data to the user's AI assistant (Claude, Cursor,
   others) as tools.
3. **CLI bridge** — drive dictation and note capture from the terminal.

## 2. Direction of travel matters

We are an **MCP client** today: `packages/core/src/mcp/mcp.ts` connects to
external MCP servers and lists their tools. That is the opposite direction from
what this RFC proposes. Being an MCP _server_ means a user's Claude can ask "what
did Dana commit to last week?" and get an answer from our relationship graph.

For us this is strategically more valuable than for a dictation app. Our moat is
the graph (RFC 022, RFC 036); exposing it through MCP makes every AI assistant a
distribution channel for it, rather than a competitor for the same attention.

## 3. What we have

- `apps/rowboat-api` — a real service plane with GraphQL, Ent, and an OpenAPI
  document (`apps/rowboat-api/api/openapi.json`).
- `packages/rowboat-api-client-ts` — a generated client.
- Auth via WorkOS (`internal/workosauth`).

We have the backend; we lack a user-facing, token-scoped, documented product API
and the two local bridges.

## 4. Design

### 4.1 Public API

Scope to nouns users understand: notes, meetings, transcriptions, people,
commitments. Requirements: API tokens with per-scope grants, per-token rate
limits, revocation, an audit trail, and semantic versioning with a deprecation
policy. Personal tokens and workspace tokens are distinct.

### 4.2 MCP server

Ship an MCP server (stdio for local, HTTP for remote) exposing read tools first:
search notes, get meeting, list commitments, get relationship state. Writes come
later and only behind explicit approval, consistent with RFC 023's
propose/approve/execute discipline.

Key constraint: **an MCP tool result is untrusted input to the caller's model.**
Content returned from our graph can contain text an attacker put in an email.
Tool descriptions and results must be structured to avoid becoming an injection
channel into the user's assistant.

### 4.3 CLI bridge

A local socket protocol so a terminal command can start dictation, capture a
note, or query recent transcriptions. Auth is process-ownership-based on a
user-scoped socket path. This is genuinely useful for our own dogfooding, and
cheap given the IPC layer already exists.

## 5. Definition of done

- Public API documented from the OpenAPI source, with scoped tokens, rate
  limits, revocation, and an audit trail.
- MCP server exposes read tools, installable with a documented config snippet,
  tested against at least two MCP clients.
- CLI can start dictation and create a note on macOS.
- Tokens never appear in logs; scope violations are tested.

## 6. OpenWhispr code references

Their API and MCP server are documented at `docs.openwhispr.com`; the local
checkout carries the desktop-side bridges.

| Concern             | File                                                                        | Lines | Notes                                                                                     |
| ------------------- | --------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| CLI bridge          | `src/helpers/cliBridge.js`                                                  | 429   | Local socket protocol, command dispatch, and lifecycle. The most directly reusable piece. |
| CLI onboarding      | `src/components/CliIntegrationCard.tsx`                                     | 122   | Install flow and copyable commands.                                                       |
| MCP setup UI        | `src/components/McpIntegrationCard.tsx`                                     | 102   | How they present MCP config to non-technical users.                                       |
| API key management  | `src/services/ApiKeysService.ts`, `src/services/WorkspaceApiKeysService.ts` | —     | Personal vs workspace token split, matching §4.1.                                         |
| Session headers     | `src/helpers/sessionHeaders.js`                                             | —     | Auth header construction.                                                                 |
| Cloud request layer | `src/helpers/cloudApiRequest.js`                                            | —     | Retry and error normalization.                                                            |

MIT-licensed; carry the notice on any adapted file. Their public API shape is
also worth reading as a product-design reference at `docs.openwhispr.com/api/overview`.

## 7. Risks

- A public API is a permanent compatibility commitment. Version from day one and
  keep the initial surface deliberately small.
- MCP write tools are a significant authority delegation. Reads first; writes
  only through the RFC 023 approval path.
- The CLI socket is a local privilege boundary. Scope the socket path per user
  and verify peer credentials.

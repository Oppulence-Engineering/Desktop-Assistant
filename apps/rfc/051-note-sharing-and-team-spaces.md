# RFC 051: Note Sharing and Team Spaces

|                    |                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **RFC**            | 051                                                                                                                            |
| **Status**         | Draft                                                                                                                          |
| **Track**          | Collaboration — OpenWhispr parity                                                                                              |
| **Owners**         | `apps/rowboat-api`, `apps/rowboat-www`, `apps/x`, security                                                                     |
| **Created**        | 2026-08-12                                                                                                                     |
| **Depends on**     | [RFC 011](./complete-011-identity-and-authorization-plane.md), [RFC 015](./015-rowboat-platform-workos-fga-and-widget-auth.md) |
| **Related**        | [RFC 050](./050-enterprise-controls.md), [RFC 048](./048-public-api-mcp-server-cli.md)                                         |
| **Reference impl** | OpenWhispr (MIT) — see §6                                                                                                      |

## 1. Decision

Let a note leave one person's machine: shareable web links with link,
domain-restricted, or invite-only visibility, plus team spaces with roles,
invitations, and server-enforced membership.

## 2. Why

Meeting notes are inherently multiplayer. A note that cannot be shared forces
users into copy-paste, which means the canonical version leaves our product and
the relationship graph stops seeing the follow-up. Sharing keeps the artifact,
and therefore the evidence, inside the system.

It is also the natural pull-based growth loop: a shared note is a product demo
sent by a customer to a colleague.

## 3. What we have

- `apps/rowboat-www` — the web app that would render shared notes, with WorkOS
  auth routes already present.
- RFC 015 covers organization identity and FGA, which is the authorization
  substrate this needs.
- Desktop notes and version history (`packages/core/src/knowledge/version_history.ts`).

The gap is the sharing model itself and the public rendering surface.

## 4. Design

### 4.1 Visibility model

Four levels, server-enforced:

| Level       | Who can read                                  |
| ----------- | --------------------------------------------- |
| Private     | Owner only                                    |
| Invite-only | Explicitly invited accounts                   |
| Domain      | Anyone signed in with an allowed email domain |
| Link        | Anyone with the URL                           |

**Authorization must be evaluated server-side on every request.** A share token
in the URL is a bearer credential: it must be high-entropy, revocable,
independently rotatable, and excluded from referrers and logs.

### 4.2 Team spaces

Spaces hold notes with membership and roles (owner, editor, viewer). Membership
is enforced at the API, not by hiding UI. Invitations are tokenized, expiring,
and single-use.

### 4.3 The privacy tension

This is the part that deserves genuine care. Meeting notes contain transcripts
of people who never consented to publication, and with RFC 044 they may carry
speaker identity. Requirements:

- Link sharing is **off by default** and requires an explicit action per note.
- Sharing a meeting note warns that it contains a transcript of other people.
- Org policy (RFC 050) can disable public link sharing entirely.
- Revocation is immediate and verifiable.
- Shared notes are excluded from search-engine indexing.

### 4.4 Sync semantics

Shared notes need a defined conflict model. Last-write-wins on a whole note is
unacceptable for collaborative editing; scope initial sharing to **read-only
publication** plus comments, and defer collaborative editing to a later RFC.
That single decision removes most of the complexity here.

## 5. Definition of done

- A note can be shared at each visibility level, with authorization enforced
  server-side (tested, including direct API access with a revoked token).
- Revocation takes effect immediately.
- Team spaces enforce roles at the API layer.
- Invitations expire and cannot be replayed.
- Sharing a meeting note surfaces a third-party-content warning.
- Shared pages carry `noindex`, and tokens never appear in logs or referrers.

## 6. OpenWhispr code references

| Concern               | File                                                                                            | Lines | Notes                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Sharing service       | `src/services/NoteSharingService.ts`                                                            | 156   | Visibility levels and token lifecycle. The core reference for §4.1.                                   |
| Share UI              | `src/components/notes/ShareNoteDialog.tsx`                                                      | 1078  | Full sharing surface; large because the states (link, domain, invite, revoked) each need explanation. |
| Visibility menu       | `src/components/notes/ShareVisibilityMenu.tsx`                                                  | —     | Compact visibility switcher.                                                                          |
| Spaces service        | `src/services/SpacesService.ts`                                                                 | 96    | Space CRUD and membership.                                                                            |
| Space actions         | `src/services/spaceActions.ts`, `spaceActionsCore.ts`                                           | —     | Role-gated operations, split for testability.                                                         |
| Teams                 | `src/services/TeamsService.ts`                                                                  | 45    | Team model.                                                                                           |
| Invitations           | `src/services/InvitationsService.ts`                                                            | 62    | Token issuance and acceptance.                                                                        |
| Membership validation | `src/services/accountSpaceValidation.ts`, `membershipActions.ts`                                | —     | Server-enforced membership checks.                                                                    |
| Invite UX             | `src/components/AcceptInvitationModal.tsx`, `InviteTeammateDialog.tsx`, `JoinYourTeamModal.tsx` | —     | The full invite loop.                                                                                 |
| Sync guards           | `src/helpers/cloudSyncGuards.js`, `src/services/syncPassPolicy.ts`                              | —     | Preventing sync of content that policy forbids leaving the device.                                    |
| Participants          | `src/components/notes/NoteParticipants.tsx`, `src/utils/participants.ts`                        | —     | Displaying who is on a note.                                                                          |

MIT-licensed; carry the notice on any adapted file.

## 7. Risks

- **A sharing bug is a data breach**, not a defect. This RFC needs a security
  review and explicit negative tests before any public link ships.
- Publishing transcripts of third parties has legal exposure in two-party-consent
  jurisdictions. Warnings are necessary but may not be sufficient; get counsel
  input before enabling link sharing on meeting notes specifically.

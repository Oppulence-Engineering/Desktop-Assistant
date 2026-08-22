# RFC 055: Capture Product Boundary and Rowboat Integration

|                       |                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**               | 055                                                                                                                                          |
| **Status**            | Accepted                                                                                                                                     |
| **Track**             | Product architecture · portfolio boundaries · capture ingestion                                                                              |
| **Owners**            | product, `apps/x`, `apps/rowboat-api`, Oppulence Capture                                                                                     |
| **Created**           | 2026-08-21                                                                                                                                   |
| **Depends on**        | [RFC 035](./035-meeting-intelligence-commitment-ledger.md), [RFC 036](./036-relationship-state-engine.md)                                    |
| **Related**           | [RFC 020](./020-native-third-party-action-engine.md), [RFC 048](./048-public-api-mcp-server-cli.md), [RFC 050](./050-enterprise-controls.md) |
| **Supersedes**        | RFC 054 and the Rowboat-owned OpenWhispr parity program                                                                                      |
| **Reference product** | Oppulence's MIT-derived OpenWhispr capture-product fork                                                                                      |

## 1. Decision

Keep the OpenWhispr fork as a **separate capture product and codebase**, make
Rowboat the relationship-intelligence system it feeds, and selectively port
only a small number of foundational components.

Do not merge the products or broadly cherry-pick OpenWhispr into Rowboat.

Initially position the capture fork as a companion and acquisition product, not
as a second company-scale go-to-market motion. It must be independently useful,
but it becomes a fully independent paid product only after retention and revenue
demonstrate that it deserves a separate motion.

The operating model is:

> **Separate application, separate repository, separate product promise, shared
> company account, versioned integration, optional standalone SKU.**

## 2. Product responsibilities

### 2.1 Capture product

The capture product owns:

- global dictation;
- selection rewriting and translation;
- local and cloud transcription;
- meeting detection and recording;
- audio and video import;
- speaker diarization and local voice profiles;
- basic transcript and note editing;
- cross-platform native audio, hotkey, and paste infrastructure;
- local privacy controls and transcription-provider configuration; and
- a lightweight, capture-focused agent.

Its product promise is:

> Capture everything you say and hear, privately, on any desktop.

### 2.2 Rowboat

Rowboat owns:

- canonical people, organization, and relationship identity;
- cross-source identity resolution;
- evidence and exact-quote provenance;
- commitments, risks, opportunities, milestones, and relationship state;
- account and person timelines;
- CRM, email, calendar, Slack, finance, and other business connectors;
- meeting preparation and follow-through;
- recommendations;
- approval and governed external actions; and
- longitudinal professional memory.

Its product promise remains:

> Maintain an evidence-backed model of every important relationship and help
> the user act on it.

### 2.3 Shared company platform

Both products may use the same Oppulence infrastructure for:

- accounts and organizations;
- billing and entitlements;
- provider credentials;
- organization policy;
- telemetry and release infrastructure;
- a versioned capture-artifact protocol; and
- optional encrypted synchronization.

They must not share application databases or reach into one another's internal
state directly.

## 3. Why the products remain separate

### 3.1 Rowboat's position stays sharp

Meeting capture and dictation are inputs to the relationship model, not
substitutes for it. Merging every capture capability into Rowboat would make the
product simultaneously a relationship manager, dictation application, meeting
recorder, local AI client, note editor, provider manager, and cross-platform
voice utility. That is harder to understand, sell, and prioritize.

### 3.2 Capture is the acquisition wedge

Private dictation has a low-friction activation loop: install, press a hotkey,
speak, and receive text. Relationship intelligence needs enough evidence before
its value becomes visible. The capture product creates that evidence and a
natural progression into Rowboat:

```text
Install capture app
        ↓
Dictate and record meetings
        ↓
Build a trustworthy local corpus
        ↓
Connect to Rowboat
        ↓
Resolve people and accounts
        ↓
Generate relationship state and follow-through
```

### 3.3 Native platform complexity stays contained

The capture fork already owns native integrations across macOS, Windows, and
Linux, including X11 and Wayland behavior, paste helpers, global key listeners,
system audio, transcription engines, and local model management. Rebuilding
that platform stack in Rowboat would create permanent duplicated maintenance.

### 3.4 The privacy boundary becomes legible

The capture product remains local-first:

- raw audio stays local by default;
- transcript storage stays local by default;
- the user explicitly chooses which artifacts go to Rowboat;
- raw audio need not be uploaded; and
- Rowboat receives only the transcript, evidence spans, participant hints, and
  provenance required for relationship intelligence.

Each UI must state whether a capability is local, invokes a user-selected
provider, or sends an artifact to Rowboat.

## 4. Versioned integration contract

Rowboat must not read the capture product's SQLite database. The capture product
publishes a stable, versioned envelope:

```text
CaptureArtifact
├── artifact ID and schema version
├── artifact type: meeting, dictation, imported media, note
├── timestamps and source application
├── transcript segments
│   ├── exact text
│   ├── start/end time
│   ├── speaker profile hint
│   └── confidence
├── calendar participant hints
├── consent and privacy classification
├── processing provenance
│   ├── transcription provider/model
│   ├── diarization provider/model
│   └── transformation history
├── content hash
└── deletion/tombstone information
```

The normative schema belongs in a small versioned package such as
`@oppulence/capture-protocol`. It contains schemas, validators, compatibility
fixtures, and protocol documentation—not Electron business logic.

Rowboat converts an accepted artifact into:

- canonical people and organizations;
- evidence records with exact source spans;
- relationship assertions;
- commitments;
- risks and opportunities;
- recommendations; and
- governed follow-up actions.

Ingestion must be idempotent by `(source_product, artifact_id, version)` and
must preserve the original content hash and processing provenance.

### 4.1 Identity ownership

The capture product may know:

> Local speaker profile `speaker_17` produced these segments.

Rowboat determines:

> This was probably Jane Smith from Acme, based on the voice profile, calendar
> invitation, email address, prior meetings, and CRM identity.

The capture product owns voice identity. Rowboat owns canonical relationship
identity. A capture profile ID is an identity hint, never a Rowboat person ID.

### 4.2 Action ownership

The capture product may perform local, reversible actions:

- paste text;
- rewrite selected text;
- translate dictated text; and
- create or update a local note.

Rowboat owns consequential external actions:

- send an email;
- update a CRM;
- create a third-party task;
- advance a workflow; and
- change a financial or customer object.

Rowboat's approval-token, execution, watch, and audit model remains the
authoritative path for external side effects.

### 4.3 Consent, deletion, and synchronization

Sending capture artifacts to Rowboat is explicit and revocable. The protocol
must carry:

- recording and biometric consent classifications;
- the policy version used when the artifact was captured;
- whether raw audio may be transferred;
- retention requirements;
- source-side deletion tombstones; and
- voice-profile merge, split, and deletion events.

Deletion propagation is a product requirement, not a best-effort maintenance
job. Rowboat must remove or tombstone derived data as required by policy while
retaining only the minimal audit proof permitted by that policy.

### 4.4 Implementation status (2026-08-21)

The first cloud control-plane slice is implemented in `apps/rowboat-api`:

- tenant-scoped Oppulence Voice API-key creation, listing, revocation, and
  digest-only verifier snapshots;
- opaque encrypted sync-item storage with conflict detection and resumable
  `(updated_at, id)` cursors;
- explicit capture-artifact ingestion at `/v1/capture-artifacts`, plus the
  `/capture-artifacts` compatibility route used by the desktop outbox;
- content-hash, consent, tombstone, and full-envelope idempotency validation;
- a Better Auth-shaped session adapter over already verified WorkOS JWTs; and
- Ent schemas, an Atlas migration, generated OpenAPI/GraphQL/TypeScript
  contracts, tenant interceptors, audit hooks, and handler tests.

This slice provides durable acceptance and deletion acknowledgement. It does
not yet project accepted artifacts into canonical people, evidence,
commitments, or relationship state. That work remains an asynchronous Rowboat
pipeline so capture delivery is not coupled to graph-processing availability.

The server-side opaque sync store is also implemented, but desktop encrypted
sync upload, restore, and key-recovery UX remain rollout work. The server cannot
decrypt a sync item and must not gain that capability as those clients are
added.

## 5. Code reuse policy

Do not cherry-pick complete product features into Rowboat. The repositories
have different architectures and state models, so long-running cherry-picked
branches become difficult to update and audit.

### 5.1 Adapt small pure-logic modules

Reasonable candidates include:

- translation-chain logic;
- speaker-assignment policy;
- text-selection safety checks;
- correction-learning algorithms;
- clipboard-restoration algorithms; and
- audio-import validation.

Port these only when Rowboat independently needs the behavior. Preserve MIT
attribution and record the originating upstream commit.

### 5.2 Package genuinely shared contracts

Appropriate packages include:

- `@oppulence/capture-protocol`;
- `@oppulence/evidence-protocol`; and
- `@oppulence/consent-types`.

Shared packages contain contracts, schemas, validators, and fixtures. They do
not become a dumping ground for renderer, Electron, or product business logic.

### 5.3 Keep native voice components in the capture product

Unless an independent Rowboat requirement makes integration impossible, do not
move these into Rowboat:

- Windows and Linux hotkey listeners;
- system-audio helpers;
- cross-platform paste helpers;
- Whisper and Parakeet runtime installers;
- media download and import infrastructure; and
- platform-specific meeting detection.

Rowboat may retain its existing macOS quick-capture behavior for continuity,
but major expansion stops after the companion integration is reliable.

## 6. RFC ownership after this decision

| Former parity RFC                        | Owner after RFC 055                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| 040 Dictation core UX                    | Capture product; Rowboat retains only lightweight quick capture                   |
| 041 Translation                          | Capture product                                                                   |
| 042 Screen context and selection editing | Capture product owns local editing; Rowboat owns relationship-aware commands      |
| 043 GPU Whisper and Parakeet             | Capture product                                                                   |
| 044 Speaker fingerprinting               | Capture product owns profiles; Rowboat owns identity binding                      |
| 045 Audio/video import                   | Capture product                                                                   |
| 046 Windows/Linux voice stack            | Capture product                                                                   |
| 047 Dictionary and correction learner    | Capture product                                                                   |
| 048 API/MCP/CLI                          | Capture product owns its local API; Rowboat owns graph APIs and capture ingestion |
| 049 Localization                         | Both products, independently                                                      |
| 050 Enterprise controls                  | Shared identity and policy infrastructure, enforced by each product               |
| 051 Sharing/team spaces                  | Transcript sharing in capture; relationship collaboration in Rowboat              |
| 052 Transcription providers              | Capture product                                                                   |
| 053 Local LLM runtime                    | Capture utilities in capture; local relationship processing in Rowboat            |
| 054 OpenWhispr parity program            | Superseded by this RFC                                                            |

Capture-only RFCs are removed from the active Rowboat RFC set and preserved in
the capture repository. Split RFCs remain here only for their Rowboat-owned
contract and behavior.

## 7. Brand and licensing

The upstream OpenWhispr code is MIT-licensed, so commercial modification and
distribution are permitted when its copyright and license notice are retained.
The upstream project remains an active product with its own name, website,
cloud service, and community. Code licensing does not by itself confer rights
to a product name or logo.

Therefore:

- do not publicly launch the fork using the OpenWhispr name or branding without
  explicit permission and legal review;
- give the Oppulence capture product its own name and visual identity;
- retain OpenWhispr MIT attribution in source and distributed notices;
- record upstream provenance for substantial ports; and
- audit bundled models, native binaries, fonts, and media tools under their own
  licenses.

## 8. Fork maintenance

Keep the capture fork close enough to upstream that security and platform fixes
remain importable:

- maintain an `upstream/main` remote;
- place Oppulence integrations behind adapters and feature flags;
- avoid rewriting upstream core modules merely to match Rowboat conventions;
- merge or rebase upstream on a scheduled cadence;
- maintain automated smoke tests for dictation, paste, meetings, imports, and
  Rowboat export;
- keep a short patch ledger documenting intentional divergence; and
- do not put Rowboat graph logic inside the capture fork.

## 9. Rollout

### 9.1 First 30 days

- Choose a distinct product name.
- Define and version the capture-artifact schema.
- Build an explicit **Send to Rowboat** export.
- Preserve timestamps, speakers, exact transcript spans, confidence, and
  provenance.
- Add deletion propagation.
- Keep transfer opt-in.

### 9.2 Days 30–60

- Add Oppulence account linking.
- Create Rowboat's capture connector.
- Resolve calendar participants into Rowboat identities.
- Convert transcripts into evidence and commitments.
- Link every derived Rowboat claim back to its source transcript.

### 9.3 Days 60–90

- Add continuous outbox-based synchronization.
- Add workspace policy and consent metadata.
- Measure how often captured artifacts produce useful relationship evidence.
- Decide whether the capture product merits its own paid plan.

## 10. Success measures and independent-product gate

Measure:

- percentage of capture users who connect Rowboat;
- percentage of meeting artifacts matched to an account or person;
- percentage producing a commitment, risk, or useful recommendation;
- seven-day and thirty-day capture retention;
- Rowboat activation improvement among capture-originated users;
- synchronization failure rate; and
- deletion-propagation success and latency.

The capture product receives a fully independent go-to-market motion only when
it demonstrates independent retention, a distinguishable buyer or use case,
and revenue capable of supporting its native-platform maintenance burden.

Until then, it is a standalone-useful companion and acquisition surface for
Rowboat.

## 11. Definition of done

- The capture-only RFCs no longer appear in Rowboat's active roadmap.
- Both repositories document the ownership boundary.
- A versioned `CaptureArtifact` schema and compatibility fixtures exist.
- Export is explicit, idempotent, observable, and deletion-aware.
- Rowboat evidence preserves exact source spans and capture provenance.
- Voice-profile hints cannot silently become canonical person identities.
- External actions remain behind Rowboat's governed action runtime.
- The fork has independent branding, attribution, and an upstream-sync policy.
- Product analytics can measure the capture-to-Rowboat funnel and the
  independent-product gate.

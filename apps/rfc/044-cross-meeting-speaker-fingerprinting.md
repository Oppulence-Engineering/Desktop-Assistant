# RFC 044: Capture Voice-Profile Hints to Canonical Relationship Identity

|                |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**        | 044                                                                                                                                                                        |
| **Status**     | Draft — rescoped by RFC 055                                                                                                                                                |
| **Track**      | Meeting evidence · identity resolution · capture integration                                                                                                               |
| **Owners**     | `apps/rowboat-api`, `apps/x` meeting ingestion, relationship graph, privacy                                                                                                |
| **Created**    | 2026-08-12                                                                                                                                                                 |
| **Updated**    | 2026-08-21                                                                                                                                                                 |
| **Depends on** | [RFC 022](./022-unified-entity-graph.md), [RFC 035](./035-meeting-intelligence-commitment-ledger.md), [RFC 055](./055-capture-product-boundary-and-rowboat-integration.md) |
| **Related**    | [RFC 036](./036-relationship-state-engine.md)                                                                                                                              |
| **Supersedes** | The Rowboat-owned embedding, enrollment, and voice-profile store scope in the original RFC 044                                                                             |

## 1. Decision

The capture product owns speaker embeddings, persistent local voice profiles,
enrollment, correction, merge/split, and profile deletion. Rowboat accepts a
voice-profile reference only as an identity **hint** and combines it with
calendar, email, CRM, and prior evidence to resolve a canonical person.

A capture voice-profile ID is never a Rowboat person ID, and a high-confidence
voice match alone cannot silently assert a consequential commitment against a
person without provenance.

## 2. Why Rowboat still needs this RFC

RFC 035 attributes spoken commitments and RFC 036 projects relationship state.
Those systems need durable identity across meetings, but the correct Rowboat
problem is evidence-backed identity binding—not running a second biometric
profile system.

Separating the systems also preserves a legible privacy boundary: biometric
vectors can remain on-device while Rowboat receives a pseudonymous profile
reference, confidence, and user-confirmation state.

## 3. Capture identity hint

The versioned `CaptureArtifact` envelope defined by RFC 055 adds, per speaker:

```text
CaptureSpeakerHint
├── source_profile_id
├── source_profile_version
├── segment references
├── match confidence band: confirmed | high | proposed | unknown
├── confirmation provenance
├── calendar/roster hints
├── biometric-transfer classification
└── deletion or split/merge tombstone references
```

Raw embeddings are excluded by default. Transferring an embedding requires a
separate explicit policy and consent decision; it is not implied by connecting
the capture product to Rowboat.

## 4. Resolution policy

Rowboat's identity resolver combines the hint with:

- a user-confirmed speaker assignment;
- calendar attendee identity;
- verified email or CRM identity;
- organization membership;
- prior source mappings; and
- contradictory evidence.

Rules:

1. A user-confirmed mapping may bind the source profile to a canonical person.
2. A high voice confidence plus an independently matching calendar/roster hint
   may auto-resolve under organization policy.
3. A voice-only proposed match remains unresolved and is shown for confirmation.
4. Conflicts preserve both candidates and surface the contradiction.
5. Commitments derived from an unresolved speaker remain attached to an
   anonymous participant until resolution.

Every resolved speaker label records whether it came from user confirmation,
voice profile, calendar roster, another connector, or a combination.

## 5. Consent and deletion

Voice profiles are biometric data. Rowboat must ingest the capture product's
consent classification, policy version, and deletion events. When a source
profile is deleted, split, or merged, Rowboat invalidates the source mapping and
reprojects affected assertions according to policy.

Rowboat settings must show linked capture profiles without implying that
Rowboat stores their embeddings. Disconnecting the capture product revokes
future access; deletion behavior follows the user's selected retention policy.

## 6. Definition of done

- Rowboat ingests pseudonymous profile hints without requiring embeddings.
- Source profile IDs are scoped by product, installation/account, and version.
- Identity binding uses at least one independent signal or explicit user
  confirmation before automatic canonical assignment.
- Unresolved speakers cannot silently create person-attributed commitments.
- Split, merge, deletion, and correction events trigger deterministic
  re-resolution.
- Every speaker-to-person binding is explainable from its evidence.
- Biometric consent and retention policy are enforced before production use.

## 7. Capture implementation reference

Persistent embeddings, profile matching, threshold policy, and local profile
management remain in the capture repository, including its RFC 0001. MIT code
may inform the integration, but Rowboat ports only protocol types, validators,
and evidence-resolution logic required by this RFC.

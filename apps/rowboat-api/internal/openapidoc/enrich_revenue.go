package openapidoc

// Revenue memory and outbound governance surface (RFC 030). Always mounted;
// without a configured facade the workspace runs in local mode (observation
// and drafts work, preflight and sends fail closed).

func addRevenueSchemas(schemas obj) {
	schemas["RevenueWorkspace"] = objectSchema("Mapping between the Rowboat tenant and the canonical OutboundConsole workspace. Local mode has no link: observation and draft-only execution work while preflight and sends stay disabled.", obj{
		"id":                     uuidSchema("Workspace id.", "0b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"mode":                   stringEnum("Workspace mode.", "local", "local", "linked"),
		"status":                 stringEnum("Link health.", "active", "active", "disconnected", "repair_required"),
		"outboundOrganizationId": stringSchema("OutboundConsole organization id.", "org_01ABC"),
		"outboundWorkspaceId":    stringSchema("OutboundConsole workspace id.", "ws_01ABC"),
		"lastVerifiedAt":         stringSchema("When the link was last verified.", "2026-07-12T12:00:00Z", obj{"format": "date-time"}, nullable()),
		"preflightAvailable":     boolSchema("Whether policy preflight can run (linked and active).", false),
	}, "id", "mode", "status", "preflightAvailable")

	schemas["RevenueRelationship"] = objectSchema("Canonical, living relationship state projected from append-only evidence. CRM and communication systems remain evidence sources; this object is the shared model rendered by web and desktop.", obj{
		"id":               uuidSchema("Relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":             stringEnum("Relationship kind.", "person", "person", "company", "customer", "opportunity", "referral", "partner"),
		"displayName":      stringSchema("Human display name.", "Jordan Buyer"),
		"primaryEmail":     stringSchema("Primary email address.", "buyer@example.com"),
		"accountDomain":    stringSchema("Account domain.", "example.com"),
		"summary":          stringSchema("Bounded relationship summary.", "Asked for pricing in April; wants a follow-up in July."),
		"status":           stringEnum("Lifecycle status.", "active", "active", "dormant", "closed", "archived"),
		"lastTouchAt":      stringSchema("Last observed touch.", "2026-04-10T15:00:00Z", obj{"format": "date-time"}, nullable()),
		"nextActionAt":     stringSchema("Next planned action.", "2026-07-01T00:00:00Z", obj{"format": "date-time"}, nullable()),
		"openActions":      intSchema("Open queue actions for this relationship.", 1),
		"nextAction":       stringSchema("Recommended next action.", "Confirm the security review owner."),
		"lifecycle":        stringEnum("Commercial lifecycle.", "evaluation", "prospect", "evaluation", "contracting", "onboarding", "active_customer", "renewal", "churned", "former_customer"),
		"engagement":       stringEnum("Direction of engagement.", "declining", "unknown", "increasing", "steady", "declining", "dormant"),
		"sentiment":        stringEnum("Observed sentiment.", "mixed", "unknown", "positive", "mixed", "negative"),
		"health":           stringEnum("Explainable health state; never a magic score.", "needs_attention", "unknown", "healthy", "needs_attention", "critical"),
		"stateReason":      stringSchema("Evidence-backed explanation of the projected state.", "Security review was promised, but no owner or meeting exists."),
		"stateVersion":     intSchema("Monotonic projection version.", 4),
		"stateHash":        stringSchema("Stable hash of canonical projected values and winning assertions.", "sha256:ab12cd34"),
		"projectorVersion": intSchema("Deterministic projector version.", 1),
		"projectedAt":      stringSchema("Explicit evaluation time used by the projector.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastChangedAt":    stringSchema("Last material state change.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}, nullable()),
		"risks":            arraySchema("Current relationship risks.", stringSchema("Risk.", "Security review has no owner.")),
		"milestones":       arraySchema("Reached relationship milestones.", stringSchema("Milestone.", "Proposal shared.")),
	}, "id", "kind", "displayName", "status", "lifecycle", "engagement", "sentiment", "health", "stateVersion", "projectorVersion", "risks", "milestones")

	schemas["RelationshipParticipant"] = objectSchema("A person participating in the relationship, resolved across provider identities.", obj{
		"id":           uuidSchema("Participant id.", "7b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"displayName":  stringSchema("Display name.", "Avery Chen"),
		"email":        stringSchema("Normalized email.", "avery@acme.com"),
		"role":         stringSchema("Relationship role.", "champion"),
		"title":        stringSchema("Current title.", "VP Operations"),
		"active":       boolSchema("Whether the participant is active.", true),
		"externalRefs": arraySchema("Provider identity references.", stringSchema("External reference.", "hubspot:contact:123")),
	}, "id", "displayName", "role", "active", "externalRefs")

	schemas["RelationshipCommitment"] = objectSchema("An open or completed promise attached to the relationship.", obj{
		"id":            uuidSchema("Commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"direction":     stringSchema("Who owes the commitment.", "us_to_them"),
		"text":          stringSchema("Commitment text.", "Send the security packet."),
		"status":        stringSchema("Commitment status.", "open"),
		"dueAt":         stringSchema("Due time.", "2026-07-22T17:00:00Z", obj{"format": "date-time"}, nullable()),
		"confidence":    numberSchema("Extraction confidence.", 0.94),
		"userConfirmed": boolSchema("Whether a human confirmed it.", false),
	}, "id", "direction", "text", "status", "confidence", "userConfirmed")
	schemas["CommitmentDependency"] = objectSchema("An evidence-backed directed edge between two commitments.", obj{
		"dependencyId":     uuidSchema("Dependency id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"relationshipId":   uuidSchema("Relationship id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"fromCommitmentId": uuidSchema("Origin commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"toCommitmentId":   uuidSchema("Target commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":             stringEnum("Dependency semantics.", "blocks", "blocks", "requires", "supersedes"),
		"evidenceRefs":     arraySchema("Evidence references.", stringSchema("Reference.", "relationship-observation:ab12")),
		"createdAt":        stringSchema("Creation time.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}),
	}, "dependencyId", "relationshipId", "fromCommitmentId", "toCommitmentId", "kind", "evidenceRefs", "createdAt")
	schemas["CommitmentEvent"] = objectSchema("One immutable event in a commitment transition stream.", obj{
		"eventId":                    uuidSchema("Event id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"commitmentId":               uuidSchema("Commitment id.", "26cdbdc9-d0fc-4f8c-8660-2f0d62cfef51"),
		"sourceEventId":              stringSchema("Idempotent source event id.", "user-accept:commitment-1"),
		"version":                    obj{"type": "integer", "minimum": 1},
		"kind":                       stringEnum("Transition kind.", "accepted", "proposed", "internally_confirmed", "offered", "accepted", "disputed", "blocked", "unblocked", "due_date_changed", "renegotiated", "fulfilled", "cancelled", "superseded"),
		"actorType":                  stringEnum("Transition authority.", "user", "user", "source_fact", "deterministic_rule", "ai_candidate"),
		"actorRef":                   stringSchema("Actor reference.", "participant:owner"),
		"occurredAt":                 stringSchema("Event time.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}),
		"sourceObservationId":        stringSchema("Source observation id.", "relationship-observation:ab12"),
		"evidenceRefs":               arraySchema("Exact evidence references.", stringSchema("Reference.", "relationship-observation:ab12")),
		"ownerParticipantRef":        stringSchema("Promise owner.", "participant:owner"),
		"counterpartyParticipantRef": stringSchema("Promise counterparty.", "participant:customer"),
		"beneficiaryParticipantRef":  stringSchema("Promise beneficiary.", "participant:beneficiary"),
		"action":                     stringSchema("Promised action at this event.", "Send the security packet."),
		"duePhrase":                  stringSchema("Original due phrase.", "by Friday"),
		"dueAt":                      stringSchema("Resolved due time.", "2026-08-07T17:00:00Z", obj{"format": "date-time"}),
		"dueTimezone":                stringSchema("Due-time timezone.", "America/New_York"),
		"blocker":                    stringSchema("Blocker detail.", "Waiting on legal."),
		"reason":                     stringSchema("Transition rationale.", "Counterparty accepted in writing."),
		"supersedesCommitmentId":     uuidSchema("Superseded commitment id.", "a13cf25b-d195-45f3-a665-3a38ba575392"),
	}, "eventId", "commitmentId", "sourceEventId", "version", "kind", "actorType", "occurredAt", "evidenceRefs")

	schemas["RelationshipObservation"] = objectSchema("Immutable, idempotent provider evidence used to project relationship state.", obj{
		"id":              uuidSchema("Observation id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"source":          stringSchema("Evidence source.", "gmail"),
		"sourceAccountId": stringSchema("Provider account id.", "me@company.com"),
		"externalId":      stringSchema("Provider event id.", "message-123"),
		"sourceVersion":   stringSchema("Provider event version.", "1"),
		"eventType":       stringSchema("Normalized event type.", "commitment_created"),
		"occurredAt":      stringSchema("Provider occurrence time.", "2026-07-18T17:30:00Z", obj{"format": "date-time"}),
		"receivedAt":      stringSchema("Ingestion time.", "2026-07-18T17:31:00Z", obj{"format": "date-time"}),
		"summary":         stringSchema("Bounded evidence summary.", "We promised to send the security packet."),
		"normalizedFacts": freeFormSchema("Provider-neutral normalized facts."),
		"contentHash":     stringSchema("Hash of summary, facts, and sealed payload.", "ab12cd34"),
	}, "id", "source", "externalId", "sourceVersion", "eventType", "occurredAt", "receivedAt", "normalizedFacts", "contentHash")

	schemas["RelationshipStateSnapshot"] = objectSchema("Immutable projection snapshot created only when material relationship state changes.", obj{
		"id":                uuidSchema("Snapshot id.", "5b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"version":           intSchema("Relationship state version.", 4),
		"state":             freeFormSchema("Projected state at this version."),
		"stateHash":         stringSchema("Stable hash of canonical state and winning assertions.", "sha256:ab12cd34"),
		"projectorVersion":  intSchema("Projector version used for this snapshot.", 1),
		"evaluatedAt":       stringSchema("Explicit evaluation time used by the projector.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}),
		"changedDimensions": arraySchema("Material dimensions that changed.", stringSchema("Dimension.", "health")),
		"assertionIds":      arraySchema("Assertions selected by deterministic precedence.", stringSchema("Assertion id.", "assertion-123")),
		"createdAt":         stringSchema("Snapshot creation time.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}),
	}, "id", "version", "state", "stateHash", "projectorVersion", "evaluatedAt", "changedDimensions", "assertionIds", "createdAt")

	schemas["RelationshipSourceStatus"] = objectSchema("User-facing authorization, backfill, freshness, repair, revocation, and disconnect state for one stable provider connection. Tokens and raw cursors are never returned.", obj{
		"connectionId":           uuidSchema("Stable source connection id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"source":                 stringEnum("Source provider.", "google", "google", "slack", "hubspot"),
		"sourceAccountId":        stringSchema("Provider account or workspace id.", "me@company.com"),
		"consentingActorId":      uuidSchema("Actor who initiated consent.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"status":                 stringEnum("Connection lifecycle.", "live", "not_connected", "authorizing", "connected", "backfilling", "live", "degraded", "stale", "rebuilding", "reconnect_required", "disconnected"),
		"backfillPhase":          stringEnum("Backfill phase.", "live", "idle", "queued", "running", "live", "paused", "failed"),
		"backfillCompleted":      intSchema("Accepted backfill records.", 250),
		"backfillTotal":          intSchema("Known backfill total, zero when unknown.", 1000),
		"completeness":           stringEnum("Impact on relationship completeness.", "partial", "complete", "partial", "stale", "rebuilding", "disconnected"),
		"expectedCadenceSeconds": intSchema("Expected live-sync cadence.", 900),
		"lagSeconds":             intSchema("Calculated sync lag.", 42),
		"requiredScopes":         arraySchema("Scopes required by enabled capabilities.", stringSchema("Scope.", "https://www.googleapis.com/auth/gmail.readonly")),
		"grantedScopes":          arraySchema("Currently granted scopes.", stringSchema("Scope.", "https://www.googleapis.com/auth/gmail.readonly")),
		"missingScopes":          arraySchema("Missing or revoked required scopes.", stringSchema("Scope.", "https://www.googleapis.com/auth/gmail.readonly")),
		"errorCode":              stringSchema("Categorical safe error code.", "rate_limited"),
		"retryCount":             intSchema("Bounded retry count.", 2),
		"nextRetryAt":            stringSchema("Next retry.", "2026-07-31T14:05:00Z", obj{"format": "date-time"}, nullable()),
		"authorizationStartedAt": stringSchema("Authorization start.", "2026-07-31T13:00:00Z", obj{"format": "date-time"}, nullable()),
		"authorizedAt":           stringSchema("Authorization completion.", "2026-07-31T13:01:00Z", obj{"format": "date-time"}, nullable()),
		"syncStartedAt":          stringSchema("Backfill start.", "2026-07-31T13:01:00Z", obj{"format": "date-time"}, nullable()),
		"backfillCompletedAt":    stringSchema("Backfill completion.", "2026-07-31T13:10:00Z", obj{"format": "date-time"}, nullable()),
		"lastProviderEventAt":    stringSchema("Newest provider event observed.", "2026-07-31T13:58:00Z", obj{"format": "date-time"}, nullable()),
		"lastObservationAt":      stringSchema("Newest accepted observation.", "2026-07-31T13:58:00Z", obj{"format": "date-time"}, nullable()),
		"lastSyncAt":             stringSchema("Most recent sync attempt.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastSuccessAt":          stringSchema("Most recent successful sync.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastFailedSyncAt":       stringSchema("Most recent failed sync.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"disconnectedAt":         stringSchema("User disconnect time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"revokedAt":              stringSchema("Provider revocation time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastError":              stringSchema("Bounded, user-safe error summary.", "Provider synchronization is delayed."),
	}, "connectionId", "source", "sourceAccountId", "status", "backfillPhase", "backfillCompleted", "backfillTotal", "completeness", "expectedCadenceSeconds", "lagSeconds", "requiredScopes", "grantedScopes", "missingScopes", "retryCount")

	schemas["RelationshipSourceInventoryItem"] = objectSchema("Guided source card with consent explanation, supported evidence/actions, and every connected account.", obj{
		"source":                 stringEnum("Source provider.", "google", "google", "slack", "hubspot"),
		"displayName":            stringSchema("Provider display name.", "Google Gmail & Calendar"),
		"evidence":               arraySchema("Evidence contributed.", stringSchema("Evidence category.", "email_threads")),
		"actions":                arraySchema("Approval-gated actions supported.", stringSchema("Action category.", "gmail_send")),
		"readScopes":             arraySchema("Progressive read scopes.", stringSchema("Scope.", "https://www.googleapis.com/auth/gmail.readonly")),
		"writeScopes":            arraySchema("Progressive action scopes.", stringSchema("Scope.", "gmail.send")),
		"scopeExplanation":       stringSchema("Why the scopes are requested.", "Read scopes build relationship history."),
		"connectPath":            stringSchema("Managed connection entry path.", "/v1/google-oauth/start"),
		"disconnectPath":         stringSchema("Credential disconnect path.", "/v1/google-oauth"),
		"supportsReconnect":      boolSchema("Whether reconnect is supported.", true),
		"supportsResync":         boolSchema("Whether resync is supported.", true),
		"expectedCadenceSeconds": intSchema("Expected cadence.", 900),
		"accounts":               arraySchema("Provider accounts.", ref("RelationshipSourceStatus")),
	}, "source", "displayName", "evidence", "actions", "readScopes", "writeScopes", "scopeExplanation", "connectPath", "disconnectPath", "supportsReconnect", "supportsResync", "expectedCadenceSeconds", "accounts")

	schemas["RelationshipIdentityDecision"] = objectSchema("Immutable actor-bound identity decision.", obj{
		"id": uuidSchema("Decision id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "decision": stringSchema("Decision kind.", "merge"),
		"candidateVersion": intSchema("Candidate version decided.", 1), "actorId": uuidSchema("Decision actor.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"reason": stringSchema("Decision reason.", "Confirmed the provider records are the same account."), "decidedAt": stringSchema("Decision time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
		"compensatesDecisionId": uuidSchema("Decision compensated by undo.", "7b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
	}, "id", "decision", "candidateVersion", "actorId", "decidedAt")
	schemas["RelationshipIdentityLineage"] = objectSchema("Immutable graph lineage produced by an identity decision.", obj{
		"id": uuidSchema("Lineage event id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "kind": stringSchema("Lineage kind.", "merged"),
		"actorId": uuidSchema("Actor.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "reason": stringSchema("Reason.", "Confirmed duplicate."),
		"observationIds":        arraySchema("Moved observation ids.", stringSchema("Observation id.", "observation:1")),
		"identityIds":           arraySchema("Affected identity ids.", stringSchema("Identity id.", "identity:1")),
		"movedObjectRefs":       arraySchema("All moved graph objects.", stringSchema("Object ref.", "relationship-observation:1")),
		"beforeRelationshipIds": arraySchema("Relationship ids before.", stringSchema("Relationship id.", "relationship:1")),
		"afterRelationshipIds":  arraySchema("Relationship ids after.", stringSchema("Relationship id.", "relationship:2")),
		"occurredAt":            stringSchema("Event time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
	}, "id", "kind", "actorId", "observationIds", "identityIds", "movedObjectRefs", "beforeRelationshipIds", "afterRelationshipIds", "occurredAt")
	schemas["RelationshipIdentityCandidate"] = objectSchema("Durable, optimistic-versioned exact-anchor ambiguity review.", obj{
		"id": uuidSchema("Candidate id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "status": stringEnum("Review state.", "pending", "pending", "deferred", "resolving", "resolved", "undone"),
		"candidateType": stringSchema("Candidate kind.", "anchor_collision"), "version": intSchema("Optimistic version.", 1),
		"proposedRelationship": ref("RevenueRelationship"), "existingRelationship": ref("RevenueRelationship"),
		"anchorKind": stringSchema("Exact anchor kind.", "provider_resource"), "anchorProvider": stringSchema("Provider.", "hubspot"), "anchorPreview": stringSchema("Redacted anchor preview.", "contact …123"),
		"matchingAnchors": arraySchema("Matching exact anchors.", stringSchema("Anchor.", "hubspot:contact:123")), "conflictingAnchors": arraySchema("Conflicting anchors.", stringSchema("Anchor.", "email:other@example.com")),
		"evidenceRefs": arraySchema("Evidence references.", stringSchema("Evidence ref.", "relationship-observation:1")), "evidenceCount": intSchema("Affected evidence count.", 4),
		"evidenceFrom": stringSchema("Earliest evidence.", "2026-01-01T00:00:00Z", obj{"format": "date-time"}, nullable()), "evidenceTo": stringSchema("Latest evidence.", "2026-07-31T00:00:00Z", obj{"format": "date-time"}, nullable()),
		"impact": freeFormSchema("Counts and history that would move."), "recommendedDecision": stringSchema("Advisory decision.", "merge"), "recommendationConfidence": numberSchema("Advisory confidence.", 0.92),
		"decision": stringSchema("Resolved decision.", "merge"), "decisionReason": stringSchema("Reason.", "Confirmed duplicate."), "decisionActorId": uuidSchema("Actor.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "decidedAt": stringSchema("Decision time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"decisions": arraySchema("Decision history.", ref("RelationshipIdentityDecision")), "lineage": arraySchema("Lineage history.", ref("RelationshipIdentityLineage")),
	}, "id", "status", "candidateType", "version", "proposedRelationship", "existingRelationship", "anchorKind", "matchingAnchors", "conflictingAnchors", "evidenceRefs", "evidenceCount", "impact", "recommendedDecision", "recommendationConfidence", "decisions", "lineage")

	schemas["RelationshipAttentionItem"] = objectSchema("Versioned relationship-native reason for portfolio attention.", obj{
		"id": uuidSchema("Attention id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "version": intSchema("Optimistic version.", 1),
		"relationshipId": uuidSchema("Relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "relationshipName": stringSchema("Relationship name.", "Acme"),
		"reasonCode": stringSchema("Detector reason.", "overdue_commitment"), "explanation": stringSchema("Readable explanation.", "A confirmed commitment is overdue by two days."),
		"triggeringObjectRef": stringSchema("Triggering object.", "commitment:123"), "evidenceRefs": arraySchema("Evidence refs.", stringSchema("Evidence ref.", "relationship-observation:1")),
		"urgencyBand": stringEnum("Urgency.", "high", "low", "normal", "high", "critical"), "rankScore": intSchema("Internal deterministic rank.", 82), "rankFactors": freeFormSchema("Readable factor contributions."),
		"sourceRequirements": arraySchema("Fresh sources required.", stringSchema("Source.", "google")), "recommendationId": uuidSchema("Recommendation id.", "7b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "recommendationRevision": intSchema("Recommendation revision.", 2),
		"ownerId": uuidSchema("Owner id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "status": stringEnum("Triage state.", "open", "open", "acknowledged", "snoozed", "dismissed", "superseded", "resolved"), "stateReason": stringSchema("Triage reason.", "Reviewed with account owner."),
		"snoozedUntil": stringSchema("Snooze time.", "2026-08-07T14:00:00Z", obj{"format": "date-time"}, nullable()), "expiresAt": stringSchema("Expiry time.", "2026-08-07T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"detectorVersion": intSchema("Detector version.", 1), "projectorVersion": intSchema("Projector version.", 1), "relationshipStateVersion": intSchema("Relationship version evaluated.", 4),
		"acknowledgedBy": uuidSchema("Acknowledging actor.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "acknowledgedAt": stringSchema("Acknowledged time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"dismissedBy": uuidSchema("Dismissing actor.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"), "dismissedAt": stringSchema("Dismissed time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"createdAt": stringSchema("Created time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}), "updatedAt": stringSchema("Updated time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
	}, "id", "version", "relationshipId", "relationshipName", "reasonCode", "explanation", "triggeringObjectRef", "evidenceRefs", "urgencyBand", "rankScore", "rankFactors", "sourceRequirements", "status", "detectorVersion", "projectorVersion", "relationshipStateVersion", "createdAt", "updatedAt")

	schemas["MissionControlReadModel"] = objectSchema("One server-owned, version-consistent answer to state, change, evidence, action, completeness, and control.", obj{
		"contractVersion": stringSchema("Read-contract version.", "tfa-2026-07-31"), "aggregateHash": stringSchema("Stable hash of every material answer in this aggregate.", "sha256:cd34"), "asOf": stringSchema("Explicit response boundary.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
		"stateVersion": intSchema("Relationship state version.", 4), "stateHash": stringSchema("Stable state hash.", "sha256:ab12"), "projectorVersion": intSchema("Projector version.", 1), "detectorVersion": intSchema("Detector version.", 1),
		"freshnessBoundary": stringSchema("Earliest source freshness boundary.", "2026-07-31T14:30:00Z", obj{"format": "date-time"}, nullable()), "previousReviewedStateVersion": intSchema("Last acknowledged version.", 3), "changedSinceReview": boolSchema("Whether material state changed.", true),
		"changes": arraySchema("Dimension-level changes.", freeFormSchema("Mission Control change.")), "evidence": freeFormSchema("Dimension-keyed winning assertions and evidence references."),
		"completeness": freeFormSchema("Source coverage, missing dimensions, ambiguity, and external-action safety."), "activeRecommendation": freeFormSchema("Active revision-bound recommendation and factors."),
		"pending": freeFormSchema("Pending correction, identity, approval, execution, and reconciliation counts."), "capabilities": freeFormSchema("Authorized operation links."),
	}, "contractVersion", "aggregateHash", "asOf", "stateVersion", "stateHash", "projectorVersion", "detectorVersion", "previousReviewedStateVersion", "changedSinceReview", "changes", "evidence", "completeness", "pending", "capabilities")

	schemas["BetaDiagnostics"] = objectSchema("Metadata-only support export. It excludes relationship names, addresses, evidence, action bodies, tokens, cursors, raw errors, and correlation identifiers.", obj{
		"schemaVersion": stringSchema("Diagnostics contract version.", "tfa-support-v1"),
		"generatedAt":   stringSchema("Generation time.", "2026-08-01T15:00:00Z", obj{"format": "date-time"}),
		"workspaceRef":  stringSchema("One-way workspace support reference.", "workspace:sha256:ab12"),
		"features": arraySchema("Workspace rollout controls.", objectSchema("Feature diagnostic.", obj{
			"capability": stringSchema("Capability id.", "action_gmail"), "enabled": boolSchema("Whether enabled.", false),
			"rolloutStage": stringSchema("Rollout stage.", "internal_read_only"), "reasonCode": stringSchema("Categorical change reason.", "internal_canary"),
		}, "capability", "enabled", "rolloutStage")),
		"sources": arraySchema("Redacted connection lifecycle metadata.", objectSchema("Source diagnostic.", obj{
			"connectionRef": stringSchema("One-way connection support reference.", "connection:sha256:ab12"), "source": stringSchema("Provider.", "hubspot"),
			"sourceAccountRef": stringSchema("One-way provider account support reference.", "source-account:sha256:cd34"), "status": stringSchema("Lifecycle state.", "degraded"), "completeness": stringSchema("Completeness state.", "stale"),
			"backfillPhase": stringSchema("Backfill phase.", "failed"), "backfillCompleted": intSchema("Completed units.", 20), "backfillTotal": intSchema("Total units.", 100),
			"lagSeconds": intSchema("Current lag.", 900), "missingScopeCount": intSchema("Count only; scope values remain on the user-facing connection card.", 0),
			"errorCode": stringSchema("Safe categorical error.", "provider_outage"), "retryCount": intSchema("Retry attempts.", 2),
		}, "connectionRef", "source", "sourceAccountRef", "status", "completeness", "backfillPhase", "backfillCompleted", "backfillTotal", "lagSeconds", "missingScopeCount", "retryCount")),
		"counts": freeFormSchema("Bounded operational counts keyed by stable category."),
		"trustFunnel": arraySchema("Categorical trust funnel totals.", objectSchema("Trust total.", obj{
			"eventName": stringSchema("Event category.", "mission_control_opened"), "outcome": stringSchema("Outcome category.", "viewed"), "count": intSchema("Total.", 12),
		}, "eventName", "outcome", "count")),
		"checks": arraySchema("Release guardrail checks.", objectSchema("Diagnostic check.", obj{
			"code": stringSchema("Stable check code.", "projection_dead_letter"), "status": stringEnum("Check state.", "pass", "pass", "attention"),
			"explanation": stringSchema("Content-free operator explanation.", "No relationship projection is dead-lettered."), "count": intSchema("Affected objects.", 0),
		}, "code", "status", "explanation", "count")),
	}, "schemaVersion", "generatedAt", "workspaceRef", "features", "sources", "counts", "trustFunnel", "checks")

	schemas["ConversationClaim"] = objectSchema("A material conversation claim anchored to exact words, time, speaker confidence, and capture caveats.", obj{
		"id":                stringSchema("Stable claim id.", "claim:ab12"),
		"kind":              stringEnum("Claim kind.", "risk", "risk", "objection", "decision", "milestone", "sentiment", "stakeholder", "lifecycle", "commitment"),
		"value":             stringSchema("Normalized claim value.", "Security review may delay renewal."),
		"exactQuote":        stringSchema("Exact supporting transcript words.", "We are concerned security could delay the renewal."),
		"startMs":           intSchema("Start offset in milliseconds.", 12000),
		"endMs":             intSchema("End offset in milliseconds.", 16000),
		"speakerId":         stringSchema("Meeting-scoped speaker id; never a persistent voiceprint.", "anonymous:remote-channel"),
		"speakerLabel":      stringSchema("Current meeting-scoped speaker label.", "Other"),
		"speakerConfidence": numberSchema("Speaker attribution confidence.", 0.55),
		"confidence":        numberSchema("Claim confidence.", 0.72),
		"captureCaveats":    arraySchema("Capture caveats.", stringSchema("Caveat.", "Remote channel may contain multiple speakers.")),
		"material":          boolSchema("Whether the claim can affect state or action.", true),
		"stateDimension":    stringSchema("Projected state dimension when applicable.", "risk"),
		"observationId":     uuidSchema("Supporting immutable observation.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
	}, "id", "kind", "value", "exactQuote", "startMs", "endMs", "speakerId", "speakerLabel", "speakerConfidence", "confidence", "captureCaveats", "material")

	schemas["ConversationReviewItem"] = objectSchema("One evidence-backed proposed change requiring approve, correct, reject, or defer review.", obj{
		"id":                 stringSchema("Stable review item id.", "review:ab12"),
		"kind":               stringEnum("Review kind.", "speaker", "word", "speaker", "entity", "claim", "capture"),
		"label":              stringSchema("Review prompt.", "Resolve the speaker for a material statement."),
		"currentValue":       stringSchema("Current inferred value.", "Other"),
		"confidence":         numberSchema("Current confidence.", 0.55),
		"observationId":      uuidSchema("Supporting observation.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"claimId":            stringSchema("Material claim id.", "claim:ab12"),
		"stateDimension":     stringSchema("Canonical state dimension affected by correction.", "risk"),
		"exactQuote":         stringSchema("Exact words under review.", "We are concerned."),
		"batchId":            stringSchema("Idempotent review batch id.", "review:ab12"),
		"status":             stringEnum("Review state.", "pending_review", "pending_review", "accepted", "corrected", "rejected", "deferred"),
		"before":             freeFormSchema("State pinned before conversation processing."),
		"proposedAfter":      freeFormSchema("Typed proposed value after this item."),
		"caveats":            arraySchema("Extraction and capture caveats.", stringSchema("Caveat.", "Speaker assignment requires review.")),
		"dependentActionIds": arraySchema("Actions invalidated by rejection or correction.", stringSchema("Action id.", "action:ab12")),
		"baselineVersion":    intSchema("Pinned relationship-state version.", 4),
	}, "id", "kind", "label", "currentValue", "confidence", "observationId")

	schemas["ConversationGovernanceReceipt"] = objectSchema("Capture, routing, retention, disclosure, legal-hold, deletion, and evidence-clip receipt stored beside a transcript.", obj{
		"receiptId":             stringSchema("Receipt id.", "governance:ab12"),
		"capturedAt":            stringSchema("Capture time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
		"capturePolicy":         stringSchema("Capture policy in force.", "manual_capture"),
		"routing":               stringSchema("Evidence routing path.", "local_transcription_to_oppulence"),
		"region":                stringSchema("Processing region or boundary.", "local_device"),
		"retention":             stringSchema("Retention policy.", "untilTranscribed"),
		"participantDisclosure": stringSchema("Recorded participant disclosure status.", "not_recorded"),
		"legalHold":             boolSchema("Whether deletion is blocked by legal hold.", false),
		"deletionOutcome":       stringSchema("Observed deletion outcome.", "scheduled_after_transcription"),
		"evidenceClip":          stringEnum("Material audio evidence status; retained clips may only be encrypted.", "not_retained", "not_retained", "encrypted"),
	}, "receiptId", "capturedAt", "capturePolicy", "routing", "region", "retention", "participantDisclosure", "legalHold", "deletionOutcome", "evidenceClip")

	schemas["ResolvedConversationPolicy"] = objectSchema("Monotonically resolved conversation policy with every contributing layer recorded.", obj{
		"capture":          stringEnum("Capture rule.", "require_consent", "deny", "require_consent", "allow"),
		"modelRoute":       stringEnum("Most permissive model route allowed.", "local_only", "local_only", "region_restricted", "hosted_allowed"),
		"publishEvidence":  boolSchema("Whether shared evidence publication is allowed.", true),
		"externalShare":    boolSchema("Whether externally scoped plan sharing is allowed.", true),
		"retentionDays":    intSchema("Maximum retention in days.", 30),
		"redactionClasses": arraySchema("Classes removed at outbound boundaries.", stringSchema("Redaction class.", "personal_identifier")),
		"legalHold":        boolSchema("Whether required deletion is blocked.", false),
		"policyVersion":    stringSchema("Hash-bound effective policy version.", "policy:ab12"),
		"sourceLayerIds":   arraySchema("Policy layers that contributed.", stringSchema("Layer id.", "workspace:default")),
		"resolvedAt":       stringSchema("Resolution time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
	}, "capture", "modelRoute", "publishEvidence", "externalShare", "retentionDays", "redactionClasses", "legalHold", "policyVersion", "sourceLayerIds", "resolvedAt")

	schemas["ConversationDeletionReceipt"] = objectSchema("Immutable deletion request and per-target verification state. Pending device or provider targets keep the receipt partial.", obj{
		"receiptId":   stringSchema("Idempotent request id.", "delete:ab12"),
		"requestedAt": stringSchema("Request time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
		"scopeRef":    stringSchema("Relationship scope.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"legalHold":   boolSchema("Whether legal hold blocked deletion.", false),
		"status":      stringEnum("Aggregate deletion state.", "partial", "pending", "blocked", "partial", "verified"),
		"targets": arraySchema("Per-target outcomes.", objectSchema("Deletion target outcome.", obj{
			"target":           stringEnum("Deletion target.", "api_evidence", "local_recording", "local_note", "outbox", "api_evidence", "embedding", "plan_share", "provider"),
			"status":           stringEnum("Target state.", "deleted", "pending", "deleted", "not_found", "blocked", "failed"),
			"verificationHash": stringSchema("Content-free verification hash.", "sha256:ab12"),
			"errorCode":        stringSchema("Bounded failure code.", "legal_hold"),
			"attempts":         intSchema("Attempts made.", 1),
		}, "target", "status", "attempts")),
		"completedAt": stringSchema("Time every required target was verified.", "2026-07-31T14:01:00Z", obj{"format": "date-time"}, nullable()),
	}, "receiptId", "requestedAt", "scopeRef", "legalHold", "status", "targets")

	schemas["RelationshipIntelligence"] = objectSchema("Derived trust surface for a relationship: conversation claims, focused review, exact delta, governance, contradictions, and live cue cards.", obj{
		"claims":                    arraySchema("Material quote-backed claims.", ref("ConversationClaim")),
		"reviewItems":               arraySchema("Only low-confidence review items.", ref("ConversationReviewItem")),
		"governanceReceipts":        arraySchema("Transcript governance receipts.", ref("ConversationGovernanceReceipt")),
		"delta":                     freeFormSchema("Exact before/after values, uncertain claim ids, contradictions, and recommendation reason."),
		"liveCues":                  arraySchema("Account-history cue cards for the next/live meeting.", freeFormSchema("Cue card.")),
		"contradictionCases":        arraySchema("Typed durable conflicts.", freeFormSchema("Contradiction case.")),
		"recoveryEvaluations":       arraySchema("Bounded commitment recovery evaluations.", freeFormSchema("Recovery evaluation.")),
		"recommendationEvaluations": arraySchema("Immutable contextual ranking factors.", freeFormSchema("Recommendation evaluation.")),
		"mutualActionPlans":         arraySchema("Revision-bound bilateral plans.", freeFormSchema("Mutual action plan.")),
		"effectivePolicy":           ref("ResolvedConversationPolicy"),
		"governanceDecisions":       arraySchema("Immutable checkpoint decisions.", freeFormSchema("Governance decision.")),
		"deletionReceipts":          arraySchema("Deletion status and verification.", ref("ConversationDeletionReceipt")),
	}, "claims", "reviewItems", "governanceReceipts", "delta", "liveCues", "contradictionCases", "recoveryEvaluations", "recommendationEvaluations", "mutualActionPlans", "effectivePolicy", "governanceDecisions", "deletionReceipts")

	schemas["RelationshipGraphNode"] = objectSchema("A versioned, typed relationship graph node. Meaning is explicit so clients can render status without relying on color alone.", obj{
		"id":                 stringSchema("Stable node id.", "relationship:9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":               stringEnum("Node kind.", "relationship", "relationship", "person", "commitment", "risk", "milestone", "action", "evidence", "source", "note"),
		"label":              stringSchema("Human-readable label.", "Northstar Labs"),
		"relationshipId":     uuidSchema("Primary relationship id when applicable.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"relationshipIds":    arraySchema("All associated relationships, including shared participants.", uuidSchema("Relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5")),
		"summary":            stringSchema("Evidence-backed summary.", "Security review is overdue."),
		"status":             stringSchema("Domain status.", "open"),
		"role":               stringSchema("Participant role.", "champion"),
		"source":             stringSchema("Evidence source.", "meeting"),
		"lifecycle":          stringSchema("Commercial lifecycle.", "renewal"),
		"engagement":         stringSchema("Engagement state.", "declining"),
		"sentiment":          stringSchema("Sentiment state.", "mixed"),
		"health":             stringSchema("Health state.", "needs_attention"),
		"approvalStatus":     stringSchema("Action approval state.", "pending"),
		"policyStatus":       stringSchema("Action policy state.", "passed"),
		"executionStatus":    stringSchema("Action execution state.", "pending"),
		"freshness":          stringEnum("Evidence freshness.", "current", "current", "aging", "stale", "unknown"),
		"confidence":         obj{"type": "number", "minimum": 0, "maximum": 1, "example": 0.88},
		"priority":           obj{"type": "integer", "minimum": 0, "maximum": 100, "example": 82},
		"dueAt":              stringSchema("Due time.", "2026-08-12T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"occurredAt":         stringSchema("Evidence occurrence time.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"updatedAt":          stringSchema("Last material update.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"changedSinceReview": boolSchema("Whether this state is newer than the viewer's acknowledgement.", true),
		"changedDimensions":  arraySchema("Changed state dimensions.", stringSchema("Dimension.", "health")),
		"evidenceRefs":       arraySchema("Inspectable evidence ids.", stringSchema("Evidence id.", "4b8dfa9b-a7b2-46ea-982c-622a914c00e5")),
		"resourceRef":        stringSchema("Underlying record id used by explicit Open actions.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"metadata":           freeFormSchema("Kind-specific bounded metadata."),
	}, "id", "kind", "label", "relationshipIds", "changedSinceReview", "changedDimensions", "evidenceRefs", "metadata")

	schemas["RelationshipGraphEdge"] = objectSchema("A typed graph edge whose source-to-target direction is semantically meaningful.", obj{
		"id":           stringSchema("Stable edge id.", "edge:ab12cd34"),
		"source":       stringSchema("Source node id.", "commitment:1"),
		"target":       stringSchema("Target node id.", "commitment:2"),
		"kind":         stringEnum("Edge kind.", "requires", "participant_of", "owns", "has_commitment", "blocks", "requires", "supersedes", "has_risk", "has_milestone", "recommended_for", "supports", "contradicts", "observed_from", "linked_note"),
		"label":        stringSchema("Human-readable edge label.", "requires"),
		"directed":     boolSchema("Whether the source-to-target direction is meaningful.", true),
		"confidence":   obj{"type": "number", "minimum": 0, "maximum": 1, "example": 0.88},
		"evidenceRefs": arraySchema("Evidence supporting the connection.", stringSchema("Evidence id.", "4b8dfa9b-a7b2-46ea-982c-622a914c00e5")),
	}, "id", "source", "target", "kind", "label", "directed", "evidenceRefs")

	schemas["RelationshipGraph"] = objectSchema("Shared read model for Account Graph and Portfolio Graph in web and desktop. Historical reads are bounded by asOf and every governed action remains permission-gated.", obj{
		"contractVersion": stringSchema("Wire contract version.", "2026-08-01"),
		"generatedAt":     stringSchema("Projection generation time.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}),
		"asOf":            stringSchema("Historical evidence boundary.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}),
		"historical":      boolSchema("Whether the response is an historical projection.", false),
		"scope":           stringEnum("Graph scope.", "portfolio", "portfolio", "relationship"),
		"relationshipId":  uuidSchema("Relationship id for account scope.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"depth":           obj{"type": "integer", "minimum": 1, "maximum": 3, "example": 2},
		"nodes":           arraySchema("Typed nodes.", ref("RelationshipGraphNode")),
		"edges":           arraySchema("Typed directed edges.", ref("RelationshipGraphEdge")),
		"permissions": objectSchema("Viewer capabilities for this projection.", obj{
			"canView":       boolSchema("May view.", true),
			"canContribute": boolSchema("May propose state or actions.", true),
			"canApprove":    boolSchema("May approve current action revisions.", false),
			"canExecute":    boolSchema("May explicitly execute approved actions.", false),
			"canSaveViews":  boolSchema("May save graph views.", true),
		}, "canView", "canContribute", "canApprove", "canExecute", "canSaveViews"),
	}, "contractVersion", "generatedAt", "asOf", "historical", "scope", "depth", "nodes", "edges", "permissions")

	schemas["RevenueAction"] = objectSchema("One Revenue Action Queue item. State is split into independent dimensions: queue triage, policy preflight, approval, and execution. Every edit creates a new revision and invalidates the previous policy decision and approval.", obj{
		"id":                      uuidSchema("Action id.", "1a8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"relationshipId":          uuidSchema("Owning relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"actionType":              stringEnum("Action type.", "warm_follow_up", "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up", "meeting_recap", "crm_update", "follow_up_task", "calendar_hold", "commitment_rescue"),
		"channel":                 stringEnum("Delivery channel.", "email", "email", "slack", "call", "crm_task", "crm", "task", "calendar"),
		"detector":                stringEnum("Detector that produced the action.", "manual", "requested_follow_up_due", "unanswered_proposal", "waiting_on_me", "dormant_warm_opportunity", "neglected_referral", "former_customer_reconnect", "conversation_action_pack", "commitment_due", "manual"),
		"revision":                intSchema("Current revision number.", 1),
		"revisionHash":            stringSchema("Canonical hash of the revision content.", "sha256:ab12..."),
		"reason":                  stringSchema("Human-readable evidence-backed reason.", "They asked for a follow-up in July."),
		"recipientEmail":          stringSchema("Recipient email address.", "buyer@example.com"),
		"proposedSubject":         stringSchema("Proposed email subject.", "Following up as promised"),
		"proposedMessage":         stringSchema("Proposed message body.", "Hi Jordan — you asked me to circle back this month..."),
		"senderAccountRef":        stringSchema("Sender account reference.", "gmail:me@company.com"),
		"priorityScore":           intSchema("Explainable priority score (0-100).", 82),
		"priorityComponents":      freeFormSchema("Per-component priority breakdown; every component is stored and shown."),
		"queueStatus":             stringEnum("Operator triage state.", "open", "open", "snoozed", "dismissed", "handled"),
		"policyStatus":            stringEnum("Preflight state. Facade unavailability keeps pending (fail closed).", "pending", "pending", "passed", "review_required", "blocked", "stale"),
		"approvalStatus":          stringEnum("Approval state, bound to the exact revision and decision.", "pending", "pending", "approved", "rejected"),
		"executionStatus":         stringEnum("Execution state. A lost provider result is ambiguous, never auto-resent.", "pending", "pending", "requested", "sent", "failed", "ambiguous", "cancelled"),
		"executionOwner":          stringEnum("Exactly one owner may execute a revision.", "rowboat", "rowboat", "outbound"),
		"executionMode":           stringEnum("Draft lands in the operator's mailbox; send requires a passed unexpired decision and a linked workspace.", "draft", "draft", "send"),
		"approvedRevision":        intSchema("Revision the approval is bound to.", 1),
		"approvedAt":              stringSchema("Approval time.", "2026-07-12T12:05:00Z", obj{"format": "date-time"}, nullable()),
		"providerMessageId":       stringSchema("Provider message id after execution.", "msg_01"),
		"providerThreadId":        stringSchema("Provider thread id after execution.", "thread_01"),
		"executedAt":              stringSchema("Execution time.", "2026-07-12T12:06:00Z", obj{"format": "date-time"}, nullable()),
		"executionError":          stringSchema("Bounded execution error.", ""),
		"reconciliationStatus":    stringEnum("Read-only provider reconciliation state for an ambiguous write.", "pending", "pending", "found", "not_found", "error", "manual_review"),
		"reconciliationAttempts":  intSchema("Number of bounded provider lookups performed.", 1),
		"reconciliationCheckedAt": stringSchema("Most recent provider lookup time.", "2026-07-12T12:07:00Z", obj{"format": "date-time"}, nullable()),
		"reconciliationNextAt":    stringSchema("Next scheduled read-only lookup time.", "2026-07-12T12:12:00Z", obj{"format": "date-time"}, nullable()),
		"reconciliationError":     stringSchema("Bounded provider lookup error.", ""),
		"dismissReason":           stringSchema("Dismissal reason label.", "already_handled"),
		"snoozedUntil":            stringSchema("Snooze wake time.", "2026-07-20T09:00:00Z", obj{"format": "date-time"}, nullable()),
		"dueAt":                   stringSchema("Due time.", "2026-07-15T00:00:00Z", obj{"format": "date-time"}, nullable()),
		"createdAt":               stringSchema("Creation time.", "2026-07-12T12:00:00Z", obj{"format": "date-time"}),
		"updatedAt":               stringSchema("Last update time.", "2026-07-12T12:06:00Z", obj{"format": "date-time"}),
		"evidence": arraySchema("Exact supporting evidence available in the approval UI.", objectSchema("Action evidence.", obj{
			"id":                   uuidSchema("Evidence id.", "4b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
			"source":               stringSchema("Evidence source.", "meeting"),
			"sourceRecordId":       stringSchema("Source record id.", "oppulence:session-42:claim:claim-risk"),
			"excerpt":              stringSchema("Exact supporting words.", "We are concerned security could delay renewal."),
			"occurredAt":           stringSchema("Evidence time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}),
			"externalEvidenceRefs": arraySchema("Observation, timestamp, and speaker references.", stringSchema("Reference.", "timestamp:12000-16000")),
		}, "id", "source", "sourceRecordId", "occurredAt", "externalEvidenceRefs")),
	}, "id", "actionType", "channel", "detector", "revision", "revisionHash", "reason", "priorityScore", "queueStatus", "policyStatus", "approvalStatus", "executionStatus", "executionOwner", "executionMode", "evidence")

	schemas["RevenuePolicyDecision"] = objectSchema("Immutable OutboundConsole preflight decision for one exact action revision. Rowboat snapshots the decision; it never composes one.", obj{
		"id":           uuidSchema("Decision snapshot id.", "2b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"revision":     intSchema("Action revision the decision is about.", 1),
		"revisionHash": stringSchema("Revision hash the decision is bound to.", "sha256:ab12..."),
		"status":       stringEnum("Decision status.", "passed", "passed", "review_required", "blocked"),
		"reasonCodes":  arraySchema("Bounded reason codes.", stringSchema("Reason code.", "suppression.opted_out")),
		"verification": freeFormSchema("Verification sub-result snapshot."),
		"suppression":  freeFormSchema("Suppression sub-result snapshot."),
		"research":     freeFormSchema("Research sub-result snapshot."),
		"crm":          freeFormSchema("CRM sub-result snapshot; unknown when the connector is unavailable."),
		"evaluatedAt":  stringSchema("Evaluation time.", "2026-07-12T12:00:00Z", obj{"format": "date-time"}),
		"expiresAt":    stringSchema("Decision expiry; expired decisions must be re-evaluated before approval or execution.", "2026-07-13T12:00:00Z", obj{"format": "date-time"}),
	}, "id", "revision", "revisionHash", "status", "evaluatedAt", "expiresAt")

	schemas["RevenueImpact"] = objectSchema("Aggregate ROI picture for the caller's revenue queue: how many open loops were surfaced, how they were triaged, how many were acted on, and what came back.", obj{
		"surfaced":       intSchema("Total actions ever surfaced.", 42),
		"open":           intSchema("Actions currently open.", 8),
		"handled":        intSchema("Actions marked handled.", 20),
		"snoozed":        intSchema("Actions snoozed.", 3),
		"dismissed":      intSchema("Actions dismissed.", 11),
		"approved":       intSchema("Actions approved.", 18),
		"executed":       intSchema("Actions executed (draft created or email sent).", 16),
		"replied":        intSchema("Replies observed.", 6),
		"meetingsBooked": intSchema("Meetings booked.", 2),
		"won":            intSchema("Deals marked won.", 1),
		"lost":           intSchema("Deals marked lost.", 1),
		"replyRate":      obj{"type": "number", "nullable": true, "description": "Reply rate = replied / executed; null with no denominator.", "example": 0.38},
		"meetingRate":    obj{"type": "number", "nullable": true, "description": "Meeting rate = meetings / executed; null with no denominator.", "example": 0.12},
		"outcomes":       freeFormSchema("Raw outcome-kind counts."),
		"byDetector": arraySchema("Per-detector contribution.", objectSchema("Detector stat.", obj{
			"detector": stringSchema("Detector.", "unanswered_proposal"),
			"surfaced": intSchema("Surfaced by this detector.", 12),
			"handled":  intSchema("Handled from this detector.", 7),
		})),
	}, "surfaced", "open", "handled", "approved", "executed")

	schemas["RevenueDigest"] = objectSchema("The proactive digest content: the top open loops plus running impact counts. This is what the scheduled digest email is built from.", obj{
		"generatedAt":    stringSchema("When composed.", "2026-07-23T09:00:00Z", obj{"format": "date-time"}),
		"openCount":      intSchema("Total open actions.", 8),
		"replied":        intSchema("Replies observed.", 6),
		"meetingsBooked": intSchema("Meetings booked.", 2),
		"handled":        intSchema("Actions handled.", 20),
		"top": arraySchema("Highest-priority open loops.", objectSchema("Digest action.", obj{
			"detector":  stringSchema("Human detector label.", "Unanswered proposal"),
			"recipient": stringSchema("Recipient email.", "buyer@example.com"),
			"reason":    stringSchema("Evidence-backed reason.", "You sent a proposal 10 days ago with no reply."),
			"priority":  intSchema("Priority score.", 82),
		})),
	}, "generatedAt", "openCount")

	schemas["RevenueLeakScan"] = objectSchema("One bounded historical scan over connected sources (Gmail first). Detectors are deterministic; counts, errors, and freshness make runs incremental and auditable.", obj{
		"id":                   uuidSchema("Scan id.", "4d8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"status":               stringEnum("Scan status.", "completed", "pending", "running", "completed", "failed"),
		"mode":                 stringEnum("Workspace mode at scan time.", "local", "local", "linked"),
		"lookbackDays":         intSchema("Historical lookback in days.", 90),
		"threadsSeen":          intSchema("Threads examined.", 42),
		"candidatesSeen":       intSchema("Detector candidates found.", 7),
		"relationshipsCreated": intSchema("New relationships recorded.", 3),
		"evidencesCreated":     intSchema("New evidence rows recorded.", 5),
		"actionsCreated":       intSchema("New queue actions created.", 5),
		"startedAt":            stringSchema("Start time.", "2026-07-23T12:00:00Z", obj{"format": "date-time"}, nullable()),
		"completedAt":          stringSchema("Completion time.", "2026-07-23T12:00:40Z", obj{"format": "date-time"}, nullable()),
		"sourceFreshnessAt":    stringSchema("Newest source timestamp observed (incremental cursor).", "2026-07-22T09:00:00Z", obj{"format": "date-time"}, nullable()),
		"error":                stringSchema("Bounded failure reason.", ""),
	}, "id", "status", "mode", "lookbackDays")

	schemas["RevenueOutcome"] = objectSchema("One observed action outcome, append-only and idempotent on (action, source, sourceEventId).", obj{
		"id":            uuidSchema("Outcome id.", "3c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":          stringEnum("Outcome kind.", "replied", "sent", "delivered", "bounced", "replied", "meeting_booked", "won", "lost", "dismissed", "bad_recommendation", "deal_advanced", "onboarding_progressed", "renewed", "escalated", "churned", "corrected"),
		"source":        stringEnum("Observing source.", "gmail", "gmail", "calendar", "crm", "user", "outbound", "slack", "meeting", "task"),
		"sourceEventId": stringSchema("Source event id used for deduplication.", "msg_01"),
		"occurredAt":    stringSchema("When the outcome occurred.", "2026-07-12T14:00:00Z", obj{"format": "date-time"}),
	}, "id", "kind", "source", "sourceEventId", "occurredAt")
}

func addRevenuePaths(paths obj) {
	actionParam := []any{obj{"name": "actionId", "in": "path", "required": true, "description": "Action id.", "schema": obj{"type": "string", "format": "uuid"}}}

	paths["/v1/revenue-workspaces/current"] = obj{"get": operation("Revenue", "Get current revenue workspace", "Returns the caller's revenue workspace mapping and preflight health, creating the local-mode workspace on first touch.", "getRevenueWorkspace", bearer(), nil, nil, obj{
		"200": jsonResponse("Current workspace.", ref("RevenueWorkspace"), nil),
		"401": responseRef("401"),
	})}
	paths["/v1/revenue-workspaces/link"] = obj{"post": operation("Revenue", "Link the OutboundConsole workspace", "Completes the OutboundConsole workspace link and switches the workspace to linked mode. Requires a configured policy facade; without one the call fails closed.", "linkRevenueWorkspace", bearer(), nil, jsonRequest("OutboundConsole identifiers.", objectSchema("Link request.", obj{
		"outboundOrganizationId": stringSchema("OutboundConsole organization id.", "org_01ABC"),
		"outboundWorkspaceId":    stringSchema("OutboundConsole workspace id.", "ws_01ABC"),
	}, "outboundWorkspaceId"), obj{"outboundOrganizationId": "org_01ABC", "outboundWorkspaceId": "ws_01ABC"}), obj{
		"200": jsonResponse("Linked workspace.", ref("RevenueWorkspace"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"503": problemResponse("Policy facade unavailable; the link fails closed.", ref("ErrorEnvelope"), problemExample(503, "Service Unavailable", "policy preflight unavailable; the action stays pending", "facade_unavailable")),
	})}

	paths["/v1/revenue-impact"] = obj{"get": operation("Revenue", "Get the revenue impact summary", "Returns the aggregate ROI picture for the caller: actions surfaced, triage breakdown, executions, outcomes, reply/meeting rates, and per-detector contribution.", "getRevenueImpact", bearer(), nil, nil, obj{
		"200": jsonResponse("Impact summary.", ref("RevenueImpact"), nil),
		"401": responseRef("401"),
	})}
	paths["/v1/revenue-search"] = obj{"get": operation("Revenue", "Semantic search over mail", "Natural-language search over the caller's Layer-2 signals (RFC 031). Returns available=false with no matches when semantic memory is not configured.", "revenueSemanticSearch", bearer(), []any{obj{"name": "q", "in": "query", "required": true, "description": "Search query.", "schema": obj{"type": "string"}}}, nil, obj{
		"200": jsonResponse("Ranked matches.", objectSchema("Search result.", obj{
			"available": boolSchema("Whether semantic memory is configured.", true),
			"matches": arraySchema("Ranked matches.", objectSchema("Match.", obj{
				"threadId":       stringSchema("Provider thread id.", "thr_01"),
				"subject":        stringSchema("Thread subject.", "Proposal follow-up"),
				"counterparty":   stringSchema("Counterparty email.", "buyer@example.com"),
				"classification": stringEnum("Signal class.", "deal", "deal", "invoice", "client", "referral", "other"),
				"summary":        stringSchema("Derived summary.", "Unanswered proposal from 10 days ago."),
				"score":          numberSchema("Cosine similarity.", 0.82),
			})),
		}), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
	})}
	paths["/v1/revenue-digest"] = obj{"get": operation("Revenue", "Preview the proactive digest", "Returns the digest content the scheduled email is built from: the top open loops and running impact counts.", "getRevenueDigest", bearer(), nil, nil, obj{
		"200": jsonResponse("Digest content.", ref("RevenueDigest"), nil),
		"401": responseRef("401"),
	})}

	paths["/v1/revenue-leak-scans"] = obj{"post": operation("Revenue", "Start a revenue leak scan", "Starts a bounded historical scan over the user's connected Gmail (deterministic detectors, draft-first actions). One scan runs per workspace at a time; poll the scan id for progress.", "startRevenueLeakScan", bearer(), nil, jsonRequestOptional("Scan options.", objectSchema("Scan request.", obj{
		"lookbackDays": intSchema("Historical lookback in days (default 90, max 365).", 90),
	}), obj{"lookbackDays": 90}), obj{
		"202": jsonResponse("Scan started.", ref("RevenueLeakScan"), nil),
		"401": responseRef("401"),
		"409": problemResponse("A scan is already running, or no scan source is configured.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "revenue: scan unavailable: a scan is already running", "scan_unavailable")),
	})}
	paths["/v1/revenue-leak-scans/{scanId}"] = obj{"get": operation("Revenue", "Get scan progress", "Returns progress, counts, errors, and source freshness for one scan.", "getRevenueLeakScan", bearer(), []any{obj{"name": "scanId", "in": "path", "required": true, "description": "Scan id.", "schema": obj{"type": "string", "format": "uuid"}}}, nil, obj{
		"200": jsonResponse("Scan state.", ref("RevenueLeakScan"), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}

	paths["/v1/relationships"] = obj{
		"get": operation("Relationship Intelligence", "List relationships", "Lists canonical relationship state with optional text, lifecycle, health, and engagement filters.", "listRelationships", bearer(), []any{
			obj{"name": "q", "in": "query", "required": false, "description": "Account, domain, or contact search.", "schema": obj{"type": "string"}},
			obj{"name": "lifecycle", "in": "query", "required": false, "description": "Lifecycle filter.", "schema": obj{"type": "string"}},
			obj{"name": "health", "in": "query", "required": false, "description": "Health filter.", "schema": obj{"type": "string"}},
			obj{"name": "engagement", "in": "query", "required": false, "description": "Engagement filter.", "schema": obj{"type": "string"}},
		}, nil, obj{
			"200": jsonResponse("Relationships.", objectSchema("Relationship list.", obj{"relationships": arraySchema("Relationships.", ref("RevenueRelationship"))}), nil),
			"401": responseRef("401"),
		}),
		"post": operation("Relationship Intelligence", "Create a relationship", "Records a canonical relationship in the caller's workspace.", "createRelationship", bearer(), nil, jsonRequest("Relationship.", objectSchema("Create request.", obj{
			"kind":          stringEnum("Relationship kind.", "person", "person", "company", "customer", "opportunity", "referral", "partner"),
			"displayName":   stringSchema("Display name.", "Jordan Buyer"),
			"primaryEmail":  stringSchema("Primary email.", "buyer@example.com"),
			"accountDomain": stringSchema("Account domain.", "example.com"),
			"summary":       stringSchema("Summary.", "Warm lead from the April demo."),
		}, "kind", "displayName"), obj{"kind": "person", "displayName": "Jordan Buyer", "primaryEmail": "buyer@example.com"}), obj{
			"201": jsonResponse("Created relationship.", ref("RevenueRelationship"), nil),
			"400": responseRef("400"),
			"401": responseRef("401"),
		}),
	}
	paths["/v1/relationships/graph"] = obj{"get": operation(
		"Relationship Intelligence",
		"Get the relationship graph",
		"Returns the shared versioned graph read model for an account or the authorized portfolio. Historical asOf reads exclude later evidence and proposed actions.",
		"getRelationshipGraph",
		bearer(),
		[]any{
			obj{"name": "scope", "in": "query", "required": false, "description": "Portfolio or one relationship.", "schema": obj{"type": "string", "enum": []string{"portfolio", "relationship"}, "default": "portfolio"}},
			obj{"name": "relationshipId", "in": "query", "required": false, "description": "Required when scope=relationship.", "schema": obj{"type": "string", "format": "uuid"}},
			obj{"name": "depth", "in": "query", "required": false, "description": "Bounded graph expansion depth.", "schema": obj{"type": "integer", "minimum": 1, "maximum": 3, "default": 2}},
			obj{"name": "asOf", "in": "query", "required": false, "description": "Historical evidence boundary; must not be in the future.", "schema": obj{"type": "string", "format": "date-time"}},
		},
		nil,
		obj{
			"200": jsonResponse("Authorized relationship graph.", ref("RelationshipGraph"), nil),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
		},
	)}
	relationshipParam := []any{obj{"name": "relationshipId", "in": "path", "required": true, "description": "Relationship id.", "schema": obj{"type": "string", "format": "uuid"}}}
	paths["/v1/relationships/{relationshipId}"] = obj{"get": operation("Relationship Intelligence", "Get relationship mission control", "Returns living relationship state, governed recommendations, participants, and commitments.", "getRelationship", bearer(), relationshipParam, nil, obj{
		"200": jsonResponse("Relationship detail.", objectSchema("Relationship detail.", obj{
			"relationship":           ref("RevenueRelationship"),
			"actions":                arraySchema("Actions for this relationship.", ref("RevenueAction")),
			"recommendations":        arraySchema("Governed recommendations.", ref("RevenueAction")),
			"participants":           arraySchema("Relationship participants.", ref("RelationshipParticipant")),
			"commitments":            arraySchema("Open and completed commitments.", ref("RelationshipCommitment")),
			"commitmentDependencies": arraySchema("Evidence-backed commitment graph edges.", ref("CommitmentDependency")),
			"intelligence":           ref("RelationshipIntelligence"),
			"missionControl":         ref("MissionControlReadModel"),
		}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/timeline"] = obj{"get": operation("Relationship Intelligence", "Get evidence timeline", "Returns the latest immutable observations for a relationship.", "getRelationshipTimeline", bearer(), append(relationshipParam, obj{"name": "limit", "in": "query", "required": false, "description": "Maximum observations (1-100).", "schema": obj{"type": "integer"}}), nil, obj{
		"200": jsonResponse("Evidence timeline.", objectSchema("Observation list.", obj{"observations": arraySchema("Observations.", ref("RelationshipObservation"))}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/changes"] = obj{"get": operation("Relationship Intelligence", "Get relationship changes", "Returns immutable projection snapshots so operators can see what changed and why.", "getRelationshipChanges", bearer(), relationshipParam, nil, obj{
		"200": jsonResponse("State changes.", objectSchema("Snapshot list.", obj{"snapshots": arraySchema("Snapshots.", ref("RelationshipStateSnapshot"))}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/acknowledgements"] = obj{"post": operation("Relationship Intelligence", "Acknowledge Mission Control state", "Records the exact state version and hash the actor reviewed. A stale acknowledgement fails with 409.", "acknowledgeMissionControl", bearer(), relationshipParam, jsonRequest("Review boundary.", objectSchema("Mission Control acknowledgement.", obj{
		"stateVersion": intSchema("Reviewed state version.", 4), "stateHash": stringSchema("Reviewed state hash.", "sha256:ab12"),
	}, "stateVersion", "stateHash"), obj{"stateVersion": 4, "stateHash": "sha256:ab12"}), obj{
		"201": jsonResponse("Acknowledgement.", objectSchema("Mission Control acknowledgement result.", obj{"id": uuidSchema("Acknowledgement id.", "6b8dfa9b-a7b2-46ea-982c-622a914c00e5"), "stateVersion": intSchema("Reviewed state version.", 4), "stateHash": stringSchema("Reviewed hash.", "sha256:ab12"), "acknowledgedAt": stringSchema("Review time.", "2026-07-31T14:00:00Z", obj{"format": "date-time"})}, "id", "stateVersion", "stateHash", "acknowledgedAt"), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/evidence/{evidenceId}"] = obj{"get": operation("Relationship Intelligence", "Open source evidence", "Returns one observation plus its decrypted raw payload. Tenant ownership is enforced before decryption.", "getRelationshipEvidence", bearer(), append(relationshipParam, obj{"name": "evidenceId", "in": "path", "required": true, "description": "Observation id.", "schema": obj{"type": "string", "format": "uuid"}}), nil, obj{
		"200": jsonResponse("Source evidence.", objectSchema("Evidence result.", obj{"observation": ref("RelationshipObservation"), "payload": freeFormSchema("Decrypted provider payload.")}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/corrections"] = obj{"post": operation("Relationship Intelligence", "Correct relationship state", "Appends a user correction assertion and deterministically reprojects the relationship. Source evidence is never overwritten.", "correctRelationship", bearer(), relationshipParam, jsonRequest("Correction.", objectSchema("Relationship correction.", obj{
		"dimension":             stringEnum("Corrected state dimension.", "health", "lifecycle", "engagement", "sentiment", "health", "next_action"),
		"value":                 stringSchema("Correct value.", "healthy"),
		"reason":                stringSchema("Why the model is wrong.", "The review happened yesterday."),
		"supersedesAssertionId": stringSchema("Optional active assertion on the same relationship and dimension that this correction permanently replaces.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5", obj{"format": "uuid"}),
		"validTo":               stringSchema("Optional exclusive expiry boundary for a temporary correction.", "2026-08-31T17:00:00Z", obj{"format": "date-time"}, nullable()),
	}, "dimension", "value", "reason"), obj{"dimension": "health", "value": "healthy", "reason": "The review happened yesterday."}), obj{
		"201": jsonResponse("Reprojected relationship.", ref("RevenueRelationship"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	assertionParam := make([]any, len(relationshipParam), len(relationshipParam)+1)
	copy(assertionParam, relationshipParam)
	assertionParam = append(assertionParam, obj{"name": "assertionId", "in": "path", "required": true, "description": "User-correction assertion id.", "schema": obj{"type": "string", "format": "uuid"}})
	paths["/v1/relationships/{relationshipId}/assertions/{assertionId}/retract"] = obj{"post": operation("Relationship Intelligence", "Retract a relationship correction", "Ends one active user correction without rewriting its immutable history, then reprojects at the same explicit evaluation time.", "retractRelationshipAssertion", bearer(), assertionParam, jsonRequest("Retraction.", objectSchema("Correction retraction.", obj{
		"reason": stringSchema("Why the correction is being retracted.", "The correction was entered against the wrong customer call."),
	}, "reason"), obj{"reason": "The correction was entered against the wrong customer call."}), obj{
		"200": jsonResponse("Reprojected relationship.", ref("RevenueRelationship"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/conversation-corrections"] = obj{"post": operation("Relationship Intelligence", "Correct reviewed conversation evidence", "Resolves a focused word, speaker, entity, or material-claim review item. State-affecting corrections append a top-precedence user assertion and reproject deterministically.", "correctConversationEvidence", bearer(), relationshipParam, jsonRequest("Focused correction.", objectSchema("Conversation correction.", obj{
		"reviewItemId":   stringSchema("Focused review item id.", "review:ab12"),
		"correctedValue": stringSchema("Human-corrected value.", "Avery Chen"),
		"reason":         stringSchema("Correction reason.", "Avery was the speaker."),
	}, "reviewItemId", "correctedValue", "reason"), obj{"reviewItemId": "review:ab12", "correctedValue": "Avery Chen", "reason": "Avery was the speaker."}), obj{
		"201": jsonResponse("Corrected relationship and refreshed intelligence.", objectSchema("Correction result.", obj{"relationship": ref("RevenueRelationship"), "intelligence": ref("RelationshipIntelligence")}, "relationship", "intelligence"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/conversation-decisions"] = obj{"post": operation("Relationship Intelligence", "Decide a proposed conversation change", "Approves, corrects, rejects, or defers one evidence-backed semantic candidate. A stale baseline returns 409 and no state mutation.", "decideConversationChange", bearer(), relationshipParam, jsonRequest("Review decision.", objectSchema("Conversation review decision.", obj{
		"reviewItemId":   stringSchema("Review item id.", "review:ab12"),
		"kind":           stringEnum("Decision kind.", "approve", "approve", "correct", "reject", "defer"),
		"correctedValue": stringSchema("Required replacement for correct.", "Security review is complete."),
		"reason":         stringSchema("Decision reason.", "Customer clarified this in the meeting."),
		"deferUntil":     stringSchema("Future reminder for defer.", "2026-08-01T14:00:00Z", obj{"format": "date-time"}),
	}, "reviewItemId", "kind"), obj{"reviewItemId": "review:ab12", "kind": "approve", "reason": "Customer stated this directly."}), obj{
		"201": jsonResponse("Updated relationship and refreshed review queue.", objectSchema("Decision result.", obj{"relationship": ref("RevenueRelationship"), "intelligence": ref("RelationshipIntelligence")}, "relationship", "intelligence"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"409": responseRef("409"),
	})}
	caseParam := make([]any, len(relationshipParam), len(relationshipParam)+1)
	copy(caseParam, relationshipParam)
	caseParam = append(caseParam, obj{"name": "caseId", "in": "path", "required": true, "description": "Contradiction case id.", "schema": obj{"type": "string"}})
	paths["/v1/relationships/{relationshipId}/contradictions/{caseId}/resolve"] = obj{"post": operation("Relationship Intelligence", "Resolve a typed contradiction", "Records the user's selected evidence side as a top-authority correction without rewriting either source.", "resolveRelationshipContradiction", bearer(), caseParam, jsonRequest("Resolution.", objectSchema("Contradiction resolution.", obj{
		"selectedAssertionId": stringSchema("Selected assertion id.", "assertion:ab12"),
		"reason":              stringSchema("Optional rationale.", "CRM was updated after the meeting."),
	}, "selectedAssertionId"), obj{"selectedAssertionId": "assertion:ab12"}), obj{
		"201": jsonResponse("Updated relationship and intelligence.", freeFormSchema("Relationship detail result."), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/commitment-recovery/run"] = obj{"post": operation("Relationship Intelligence", "Run commitment recovery", "Reconciles due commitments against bounded fresh evidence, closes only explicit fulfillment, and queues governed recovery proposals otherwise.", "runCommitmentRecovery", bearer(), relationshipParam, jsonRequestOptional("Empty request.", objectSchema("Recovery request.", obj{}), obj{}), obj{
		"200": jsonResponse("Recovery evaluations.", freeFormSchema("Recovery evaluation result."), nil),
		"401": responseRef("401"), "404": responseRef("404"),
	})}
	commitmentParam := make([]any, len(relationshipParam), len(relationshipParam)+1)
	copy(commitmentParam, relationshipParam)
	commitmentParam = append(commitmentParam, obj{"name": "commitmentId", "in": "path", "required": true, "description": "Commitment id.", "schema": obj{"type": "string", "format": "uuid"}})
	paths["/v1/relationships/{relationshipId}/commitments/{commitmentId}/events"] = obj{"get": operation("Relationship Intelligence", "Get commitment history", "Returns the append-only transition history for one commitment.", "getCommitmentEvents", bearer(), commitmentParam, nil, obj{
		"200": jsonResponse("Commitment events.", objectSchema("Commitment history.", obj{"events": arraySchema("Ordered immutable events.", ref("CommitmentEvent"))}, "events"), nil),
		"401": responseRef("401"), "404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/commitments/{commitmentId}/transitions"] = obj{"post": operation("Relationship Intelligence", "Append a commitment transition", "Validates the state machine and appends one idempotent event before atomically updating the materialized projection.", "appendCommitmentTransition", bearer(), commitmentParam, jsonRequest("Transition.", objectSchema("Commitment transition.", obj{
		"kind":           stringEnum("Event kind.", "accepted", "internally_confirmed", "offered", "accepted", "disputed", "blocked", "unblocked", "due_date_changed", "renegotiated", "fulfilled", "cancelled", "superseded"),
		"idempotencyKey": stringSchema("Stable source event id.", "ui:accept:ab12"),
		"reason":         stringSchema("Optional reason.", "Counterparty accepted in writing."),
		"dueAt":          stringSchema("Replacement due date.", "2026-08-07T17:00:00Z", obj{"format": "date-time"}),
		"action":         stringSchema("Replacement action for renegotiation.", "Send revised packet."),
		"blocker":        stringSchema("Blocker detail.", "Waiting on legal."),
		"evidenceRefs":   arraySchema("Evidence references.", stringSchema("Reference.", "relationship-observation:ab12")),
	}, "kind", "idempotencyKey"), obj{"kind": "accepted", "idempotencyKey": "ui:accept:ab12", "evidenceRefs": []any{"counterparty:accepted"}}), obj{
		"200": jsonResponse("Updated commitment.", ref("RelationshipCommitment"), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/commitment-dependencies"] = obj{"post": operation("Relationship Intelligence", "Create a commitment dependency", "Creates an evidence-backed dependency after enforcing tenant and relationship scope and rejecting graph cycles.", "createCommitmentDependency", bearer(), relationshipParam, jsonRequest("Dependency.", objectSchema("Commitment dependency request.", obj{
		"fromCommitmentId": uuidSchema("Origin commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"toCommitmentId":   uuidSchema("Target commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":             stringEnum("Dependency semantics.", "blocks", "blocks", "requires", "supersedes"),
		"evidenceRefs":     arraySchema("Evidence references.", stringSchema("Reference.", "relationship-observation:ab12")),
	}, "fromCommitmentId", "toCommitmentId", "kind", "evidenceRefs"), obj{"fromCommitmentId": "8b8dfa9b-a7b2-46ea-982c-622a914c00e5", "toCommitmentId": "26cdbdc9-d0fc-4f8c-8660-2f0d62cfef51", "kind": "blocks", "evidenceRefs": []any{"relationship-observation:ab12"}}), obj{
		"201": jsonResponse("Created dependency.", ref("CommitmentDependency"), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/mutual-action-plans"] = obj{"post": operation("Relationship Intelligence", "Create a mutual action plan", "Creates an evidence-backed plan only from accepted or open commitments.", "createMutualActionPlan", bearer(), relationshipParam, jsonRequest("Accepted commitments.", objectSchema("Plan create request.", obj{
		"commitmentIds": arraySchema("Commitment ids.", uuidSchema("Commitment id.", "8b8dfa9b-a7b2-46ea-982c-622a914c00e5")),
	}, "commitmentIds"), obj{"commitmentIds": []any{"8b8dfa9b-a7b2-46ea-982c-622a914c00e5"}}), obj{
		"201": jsonResponse("Draft plan.", freeFormSchema("Mutual action plan."), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	planParam := make([]any, len(relationshipParam), len(relationshipParam)+1)
	copy(planParam, relationshipParam)
	planParam = append(planParam, obj{"name": "planId", "in": "path", "required": true, "description": "Mutual action plan id.", "schema": obj{"type": "string"}})
	paths["/v1/relationships/{relationshipId}/mutual-action-plans/{planId}"] = obj{"put": operation("Relationship Intelligence", "Revise a mutual action plan", "Appends a validated revision and invalidates any approval bound to the prior hash.", "reviseMutualActionPlan", bearer(), planParam, jsonRequest("Replacement items.", objectSchema("Plan revision request.", obj{
		"items": arraySchema("Plan items.", freeFormSchema("Mutual action plan item.")),
	}, "items"), nil), obj{
		"200": jsonResponse("Revised plan.", freeFormSchema("Mutual action plan."), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/mutual-action-plans/{planId}/approve"] = obj{"post": operation("Relationship Intelligence", "Approve a plan revision", "Binds internal approval to the exact current revision hash.", "approveMutualActionPlan", bearer(), planParam, jsonRequestOptional("Empty request.", objectSchema("Plan approval request.", obj{}), obj{}), obj{
		"200": jsonResponse("Approved plan.", freeFormSchema("Mutual action plan."), nil),
		"401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/mutual-action-plans/{planId}/share"] = obj{"post": operation("Relationship Intelligence", "Queue an approved plan share", "Re-evaluates effective policy, creates a scoped expiring token, stores only its hash, and queues the exact approved revision for operator approval.", "shareMutualActionPlan", bearer(), planParam, jsonRequestOptional("Empty request.", objectSchema("Plan share request.", obj{}), obj{}), obj{
		"200": jsonResponse("Shared plan metadata and one-time response token.", freeFormSchema("Plan share result."), nil),
		"401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationships/{relationshipId}/conversation-policy"] = obj{
		"get": operation("Relationship Intelligence", "Inspect conversation policy", "Returns all applicable layers and the monotonically resolved effective policy.", "getConversationPolicy", bearer(), relationshipParam, nil, obj{
			"200": jsonResponse("Policy layers and effective policy.", freeFormSchema("Conversation policy result."), nil), "401": responseRef("401"), "404": responseRef("404"),
		}),
		"put": operation("Relationship Intelligence", "Update conversation policy", "Appends authorized policy-layer versions; lower layers may only make handling stricter.", "putConversationPolicy", bearer(), relationshipParam, jsonRequest("Policy layers.", objectSchema("Policy update.", obj{
			"layers": arraySchema("Versioned policy layers.", freeFormSchema("Conversation policy layer.")),
		}, "layers"), nil), obj{
			"201": jsonResponse("Resolved effective policy.", freeFormSchema("Conversation policy result."), nil), "400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"),
		}),
	}
	paths["/v1/relationships/{relationshipId}/conversation-deletion"] = obj{"post": operation("Relationship Intelligence", "Request conversation deletion", "Evaluates legal hold at execution time, removes server-side content transactionally, and returns an idempotent per-target receipt. Device and provider work remains pending until separately verified.", "requestConversationDeletion", bearer(), relationshipParam, jsonRequest("Deletion request.", objectSchema("Deletion request.", obj{
		"requestId": stringSchema("Idempotency key.", "delete:ab12"),
	}, "requestId"), obj{"requestId": "delete:ab12"}), obj{
		"202": jsonResponse("Deletion receipt.", ref("ConversationDeletionReceipt"), nil),
		"400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409"),
	})}
	paths["/v1/relationship-observations/batch"] = obj{"post": operation("Relationship Intelligence", "Ingest relationship observations", "Atomically ingests up to 100 idempotent observations from Gmail, Calendar, Slack, CRM, desktop, or another adapter, then reprojects each affected relationship once.", "ingestRelationshipObservations", bearer(), nil, jsonRequest("Observation batch.", objectSchema("Observation batch.", obj{
		"observations": arraySchema("Provider-neutral observations.", objectSchema("Observation input.", obj{
			"relationshipId":  uuidSchema("Known relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
			"displayName":     stringSchema("Account display name for first ingestion.", "Acme"),
			"primaryEmail":    stringSchema("Primary contact email.", "avery@acme.com"),
			"accountDomain":   stringSchema("Exact account domain.", "acme.com"),
			"source":          stringSchema("Evidence source.", "gmail"),
			"sourceAccountId": stringSchema("Provider account id.", "me@company.com"),
			"externalId":      stringSchema("Provider event id.", "message-123"),
			"sourceVersion":   stringSchema("Provider event version.", "1"),
			"eventType":       stringSchema("Normalized event type.", "commitment_created"),
			"occurredAt":      stringSchema("Occurrence time.", "2026-07-18T17:30:00Z", obj{"format": "date-time"}),
			"summary":         stringSchema("Bounded evidence summary.", "We promised the security packet."),
			"normalizedFacts": freeFormSchema("Provider-neutral facts."),
			"payload":         freeFormSchema("Raw provider payload, sealed at rest."),
		}, "source", "externalId", "eventType")),
	}, "observations"), obj{"observations": []any{obj{"displayName": "Acme", "accountDomain": "acme.com", "source": "gmail", "externalId": "message-123", "eventType": "commitment_created"}}}), obj{
		"201": jsonResponse("Ingestion results.", freeFormSchema("Observation, relationship, and duplicate status per input."), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"409": responseRef("409"),
	})}
	planTokenParam := []any{obj{"name": "X-Oppulence-Plan-Token", "in": "header", "required": true, "description": "Scoped plan response token. Never put this token in a URL or query parameter.", "schema": obj{"type": "string"}}}
	paths["/v1/public/mutual-action-plan"] = obj{"get": operation("Relationship Intelligence", "Open a scoped mutual action plan", "Returns only the externally authorized plan revision with internal evidence references removed and policy redactions applied.", "getPublicMutualActionPlan", nil, planTokenParam, nil, obj{
		"200": jsonResponse("Scoped public plan.", freeFormSchema("Public mutual action plan."), nil), "404": responseRef("404"),
	})}
	paths["/v1/public/mutual-action-plan/responses"] = obj{"post": operation("Relationship Intelligence", "Respond to a scoped plan", "Appends an idempotent external response for internal review; it never directly changes canonical commitments.", "respondPublicMutualActionPlan", nil, planTokenParam, jsonRequest("External response.", objectSchema("Plan response.", obj{
		"responseId":    stringSchema("Counterparty-generated idempotency key.", "response:ab12"),
		"kind":          stringEnum("Response kind.", "confirm", "confirm", "correct", "blocked", "completed", "comment"),
		"itemId":        stringSchema("Plan item id when applicable.", "item:ab12"),
		"proposedValue": stringSchema("Proposed correction.", "Move due date to Friday."),
		"comment":       stringSchema("Counterparty comment.", "Waiting on legal."),
	}, "responseId", "kind"), obj{"responseId": "response:ab12", "kind": "confirm"}), obj{
		"201": jsonResponse("Recorded response.", freeFormSchema("Response receipt."), nil), "400": responseRef("400"), "404": responseRef("404"),
	})}
	paths["/v1/relationship-sources"] = obj{"get": operation("Relationship Intelligence", "List guided source connections", "Returns Google, Slack, and HubSpot capability/scopes plus durable account lifecycle state. No token, secret, or raw cursor is exposed.", "getRelationshipSourceInventory", bearer(), nil, nil, obj{
		"200": jsonResponse("Guided source inventory.", objectSchema("Source inventory.", obj{"sources": arraySchema("Source cards.", ref("RelationshipSourceInventoryItem"))}, "sources"), nil),
		"401": responseRef("401"),
	})}
	paths["/v1/relationship-sources/status"] = obj{"get": operation("Relationship Intelligence", "Get source health", "Returns authorization, backfill, freshness, failure, repair, revocation, and disconnect state for each relationship evidence source.", "getRelationshipSourceStatuses", bearer(), nil, nil, obj{
		"200": jsonResponse("Evidence source health.", objectSchema("Source status list.", obj{"sources": arraySchema("Sources.", ref("RelationshipSourceStatus"))}), nil),
		"401": responseRef("401"),
	})}
	paths["/v1/relationship-beta/diagnostics"] = obj{"get": operation("Relationship Intelligence", "Export redacted beta diagnostics", "Returns metadata-only rollout, source, queue, projection, uncertainty, and trust-funnel diagnostics for workspace administrators. Customer content, credentials, cursors, raw errors, and correlation identifiers are excluded.", "getRelationshipBetaDiagnostics", bearer(), nil, nil, obj{
		"200": jsonResponse("Support-safe diagnostic bundle.", ref("BetaDiagnostics"), nil), "401": responseRef("401"), "403": responseRef("403"),
	})}
	sourceParam := []any{obj{"name": "source", "in": "path", "required": true, "description": "Beta source provider.", "schema": obj{"type": "string", "enum": []any{"google", "slack", "hubspot"}}}}
	paths["/v1/relationship-sources/{source}/authorization"] = obj{"post": operation("Relationship Intelligence", "Report source authorization lifecycle", "Records the bounded consent state, actor, granted read scopes, and safe categorical failure without exposing provider tokens or authorization codes.", "reportRelationshipSourceAuthorization", bearer(), sourceParam, jsonRequest("Authorization lifecycle transition.", objectSchema("Source authorization transition.", obj{
		"sourceAccountId": stringSchema("Provider account id when known; otherwise default.", "me@company.com"),
		"state":           stringEnum("Consent transition.", "completed", "started", "completed", "canceled", "failed"),
		"grantedScopes":   arraySchema("Scopes returned by the provider.", stringSchema("Scope.", "https://www.googleapis.com/auth/gmail.readonly")),
		"errorCode":       stringSchema("Safe categorical error for failed transitions.", "invalid_grant"),
	}, "state"), obj{"sourceAccountId": "me@company.com", "state": "completed", "grantedScopes": []any{"https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"}}), obj{
		"200": jsonResponse("Updated authorization lifecycle.", ref("RelationshipSourceStatus"), nil), "400": responseRef("400"), "401": responseRef("401"), "403": responseRef("403"),
	})}
	paths["/v1/relationship-sources/{source}/resync"] = obj{"post": operation("Relationship Intelligence", "Resync a source", "Explicitly starts or resumes a durable source backfill and immediately marks relationship completeness rebuilding.", "resyncRelationshipSource", bearer(), sourceParam, jsonRequest("Source account.", objectSchema("Source resync request.", obj{"sourceAccountId": stringSchema("Provider account id.", "me@company.com")}, "sourceAccountId"), obj{"sourceAccountId": "me@company.com"}), obj{
		"202": jsonResponse("Queued source lifecycle.", ref("RelationshipSourceStatus"), nil), "400": responseRef("400"), "401": responseRef("401"), "403": responseRef("403"),
	})}
	disconnectSourceParam := append(append([]any{}, sourceParam...), obj{"name": "sourceAccountId", "in": "path", "required": true, "description": "Provider account id.", "schema": obj{"type": "string"}})
	paths["/v1/relationship-sources/{source}/{sourceAccountId}/disconnect"] = obj{"post": operation("Relationship Intelligence", "Disconnect relationship source", "Marks the relationship-facing source disconnected and immediately downgrades completeness. Credential revocation remains owned by the connector path shown on the source card.", "disconnectRelationshipSource", bearer(), disconnectSourceParam, nil, obj{
		"200": jsonResponse("Disconnected lifecycle.", ref("RelationshipSourceStatus"), nil), "400": responseRef("400"), "401": responseRef("401"), "403": responseRef("403"),
	})}

	paths["/v1/relationship-identity-candidates"] = obj{"get": operation("Relationship Intelligence", "List identity review candidates", "Lists durable exact-anchor conflicts with bounded filters, impact preview, decision history, and lineage.", "listRelationshipIdentityCandidates", bearer(), []any{
		obj{"name": "status", "in": "query", "required": false, "schema": obj{"type": "string", "enum": []any{"pending", "deferred", "resolving", "resolved", "undone"}}},
		obj{"name": "source", "in": "query", "required": false, "schema": obj{"type": "string"}}, obj{"name": "relationshipId", "in": "query", "required": false, "schema": obj{"type": "string", "format": "uuid"}}, obj{"name": "limit", "in": "query", "required": false, "schema": obj{"type": "integer"}},
	}, nil, obj{"200": jsonResponse("Identity inbox.", objectSchema("Identity candidate list.", obj{"candidates": arraySchema("Candidates.", ref("RelationshipIdentityCandidate"))}, "candidates"), nil), "400": responseRef("400"), "401": responseRef("401")})}
	candidateParam := []any{obj{"name": "candidateId", "in": "path", "required": true, "description": "Identity candidate id.", "schema": obj{"type": "string", "format": "uuid"}}}
	paths["/v1/relationship-identity-candidates/{candidateId}"] = obj{"get": operation("Relationship Intelligence", "Inspect identity candidate", "Returns exact anchors, provider records, evidence range, impact, advisory confidence, immutable decisions, and lineage.", "getRelationshipIdentityCandidate", bearer(), candidateParam, nil, obj{"200": jsonResponse("Identity candidate.", ref("RelationshipIdentityCandidate"), nil), "401": responseRef("401"), "404": responseRef("404")})}
	paths["/v1/relationship-identity-candidates/{candidateId}/decisions"] = obj{"post": operation("Relationship Intelligence", "Decide identity candidate", "Applies merge, keep-separate, move-evidence, split, defer, or compensating undo once at the expected optimistic version.", "decideRelationshipIdentityCandidate", bearer(), candidateParam, jsonRequest("Identity decision.", objectSchema("Identity decision request.", obj{
		"decision": stringEnum("Decision.", "merge", "merge", "keep_separate", "move_evidence", "split", "defer", "undo"), "reason": stringSchema("Actor reason.", "Confirmed provider records are the same account."), "expectedVersion": intSchema("Expected candidate version.", 1), "idempotencyKey": stringSchema("Stable client idempotency key.", "identity-review:123"),
	}, "decision", "expectedVersion", "idempotencyKey"), obj{"decision": "merge", "expectedVersion": 1, "idempotencyKey": "identity-review:123"}), obj{"200": jsonResponse("Resolved candidate.", ref("RelationshipIdentityCandidate"), nil), "400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409")})}

	paths["/v1/relationship-attention"] = obj{"get": operation("Relationship Intelligence", "List portfolio attention", "Returns deterministic relationship-native attention ordered by explicit factor contributions.", "listRelationshipAttention", bearer(), []any{
		obj{"name": "status", "in": "query", "required": false, "schema": obj{"type": "string", "enum": []any{"open", "acknowledged", "snoozed", "dismissed", "superseded", "resolved", "all"}}}, obj{"name": "limit", "in": "query", "required": false, "schema": obj{"type": "integer"}},
	}, nil, obj{"200": jsonResponse("Attention projection.", objectSchema("Attention list.", obj{"contractVersion": stringSchema("Contract version.", "relationship-attention.v1"), "asOf": stringSchema("Read boundary.", "2026-07-31T14:00:00Z", obj{"format": "date-time"}), "items": arraySchema("Attention items.", ref("RelationshipAttentionItem"))}, "contractVersion", "asOf", "items"), nil), "401": responseRef("401")})}
	attentionParam := []any{obj{"name": "attentionId", "in": "path", "required": true, "description": "Attention item id.", "schema": obj{"type": "string", "format": "uuid"}}}
	paths["/v1/relationship-attention/{attentionId}/decisions"] = obj{"post": operation("Relationship Intelligence", "Decide attention item", "Acknowledges, snoozes, or dismisses at the expected optimistic version. Materially new evidence reopens the item.", "decideRelationshipAttention", bearer(), attentionParam, jsonRequest("Attention decision.", objectSchema("Attention decision request.", obj{
		"decision": stringEnum("Decision.", "acknowledge", "acknowledge", "snooze", "dismiss"), "reason": stringSchema("Decision reason.", "Reviewed with the account owner."), "expectedVersion": intSchema("Expected version.", 1), "snoozedUntil": stringSchema("Bounded future wake time.", "2026-08-07T14:00:00Z", obj{"format": "date-time"}, nullable()),
	}, "decision", "expectedVersion"), obj{"decision": "acknowledge", "expectedVersion": 1}), obj{"200": jsonResponse("Updated attention item.", ref("RelationshipAttentionItem"), nil), "400": responseRef("400"), "401": responseRef("401"), "404": responseRef("404"), "409": responseRef("409")})}
	recommendationParam := []any{obj{"name": "actionId", "in": "path", "required": true, "description": "Recommendation/action id.", "schema": obj{"type": "string", "format": "uuid"}}}
	paths["/v1/relationship-recommendations/{actionId}/approve"] = obj{"post": operation("Relationship Intelligence", "Approve a recommendation", "Relationship-intelligence alias for the governed action approval transition.", "approveRelationshipRecommendation", bearer(), recommendationParam, jsonRequestOptional("Approval options.", objectSchema("Approve request.", obj{"acceptRisk": boolSchema("Explicitly accept a review-required decision.", false)}), obj{"acceptRisk": false}), obj{
		"200": jsonResponse("Approved recommendation.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"409": responseRef("409"),
	})}
	paths["/v1/relationship-recommendations/{actionId}/reject"] = obj{"post": operation("Relationship Intelligence", "Reject a recommendation", "Relationship-intelligence alias for rejecting the current action revision.", "rejectRelationshipRecommendation", bearer(), recommendationParam, jsonRequest("Rejection.", objectSchema("Reject request.", obj{"reason": stringSchema("Rejection reason.", "Not the right next move.")}, "reason"), obj{"reason": "Not the right next move."}), obj{
		"200": jsonResponse("Rejected recommendation.", ref("RevenueAction"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"409": responseRef("409"),
	})}

	paths["/v1/revenue-actions"] = obj{
		"get": operation("Revenue", "List the action queue", "Lists/filters the queue ordered by priority. The default page is the ten highest-priority open actions.", "listRevenueActions", bearer(), []any{
			obj{"name": "queueStatus", "in": "query", "required": false, "description": "Queue status filter, or all.", "schema": obj{"type": "string", "enum": []any{"open", "snoozed", "dismissed", "handled", "all"}}},
			obj{"name": "limit", "in": "query", "required": false, "description": "Page size (max 100, default 10).", "schema": obj{"type": "integer"}},
		}, nil, obj{
			"200": jsonResponse("Queue page.", objectSchema("Action list.", obj{"actions": arraySchema("Actions.", ref("RevenueAction"))}), nil),
			"401": responseRef("401"),
		}),
		"post": operation("Revenue", "Create a manual action", "Proposes a manual queue action with revision 1 and an immutable revision snapshot. A duplicate dedupe key returns the existing item.", "createRevenueAction", bearer(), nil, jsonRequest("Action.", objectSchema("Create request.", obj{
			"relationshipId":     uuidSchema("Owning relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
			"actionType":         stringEnum("Action type.", "warm_follow_up", "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up", "meeting_recap", "crm_update", "follow_up_task", "calendar_hold", "commitment_rescue"),
			"channel":            stringEnum("Delivery channel.", "email", "email", "slack", "call", "crm_task", "crm", "task", "calendar"),
			"reason":             stringSchema("Evidence-backed reason.", "They asked for a follow-up in July."),
			"recipientEmail":     stringSchema("Recipient email.", "buyer@example.com"),
			"proposedSubject":    stringSchema("Proposed subject.", "Following up as promised"),
			"proposedMessage":    stringSchema("Proposed body.", "Hi Jordan — circling back as promised..."),
			"senderAccountRef":   stringSchema("Sender account reference.", "gmail:me@company.com"),
			"executionMode":      stringEnum("Execution mode.", "draft", "draft", "send"),
			"priorityScore":      intSchema("Priority (0-100).", 80),
			"priorityComponents": freeFormSchema("Per-component priority breakdown."),
			"dueAt":              stringSchema("Due time.", "2026-07-15T00:00:00Z", obj{"format": "date-time"}, nullable()),
		}, "relationshipId", "actionType", "channel", "reason"), nil), obj{
			"201": jsonResponse("Created action.", ref("RevenueAction"), nil),
			"400": responseRef("400"),
			"401": responseRef("401"),
			"404": responseRef("404"),
		}),
	}
	paths["/v1/revenue-actions/{actionId}"] = obj{"get": operation("Revenue", "Get an action", "Returns one action with relationship context.", "getRevenueAction", bearer(), actionParam, nil, obj{
		"200": jsonResponse("Action.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/revenue-actions/{actionId}/audit"] = obj{"get": operation("Revenue", "Get the audit chain", "Returns the full observe, decision, approval, execution, and outcome chain for one action.", "getRevenueActionAudit", bearer(), actionParam, nil, obj{
		"200": jsonResponse("Audit chain.", objectSchema("Audit chain.", obj{
			"action":    ref("RevenueAction"),
			"revisions": arraySchema("Immutable revision snapshots.", freeFormSchema("Revision snapshot.")),
			"decisions": arraySchema("Policy decision snapshots.", ref("RevenuePolicyDecision")),
			"outcomes":  arraySchema("Observed outcomes.", ref("RevenueOutcome")),
		}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/revenue-actions/{actionId}/evaluate"] = obj{"post": operation("Revenue", "Request policy preflight", "Requests or retries the OutboundConsole preflight for the current revision and stores the immutable decision snapshot. A fresh unexpired decision for the same revision is returned without provider cost. Facade unavailability keeps the action pending (fail closed).", "evaluateRevenueAction", bearer(), actionParam, nil, obj{
		"200": jsonResponse("Decision snapshot.", ref("RevenuePolicyDecision"), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"503": problemResponse("Policy facade unavailable; the action stays pending.", ref("ErrorEnvelope"), problemExample(503, "Service Unavailable", "policy preflight unavailable; the action stays pending", "facade_unavailable")),
	})}
	paths["/v1/revenue-actions/{actionId}/edit"] = obj{"post": operation("Revenue", "Edit an action", "Creates a new revision and invalidates the previous policy decision and approval. Editing is refused once execution has started.", "editRevenueAction", bearer(), actionParam, jsonRequest("Fields to change; omitted fields keep their value.", objectSchema("Edit request.", obj{
		"reason":           stringSchema("Reason.", "Updated context.", nullable()),
		"recipientEmail":   stringSchema("Recipient email.", "buyer@example.com", nullable()),
		"proposedSubject":  stringSchema("Proposed subject.", "Updated subject", nullable()),
		"proposedMessage":  stringSchema("Proposed body.", "Updated body", nullable()),
		"senderAccountRef": stringSchema("Sender account reference.", "gmail:me@company.com", nullable()),
		"channel":          stringEnum("Channel.", "email", "email", "slack", "call", "crm_task"),
		"actionType":       stringEnum("Action type.", "warm_follow_up", "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up"),
		"executionMode":    stringEnum("Execution mode.", "draft", "draft", "send"),
	}), nil), obj{
		"200": jsonResponse("Action at its new revision.", ref("RevenueAction"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"409": problemResponse("Execution already started; the action is immutable.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "execution already started; the action is immutable", "not_editable")),
	})}
	paths["/v1/revenue-actions/{actionId}/snooze"] = obj{"post": operation("Revenue", "Snooze an action", "Parks the action until a bounded future timestamp (at most 90 days).", "snoozeRevenueAction", bearer(), actionParam, jsonRequest("Wake time.", objectSchema("Snooze request.", obj{
		"until": stringSchema("Wake time.", "2026-07-20T09:00:00Z", obj{"format": "date-time"}),
	}, "until"), obj{"until": "2026-07-20T09:00:00Z"}), obj{
		"200": jsonResponse("Snoozed action.", ref("RevenueAction"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/revenue-actions/{actionId}/dismiss"] = obj{"post": operation("Revenue", "Dismiss an action", "Dismisses the action with a reason label and records the dismissed outcome.", "dismissRevenueAction", bearer(), actionParam, jsonRequest("Dismissal reason.", objectSchema("Dismiss request.", obj{
		"reason": stringSchema("Reason label.", "already_handled"),
	}), obj{"reason": "already_handled"}), obj{
		"200": jsonResponse("Dismissed action.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/revenue-actions/{actionId}/approve"] = obj{"post": operation("Revenue", "Approve an action", "Approves the current revision. Send-mode actions require a passed (or explicitly risk-accepted review_required) unexpired decision bound to the exact revision; blocked actions can never be approved.", "approveRevenueAction", bearer(), actionParam, jsonRequestOptional("Approval options.", objectSchema("Approve request.", obj{
		"acceptRisk": boolSchema("Explicitly accept a review_required decision.", false),
	}), obj{"acceptRisk": false}), obj{
		"200": jsonResponse("Approved action.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"402": problemResponse("Acting on actions requires a paid subscription.", ref("ErrorEnvelope"), problemExample(402, "Payment Required", "an active subscription is required to act on actions", "subscription_required")),
		"404": responseRef("404"),
		"409": problemResponse("Invariant violation: blocked, no decision, expired decision, or review required.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "action is blocked by policy", "blocked")),
	})}
	paths["/v1/revenue-actions/{actionId}/reject"] = obj{"post": operation("Revenue", "Reject an action", "Rejects the current revision with a reason.", "rejectRevenueAction", bearer(), actionParam, jsonRequest("Rejection reason.", objectSchema("Reject request.", obj{
		"reason": stringSchema("Reason.", "wrong_recipient"),
	}), obj{"reason": "wrong_recipient"}), obj{
		"200": jsonResponse("Rejected action.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
		"409": responseRef("409"),
	})}
	paths["/v1/revenue-actions/{actionId}/execute"] = obj{"post": operation("Revenue", "Execute an action", "Executes the approved current revision exactly once through the assigned execution owner, with an idempotency key derived from the action and revision. A duplicate execute returns the existing result. A lost provider result is marked ambiguous and never automatically resent.", "executeRevenueAction", bearer(), actionParam, nil, obj{
		"200": jsonResponse("Action after execution.", ref("RevenueAction"), nil),
		"401": responseRef("401"),
		"402": problemResponse("Acting on actions requires a paid subscription.", ref("ErrorEnvelope"), problemExample(402, "Payment Required", "an active subscription is required to act on actions", "subscription_required")),
		"404": responseRef("404"),
		"409": problemResponse("Invariant violation: not approved, blocked, expired decision, or workspace not linked for sends.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "action is not approved for its current revision", "not_approved")),
	})}
	paths["/v1/revenue-actions/{actionId}/source-body"] = obj{"get": operation("Revenue", "Get the original email body", "Returns the plain-text body of the original email behind this action (RFC 031 Layer 3), served from the sealed short-TTL cache or fetched from Gmail on demand. 404 when no source message is linked or the body is unavailable.", "getRevenueActionSourceBody", bearer(), actionParam, nil, obj{
		"200": jsonResponse("Original email body.", objectSchema("Body.", obj{"body": stringSchema("Plain-text body.", "Hi — following up on the proposal...")}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/revenue-actions/{actionId}/outcomes"] = obj{"post": operation("Revenue", "Record an outcome", "Appends an observed outcome idempotently on (action, source, sourceEventId); the duplicate returns the stored row.", "recordRevenueActionOutcome", bearer(), actionParam, jsonRequest("Outcome.", objectSchema("Outcome request.", obj{
		"kind":          stringEnum("Outcome kind.", "replied", "sent", "delivered", "bounced", "replied", "meeting_booked", "won", "lost", "dismissed", "bad_recommendation"),
		"source":        stringEnum("Observing source.", "gmail", "gmail", "calendar", "crm", "user", "outbound"),
		"sourceEventId": stringSchema("Source event id for deduplication.", "msg_01"),
		"occurredAt":    stringSchema("When the outcome occurred.", "2026-07-12T14:00:00Z", obj{"format": "date-time"}, nullable()),
		"metadata":      freeFormSchema("Bounded metadata."),
	}, "kind", "source", "sourceEventId"), obj{"kind": "replied", "source": "gmail", "sourceEventId": "msg_01"}), obj{
		"201": jsonResponse("Recorded outcome.", ref("RevenueOutcome"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
}

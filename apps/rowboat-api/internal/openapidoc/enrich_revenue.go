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
		"id":            uuidSchema("Relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"kind":          stringEnum("Relationship kind.", "person", "person", "company", "customer", "opportunity", "referral", "partner"),
		"displayName":   stringSchema("Human display name.", "Jordan Buyer"),
		"primaryEmail":  stringSchema("Primary email address.", "buyer@example.com"),
		"accountDomain": stringSchema("Account domain.", "example.com"),
		"summary":       stringSchema("Bounded relationship summary.", "Asked for pricing in April; wants a follow-up in July."),
		"status":        stringEnum("Lifecycle status.", "active", "active", "dormant", "closed", "archived"),
		"lastTouchAt":   stringSchema("Last observed touch.", "2026-04-10T15:00:00Z", obj{"format": "date-time"}, nullable()),
		"nextActionAt":  stringSchema("Next planned action.", "2026-07-01T00:00:00Z", obj{"format": "date-time"}, nullable()),
		"openActions":   intSchema("Open queue actions for this relationship.", 1),
		"nextAction":    stringSchema("Recommended next action.", "Confirm the security review owner."),
		"lifecycle":     stringEnum("Commercial lifecycle.", "evaluation", "prospect", "evaluation", "contracting", "onboarding", "active_customer", "renewal", "churned", "former_customer"),
		"engagement":    stringEnum("Direction of engagement.", "declining", "unknown", "increasing", "steady", "declining", "dormant"),
		"sentiment":     stringEnum("Observed sentiment.", "mixed", "unknown", "positive", "mixed", "negative"),
		"health":        stringEnum("Explainable health state; never a magic score.", "needs_attention", "unknown", "healthy", "needs_attention", "critical"),
		"stateReason":   stringSchema("Evidence-backed explanation of the projected state.", "Security review was promised, but no owner or meeting exists."),
		"stateVersion":  intSchema("Monotonic projection version.", 4),
		"lastChangedAt": stringSchema("Last material state change.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}, nullable()),
		"risks":         arraySchema("Current relationship risks.", stringSchema("Risk.", "Security review has no owner.")),
		"milestones":    arraySchema("Reached relationship milestones.", stringSchema("Milestone.", "Proposal shared.")),
	}, "id", "kind", "displayName", "status", "lifecycle", "engagement", "sentiment", "health", "stateVersion", "risks", "milestones")

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
		"changedDimensions": arraySchema("Material dimensions that changed.", stringSchema("Dimension.", "health")),
		"assertionIds":      arraySchema("Assertions selected by deterministic precedence.", stringSchema("Assertion id.", "assertion-123")),
		"createdAt":         stringSchema("Snapshot creation time.", "2026-07-25T16:00:00Z", obj{"format": "date-time"}),
	}, "id", "version", "state", "changedDimensions", "assertionIds", "createdAt")

	schemas["RelationshipSourceStatus"] = objectSchema("Freshness and failure state for one relationship evidence source.", obj{
		"source":            stringSchema("Source name.", "gmail"),
		"sourceAccountId":   stringSchema("Provider account id.", "me@company.com"),
		"status":            stringSchema("Connection status.", "connected"),
		"lastSuccessAt":     stringSchema("Last successful ingestion.", "2026-07-26T12:00:00Z", obj{"format": "date-time"}, nullable()),
		"lastObservationAt": stringSchema("Newest provider event seen.", "2026-07-26T11:58:00Z", obj{"format": "date-time"}, nullable()),
		"lastError":         stringSchema("Bounded provider error.", ""),
	}, "source", "sourceAccountId", "status")

	schemas["RevenueAction"] = objectSchema("One Revenue Action Queue item. State is split into independent dimensions: queue triage, policy preflight, approval, and execution. Every edit creates a new revision and invalidates the previous policy decision and approval.", obj{
		"id":                 uuidSchema("Action id.", "1a8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"relationshipId":     uuidSchema("Owning relationship id.", "9c8dfa9b-a7b2-46ea-982c-622a914c00e5"),
		"actionType":         stringEnum("Action type.", "warm_follow_up", "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up"),
		"channel":            stringEnum("Delivery channel.", "email", "email", "slack", "call", "crm_task"),
		"detector":           stringEnum("Detector that produced the action.", "manual", "requested_follow_up_due", "unanswered_proposal", "waiting_on_me", "dormant_warm_opportunity", "neglected_referral", "former_customer_reconnect", "manual"),
		"revision":           intSchema("Current revision number.", 1),
		"revisionHash":       stringSchema("Canonical hash of the revision content.", "sha256:ab12..."),
		"reason":             stringSchema("Human-readable evidence-backed reason.", "They asked for a follow-up in July."),
		"recipientEmail":     stringSchema("Recipient email address.", "buyer@example.com"),
		"proposedSubject":    stringSchema("Proposed email subject.", "Following up as promised"),
		"proposedMessage":    stringSchema("Proposed message body.", "Hi Jordan — you asked me to circle back this month..."),
		"senderAccountRef":   stringSchema("Sender account reference.", "gmail:me@company.com"),
		"priorityScore":      intSchema("Explainable priority score (0-100).", 82),
		"priorityComponents": freeFormSchema("Per-component priority breakdown; every component is stored and shown."),
		"queueStatus":        stringEnum("Operator triage state.", "open", "open", "snoozed", "dismissed", "handled"),
		"policyStatus":       stringEnum("Preflight state. Facade unavailability keeps pending (fail closed).", "pending", "pending", "passed", "review_required", "blocked", "stale"),
		"approvalStatus":     stringEnum("Approval state, bound to the exact revision and decision.", "pending", "pending", "approved", "rejected"),
		"executionStatus":    stringEnum("Execution state. A lost provider result is ambiguous, never auto-resent.", "pending", "pending", "requested", "sent", "failed", "ambiguous", "cancelled"),
		"executionOwner":     stringEnum("Exactly one owner may execute a revision.", "rowboat", "rowboat", "outbound"),
		"executionMode":      stringEnum("Draft lands in the operator's mailbox; send requires a passed unexpired decision and a linked workspace.", "draft", "draft", "send"),
		"approvedRevision":   intSchema("Revision the approval is bound to.", 1),
		"approvedAt":         stringSchema("Approval time.", "2026-07-12T12:05:00Z", obj{"format": "date-time"}, nullable()),
		"providerMessageId":  stringSchema("Provider message id after execution.", "msg_01"),
		"providerThreadId":   stringSchema("Provider thread id after execution.", "thread_01"),
		"executedAt":         stringSchema("Execution time.", "2026-07-12T12:06:00Z", obj{"format": "date-time"}, nullable()),
		"executionError":     stringSchema("Bounded execution error.", ""),
		"dismissReason":      stringSchema("Dismissal reason label.", "already_handled"),
		"snoozedUntil":       stringSchema("Snooze wake time.", "2026-07-20T09:00:00Z", obj{"format": "date-time"}, nullable()),
		"dueAt":              stringSchema("Due time.", "2026-07-15T00:00:00Z", obj{"format": "date-time"}, nullable()),
		"createdAt":          stringSchema("Creation time.", "2026-07-12T12:00:00Z", obj{"format": "date-time"}),
		"updatedAt":          stringSchema("Last update time.", "2026-07-12T12:06:00Z", obj{"format": "date-time"}),
	}, "id", "actionType", "channel", "detector", "revision", "revisionHash", "reason", "priorityScore", "queueStatus", "policyStatus", "approvalStatus", "executionStatus", "executionOwner", "executionMode")

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
		"kind":          stringEnum("Outcome kind.", "replied", "sent", "delivered", "bounced", "replied", "meeting_booked", "won", "lost", "dismissed", "bad_recommendation"),
		"source":        stringEnum("Observing source.", "gmail", "gmail", "calendar", "crm", "user", "outbound"),
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
	relationshipParam := []any{obj{"name": "relationshipId", "in": "path", "required": true, "description": "Relationship id.", "schema": obj{"type": "string", "format": "uuid"}}}
	paths["/v1/relationships/{relationshipId}"] = obj{"get": operation("Relationship Intelligence", "Get relationship mission control", "Returns living relationship state, governed recommendations, participants, and commitments.", "getRelationship", bearer(), relationshipParam, nil, obj{
		"200": jsonResponse("Relationship detail.", objectSchema("Relationship detail.", obj{
			"relationship":    ref("RevenueRelationship"),
			"actions":         arraySchema("Actions for this relationship.", ref("RevenueAction")),
			"recommendations": arraySchema("Governed recommendations.", ref("RevenueAction")),
			"participants":    arraySchema("Relationship participants.", ref("RelationshipParticipant")),
			"commitments":     arraySchema("Open and completed commitments.", ref("RelationshipCommitment")),
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
	paths["/v1/relationships/{relationshipId}/evidence/{evidenceId}"] = obj{"get": operation("Relationship Intelligence", "Open source evidence", "Returns one observation plus its decrypted raw payload. Tenant ownership is enforced before decryption.", "getRelationshipEvidence", bearer(), append(relationshipParam, obj{"name": "evidenceId", "in": "path", "required": true, "description": "Observation id.", "schema": obj{"type": "string", "format": "uuid"}}), nil, obj{
		"200": jsonResponse("Source evidence.", objectSchema("Evidence result.", obj{"observation": ref("RelationshipObservation"), "payload": freeFormSchema("Decrypted provider payload.")}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
	})}
	paths["/v1/relationships/{relationshipId}/corrections"] = obj{"post": operation("Relationship Intelligence", "Correct relationship state", "Appends a user correction assertion and deterministically reprojects the relationship. Source evidence is never overwritten.", "correctRelationship", bearer(), relationshipParam, jsonRequest("Correction.", objectSchema("Relationship correction.", obj{
		"dimension": stringEnum("Corrected state dimension.", "health", "lifecycle", "engagement", "sentiment", "health", "next_action"),
		"value":     stringSchema("Correct value.", "healthy"),
		"reason":    stringSchema("Why the model is wrong.", "The review happened yesterday."),
	}, "dimension", "value", "reason"), obj{"dimension": "health", "value": "healthy", "reason": "The review happened yesterday."}), obj{
		"201": jsonResponse("Reprojected relationship.", ref("RevenueRelationship"), nil),
		"400": responseRef("400"),
		"401": responseRef("401"),
		"404": responseRef("404"),
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
	paths["/v1/relationship-sources/status"] = obj{"get": operation("Relationship Intelligence", "Get source health", "Returns freshness and failure state for each relationship evidence source.", "getRelationshipSourceStatuses", bearer(), nil, nil, obj{
		"200": jsonResponse("Evidence source health.", objectSchema("Source status list.", obj{"sources": arraySchema("Sources.", ref("RelationshipSourceStatus"))}), nil),
		"401": responseRef("401"),
	})}
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
			"actionType":         stringEnum("Action type.", "warm_follow_up", "warm_follow_up", "proposal_nudge", "referral_reconnect", "customer_risk", "meeting_follow_up"),
			"channel":            stringEnum("Delivery channel.", "email", "email", "slack", "call", "crm_task"),
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

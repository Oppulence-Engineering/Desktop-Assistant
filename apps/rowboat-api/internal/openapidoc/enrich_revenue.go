package openapidoc

// Revenue memory and outbound governance surface (RFC 030). Mounted only when
// REVENUE_ENABLED is true; documented unconditionally so the SDK always
// carries the contract.

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

	schemas["RevenueRelationship"] = objectSchema("Longitudinal revenue-memory relationship. The enriched commercial lead stays canonical in OutboundConsole and is referenced, never duplicated.", obj{
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
	}, "id", "kind", "displayName", "status")

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

	paths["/v1/relationships"] = obj{
		"get": operation("Revenue", "List relationships", "Lists relationship summaries with open-loop counts.", "listRevenueRelationships", bearer(), nil, nil, obj{
			"200": jsonResponse("Relationships.", objectSchema("Relationship list.", obj{"relationships": arraySchema("Relationships.", ref("RevenueRelationship"))}), nil),
			"401": responseRef("401"),
		}),
		"post": operation("Revenue", "Create a relationship", "Records a relationship in the caller's workspace.", "createRevenueRelationship", bearer(), nil, jsonRequest("Relationship.", objectSchema("Create request.", obj{
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
	paths["/v1/relationships/{relationshipId}"] = obj{"get": operation("Revenue", "Get a relationship", "Returns one relationship with its commitments and actions.", "getRevenueRelationship", bearer(), []any{obj{"name": "relationshipId", "in": "path", "required": true, "description": "Relationship id.", "schema": obj{"type": "string", "format": "uuid"}}}, nil, obj{
		"200": jsonResponse("Relationship detail.", objectSchema("Relationship detail.", obj{
			"relationship": ref("RevenueRelationship"),
			"actions":      arraySchema("Actions for this relationship.", ref("RevenueAction")),
		}), nil),
		"401": responseRef("401"),
		"404": responseRef("404"),
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
		"channel":          stringSchema("Channel.", "email", nullable()),
		"actionType":       stringSchema("Action type.", "warm_follow_up", nullable()),
		"executionMode":    stringSchema("Execution mode.", "draft", nullable()),
	}), nil), obj{
		"200": jsonResponse("Action at its new revision.", ref("RevenueAction"), nil),
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
		"404": responseRef("404"),
		"409": problemResponse("Invariant violation: not approved, blocked, expired decision, or workspace not linked for sends.", ref("ErrorEnvelope"), problemExample(409, "Conflict", "action is not approved for its current revision", "not_approved")),
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

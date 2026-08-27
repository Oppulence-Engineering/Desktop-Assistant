package openapidoc

func addEntitySchemas(schemas obj) {
	entity := objectSchema("Minimal org-scoped entity spine projection. Raw note bodies and mirrored payloads are forbidden.", obj{
		"id": stringSchema("Stable ULID.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"), "kind": stringSchema("Non-customer entity kind.", "company"), "displayName": stringSchema("Bounded display name.", "Acme"),
		"resourceRefs": obj{"type": "array", "items": obj{"type": "string"}}, "identifiers": obj{"type": "object", "additionalProperties": obj{"type": "array", "items": obj{"type": "string"}}}, "oneLineSummary": stringSchema("Bounded summary.", "Key supplier."),
		"status": stringEnum("Lifecycle status.", "active", "active", "merged", "archived"), "canonicalEntityId": stringSchema("Canonical id for a tombstone.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3", nullable()), "version": intSchema("Optimistic version.", 1),
	}, "id", "kind", "displayName", "resourceRefs", "status", "version")
	schemas["EntitySpine"] = entity
	schemas["EntityProjection"] = objectSchema("Strict projection allowlist accepted by PUT.", obj{"id": stringSchema("Optional body copy of path ULID.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3", nullable()), "kind": stringSchema("Entity kind.", "company"), "displayName": stringSchema("Display name.", "Acme"), "resourceRefs": obj{"type": "array", "items": obj{"type": "string"}}, "identifiers": obj{"type": "object", "additionalProperties": obj{"type": "array", "items": obj{"type": "string"}}}, "oneLineSummary": stringSchema("Summary.", "Key supplier.", nullable()), "expectedVersion": intSchema("Optional compare-and-swap version.", 1, nullable())}, "kind", "displayName", "resourceRefs", "identifiers")
	schemas["EntityMergeRequest"] = objectSchema("Explicit idempotent merge with compare-and-swap versions.", obj{"sourceId": stringSchema("Tombstoned id.", "01J9SOURCE0000000000000000"), "targetId": stringSchema("Canonical id.", "01J9TARGET0000000000000000"), "expectedSourceVersion": intSchema("Source version.", 1), "expectedTargetVersion": intSchema("Target version.", 1)}, "sourceId", "targetId", "expectedSourceVersion", "expectedTargetVersion")
	schemas["EntityMergeResponse"] = objectSchema("Canonical entity and durable tombstone.", obj{"canonical": ref("EntitySpine"), "tombstone": ref("EntitySpine"), "idempotent": boolSchema("True for a replay.", false)}, "canonical", "tombstone", "idempotent")
}

func addEntityPaths(paths obj) {
	sec := []any{obj{"BearerAuth": []any{}}}
	common := obj{"400": responseRef("400"), "401": responseRef("401"), "403": responseRef("403"), "409": responseRef("409"), "500": responseRef("500")}
	idp := []any{pathParam("id", "Stable entity ULID.", stringSchema("Entity id.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"))}
	putResp := cloneObj(common)
	putResp["200"] = jsonResponse("Upserted projection or canonical adoption tombstone.", ref("EntitySpine"), nil)
	getResp := cloneObj(common)
	getResp["200"] = jsonResponse("Entity projection.", ref("EntitySpine"), nil)
	getResp["404"] = responseRef("404")
	paths["/v1/entities/{id}"] = obj{"put": operation("Entities", "Upsert entity projection", "Strict fixed allowlist. Unknown fields are rejected.", "putEntity", sec, idp, jsonRequest("Projection.", ref("EntityProjection"), nil), putResp), "get": operation("Entities", "Get entity", "Returns an entity or merge tombstone within the caller organization.", "getEntity", sec, idp, nil, getResp)}
	paths["/v1/entities"] = obj{"get": operation("Entities", "Resolve resource reference", "Exact reverse resolution within the caller organization.", "resolveEntityByRef", sec, []any{queryParam("ref", "Exact resourceRef.", true, stringSchema("Resource reference.", "conduit:customer:cus_8fA2"))}, nil, getResp)}
	mergeResp := cloneObj(common)
	mergeResp["200"] = jsonResponse("Merge result.", ref("EntityMergeResponse"), nil)
	mergeResp["404"] = responseRef("404")
	paths["/v1/entities/merge"] = obj{"post": operation("Entities", "Merge entity ids", "Idempotently tombstones source and unions projection sets into target.", "mergeEntities", sec, nil, jsonRequest("Merge request.", ref("EntityMergeRequest"), nil), mergeResp)}
}

func cloneObj(in obj) obj {
	out := obj{}
	for k, v := range in {
		out[k] = v
	}
	return out
}

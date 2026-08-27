package openapidoc

func entityULIDSchema(description, example string) obj {
	return obj{"type": "string", "description": description, "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$", "minLength": 26, "maxLength": 26, "example": example}
}

func entityResourceRefSchema(description, example string) obj {
	return obj{"type": "string", "description": description, "pattern": "^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_-]{0,63}:[^\\x00-\\x1F\\x7F]{1,256}$", "maxLength": 386, "example": example}
}

func entityFingerprintSchema() obj {
	return obj{"type": "string", "description": "Versioned one-way identifier fingerprint. Raw domains, tax ids, emails, and other PII are rejected.", "pattern": "^sha256:v1:[0-9a-f]{64}$", "minLength": 74, "maxLength": 74, "example": "sha256:v1:54667cc7be6265f6a4cdfe25b9c89d52aea7817c4e570cb678feec57c23f4a6a"}
}

func addEntitySchemas(schemas obj) {
	refs := obj{"type": "array", "maxItems": 100, "uniqueItems": true, "items": entityResourceRefSchema("Stable external product pointer.", "conduit:customer:cus_8fA2")}
	identifiers := obj{
		"type": "object", "maxProperties": 32,
		"additionalProperties": obj{"type": "array", "maxItems": 100, "uniqueItems": true, "items": entityFingerprintSchema()},
	}
	entity := objectSchema("Minimal org-scoped entity spine projection. Raw note bodies and mirrored payloads are forbidden.", obj{
		"id":                entityULIDSchema("Stable entity ULID.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"),
		"kind":              obj{"type": "string", "description": "Non-customer entity kind.", "minLength": 1, "maxLength": 64, "example": "company"},
		"displayName":       obj{"type": "string", "description": "Bounded display name.", "minLength": 1, "maxLength": 200, "example": "Acme"},
		"resourceRefs":      refs,
		"identifiers":       identifiers,
		"oneLineSummary":    obj{"type": "string", "description": "Bounded one-line summary.", "maxLength": 500, "example": "Key supplier."},
		"status":            stringEnum("Lifecycle status.", "active", "active", "merged", "archived"),
		"canonicalEntityId": entityULIDSchema("Canonical id for a durable merge tombstone.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"),
		"version":           obj{"type": "integer", "format": "int64", "minimum": 1, "example": 1},
	}, "id", "kind", "displayName", "resourceRefs", "status", "version")
	schemas["EntitySpine"] = entity
	schemas["EntityProjection"] = objectSchema("Strict projection allowlist accepted by PUT. Unknown fields, raw identifiers, and note bodies are rejected.", obj{
		"id":              entityULIDSchema("Optional body copy of the path ULID.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"),
		"kind":            obj{"type": "string", "minLength": 1, "maxLength": 64, "example": "company"},
		"displayName":     obj{"type": "string", "minLength": 1, "maxLength": 200, "example": "Acme"},
		"resourceRefs":    refs,
		"identifiers":     identifiers,
		"oneLineSummary":  obj{"type": "string", "maxLength": 500, "example": "Key supplier."},
		"expectedVersion": obj{"type": "integer", "format": "int64", "minimum": 1, "example": 1},
	}, "kind", "displayName")
	schemas["EntityMergeRequest"] = objectSchema("Explicit idempotent merge with compare-and-swap versions.", obj{
		"sourceId":              entityULIDSchema("Tombstoned id.", "01J9Z8Q5K3R7V2C4M6N8P0T1S4"),
		"targetId":              entityULIDSchema("Canonical id.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"),
		"expectedSourceVersion": obj{"type": "integer", "format": "int64", "minimum": 1, "example": 1},
		"expectedTargetVersion": obj{"type": "integer", "format": "int64", "minimum": 1, "example": 1},
	}, "sourceId", "targetId", "expectedSourceVersion", "expectedTargetVersion")
	schemas["EntityMergeResponse"] = objectSchema("Canonical entity and durable tombstone.", obj{"canonical": ref("EntitySpine"), "tombstone": ref("EntitySpine"), "idempotent": boolSchema("True for a replay.", false)}, "canonical", "tombstone", "idempotent")
}

func addEntityPaths(paths obj) {
	sec := []any{obj{"BearerAuth": []any{}}}
	common := obj{
		"400": responseRef("400"), "401": responseRef("401"), "403": responseRef("403"), "409": responseRef("409"), "500": responseRef("500"),
		"413": problemResponse("Projection exceeds the 256 KiB request cap.", ref("ErrorEnvelope"), problemExample(413, "Request Entity Too Large", "request body exceeds 262144 bytes", "request_body_too_large")),
		"415": problemResponse("Content-Type must be application/json.", ref("ErrorEnvelope"), problemExample(415, "Unsupported Media Type", "Content-Type must be application/json", "unsupported_media_type")),
	}
	idp := []any{pathParam("id", "Stable entity ULID.", entityULIDSchema("Entity id.", "01J9Z8Q5K3R7V2C4M6N8P0T1S3"))}
	putResp := cloneObj(common)
	putResp["200"] = jsonResponse("Upserted projection or canonical adoption tombstone.", ref("EntitySpine"), nil)
	getResp := cloneObj(common)
	getResp["200"] = jsonResponse("Entity projection.", ref("EntitySpine"), nil)
	getResp["404"] = responseRef("404")
	paths["/v1/entities/{id}"] = obj{"put": operation("Entities", "Upsert entity projection", "Strict fixed allowlist. Unknown fields are rejected.", "putEntity", sec, idp, jsonRequest("Projection.", ref("EntityProjection"), nil), putResp), "get": operation("Entities", "Get entity", "Returns an entity or merge tombstone within the caller organization.", "getEntity", sec, idp, nil, getResp)}
	paths["/v1/entities"] = obj{"get": operation("Entities", "Resolve resource reference", "Exact reverse resolution within the caller organization.", "resolveEntityByRef", sec, []any{queryParam("ref", "Exact resourceRef.", true, entityResourceRefSchema("Resource reference.", "conduit:customer:cus_8fA2"))}, nil, getResp)}
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

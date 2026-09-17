import http from "node:http";

const host = "127.0.0.1";
const port = 4318;
const defaultConsolePreferences = {
  defaultAgentSlug: "",
  displayName: "",
  notificationLevel: "attention",
  shareUsageData: false,
  showModelReasoning: false,
  theme: "system",
};
const state = {
  connected: false,
  googleBackfillPollsRemaining: 0,
  nativeGoogleConnected: false,
  relationshipConnected: true,
  consolePreferences: { ...defaultConsolePreferences },
  consoleResources: [],
  consumedTickets: new Set(),
  lastStart: null,
  lastClaimAuthorization: null,
  lastScanLookbackDays: null,
  ticketCounter: 0,
  scanCounter: 1,
  resourceCounter: 0,
};

const completedScan = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "completed",
  mode: "linked",
  lookbackDays: 180,
  threadsSeen: 12,
  candidatesSeen: 4,
  startedAt: "2026-08-28T01:00:00Z",
  completedAt: "2026-08-28T01:05:00Z",
};

const openPromisesReport = {
  generatedAt: "2026-08-28T01:05:30Z",
  lookbackDays: 180,
  threadsSeen: 12,
  scanStatus: "completed",
  outboundCount: 1,
  inboundCount: 1,
  byAccount: { "ACME Corp": 1, "Beta LLC": 1 },
  truncated: false,
  items: [
    {
      commitmentId: "commit-e2e-1",
      account: "ACME Corp",
      direction: "promised_by_us",
      text: "Send the revised proposal",
      state: "open",
      dueAt: "2026-09-01T17:00:00Z",
      sourceQuote: "I'll send the revised proposal by Friday.",
      occurredAt: "2026-08-20T14:22:00Z",
    },
    {
      commitmentId: "commit-e2e-2",
      account: "Beta LLC",
      direction: "promised_by_them",
      text: "Share the signed SOW",
      state: "at_risk",
      duePhrase: "end of month",
      sourceQuote: "We will share the signed SOW before month end.",
      occurredAt: "2026-08-18T09:10:00Z",
    },
  ],
};

function relationshipSourcesResponse() {
  const accounts = state.relationshipConnected
    ? [
        {
          connectionId: "connection-web-e2e",
          source: "google",
          sourceAccountId: "connector-e2e@example.com",
          status: state.googleBackfillPollsRemaining > 0 ? "backfilling" : "live",
          backfillPhase: state.googleBackfillPollsRemaining > 0 ? "running" : "live",
          backfillCompleted: state.googleBackfillPollsRemaining > 0 ? 25 : 100,
          backfillTotal: 100,
          completeness: state.googleBackfillPollsRemaining > 0 ? "partial" : "complete",
          expectedCadenceSeconds: 3600,
          lagSeconds: 0,
          requiredScopes: ["google:email.read", "google:calendar.read"],
          grantedScopes: ["google:email.read", "google:calendar.read"],
          missingScopes: [],
          retryCount: 0,
          lastSuccessAt: state.googleBackfillPollsRemaining > 0 ? null : "2026-08-28T01:26:00Z",
        },
      ]
    : [];
  return {
    sources: [
      {
        source: "google",
        displayName: "Google",
        evidence: ["email"],
        actions: ["read"],
        readScopes: ["google:email.read"],
        writeScopes: [],
        scopeExplanation: "Read email evidence for commitment detection.",
        connectPath: "/v1/connections/google/start",
        disconnectPath: "/v1/connections/google",
        supportsReconnect: true,
        supportsResync: true,
        expectedCadenceSeconds: 3600,
        accounts,
      },
    ],
  };
}

function json(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

async function readJSON(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function accessToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    sub: "user_web_e2e",
    sid: "session_web_e2e",
    email: "connector-e2e@example.com",
    org_id: "org_web_e2e",
    role: "owner",
    permissions: ["connectors:manage"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.test`;
}

const requiredScope = {
  description: "Read relationship email evidence.",
  displayName: "Read email evidence",
  grantTier: "required",
  name: "google:email.read",
  risk: "low",
};

const optionalScope = {
  description: "Create draft replies after approval.",
  displayName: "Create drafts",
  grantTier: "optional",
  name: "google:drafts.write",
  risk: "medium",
};

function connectorResponse() {
  return {
    connectors: [
      {
        audience: "google-product-api",
        authType: "oauth",
        availableScopes: [requiredScope, optionalScope],
        connected: state.connected,
        connectedAt: state.connected ? "2026-08-28T01:25:00Z" : null,
        connectionHealth: state.connected ? "healthy" : "disconnected",
        connectionReason: null,
        description: "Google mail and calendar evidence.",
        displayName: "Google",
        grantedScopes: state.connected ? [requiredScope] : [],
        health: "healthy",
        lastUsedAt: state.connected ? "2026-08-28T01:26:00Z" : null,
        mcpUrl: "https://connectors.example/google",
        name: "google",
        status: "enabled",
      },
      {
        audience: "disabled-product-api",
        authType: "oauth",
        connected: false,
        connectionHealth: "disabled",
        connectionReason: "provider_configuration_missing",
        description: "A connector unavailable in this environment.",
        displayName: "Disabled Connector",
        health: "unavailable",
        mcpUrl: "",
        name: "disabled",
        status: "disabled",
      },
    ],
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (url.pathname === "/__test/reset") {
    state.connected = false;
    state.googleBackfillPollsRemaining = 0;
    state.nativeGoogleConnected = false;
    state.relationshipConnected = true;
    state.consumedTickets.clear();
    state.lastStart = null;
    state.lastClaimAuthorization = null;
    state.lastScanLookbackDays = null;
    state.ticketCounter = 0;
    state.scanCounter = 1;
    state.resourceCounter = 0;
    state.consolePreferences = { ...defaultConsolePreferences };
    state.consoleResources = [];
    return json(response, 200, { ok: true });
  }
  if (url.pathname === "/__test/state") {
    return json(response, 200, {
      connected: state.connected,
      consolePreferences: state.consolePreferences,
      consoleResources: state.consoleResources,
      consumedTickets: [...state.consumedTickets],
      lastStart: state.lastStart,
      lastClaimAuthorization: state.lastClaimAuthorization,
      lastScanLookbackDays: state.lastScanLookbackDays,
    });
  }
  if (url.pathname === "/__test/google-disconnect") {
    state.nativeGoogleConnected = false;
    state.relationshipConnected = false;
    return json(response, 200, { ok: true });
  }

  if (url.pathname === "/v1/auth/workos/login-url") {
    const authorization = new URL(`http://${host}:${port}/workos/authorize`);
    authorization.searchParams.set("redirect_uri", url.searchParams.get("redirect_uri") || "");
    authorization.searchParams.set("state", url.searchParams.get("state") || "");
    return json(response, 200, { url: authorization.toString() });
  }
  if (url.pathname === "/workos/authorize") {
    const callback = new URL(url.searchParams.get("redirect_uri"));
    callback.searchParams.set("code", "workos-e2e-code");
    callback.searchParams.set("state", url.searchParams.get("state") || "");
    return redirect(response, callback.toString());
  }
  if (url.pathname === "/v1/auth/workos/exchange" && request.method === "POST") {
    return json(response, 200, {
      access_token: accessToken(),
      refresh_token: "refresh-web-e2e",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "Bearer",
      user_id: "user_web_e2e",
      email: "connector-e2e@example.com",
    });
  }
  if (url.pathname === "/v1/auth/workos/refresh" && request.method === "POST") {
    return json(response, 200, {
      access_token: accessToken(),
      refresh_token: "refresh-web-e2e",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "Bearer",
      user_id: "user_web_e2e",
      email: "connector-e2e@example.com",
    });
  }
  if (url.pathname === "/v1/me") {
    return json(response, 200, {
      user: { id: "viewer-web-e2e", email: "connector-e2e@example.com" },
      billing: { plan: "pro", status: "active", usage: {} },
    });
  }

  if (url.pathname === "/v1/google-oauth" && request.method === "GET") {
    return json(response, 200, {
      connected: state.nativeGoogleConnected,
      accounts: state.nativeGoogleConnected
        ? [
            {
              accountId: "connector-e2e@example.com",
              connectedAt: "2026-09-17T12:00:00Z",
              scopes: ["google:email.read", "google:calendar.read"],
            },
          ]
        : [],
    });
  }
  if (url.pathname === "/v1/google-oauth/start" && request.method === "POST") {
    const authorization = new URL(`http://${host}:${port}/google/authorize`);
    authorization.searchParams.set("return_path", url.searchParams.get("return_path") || "");
    return json(response, 200, { authorizeUrl: authorization.toString() });
  }
  if (url.pathname === "/google/authorize") {
    const returnPath =
      url.searchParams.get("return_path") === "/app/report"
        ? "/app/report"
        : "/app/settings?settings=connections";
    const callback = new URL(returnPath, "http://127.0.0.1:4317");
    callback.searchParams.set("google_session", "native-google-ticket");
    callback.searchParams.set("google_status", "success");
    return redirect(response, callback.toString());
  }
  if (url.pathname === "/v1/google-oauth/claim" && request.method === "POST") {
    const body = await readJSON(request);
    if (body.session !== "native-google-ticket") {
      return json(response, 400, { code: "invalid_ticket" });
    }
    state.nativeGoogleConnected = true;
    state.relationshipConnected = true;
    state.googleBackfillPollsRemaining = 1;
    return json(response, 200, {
      accountId: "connector-e2e@example.com",
      connected: true,
    });
  }

  if (url.pathname === "/v1/connectors" && request.method === "GET") {
    return json(response, 200, connectorResponse());
  }
  if (url.pathname === "/v1/connections/google/start" && request.method === "POST") {
    const body = await readJSON(request);
    state.lastStart = body;
    const ticket = `ticket-${++state.ticketCounter}`;
    const authorization = new URL(`http://${host}:${port}/connector/authorize`);
    authorization.searchParams.set("redirect_target", body.redirectTarget || "");
    authorization.searchParams.set("ticket", ticket);
    return json(response, 200, {
      authorization_url: authorization.toString(),
      authorize_url: authorization.toString(),
      expires_at: "2026-08-28T01:35:00Z",
    });
  }
  if (url.pathname === "/connector/authorize") {
    const callback = new URL(url.searchParams.get("redirect_target"));
    callback.searchParams.set("connector", "google");
    callback.searchParams.set("status", "success");
    callback.searchParams.set("session", url.searchParams.get("ticket") || "");
    return redirect(response, callback.toString());
  }
  if (url.pathname === "/v1/connections/google/claim" && request.method === "POST") {
    state.lastClaimAuthorization = request.headers.authorization || null;
    const body = await readJSON(request);
    const claimFailures = {
      "entitlement-ticket": [403, "plan_required"],
      "error-ticket": [503, "connector_disabled"],
      "expired-ticket": [410, "ticket_expired"],
      "retry-ticket": [429, "rate_limited"],
      "scope-ticket": [400, "scope_escalation"],
    };
    const failure = claimFailures[body.state];
    if (failure) {
      return json(response, failure[0], {
        code: failure[1],
        status: failure[0],
        title: "Connector claim failed",
        type: "about:blank",
      });
    }
    if (state.consumedTickets.has(body.state)) {
      return json(response, 409, {
        code: "replay",
        reconnectRequired: true,
        status: 409,
        title: "Conflict",
        type: "about:blank",
      });
    }
    state.consumedTickets.add(body.state);
    state.connected = true;
    return json(response, 200, {
      audience: "google-product-api",
      connected: true,
      connectionId: "connection-web-e2e",
      connector: "google",
      scopes: ["google:email.read"],
    });
  }
  if (url.pathname === "/v1/connections/google" && request.method === "DELETE") {
    state.connected = false;
    response.writeHead(204);
    return response.end();
  }

  if (url.pathname === "/v1/console/preferences" && request.method === "GET") {
    return json(response, 200, state.consolePreferences);
  }
  if (url.pathname === "/v1/console/preferences" && request.method === "PATCH") {
    state.consolePreferences = {
      ...state.consolePreferences,
      ...(await readJSON(request)),
    };
    return json(response, 200, state.consolePreferences);
  }
  if (url.pathname === "/v1/console/resources" && request.method === "GET") {
    const kind = url.searchParams.get("kind");
    const resources = state.consoleResources.filter((resource) => !kind || resource.kind === kind);
    return json(response, 200, {
      limit: Number(url.searchParams.get("limit") || 100),
      offset: Number(url.searchParams.get("offset") || 0),
      resources,
    });
  }
  if (url.pathname === "/v1/console/resources" && request.method === "POST") {
    const body = await readJSON(request);
    const now = new Date().toISOString();
    const resource = {
      ...body,
      id: `00000000-0000-4000-9000-${String(++state.resourceCounter).padStart(12, "0")}`,
      sortOrder: body.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    state.consoleResources.push(resource);
    return json(response, 201, resource);
  }
  const consoleResourceMatch = url.pathname.match(/^\/v1\/console\/resources\/([^/]+)$/);
  if (consoleResourceMatch) {
    const resourceId = decodeURIComponent(consoleResourceMatch[1]);
    const resourceIndex = state.consoleResources.findIndex(
      (resource) => resource.id === resourceId,
    );
    if (resourceIndex < 0) {
      return json(response, 404, {
        code: "not_found",
        status: 404,
        title: "Not found",
        type: "about:blank",
      });
    }
    if (request.method === "GET") {
      return json(response, 200, state.consoleResources[resourceIndex]);
    }
    if (request.method === "PATCH") {
      state.consoleResources[resourceIndex] = {
        ...state.consoleResources[resourceIndex],
        ...(await readJSON(request)),
        updatedAt: new Date().toISOString(),
      };
      return json(response, 200, state.consoleResources[resourceIndex]);
    }
    if (request.method === "DELETE") {
      state.consoleResources.splice(resourceIndex, 1);
      response.writeHead(204);
      return response.end();
    }
  }

  if (url.pathname === "/v1/relationship-sources" && request.method === "GET") {
    return json(response, 200, relationshipSourcesResponse());
  }
  if (url.pathname === "/v1/relationship-sources/status" && request.method === "GET") {
    const result = {
      sources: relationshipSourcesResponse().sources.flatMap((source) => source.accounts),
    };
    if (state.googleBackfillPollsRemaining > 0) state.googleBackfillPollsRemaining -= 1;
    return json(response, 200, result);
  }

  if (url.pathname === "/v1/revenue-leak-scans" && request.method === "GET") {
    return json(response, 200, { scans: [completedScan] });
  }
  if (url.pathname === "/v1/revenue-leak-scans" && request.method === "POST") {
    const body = await readJSON(request);
    state.lastScanLookbackDays = body.lookbackDays ?? 180;
    const scan = {
      id: `00000000-0000-4000-8000-${String(++state.scanCounter).padStart(12, "0")}`,
      status: "running",
      mode: "linked",
      lookbackDays: state.lastScanLookbackDays,
      threadsSeen: 0,
      startedAt: new Date().toISOString(),
    };
    return json(response, 201, scan);
  }
  const scanMatch = url.pathname.match(/^\/v1\/revenue-leak-scans\/([^/]+)(?:\/report)?$/);
  if (scanMatch) {
    const scanId = decodeURIComponent(scanMatch[1]);
    const isReport = url.pathname.endsWith("/report");
    if (isReport) {
      if (url.searchParams.get("format") === "md") {
        response.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        return response.end("# Open promises\n\nE2E fixture report.\n");
      }
      return json(response, 200, openPromisesReport);
    }
    if (scanId === completedScan.id) {
      return json(response, 200, completedScan);
    }
    return json(response, 200, { ...completedScan, id: scanId });
  }

  if (url.pathname === "/v1/revenue-actions" && request.method === "GET") {
    return json(response, 200, { actions: [] });
  }
  if (url.pathname === "/v1/revenue-search" && request.method === "GET") {
    return json(response, 200, {
      available: true,
      matches: [
        {
          threadId: "thread-e2e-1",
          subject: "Revised launch plan",
          counterparty: "Ada",
          classification: "commitment",
          summary: "Ada promised to send the revised launch plan.",
          score: 0.91,
        },
      ],
    });
  }
  if (url.pathname === "/v1/action-proposals" && request.method === "GET") {
    return json(response, 200, { proposals: [] });
  }

  return json(response, 200, {});
});

server.listen(port, host, () => {
  console.log(`fake rowboat-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

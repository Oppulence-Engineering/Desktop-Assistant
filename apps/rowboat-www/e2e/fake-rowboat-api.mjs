import http from "node:http";

const host = "127.0.0.1";
const port = 4318;
const state = {
  connected: false,
  consumedTickets: new Set(),
  lastStart: null,
  lastClaimAuthorization: null,
  ticketCounter: 0,
};

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
    state.consumedTickets.clear();
    state.lastStart = null;
    state.lastClaimAuthorization = null;
    state.ticketCounter = 0;
    return json(response, 200, { ok: true });
  }
  if (url.pathname === "/__test/state") {
    return json(response, 200, {
      connected: state.connected,
      consumedTickets: [...state.consumedTickets],
      lastStart: state.lastStart,
      lastClaimAuthorization: state.lastClaimAuthorization,
    });
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

  return json(response, 200, {});
});

server.listen(port, host, () => {
  console.log(`fake rowboat-api listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

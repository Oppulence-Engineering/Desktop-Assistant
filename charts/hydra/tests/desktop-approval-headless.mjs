#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  awaitApprovalAndRetry,
  canonicalArgumentsDigest,
  configureMcpApprovalUrlOpener,
  parseMcpApprovalDeepLink,
  registerMcpApprovalResult,
} from "../../../apps/x/packages/core/dist/mcp/product-approval.js";
import {
  mcpAuthorizationSessionFingerprint,
  mcpHeadersDigest,
  normalizeMcpEndpoint,
} from "../../../apps/x/packages/core/dist/mcp/approval-request.js";

let approvalUrl;
configureMcpApprovalUrlOpener(async (url) => {
  approvalUrl = new URL(url);
});

const originalArguments = Object.freeze({ paymentRunId: "run_contract", amount: 1250 });
const configuredEndpoint = normalizeMcpEndpoint("https://cadence.example.invalid/mcp");
const requestHeaders = Object.freeze({
  Authorization: "Bearer deployment-contract-resource-token",
  "Mcp-Session-Id": "deployment-contract-session",
});
const requestBinding = Object.freeze({
  serverName: "rowboat-cadence",
  configuredEndpoint,
  connectionId: "deployment-contract-connection",
  configGeneration: 7,
  configDigest: "deployment-contract-config-digest",
  configuredHeadersDigest: mcpHeadersDigest(requestHeaders),
  credentialFingerprint: "deployment-contract-credential-fingerprint",
  endpoint: configuredEndpoint,
  headersDigest: mcpHeadersDigest(requestHeaders),
  authorizationSessionFingerprint: mcpAuthorizationSessionFingerprint(requestHeaders),
  sessionId: "deployment-contract-session",
  toolName: "payment.execute",
  argumentsDigest: canonicalArgumentsDigest(originalArguments),
});
let retries = 0;
const resultPromise = awaitApprovalAndRetry(
  "rowboat-cadence",
  "payment.execute",
  originalArguments,
  {
    status: 428,
    body: JSON.stringify({
      approvalRequired: true,
      approvalChallengeUrl: "https://cadence.example.invalid/approvals/contract",
      actor: "deployment-contract-user",
      action: "payment.execute",
    }),
  },
  requestBinding,
  async (token, approvedBinding) => {
    retries += 1;
    assert.equal(token, "one-time-deployment-contract-token");
    assert.deepEqual(approvedBinding.configuredEndpoint, configuredEndpoint);
    assert.deepEqual(approvedBinding.endpoint, configuredEndpoint);
    assert.equal(approvedBinding.connectionId, requestBinding.connectionId);
    assert.equal(approvedBinding.configGeneration, requestBinding.configGeneration);
    assert.equal(approvedBinding.configDigest, requestBinding.configDigest);
    assert.equal(approvedBinding.configuredHeadersDigest, requestBinding.configuredHeadersDigest);
    assert.equal(approvedBinding.credentialFingerprint, requestBinding.credentialFingerprint);
    assert.equal(approvedBinding.headersDigest, requestBinding.headersDigest);
    assert.equal(
      approvedBinding.authorizationSessionFingerprint,
      requestBinding.authorizationSessionFingerprint,
    );
    assert.equal(approvedBinding.sessionId, requestBinding.sessionId);
    return { resumed: true, arguments: originalArguments };
  },
  async (code, verifier, productOrigin, approvedBinding) => {
    assert.equal(code, "one-time-deployment-contract-code");
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(productOrigin, configuredEndpoint.origin);
    assert.equal(
      approvedBinding.desktopChallengeId,
      approvalUrl.searchParams.get("desktop_challenge_id"),
    );
    assert.equal(approvedBinding.connectionId, requestBinding.connectionId);
    assert.equal(approvedBinding.toolName, requestBinding.toolName);
    assert.equal(approvedBinding.argumentsDigest, requestBinding.argumentsDigest);
    return { approvalToken: "one-time-deployment-contract-token" };
  },
);

for (let attempts = 0; !approvalUrl && attempts < 100; attempts += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(approvalUrl, "desktop adapter did not open the product approval URL");
assert.equal(approvalUrl.protocol, "https:");
assert.equal(approvalUrl.origin, configuredEndpoint.origin);
assert.ok(approvalUrl.searchParams.get("desktop_code_challenge"));
assert.equal(approvalUrl.searchParams.get("desktop_code_challenge_method"), "S256");
assert.equal(approvalUrl.searchParams.has("approval_token"), false);
assert.equal(approvalUrl.searchParams.has("token"), false);

const callback = new URL("oppulence://mcp-approval");
callback.searchParams.set("challenge_id", approvalUrl.searchParams.get("desktop_challenge_id"));
callback.searchParams.set("status", "approved");
callback.searchParams.set("code", "one-time-deployment-contract-code");

assert.equal(callback.searchParams.has("approval_token"), false);
assert.equal(callback.searchParams.has("token"), false);

const completion = parseMcpApprovalDeepLink(callback.toString());
assert.ok(completion, "packaged desktop deep-link adapter rejected a valid callback");
assert.equal(registerMcpApprovalResult(completion), true);
assert.deepEqual(await resultPromise, { resumed: true, arguments: originalArguments });
assert.equal(retries, 1);
assert.equal(registerMcpApprovalResult(completion), false, "approval callback replay was accepted");
console.log("packaged desktop approval/deep-link adapter passed");

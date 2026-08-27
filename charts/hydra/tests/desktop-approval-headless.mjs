#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  awaitApprovalAndRetry,
  configureMcpApprovalUrlOpener,
  parseMcpApprovalDeepLink,
  registerMcpApprovalResult,
} from "../../../apps/x/packages/core/dist/mcp/product-approval.js";

let approvalUrl;
configureMcpApprovalUrlOpener(async (url) => {
  approvalUrl = new URL(url);
});

const originalArguments = Object.freeze({ paymentRunId: "run_contract", amount: 1250 });
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
  async (token) => {
    retries += 1;
    assert.equal(token, "one-time-deployment-contract-token");
    return { resumed: true, arguments: originalArguments };
  },
);

for (let attempts = 0; !approvalUrl && attempts < 100; attempts += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(approvalUrl, "desktop adapter did not open the product approval URL");

const callback = new URL("oppulence://mcp-approval");
callback.searchParams.set("challenge_id", approvalUrl.searchParams.get("desktop_challenge_id"));
callback.searchParams.set("server", approvalUrl.searchParams.get("desktop_server"));
callback.searchParams.set("tool", approvalUrl.searchParams.get("desktop_tool"));
callback.searchParams.set(
  "arguments_digest",
  approvalUrl.searchParams.get("desktop_arguments_digest"),
);
callback.searchParams.set("actor", approvalUrl.searchParams.get("desktop_actor"));
callback.searchParams.set("action", approvalUrl.searchParams.get("desktop_action"));
callback.searchParams.set("status", "approved");
callback.searchParams.set("approval_token", "one-time-deployment-contract-token");

const completion = parseMcpApprovalDeepLink(callback.toString());
assert.ok(completion, "packaged desktop deep-link adapter rejected a valid callback");
assert.equal(registerMcpApprovalResult(completion), true);
assert.deepEqual(await resultPromise, { resumed: true, arguments: originalArguments });
assert.equal(retries, 1);
assert.equal(registerMcpApprovalResult(completion), false, "approval callback replay was accepted");
console.log("packaged desktop approval/deep-link adapter passed");

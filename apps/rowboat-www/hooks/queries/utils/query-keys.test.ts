import { describe, expect, it } from "vitest";

import { agentKeys } from "@/hooks/queries/utils/agent-keys";
import { artifactKeys } from "@/hooks/queries/utils/artifact-keys";
import { chatSessionKeys } from "@/hooks/queries/utils/chat-session-keys";
import { commitmentKeys } from "@/hooks/queries/utils/commitment-keys";
import { connectorKeys } from "@/hooks/queries/utils/connector-keys";
import { consoleKeys } from "@/hooks/queries/utils/console-keys";
import { impactKeys } from "@/hooks/queries/utils/impact-keys";
import { actionProposalKeys } from "@/hooks/queries/utils/action-proposal-keys";
import { communicationKeys } from "@/hooks/queries/utils/communication-keys";
import { composioKeys } from "@/hooks/queries/utils/composio-keys";
import { googleOauthKeys } from "@/hooks/queries/utils/google-oauth-keys";
import { reportKeys } from "@/hooks/queries/utils/report-keys";
import { relationshipKeys } from "@/hooks/queries/utils/relationship-keys";
import { relationshipSourceKeys } from "@/hooks/queries/utils/relationship-source-keys";
import { revenueActionKeys } from "@/hooks/queries/utils/revenue-action-keys";
import { revenueScanKeys } from "@/hooks/queries/utils/revenue-scan-keys";
import { sidebarKeys } from "@/hooks/queries/utils/sidebar-keys";
import { workflowKeys } from "@/hooks/queries/utils/workflow-keys";
import { workspaceKeys } from "@/hooks/queries/utils/workspace-keys";

describe("query key factories", () => {
  it("nests list and detail keys under an all root for prefix invalidation", () => {
    expect(relationshipSourceKeys.list()[0]).toBe(relationshipSourceKeys.all[0]);
    expect(relationshipSourceKeys.inventory()[0]).toBe(relationshipSourceKeys.all[0]);
    expect(reportKeys.scan("scan-1")).toEqual(["report", "scans", "detail", "scan-1"]);
    expect(reportKeys.document("scan-1")[0]).toBe(reportKeys.all[0]);
    expect(revenueScanKeys.detail("scan-1")).toEqual(["revenue-scan", "detail", "scan-1"]);
    expect(impactKeys.bundle()[0]).toBe(impactKeys.all[0]);
    expect(
      commitmentKeys.register({
        view: "we_owe",
        accountId: "",
        owner: "",
        includeCandidates: false,
      })[0],
    ).toBe(commitmentKeys.all[0]);
    expect(revenueActionKeys.list("open", 100)[0]).toBe(revenueActionKeys.all[0]);
    expect(relationshipKeys.list({ q: "acme" })[0]).toBe(relationshipKeys.all[0]);
    expect(relationshipKeys.graph({ scope: "portfolio" })[0]).toBe(relationshipKeys.all[0]);
    expect(relationshipKeys.persons("ada")[0]).toBe(relationshipKeys.all[0]);
    expect(googleOauthKeys.status()[0]).toBe(googleOauthKeys.all[0]);
    expect(actionProposalKeys.pending()[0]).toBe(actionProposalKeys.all[0]);
    expect(composioKeys.toolkits()[0]).toBe(composioKeys.all[0]);
    expect(communicationKeys.policy("acct-1")[0]).toBe(communicationKeys.all[0]);
    expect(workspaceKeys.current()[0]).toBe(workspaceKeys.all[0]);
    expect(workspaceKeys.notes()[0]).toBe(workspaceKeys.all[0]);
    expect(consoleKeys.resourceKind("note_template")[0]).toBe(consoleKeys.all[0]);
    expect(agentKeys.summaries()[0]).toBe(agentKeys.all[0]);
    expect(chatSessionKeys.list()[0]).toBe(chatSessionKeys.all[0]);
    expect(artifactKeys.detail("agent", "assistant")[0]).toBe(artifactKeys.all[0]);
    expect(sidebarKeys.runs()[0]).toBe(sidebarKeys.all[0]);
    expect(workflowKeys.latest("oppulence-relationship-refresh")[0]).toBe(workflowKeys.all[0]);
    expect(connectorKeys.list()[0]).toBe(connectorKeys.all[0]);
  });
});

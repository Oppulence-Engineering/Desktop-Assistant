import { describe, expect, it } from "vitest";

import { buildSlackReplyDraft, buildSlackThreadReadRequest, parseSlackPermalink } from "./slack-backend-oauth.js";

describe("parseSlackPermalink", () => {
  it("parses a Slack archive permalink", () => {
    expect(parseSlackPermalink("https://acme.slack.com/archives/C01234567/p1700000000000100")).toEqual({
      teamDomain: "acme",
      channel: "C01234567",
      threadTs: "1700000000.000100",
      messageTs: "1700000000.000100",
    });
  });

  it("uses thread_ts for replies inside a Slack thread", () => {
    expect(
      parseSlackPermalink(
        "https://acme.slack.com/archives/C01234567/p1700000000123456?thread_ts=1699999999.000200&cid=C01234567",
      ),
    ).toMatchObject({
      channel: "C01234567",
      threadTs: "1699999999.000200",
      messageTs: "1700000000.123456",
    });
  });

  it("parses Slack app client thread URLs with team id", () => {
    expect(
      parseSlackPermalink("https://app.slack.com/client/T0EXAMPLE/C01234567/thread/C01234567-1700000000.000100"),
    ).toEqual({
      teamId: "T0EXAMPLE",
      channel: "C01234567",
      threadTs: "1700000000.000100",
      messageTs: "1700000000.000100",
    });
  });

  it("parses Slack angle-bracket links", () => {
    expect(parseSlackPermalink("<https://acme.slack.com/archives/C1/p1700000000000100|message>")).toMatchObject({
      channel: "C1",
      threadTs: "1700000000.000100",
    });
  });
});

describe("buildSlackThreadReadRequest", () => {
  it("keeps explicit thread ids", () => {
    expect(
      buildSlackThreadReadRequest({
        teamId: "T0EXAMPLE",
        channel: "C01234567",
        threadTs: "1700000000.000100",
        limit: 25,
      }),
    ).toEqual({
      teamId: "T0EXAMPLE",
      channel: "C01234567",
      threadTs: "1700000000.000100",
      limit: 25,
    });
  });

  it("infers the team id for a single connected workspace", () => {
    expect(
      buildSlackThreadReadRequest(
        { url: "https://acme.slack.com/archives/C01234567/p1700000000000100" },
        [{ teamId: "T0EXAMPLE" }],
      ),
    ).toEqual({
      teamId: "T0EXAMPLE",
      channel: "C01234567",
      threadTs: "1700000000.000100",
      limit: undefined,
    });
  });

  it("requires a team id when multiple workspaces are connected", () => {
    expect(() =>
      buildSlackThreadReadRequest(
        { url: "https://acme.slack.com/archives/C01234567/p1700000000000100" },
        [{ teamId: "T1" }, { teamId: "T2" }],
      ),
    ).toThrow("More than one Slack workspace is connected");
  });
});

describe("buildSlackReplyDraft", () => {
  it("builds an unsent Slack reply draft for a permalink target", () => {
    expect(
      buildSlackReplyDraft(
        {
          url: "https://acme.slack.com/archives/C01234567/p1700000000000100",
          text: " I can take this one. ",
        },
        [{ teamId: "T0EXAMPLE" }],
      ),
    ).toEqual({
      teamId: "T0EXAMPLE",
      channel: "C01234567",
      threadTs: "1700000000.000100",
      text: "I can take this one.",
      sent: false,
      requiresUserSend: true,
    });
  });

  it("rejects empty Slack reply drafts", () => {
    expect(() =>
      buildSlackReplyDraft({
        teamId: "T0EXAMPLE",
        channel: "C01234567",
        threadTs: "1700000000.000100",
        text: "   ",
      }),
    ).toThrow("Slack reply draft text is required");
  });
});

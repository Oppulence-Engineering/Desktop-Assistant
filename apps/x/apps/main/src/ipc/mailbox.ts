import { ipc } from "@x/shared";
import { getMailboxService } from "@x/core/dist/mailbox/mailbox.js";

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]["req"],
) => IPCChannels[K]["res"] | Promise<IPCChannels[K]["res"]>;

type MailboxHandlers = {
  "mailbox:getAccounts": InvokeHandler<"mailbox:getAccounts">;
  "mailbox:getConnectionStatus": InvokeHandler<"mailbox:getConnectionStatus">;
  "mailbox:listThreads": InvokeHandler<"mailbox:listThreads">;
  "mailbox:getThread": InvokeHandler<"mailbox:getThread">;
  "mailbox:search": InvokeHandler<"mailbox:search">;
  "mailbox:triggerSync": InvokeHandler<"mailbox:triggerSync">;
  "mailbox:archiveThread": InvokeHandler<"mailbox:archiveThread">;
  "mailbox:trashThread": InvokeHandler<"mailbox:trashThread">;
  "mailbox:markThreadRead": InvokeHandler<"mailbox:markThreadRead">;
  "mailbox:sendReply": InvokeHandler<"mailbox:sendReply">;
  "mailbox:listRules": InvokeHandler<"mailbox:listRules">;
  "mailbox:createRule": InvokeHandler<"mailbox:createRule">;
  "mailbox:updateRule": InvokeHandler<"mailbox:updateRule">;
  "mailbox:deleteRule": InvokeHandler<"mailbox:deleteRule">;
  "mailbox:listTrackers": InvokeHandler<"mailbox:listTrackers">;
  "mailbox:markThreadStatus": InvokeHandler<"mailbox:markThreadStatus">;
  "mailbox:listDrafts": InvokeHandler<"mailbox:listDrafts">;
  "mailbox:generateDraft": InvokeHandler<"mailbox:generateDraft">;
  "mailbox:getActionRuns": InvokeHandler<"mailbox:getActionRuns">;
  "mailbox:getRuleRuns": InvokeHandler<"mailbox:getRuleRuns">;
};

/**
 * Provider-neutral `mailbox:*` IPC handlers. Delegates to the core mailbox
 * service; the existing `gmail:*` handlers keep working unchanged. Spread into
 * the main `registerIpcHandlers({...})` call, mirroring `browserIpcHandlers`.
 */
export const mailboxIpcHandlers: MailboxHandlers = {
  "mailbox:getAccounts": async () => {
    return { accounts: await getMailboxService().getAccounts() };
  },

  "mailbox:getConnectionStatus": async () => {
    return { status: await getMailboxService().getConnectionStatus() };
  },

  "mailbox:listThreads": async (_event, args) => {
    const page = await getMailboxService().listThreads(args);
    return { threads: page.threads, nextCursor: page.nextCursor ?? null };
  },

  "mailbox:getThread": async (_event, args) => {
    const thread = await getMailboxService().getThread(args);
    return { thread };
  },

  "mailbox:search": async (_event, args) => {
    const result = await getMailboxService().search(args);
    return { messages: result.messages };
  },

  "mailbox:triggerSync": async () => {
    getMailboxService().triggerSync();
    return {};
  },

  "mailbox:archiveThread": async (_event, args) => {
    const run = await getMailboxService().archiveThread(args.providerThreadId, args.accountId);
    return { status: run.status };
  },

  "mailbox:trashThread": async (_event, args) => {
    const run = await getMailboxService().trashThread(args.providerThreadId, args.accountId);
    return { status: run.status };
  },

  "mailbox:markThreadRead": async (_event, args) => {
    const run = await getMailboxService().markThreadRead(args.providerThreadId, args.accountId);
    return { status: run.status };
  },

  "mailbox:sendReply": async (_event, args) => {
    return getMailboxService().sendReply(args);
  },

  "mailbox:listRules": async (_event, args) => {
    return { rules: await getMailboxService().listRules(args.accountId) };
  },

  "mailbox:createRule": async (_event, args) => {
    const rule = await getMailboxService().createRule(
      args.rule as unknown as Parameters<ReturnType<typeof getMailboxService>["createRule"]>[0],
    );
    return { rule };
  },

  "mailbox:updateRule": async (_event, args) => {
    const rule = await getMailboxService().updateRule(args.id, args.patch as never);
    return { rule };
  },

  "mailbox:deleteRule": async (_event, args) => {
    await getMailboxService().deleteRule(args.id);
    return {};
  },

  "mailbox:listTrackers": async (_event, args) => {
    return { trackers: await getMailboxService().listTrackers(args.accountId, args.status) };
  },

  "mailbox:markThreadStatus": async (_event, args) => {
    const service = getMailboxService();
    switch (args.status) {
      case "done":
        return { tracker: await service.markThreadDone(args.accountId, args.threadId) };
      case "awaiting_reply":
        return {
          tracker: await service.markThreadAwaiting(args.accountId, args.threadId, args.dueInDays),
        };
      case "needs_action":
        return {
          tracker: await service.markThreadNeedsAction(args.accountId, args.threadId, args.reason),
        };
      case "needs_reply":
        // No manual "needs reply" transition; return the current tracker as-is.
        return { tracker: await service.store.getTrackerByThread(args.accountId, args.threadId) };
    }
  },

  "mailbox:listDrafts": async (_event, args) => {
    return { drafts: await getMailboxService().listDrafts(args.accountId) };
  },

  "mailbox:generateDraft": async (_event, args) => {
    return { draft: await getMailboxService().generateDraft(args) };
  },

  "mailbox:getActionRuns": async (_event, args) => {
    return { runs: await getMailboxService().getActionRuns(args.accountId, args.limit) };
  },

  "mailbox:getRuleRuns": async (_event, args) => {
    return { runs: await getMailboxService().getRuleRuns(args.accountId, args.limit) };
  },
};

export const chatSessionKeys = {
  all: ["chat-session"] as const,
  lists: () => [...chatSessionKeys.all, "list"] as const,
  list: () => [...chatSessionKeys.lists(), "remote"] as const,
};

export const CHAT_SESSION_LIST_STALE_TIME = 15_000;

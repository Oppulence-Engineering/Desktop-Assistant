/** Oppulence hero/composer seeded prompt — shared by sidebar suggestions and the typed loop. */
export const DEFAULT_USER_MESSAGE =
  "After we close Acme, pull every commitment from mail and HubSpot into the register.";

/** Oppulence reply shown once the workflow stage opens. */
export const DEFAULT_REPLY_MESSAGE =
  "Reading Gmail and HubSpot for Acme. I'll list candidate sentences and wait for you to confirm before anything sends.";

export const PREVIEW_SUGGESTIONS = [
  { title: "Read the closed deal", prompt: DEFAULT_USER_MESSAGE },
  {
    title: "Confirm register rows",
    prompt: "Turn the strong sentences into ledger rows I can approve.",
  },
  {
    title: "Watch stale promises",
    prompt: "Watch what goes stale after kickoff and queue it for review.",
  },
] as const;

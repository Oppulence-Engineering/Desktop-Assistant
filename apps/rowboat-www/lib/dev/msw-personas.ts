import { http, HttpResponse } from "msw";

import type { DevPersona } from "@/lib/dev/dev-prefs";

/** Extra MSW handlers layered on top of Orval fakes for dev personas. */
export function personaHandlers(persona: DevPersona) {
  switch (persona) {
    case "session-expired":
      return [
        http.get("/api/auth/session", () =>
          HttpResponse.json({ authenticated: false }, { status: 401 }),
        ),
      ];
    case "empty-workspace":
      return [
        http.get("*/v1/revenue-actions", () => HttpResponse.json({ items: [] })),
        http.get("*/v1/revenue-leak-scans", () => HttpResponse.json({ items: [] })),
      ];
    case "revenue-full":
      return [
        http.get("*/v1/revenue-actions", () =>
          HttpResponse.json({
            items: Array.from({ length: 8 }, (_, index) => ({
              id: `action-${index}`,
              title: `Follow up ACME ${index}`,
              status: "pending_review",
            })),
          }),
        ),
      ];
    default:
      return [];
  }
}

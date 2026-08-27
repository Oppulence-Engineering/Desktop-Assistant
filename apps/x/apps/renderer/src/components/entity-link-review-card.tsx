import { useCallback, useEffect, useState } from "react";
import { Button } from "@oppulence/ui/components/button";
import { AlertTriangleIcon } from "@/lib/icons";

type Suggestion = Awaited<ReturnType<typeof listSuggestions>>[number];
type SpineHealth = Awaited<ReturnType<typeof getSpineHealth>>;

function listSuggestions() {
  return window.ipc.invoke("entities:listLinkSuggestions", {});
}

function getSpineHealth() {
  return window.ipc.invoke("entities:getSpineHealth", {});
}

/** User-owned approval card. Copilot can list suggestions but cannot invoke this mutation channel. */
export function EntityLinkReviewCard() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [health, setHealth] = useState<SpineHealth>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextSuggestions, nextHealth] = await Promise.all([
        listSuggestions(),
        getSpineHealth(),
      ]);
      setSuggestions(nextSuggestions.filter((suggestion) => suggestion.status === "pending"));
      setHealth(nextHealth);
    } catch (error) {
      console.error("Could not load entity link suggestions:", error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const suggestion = suggestions[0];
  if (!suggestion && health?.status !== "degraded") return null;

  const decide = async (decision: "accept" | "reject", chosenRef?: string) => {
    setBusy(true);
    try {
      await window.ipc.invoke("entities:reviewLinkSuggestion", {
        suggestionId: suggestion.id,
        decision,
        chosenRef,
      });
      await refresh();
    } catch (error) {
      console.error("Could not review entity link suggestion:", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fixed bottom-5 right-5 z-50 w-[min(28rem,calc(100vw-2.5rem))] border border-amber-500/50 bg-background p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1 space-y-3">
          {health?.status === "degraded" ? (
            <div className="border-b border-amber-500/30 pb-3">
              <h2 className="text-sm font-semibold">Entity sync needs attention</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {health.remaining} queued and {health.deadLetters} requiring review. Rowboat will
                retry temporary failures automatically. Check your connection or sign-in, then
                review rejected projections if this persists.
              </p>
              {health.lastError ? (
                <p className="mt-2 break-words font-mono text-[11px] text-amber-700">
                  {health.lastError}
                </p>
              ) : null}
            </div>
          ) : null}
          {suggestion ? (
            <>
              <div>
                <h2 className="text-sm font-semibold">Confirm entity link</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {suggestion.notePath} matched multiple {suggestion.product}{" "}
                  {suggestion.recordType} records. Only your selection can change the entity
                  identity.
                </p>
              </div>
              <div className="space-y-2">
                {suggestion.candidateRefs.map((candidateRef) => (
                  <Button
                    key={candidateRef}
                    className="h-auto w-full justify-start whitespace-normal px-3 py-2 font-mono text-xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void decide("accept", candidateRef)}
                  >
                    Link {candidateRef}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {suggestions.length > 1
                    ? `${suggestions.length - 1} more pending`
                    : "No automatic merge"}
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
                  Reject
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export const MISSION_CONTROL_QUESTIONS = [
  { key: "state", label: "What is true now?" },
  { key: "change", label: "What changed?" },
  { key: "evidence", label: "Why should I trust it?" },
  { key: "action", label: "What should happen next?" },
];

export const RELATIONSHIP_DIMENSION_LABELS = {
  lifecycle: "Lifecycle",
  engagement: "Engagement",
  sentiment: "Sentiment",
  health: "Health",
  summary: "Summary",
  next_action: "Next action",
  risk: "Risk",
  milestone: "Milestone",
};

export const COMPLETENESS_LABELS = {
  complete: "Evidence current",
  partial: "Partial evidence",
  stale: "Evidence stale",
  rebuilding: "Sources rebuilding",
  ambiguous: "Identity review required",
  disconnected: "Source disconnected",
};

export const AUTHORITY_LABELS = {
  user_correction: "Confirmed by a person",
  source_fact: "Source fact",
  deterministic: "Deterministic rule",
  ai_inference: "AI inference",
};

export function relationshipLabel(value) {
  return (value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function completenessTone(status) {
  if (status === "complete") return "safe";
  if (status === "partial" || status === "rebuilding") return "caution";
  return "blocked";
}

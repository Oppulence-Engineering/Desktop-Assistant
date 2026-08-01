export const MISSION_CONTROL_QUESTIONS: readonly [
  { readonly key: "state"; readonly label: "What is true now?" },
  { readonly key: "change"; readonly label: "What changed?" },
  { readonly key: "evidence"; readonly label: "Why should I trust it?" },
  { readonly key: "action"; readonly label: "What should happen next?" },
];
export const RELATIONSHIP_DIMENSION_LABELS: Record<string, string>;
export const COMPLETENESS_LABELS: Record<string, string>;
export const AUTHORITY_LABELS: Record<string, string>;
export function relationshipLabel(value?: string): string;
export function completenessTone(status: string): "safe" | "caution" | "blocked";

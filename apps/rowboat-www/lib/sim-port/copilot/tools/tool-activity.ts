interface ToolSummaryInput {
  displayTitle: string;
}

export function getToolActivitySummaryActions(
  tools: readonly ToolSummaryInput[],
  maxActions: number,
): { labels: string[]; additionalActions: number } {
  const labels = tools.slice(0, maxActions).map((tool) => tool.displayTitle);
  return {
    labels,
    additionalActions: Math.max(0, tools.length - maxActions),
  };
}

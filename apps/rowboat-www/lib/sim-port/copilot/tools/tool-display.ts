export function getToolStatusDisplayTitle(
  title: string,
  _status?: string,
  _toolName?: string,
  activityDescription?: string,
): string {
  return activityDescription ?? title;
}

export function getWaitCountdownTitle(title: string): string {
  return title;
}

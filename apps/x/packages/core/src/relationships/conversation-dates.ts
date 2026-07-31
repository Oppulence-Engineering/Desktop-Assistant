function addDays(base: Date, days: number): Date {
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Resolve common spoken due phrases deterministically relative to the conversation. */
export function resolveSpokenDueAt(
  phrase: string | undefined,
  occurredAt: string,
): string | undefined {
  const value = phrase?.trim().toLowerCase();
  const base = new Date(occurredAt);
  if (!value || Number.isNaN(base.getTime())) return undefined;
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T17:00:00.000Z`).toISOString();
  if (/\btoday\b/.test(value)) {
    return new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 17),
    ).toISOString();
  }
  if (/\btomorrow\b/.test(value)) {
    const day = addDays(base, 1);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  const relative = value.match(/\bin\s+(\d+)\s+(day|week)s?\b/);
  if (relative) {
    const amount = Number(relative[1]) * (relative[2] === "week" ? 7 : 1);
    const day = addDays(base, amount);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  if (/\bnext week\b/.test(value)) {
    const day = addDays(base, 7);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = weekdays.findIndex((name) =>
    new RegExp(`\\b(?:next\\s+)?${name}\\b`).test(value),
  );
  if (weekday >= 0) {
    let days = (weekday - base.getUTCDay() + 7) % 7;
    if (days === 0 || value.includes("next ")) days += 7;
    const day = addDays(base, days);
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17),
    ).toISOString();
  }
  return undefined;
}

/** Find a bounded due phrase in a material claim. */
export function duePhrase(text: string): string | undefined {
  return text.match(
    /\b(?:by|before|on)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|tomorrow|next week|in\s+\d+\s+(?:day|week)s?|20\d{2}-\d{2}-\d{2})\b/i,
  )?.[1];
}

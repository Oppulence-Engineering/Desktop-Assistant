import type {
  DictationDictionaryEntry,
  DictationLanguage,
  DictationPolishChange,
  DictationSettings,
  DictationStyle,
} from "@x/shared/dist/transcription.js";

import type { DesktopTextContext } from "./desktop-context.js";

export interface DictationPolishResult {
  text: string;
  pressEnter: boolean;
  changes: DictationPolishChange[];
}

export interface DictationPolishOptions {
  settings?: DictationSettings;
  context?: DesktopTextContext | null;
  language?: DictationLanguage;
}

const FILLER_WORDS = /\b(?:um+|uh+|erm+|hmm+)\b(?:\s*,?\s*)/gi;
const PRESS_ENTER = /(?:^|[\s,.!?;:])press enter[\s,.!?;:]*$/i;

const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/\bnew paragraph\b/gi, "\n\n"],
  [/\b(?:new line|next line|line break)\b/gi, "\n"],
  [/\bquestion mark\b/gi, "?"],
  [/\b(?:exclamation mark|exclamation point)\b/gi, "!"],
  [/\bsemicolon\b/gi, ";"],
  [/\bcolon\b/gi, ":"],
  [/\bcomma\b/gi, ","],
  [/\b(?:full stop|period)\b/gi, "."],
];

function capitalizeSentences(text: string): string {
  return text.replace(
    /(^|[.!?]\s+|\n+)([a-z])/g,
    (_match, prefix: string, letter: string) => prefix + letter.toUpperCase(),
  );
}

function cleanSpacing(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=[A-Za-z0-9])/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

function isDeveloperSurface(context?: DesktopTextContext | null): boolean {
  if (!context) return false;
  const identity = `${context.appName} ${context.bundleIdentifier ?? ""} ${context.documentURL ?? ""}`;
  return /\b(?:code|visual studio|vscode|cursor|xcode|terminal|iterm|warp|intellij|webstorm|pycharm|goland|rustrover)\b/i.test(
    identity,
  );
}

/** French typography uses a narrow no-break space around high punctuation. */
function applyFrenchSpacing(text: string): string {
  return text
    .replace(/[ \t\u00a0\u202f]*([;:?!»])/gu, "\u202f$1")
    .replace(/«[ \t\u00a0\u202f]*/gu, "«\u202f");
}

/**
 * Resolve conservative, high-confidence backtracks without an LLM round-trip.
 *
 * The preposition form covers the most common natural correction ("at five,
 * actually six" / "to Alice, no wait, Bob") while avoiding destructive rewrites
 * of ordinary uses such as "I actually enjoyed it".
 */
function resolveBacktracks(text: string): string {
  let result = text;

  result = result.replace(
    /\b(\d+(?::\d+)?(?:\s*[ap]m)?)\s*,?\s*(?:actually|no\s+wait|i\s+mean)\s*,?\s*(\d+(?::\d+)?(?:\s*[ap]m)?)(?=\b|[.!?,;:]|$)/gi,
    "$2",
  );

  result = result.replace(
    /\b((?:at|on|for|with|to|from|in|by)\s+)([^,.!?;\n]{1,40}?)\s*,\s*(?:actually|no\s+wait|i\s+mean)\s*,?\s*([^,.!?;\n]{1,40})(?=[.!?;\n]|$)/gi,
    "$1$3",
  );

  // Treat only the strong parallel-article form as an implicit restart. A broad
  // repeated-preposition rule corrupts ordinary sentences such as “to meet ...
  // in order to review,” where both uses of “to” are intentional.
  result = result.replace(
    /\b(as)\s+(a|an|the)\s+([^,.!?;\n]{1,30}?)\s+\1\s+\2\s+([^,.!?;\n]{1,30})(?=[.!?,;\n]|$)/gi,
    "$1 $2 $4",
  );

  // A deliberate "scratch that" restarts the current sentence. Keep completed
  // earlier sentences and use only the replacement thought for the active one.
  result = result.replace(
    /(^|[.!?]\s+|\n)([^.!?\n]*?)\s*,?\s*scratch that\s*,?\s*([^.!?\n]+)/gi,
    "$1$3",
  );

  // Remove immediately repeated multi-word phrases ("they say they say").
  result = result.replace(/\b([\p{L}\p{N}']+\s+[\p{L}\p{N}']+)\s+\1\b/giu, "$1");
  return result;
}

/** High cleanup shortens only conventional wordy phrases with stable meaning. */
function reduceWordiness(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bat this point in time\b/gi, "now"],
    [/\bfor the purpose of\b/gi, "to"],
    [/\b(?:is|are) able to\b/gi, "can"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bin the event that\b/gi, "if"],
    [/\bwith (?:regard|respect) to\b/gi, "about"],
    [/\ba large number of\b/gi, "many"],
    [/\bi just wanted to\b/gi, "I wanted to"],
  ];
  return replacements.reduce((result, [pattern, replacement]) => {
    return result.replace(pattern, replacement);
  }, text);
}

function formatSpokenList(text: string): string {
  const match = text.match(
    /^(.*?\b(?:are|include|following)\s*:?)\s+(?:one|first)\s+(.+?)\s+(?:two|second)\s+(.+?)(?:\s+(?:three|third)\s+(.+))?$/i,
  );
  if (!match) return text;

  const intro = match[1].replace(/\s*:$/, "").trim();
  const items = match.slice(2).filter((item): item is string => Boolean(item?.trim()));
  return `${intro}:\n${items
    .map((item, index) => `${index + 1}. ${capitalizeSentences(item.trim())}`)
    .join("\n")}`;
}

function phrasePattern(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

function wholePhraseRegex(phrases: string[]): RegExp | null {
  const alternatives = phrases
    .filter((phrase) => phrase.trim())
    .sort((left, right) => right.length - left.length)
    .map(phrasePattern);
  if (!alternatives.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

function normalizedPhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function applyDictionary(text: string, entries: DictationDictionaryEntry[]): string {
  let result = text;
  const ordered = [...entries].sort(
    (left, right) =>
      Number(right.starred) - Number(left.starred) || right.term.length - left.term.length,
  );

  for (const entry of ordered) {
    if (!entry.replacementFor) continue;
    const pattern = wholePhraseRegex([entry.replacementFor]);
    if (pattern) result = result.replace(pattern, entry.term);
  }

  // Vocabulary-only entries still enforce the user's exact casing (API, FigJam,
  // Oppulence). Recognition aliases above handle genuinely different spellings.
  for (const entry of ordered) {
    const pattern = wholePhraseRegex([entry.term]);
    if (pattern) result = result.replace(pattern, entry.term);
  }
  return result;
}

function applySnippets(text: string, snippets: DictationSettings["snippets"]): string {
  const expansionByTrigger = new Map(
    snippets.map((snippet) => [normalizedPhrase(snippet.trigger), snippet.expansion] as const),
  );
  const pattern = wholePhraseRegex(snippets.map((snippet) => snippet.trigger));
  if (!pattern) return text;
  // A single replace pass prevents text inserted by one snippet from recursively
  // firing another. Alternation order makes the longest overlapping trigger win.
  return text.replace(pattern, (match) => expansionByTrigger.get(normalizedPhrase(match)) ?? match);
}

function categoryStyle(
  settings: DictationSettings,
  context?: DesktopTextContext | null,
): DictationStyle {
  switch (context?.appCategory) {
    case "email":
      return settings.styles.email;
    case "work-messaging":
      return settings.styles.workMessaging;
    case "personal-messaging":
      return settings.styles.personalMessaging;
    default:
      return settings.styles.other;
  }
}

function firstWord(text: string): string | null {
  return text.match(/^\s*([\p{L}\p{M}][\p{L}\p{M}'’_-]*)/u)?.[1] ?? null;
}

function visibleCapitalizedWords(context?: DesktopTextContext | null): Set<string> {
  const words = new Set<string>();
  if (!context || context.sensitive) return words;
  const nearby = `${context.beforeText} ${context.selectedText} ${context.afterText}`;
  for (const match of nearby.matchAll(/\b\p{Lu}[\p{L}\p{M}'’-]{1,60}\b/gu)) {
    words.add(match[0].toLocaleLowerCase());
  }
  return words;
}

function lowerFirstUnlessProtected(
  text: string,
  settings: DictationSettings,
  context?: DesktopTextContext | null,
): string {
  const word = firstWord(text);
  if (!word) return text;
  const protectedTerms = new Set(
    settings.dictionary.map((entry) => normalizedPhrase(entry.term.split(/\s+/)[0])),
  );
  for (const visible of visibleCapitalizedWords(context)) protectedTerms.add(visible);
  if (protectedTerms.has(word.toLocaleLowerCase())) return text;
  return text.replace(/^(\s*)(\p{Lu})/u, (_match, prefix: string, letter: string) => {
    return prefix + letter.toLocaleLowerCase();
  });
}

function sentenceCount(text: string): number {
  return Math.max(1, text.split(/[.!?]+(?:\s+|$)/).filter((part) => part.trim()).length);
}

function applyContextAndStyle(
  text: string,
  settings: DictationSettings,
  context?: DesktopTextContext | null,
): { text: string; contextChanged: boolean; styleChanged: boolean } {
  let result = text;
  let contextChanged = false;
  let styleChanged = false;
  const style = categoryStyle(settings, context);

  if (context && !context.sensitive && settings.contextEnabled) {
    const before = context.beforeText;
    const trimmedBefore = before.replace(/[ \t]+$/g, "");
    const midSentence =
      Boolean(trimmedBefore) && !/[.!?]\s*$/.test(trimmedBefore) && !/\n\s*$/.test(before);
    if (midSentence) {
      const next = lowerFirstUnlessProtected(result, settings, context);
      contextChanged ||= next !== result;
      result = next;
    }

    // When replacing a selection, before/after are already the exact boundaries
    // around it. Add only spaces that neither side currently supplies.
    const previousCharacter = before.at(-1) ?? "";
    const nextCharacter = context.afterText.at(0) ?? "";
    if (/[\p{L}\p{N})\]}]/u.test(previousCharacter) && !/^\s/u.test(result)) {
      result = ` ${result}`;
      contextChanged = true;
    }
    if (/[\p{L}\p{N}([{]/u.test(nextCharacter) && !/\s$/u.test(result)) {
      result = `${result} `;
      contextChanged = true;
    }

    // A dictated sentence inserted before existing continuation text should not
    // leave a sentence terminator in the middle of the surrounding sentence.
    if (nextCharacter && /[\p{L}\p{N}]/u.test(nextCharacter)) {
      const next = result.replace(/[.!?](\s*)$/u, "$1");
      contextChanged ||= next !== result;
      result = next;
    }
  }

  const messaging =
    context?.appCategory === "work-messaging" || context?.appCategory === "personal-messaging";
  if ((style === "casual" || style === "very-casual") && messaging) {
    const currentLine = context?.beforeText.split("\n").at(-1) ?? "";
    const shouldStripPeriod =
      !context?.selectedText && !/[.!?]/.test(currentLine) && sentenceCount(result) <= 2;
    if (shouldStripPeriod) {
      const next = result.replace(/\.(\s*)$/u, "$1");
      styleChanged ||= next !== result;
      result = next;
    }
  }
  if (style === "very-casual") {
    const next = lowerFirstUnlessProtected(result, settings, context);
    styleChanged ||= next !== result;
    result = next;
  } else if (style === "excited" && /\.(\s*)$/u.test(result)) {
    result = result.replace(/\.(\s*)$/u, "!$1");
    styleChanged = true;
  }

  return { text: result, contextChanged, styleChanged };
}

/**
 * Fast, deterministic cleanup for desktop dictation. It deliberately handles only
 * high-confidence edits; raw transcription remains preferable to a surprising rewrite.
 */
export function polishDictation(
  raw: string,
  options: DictationPolishOptions = {},
): DictationPolishResult {
  const changes: DictationPolishChange[] = [];
  let text = raw.normalize("NFC").trim();
  const englishRules = options.language === undefined || options.language === "en";
  const cleanupLevel = options.settings?.cleanupLevel ?? "medium";
  const cleanupEnabled = cleanupLevel !== "none";
  const clarityEnabled = cleanupLevel === "medium" || cleanupLevel === "high";
  const brevityEnabled = cleanupLevel === "high";

  const pressEnter = englishRules && PRESS_ENTER.test(text);
  if (pressEnter) {
    text = text.replace(PRESS_ENTER, "");
    changes.push("press-enter");
  }

  if (englishRules && cleanupEnabled) {
    const withoutFillers = text.replace(FILLER_WORDS, " ");
    if (withoutFillers !== text) changes.push("fillers");
    text = withoutFillers;

    if (clarityEnabled) {
      const backtracked = resolveBacktracks(text);
      if (backtracked !== text) changes.push("backtrack");
      text = backtracked;
    }

    if (brevityEnabled) {
      const concise = reduceWordiness(text);
      if (concise !== text) changes.push("brevity");
      text = concise;
    }

    for (const [pattern, replacement] of SPOKEN_PUNCTUATION) {
      const next = text.replace(pattern, replacement);
      if (next !== text && !changes.includes("formatting")) changes.push("formatting");
      text = next;
    }

    const spaced = cleanSpacing(text);
    const listed = clarityEnabled ? formatSpokenList(spaced) : spaced;
    if (listed !== spaced && !changes.includes("formatting")) changes.push("formatting");
    text = capitalizeSentences(cleanSpacing(listed));
  } else if (cleanupEnabled) {
    text = cleanSpacing(text);
  }

  if (cleanupEnabled && options.language === "fr" && !isDeveloperSurface(options.context)) {
    const next = applyFrenchSpacing(text);
    if (next !== text && !changes.includes("formatting")) changes.push("formatting");
    text = next;
  }

  const settings = options.settings;
  if (settings?.dictionary.length) {
    const next = applyDictionary(text, settings.dictionary);
    if (next !== text) changes.push("dictionary");
    text = next;
  }
  if (settings?.snippets.length) {
    const next = applySnippets(text, settings.snippets);
    if (next !== text) changes.push("snippet");
    text = next;
  }
  // Wispr-style tone settings are intentionally English-only. Applying English
  // sentence and casual-message heuristics to other languages can corrupt casing.
  if (settings && englishRules && cleanupEnabled) {
    const contextual = applyContextAndStyle(text, settings, options.context);
    if (contextual.contextChanged) changes.push("context");
    if (contextual.styleChanged) changes.push("style");
    text = contextual.text;
  }

  return { text, pressEnter, changes };
}

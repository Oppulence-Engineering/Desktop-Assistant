import type {
  DictationTransformShortcut,
} from "@x/shared/dist/transcription.js";

import type { DesktopTextContext } from "./desktop-context.js";

export const MAX_DICTATION_TRANSFORM_WORDS = 1_000;

const TRANSFORM_ACCELERATORS: Record<DictationTransformShortcut, string> = {
  "option-1": "Alt+1",
  "option-2": "Alt+2",
  "option-3": "Alt+3",
  "option-4": "Alt+4",
  "option-5": "Alt+5",
  "option-6": "Alt+6",
  "option-7": "Alt+7",
  "option-8": "Alt+8",
  "option-9": "Alt+9",
};

export function dictationTransformAccelerator(shortcut: DictationTransformShortcut): string {
  return TRANSFORM_ACCELERATORS[shortcut];
}

export function countDictationTransformWords(text: string): number {
  return text.trim().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export type DictationTransformContextResult =
  | { ok: true; selectedText: string; wordCount: number }
  | { ok: false; error: string };

/**
 * Validate the bounded native selection before any model call. The transform
 * never runs against a password field, an empty selection, or a selection that
 * the helper could not capture in full.
 */
export function validateDictationTransformContext(
  context: DesktopTextContext | null,
): DictationTransformContextResult {
  if (!context) return { ok: false, error: "Could not read the focused text field." };
  if (context.sensitive) {
    return { ok: false, error: "Quick Transforms are unavailable in password fields." };
  }
  if (context.selectedTextLength > context.selectedText.length) {
    return {
      ok: false,
      error: "The selection is too large to transform. Select a passage of 1,000 words or fewer.",
    };
  }
  const selectedText = context.selectedText;
  if (!selectedText.trim() || context.selectedTextLength === 0) {
    return { ok: false, error: "Select some text before using a Quick Transform." };
  }
  const wordCount = countDictationTransformWords(selectedText);
  if (wordCount > MAX_DICTATION_TRANSFORM_WORDS) {
    return {
      ok: false,
      error: "Quick Transforms support selections of up to 1,000 words.",
    };
  }
  return { ok: true, selectedText, wordCount };
}

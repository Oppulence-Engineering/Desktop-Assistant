import { z } from "zod";

/**
 * Spoken-language codes shared by dictation and meeting transcription.
 *
 * Lives in its own module rather than in `transcription.ts` because `transcription.ts`
 * already imports from `meetings.ts`, and meeting settings need this enum too — putting
 * it in either of those would make the pair circular. `transcription.ts` re-exports it
 * so every existing import path keeps working.
 */

/** Languages supported by the resident Parakeet v3 desktop-dictation model. */
export const DICTATION_LANGUAGE_CODES = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ro",
  "nl",
  "da",
  "sv",
  "fi",
  "hu",
  "et",
  "lv",
  "lt",
  "mt",
  "pl",
  "cs",
  "sk",
  "sl",
  "hr",
  "bs",
  "ru",
  "uk",
  "be",
  "bg",
  "sr",
  "el",
] as const;

export const DictationLanguage = z.enum(DICTATION_LANGUAGE_CODES);
export type DictationLanguage = z.infer<typeof DictationLanguage>;

export const DICTATION_LANGUAGE_LABELS: Record<DictationLanguage, string> = {
  auto: "Auto-detect",
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ro: "Română",
  nl: "Nederlands",
  da: "Dansk",
  sv: "Svenska",
  fi: "Suomi",
  hu: "Magyar",
  et: "Eesti",
  lv: "Latviešu",
  lt: "Lietuvių",
  mt: "Malti",
  pl: "Polski",
  cs: "Čeština",
  sk: "Slovenčina",
  sl: "Slovenščina",
  hr: "Hrvatski",
  bs: "Bosanski",
  ru: "Русский",
  uk: "Українська",
  be: "Беларуская",
  bg: "Български",
  sr: "Српски",
  el: "Ελληνικά",
};

export const DICTATION_LANGUAGE_OPTIONS = DICTATION_LANGUAGE_CODES.map((value) => ({
  value,
  label: DICTATION_LANGUAGE_LABELS[value],
}));


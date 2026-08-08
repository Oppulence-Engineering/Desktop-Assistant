/**
 * Turn a stored email body into the one line shown in a list row.
 *
 * The bodies are markdown converted from HTML mail, and a marketing email's
 * first 180 characters are almost never its first 180 characters of prose.
 * Measured against the real inbox on 2026-08-07: 23 of 109 visible rows led
 * with a tracking-pixel image, a click-wrapped URL, or a preheader padded with
 * invisible characters, so the list could not be scanned at all.
 */

/**
 * Zero-width and invisible characters that newsletters repeat hundreds of times
 * to pad the preheader out of the inbox preview. They survive a \s+ collapse
 * because none of them is whitespace to a regex.
 *
 * U+00AD soft hyphen, U+034F combining grapheme joiner, U+200B-U+200F,
 * U+2028/U+2029 separators, U+2060 word joiner, U+FEFF BOM.
 */
// Written as escapes on purpose: U+2028/U+2029 are line terminators and would
// end this regex literal early if pasted in raw.
const INVISIBLE = /[\u00AD\u034F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g;

/** ![alt](url) — an image contributes nothing to a text preview. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
/** [text](url) — keep the text, drop the target. */
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
/** A bare URL, which is usually a click-tracker and never worth 100 columns. */
const BARE_URL = /\bhttps?:\/\/\S+/g;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function previewText(text?: string, maxLength = 180): string {
  if (!text) return "";

  let out = text.replace(INVISIBLE, "");
  // Images before links: ![a](b) also matches the link shape, and unwrapping it
  // as a link would leave the alt text of a spacer gif behind.
  out = out.replace(MARKDOWN_IMAGE, " ");
  out = out.replace(MARKDOWN_LINK, "$1");
  out = out.replace(BARE_URL, " ");
  out = out.replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ");
  // Table pipes and rules survive the HTML→markdown conversion and read as
  // noise once the cells they framed are gone.
  out = out.replace(/[|>]+/g, " ").replace(/(^|\s)[-=_*]{3,}(\s|$)/g, " ");
  out = out.replace(/\s+/g, " ").trim();

  if (out.length <= maxLength) return out;
  // Cut on a word boundary so the line does not end mid-token, but only if that
  // does not throw away most of the budget.
  const clipped = out.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

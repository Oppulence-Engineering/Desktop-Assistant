import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DictationAppCategory } from "@x/shared/dist/transcription.js";

const execFileAsync = promisify(execFile);
const CONTEXT_LIMIT = 256;
const SELECTED_TEXT_LIMIT = 8_000;

export interface DesktopTextContext {
  appName: string;
  bundleIdentifier?: string;
  documentURL?: string;
  role?: string;
  appCategory: DictationAppCategory;
  sensitive: boolean;
  beforeText: string;
  selectedText: string;
  selectedTextLength: number;
  afterText: string;
}

function bounded(value: unknown, side: "before" | "after" | "selected"): string {
  if (typeof value !== "string") return "";
  const limit = side === "selected" ? SELECTED_TEXT_LIMIT : CONTEXT_LIMIT;
  return side === "before" ? value.slice(-limit) : value.slice(0, limit);
}

/** Deliberately small, auditable app classifier; unknown apps retain neutral formatting. */
export function classifyDesktopApp(
  appName: string,
  bundleIdentifier?: string,
  documentURL?: string,
): DictationAppCategory {
  const identity = `${appName} ${bundleIdentifier ?? ""}`.toLowerCase();
  const url = (documentURL ?? "").toLowerCase();

  if (
    /\b(mail|outlook|superhuman|spark|airmail|canary|mimestream)\b/.test(identity) ||
    /(mail\.google\.com|outlook\.(?:live|office)|superhuman\.com|fastmail\.com|hey\.com)/.test(url)
  ) {
    return "email";
  }
  if (
    /\b(slack|teams|discord|mattermost|lark|beeper|texts)\b/.test(identity) ||
    /(slack\.com|teams\.microsoft\.com|discord\.com|chat\.google\.com|mattermost|larksuite)/.test(
      url,
    )
  ) {
    return "work-messaging";
  }
  if (
    /\b(messages|imessage|whatsapp|telegram|signal|wechat|line|messenger)\b/.test(identity) ||
    /(web\.whatsapp\.com|web\.telegram\.org|messages\.google\.com|messenger\.com)/.test(url)
  ) {
    return "personal-messaging";
  }
  return "other";
}

/** Parse and bound the helper response again at the trust boundary. */
export function parseDesktopContext(raw: string): DesktopTextContext | null {
  try {
    const line = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1);
    if (!line) return null;
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type !== "desktopContext" || typeof value.appName !== "string") return null;

    const bundleIdentifier =
      typeof value.bundleIdentifier === "string" ? value.bundleIdentifier : undefined;
    const documentURL = typeof value.documentURL === "string" ? value.documentURL : undefined;
    const role = typeof value.role === "string" ? value.role : undefined;
    const sensitive = value.sensitive === true;
    return {
      appName: value.appName.slice(0, 200),
      ...(bundleIdentifier ? { bundleIdentifier: bundleIdentifier.slice(0, 300) } : {}),
      ...(documentURL ? { documentURL: documentURL.slice(0, 2_000) } : {}),
      ...(role ? { role: role.slice(0, 100) } : {}),
      appCategory: classifyDesktopApp(value.appName, bundleIdentifier, documentURL),
      sensitive,
      // A defense-in-depth blanking step: even a buggy native helper cannot pass
      // password-field contents into formatting or logs.
      beforeText: sensitive ? "" : bounded(value.beforeText, "before"),
      selectedText: sensitive ? "" : bounded(value.selectedText, "selected"),
      selectedTextLength:
        sensitive || typeof value.selectedTextLength !== "number"
          ? sensitive
            ? 0
            : bounded(value.selectedText, "selected").length
          : Math.max(0, Math.floor(value.selectedTextLength)),
      afterText: sensitive ? "" : bounded(value.afterText, "after"),
    };
  } catch {
    return null;
  }
}

export async function captureDesktopContext(
  binaryPath: string,
  includeNearbyText: boolean,
): Promise<DesktopTextContext | null> {
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ["context", ...(includeNearbyText ? [] : ["--app-only"])],
      { timeout: 1_500, maxBuffer: 64 * 1024 },
    );
    return parseDesktopContext(stdout);
  } catch {
    // Context is enhancement-only. Dictation and paste stay available if an app's
    // accessibility implementation is incomplete or the helper times out.
    return null;
  }
}

/** Selection identity guard used before an asynchronous Command Mode replacement. */
export function desktopCommandTargetUnchanged(
  expected: DesktopTextContext,
  current: DesktopTextContext | null,
): boolean {
  if (!current || current.sensitive) return false;
  const sameApp =
    expected.bundleIdentifier && current.bundleIdentifier
      ? expected.bundleIdentifier === current.bundleIdentifier
      : expected.appName === current.appName;
  return (
    Boolean(sameApp) &&
    current.selectedTextLength === expected.selectedTextLength &&
    current.selectedText === expected.selectedText
  );
}

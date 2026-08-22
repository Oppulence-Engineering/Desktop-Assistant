import { shell } from "electron";
import { validateExternalUrl } from "./external-url-policy.js";

export { MACOS_SYSTEM_SETTINGS_PROTOCOLS } from "./external-url-policy.js";

export function openTrustedExternal(
  rawUrl: string,
  allowedProtocols?: ReadonlySet<string>,
): Promise<void> {
  return shell.openExternal(validateExternalUrl(rawUrl, allowedProtocols));
}

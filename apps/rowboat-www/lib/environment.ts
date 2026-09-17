/**
 * Reports whether the current bundle is running in the development build.
 *
 * Next.js replaces `process.env.NODE_ENV` at build time, so this helper is safe
 * to share between server and client modules without exposing runtime secrets.
 * Keeping the check here also prevents environment semantics from drifting
 * across config, server, and browser code.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

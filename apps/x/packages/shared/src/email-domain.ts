/**
 * Email address and domain normalization, shared by every surface that turns an
 * address into an identity.
 *
 * There is one distinction here, and it is the whole reason this module exists:
 *
 *   emailDomain()        answers "what host is this?"          — gmail.com is a fine answer
 *   organizationDomain() answers "does this identify an org?"  — gmail.com is never an answer
 *
 * Code that groups, buckets or displays wants the first. Code that writes an
 * account anchor wants the second. Collapsing them into one function is how two
 * unrelated gmail.com people end up sharing one account, and it is why every
 * call site has to state which question it is asking.
 */

/**
 * Mailbox providers whose domain names a *provider*, not an organization.
 *
 * MUST stay a superset of the Go set in
 * `apps/rowboat-api/internal/revenue/identity_normalize.go`. The desktop and the
 * server disagreeing about what counts as an account anchor produces
 * relationships that resolve one way locally and another way after ingest —
 * `email-domain.test.ts` asserts the containment so the two cannot drift.
 */
export const PUBLIC_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "yahoo.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/** True when the domain names a mailbox provider rather than an organization. */
export function isPublicMailboxDomain(domain: string | undefined): boolean {
  const normalized = domain?.trim().toLowerCase().replace(/\.$/, "");
  return !!normalized && PUBLIC_MAILBOX_DOMAINS.has(normalized);
}

/**
 * The domain of an address, lowercased and trailing-dot stripped.
 *
 * Undefined only for input that is not an address at all. This makes no claim
 * that the domain identifies an organization — see {@link organizationDomain}.
 */
export function emailDomain(email: string | undefined): string | undefined {
  const normalized = normalizeEmail(email);
  if (!normalized) return undefined;
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) return undefined;
  const domain = normalized.slice(at + 1).replace(/\.$/, "");
  return domain || undefined;
}

/**
 * The domain when it identifies an organization, otherwise undefined.
 *
 * This is the question every caller that writes an account domain or a domain
 * identity anchor is actually asking. A public mailbox domain is shared by
 * millions of unrelated people and can never anchor an account.
 */
export function organizationDomain(email: string | undefined): string | undefined {
  const domain = emailDomain(email);
  return domain && !isPublicMailboxDomain(domain) ? domain : undefined;
}

/**
 * Lowercase and trim an address, unwrapping a `Name <addr>` header form.
 *
 * Every address that becomes an identity anchor goes through here, so the hash
 * the backend derives from it is stable no matter which surface observed it.
 */
export function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim();
  if (!trimmed) return undefined;
  const angled = trimmed.match(/<([^>]+)>\s*$/);
  const address = (angled ? angled[1] : trimmed).trim().toLowerCase();
  return address || undefined;
}

/** The portion before `@`, or undefined for input that is not an address. */
export function emailLocalPart(email: string | undefined): string | undefined {
  const normalized = normalizeEmail(email);
  if (!normalized) return undefined;
  const at = normalized.lastIndexOf("@");
  if (at < 1) return undefined;
  return normalized.slice(0, at);
}

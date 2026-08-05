package revenue

import "strings"

// Email address and domain normalization, shared by every path that turns an
// address into an identity.
//
// There is one distinction here, and it is the whole reason this file exists:
//
//	emailDomain()   answers "what host is this?"          — gmail.com is a fine answer
//	accountDomain() answers "does this identify an org?"  — gmail.com is never an answer
//
// A mail thread's domain is thread metadata, so mailindex.go wants the first and
// gmail.com is the correct value there. A Relationship.account_domain or a domain
// identity anchor is a claim about an organization, so those want the second.
// Collapsing them into one function is how two unrelated gmail.com people end up
// sharing one account.
//
// The public mailbox set is mirrored in apps/x/packages/shared/src/email-domain.ts,
// which must stay a superset of this one.

// publicMailboxDomains are providers whose domain names a *provider*, not an
// organization.
var publicMailboxDomains = map[string]struct{}{
	"gmail.com": {}, "googlemail.com": {}, "outlook.com": {}, "hotmail.com": {},
	"live.com": {}, "icloud.com": {}, "me.com": {}, "mac.com": {},
	"yahoo.com": {}, "aol.com": {}, "proton.me": {}, "protonmail.com": {},
}

// isPublicMailboxDomain reports whether the domain names a mailbox provider
// rather than an organization. Public domains are never account anchors: two
// unrelated gmail.com people must not collapse into one relationship.
func isPublicMailboxDomain(domain string) bool {
	_, public := publicMailboxDomains[normalizeDomain(domain)]
	return public
}

// normalizeEmail lowercases and trims an address, unwrapping a "Name <addr>"
// wrapper. It is the single entry point for every address that becomes an
// identity anchor, so the sha256 key_hash stays stable across sources.
func normalizeEmail(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if close := strings.LastIndexByte(trimmed, '>'); close == len(trimmed)-1 {
		if open := strings.LastIndexByte(trimmed[:close], '<'); open >= 0 {
			trimmed = strings.TrimSpace(trimmed[open+1 : close])
		}
	}
	return strings.ToLower(trimmed)
}

// emailDomain returns the raw domain of an address, lowercased and with a
// trailing dot stripped. It makes no claim that the domain identifies an
// organization.
func emailDomain(email string) string {
	normalized := normalizeEmail(email)
	at := strings.LastIndexByte(normalized, '@')
	if at < 1 || at == len(normalized)-1 {
		return ""
	}
	return normalizeDomain(normalized[at+1:])
}

// accountDomain returns emailDomain, or "" when the domain is a public mailbox.
// This is the question every caller that writes Relationship.account_domain or a
// domain identity anchor is actually asking.
func accountDomain(email string) string {
	domain := emailDomain(email)
	if domain == "" || isPublicMailboxDomain(domain) {
		return ""
	}
	return domain
}

// emailLocalPart returns the portion before "@", or "" for a malformed address.
func emailLocalPart(email string) string {
	normalized := normalizeEmail(email)
	at := strings.LastIndexByte(normalized, '@')
	if at < 1 {
		return ""
	}
	return normalized[:at]
}

func normalizeDomain(domain string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(domain)), ".")
}

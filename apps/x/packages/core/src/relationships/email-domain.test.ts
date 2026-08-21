import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_MAILBOX_DOMAINS,
  emailDomain,
  emailLocalPart,
  isPublicMailboxDomain,
  normalizeEmail,
  organizationDomain,
} from "@x/shared/email-domain";

describe("emailDomain", () => {
  it("returns the host for an ordinary address", () => {
    expect(emailDomain("Jane@Acme.COM")).toBe("acme.com");
  });

  it("returns a public mailbox host — it answers 'what host', not 'what org'", () => {
    expect(emailDomain("jane@gmail.com")).toBe("gmail.com");
  });

  it("unwraps a Name <addr> header form", () => {
    expect(emailDomain("Jane Doe <jane@acme.com>")).toBe("acme.com");
  });

  it("strips a trailing root dot", () => {
    expect(emailDomain("jane@acme.com.")).toBe("acme.com");
  });

  it("is undefined for input that is not an address", () => {
    expect(emailDomain(undefined)).toBeUndefined();
    expect(emailDomain("")).toBeUndefined();
    expect(emailDomain("not-an-address")).toBeUndefined();
    expect(emailDomain("@acme.com")).toBeUndefined();
    expect(emailDomain("jane@")).toBeUndefined();
  });
});

describe("organizationDomain", () => {
  it("returns the domain when it identifies an organization", () => {
    expect(organizationDomain("jane@acme.com")).toBe("acme.com");
  });

  it("refuses every public mailbox domain", () => {
    for (const domain of PUBLIC_MAILBOX_DOMAINS) {
      expect(organizationDomain(`jane@${domain}`)).toBeUndefined();
    }
  });

  it("refuses the three domains the desktop used to accept as account anchors", () => {
    // live.com, mac.com and aol.com were absent from the old desktop-local list,
    // so they were sent as account domains and silently rejected server-side.
    expect(organizationDomain("jane@live.com")).toBeUndefined();
    expect(organizationDomain("jane@mac.com")).toBeUndefined();
    expect(organizationDomain("jane@aol.com")).toBeUndefined();
  });
});

describe("normalizeEmail / emailLocalPart", () => {
  it("lowercases, trims and unwraps", () => {
    expect(normalizeEmail("  Jane Doe <Jane@Acme.com>  ")).toBe("jane@acme.com");
    expect(normalizeEmail("  JANE@ACME.COM ")).toBe("jane@acme.com");
  });

  it("extracts the local part", () => {
    expect(emailLocalPart("Jane.Doe+tag@acme.com")).toBe("jane.doe+tag");
    expect(emailLocalPart("@acme.com")).toBeUndefined();
    expect(emailLocalPart("nope")).toBeUndefined();
  });
});

describe("isPublicMailboxDomain", () => {
  it("normalizes before matching", () => {
    expect(isPublicMailboxDomain("  GMAIL.com. ")).toBe(true);
    expect(isPublicMailboxDomain("acme.com")).toBe(false);
    expect(isPublicMailboxDomain(undefined)).toBe(false);
  });
});

/**
 * The desktop and the server must agree about what counts as an account anchor.
 * If they drift, a relationship resolves one way locally and another way after
 * ingest, and the disagreement is invisible until someone's coworkers collapse
 * into a single account.
 */
describe("cross-repo parity with the Go public mailbox set", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const goFile = path.resolve(
    here,
    "../../../../../..",
    "apps/rowboat-api/internal/revenue/identity_normalize.go",
  );

  it("is a superset of the Go set", () => {
    expect(
      fs.existsSync(goFile),
      `Expected the Go helper at ${goFile}. If it moved, update this test — do not delete it.`,
    ).toBe(true);

    const source = fs.readFileSync(goFile, "utf8");
    const block = source.match(
      /var publicMailboxDomains = map\[string\]struct\{\}\{([\s\S]*?)\n\}/,
    );
    expect(block, "could not locate publicMailboxDomains in the Go source").toBeTruthy();

    const goDomains = [...block![1].matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]);
    expect(goDomains.length).toBeGreaterThan(0);

    const missing = goDomains.filter((domain) => !PUBLIC_MAILBOX_DOMAINS.has(domain));
    expect(
      missing,
      `PUBLIC_MAILBOX_DOMAINS is missing ${missing.join(", ")} — the desktop would send ` +
        `these as account domains while the backend refuses them.`,
    ).toEqual([]);
  });
});

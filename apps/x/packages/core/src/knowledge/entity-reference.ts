const REF_PART = /^[a-z][a-z0-9_-]{0,63}$/;
const IDENTIFIER_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export interface EntityResourceRecord {
  product: string;
  type: string;
  externalId: string;
}

export function parseResourceRef(value: string): EntityResourceRecord {
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first <= 0 || second <= first + 1 || second === value.length - 1) {
    throw new Error(`invalid resourceRef ${JSON.stringify(value)}`);
  }
  const product = value.slice(0, first).toLowerCase();
  const type = value.slice(first + 1, second).toLowerCase();
  const externalId = value.slice(second + 1).trim();
  if (!REF_PART.test(product)) throw new Error(`invalid resourceRef product ${product}`);
  if (!REF_PART.test(type)) throw new Error(`invalid resourceRef type ${type}`);
  if (
    externalId.length > 256 ||
    [...externalId].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error("invalid resourceRef external id");
  }
  return { product, type, externalId };
}

export function formatResourceRef(record: EntityResourceRecord): string {
  const value = `${record.product.toLowerCase()}:${record.type.toLowerCase()}:${record.externalId.trim()}`;
  parseResourceRef(value);
  return value;
}

function canonicalIdentifierKey(key: string): string {
  const compact = key
    .trim()
    .replace(/[_\s-]/g, "")
    .toLowerCase();
  if (compact === "emaildomain" || compact === "emaildomains" || compact === "domain") {
    return "emailDomains";
  }
  if (compact === "taxid" || compact === "taxids") return "taxIds";
  return key.trim();
}

function canonicalIdentifierValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (key === "emailDomains") return trimmed.toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (key === "taxIds") return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return trimmed;
}

export function normalizeEntityIdentifiers(
  identifiers: Record<string, string | string[]>,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [rawKey, rawValues] of Object.entries(identifiers)) {
    const key = canonicalIdentifierKey(rawKey);
    if (!IDENTIFIER_KEY.test(key)) continue;
    const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
      .map((value) => canonicalIdentifierValue(key, value))
      .filter((value) => value.length > 0 && value.length <= 256);
    if (values.length === 0) continue;
    normalized[key] = [...new Set([...(normalized[key] ?? []), ...values])].sort();
  }
  return normalized;
}

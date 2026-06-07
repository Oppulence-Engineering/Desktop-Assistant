import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./generated/schema.js";

export type RowboatAPIPaths = paths;
export type RowboatAPIClient = Client<paths>;

export type AccessTokenProvider = string | (() => Promise<string | undefined> | string | undefined);

export type HeaderProvider =
  | HeadersInit
  | (() => Promise<HeadersInit | undefined> | HeadersInit | undefined);

export interface RowboatAPIClientOptions {
  baseUrl?: string | URL;
  accessToken?: AccessTokenProvider;
  headers?: HeaderProvider;
  fetch?: typeof globalThis.fetch;
}

export function createRowboatAPIClient(options: RowboatAPIClientOptions = {}): RowboatAPIClient {
  const client = createClient<paths>({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fetch: options.fetch,
  });

  if (options.accessToken || options.headers) {
    client.use({
      async onRequest({ request }) {
        const headers = new Headers(request.headers);

        const providedHeaders = await resolveHeaders(options.headers);
        if (providedHeaders) {
          new Headers(providedHeaders).forEach((value, key) => {
            headers.set(key, value);
          });
        }

        const accessToken = await resolveAccessToken(options.accessToken);
        if (accessToken) {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }

        return new Request(request, { headers });
      },
    });
  }

  return client;
}

function normalizeBaseUrl(baseUrl: string | URL | undefined): string {
  if (!baseUrl) {
    return "";
  }
  return String(baseUrl).replace(/\/+$/, "");
}

async function resolveAccessToken(
  provider: AccessTokenProvider | undefined,
): Promise<string | undefined> {
  if (!provider) {
    return undefined;
  }
  if (typeof provider === "string") {
    return provider;
  }
  return provider();
}

async function resolveHeaders(
  provider: HeaderProvider | undefined,
): Promise<HeadersInit | undefined> {
  if (!provider) {
    return undefined;
  }
  if (typeof provider === "function") {
    return provider();
  }
  return provider;
}

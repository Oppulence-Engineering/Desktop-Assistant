export const PRODUCT_NAME = "Oppulence";
export const PRODUCT_SLUG = "oppulence";
export const PRODUCT_ARTIFACT_NAME = "Oppulence";

export const PRODUCT_PROVIDER_ID = "solomon";
export const LEGACY_PRODUCT_PROVIDER_ID = "rowboat";

export const DEEP_LINK_SCHEME = PRODUCT_SLUG;
export const LEGACY_DEEP_LINK_SCHEME = "solomon-ai";
export const OLDEST_DEEP_LINK_SCHEME = LEGACY_PRODUCT_PROVIDER_ID;

export const WORKDIR_ENV = "OPPULENCE_WORKDIR";
export const SOLOMON_WORKDIR_ENV = "SOLOMON_WORKDIR";
export const LEGACY_WORKDIR_ENV = "ROWBOAT_WORKDIR";
export const DEFAULT_WORKDIR_NAME = ".oppulence";
export const SOLOMON_WORKDIR_NAME = ".solomon-ai";
export const LEGACY_WORKDIR_NAME = ".rowboat";

export function isProductProvider(provider: string): boolean {
  return provider === PRODUCT_PROVIDER_ID || provider === LEGACY_PRODUCT_PROVIDER_ID;
}

export function getProductProviderState<T>(
  states: Record<string, T> | null | undefined,
): T | undefined {
  return states?.[PRODUCT_PROVIDER_ID] ?? states?.[LEGACY_PRODUCT_PROVIDER_ID];
}

export const PRODUCT_TOUR_STORAGE_KEY = "user_product_tour_completed";

export type TourStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function getProductTourStorage(): TourStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function isProductTourComplete(storage: TourStorage | null | undefined): boolean {
  try {
    return storage?.getItem(PRODUCT_TOUR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function markProductTourComplete(storage: TourStorage | null | undefined): void {
  try {
    storage?.setItem(PRODUCT_TOUR_STORAGE_KEY, "true");
  } catch {
    // Storage can be unavailable in private or restricted renderer contexts.
  }
}

export function clearProductTourCompletion(storage: TourStorage | null | undefined): void {
  try {
    storage?.removeItem(PRODUCT_TOUR_STORAGE_KEY);
  } catch {
    // Restart remains best-effort when storage is unavailable.
  }
}

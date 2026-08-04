import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_TOUR_STORAGE_KEY,
  clearProductTourCompletion,
  isProductTourComplete,
  markProductTourComplete,
} from "../apps/renderer/src/lib/product-tour-state.ts";
import { productTourNavigationForTarget } from "../apps/renderer/src/lib/product-tour-navigation.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("product tour completion persists and can be restarted", () => {
  const storage = memoryStorage();
  assert.equal(isProductTourComplete(storage), false);
  markProductTourComplete(storage);
  assert.equal(storage.getItem(PRODUCT_TOUR_STORAGE_KEY), "true");
  assert.equal(isProductTourComplete(storage), true);
  clearProductTourCompletion(storage);
  assert.equal(isProductTourComplete(storage), false);
});

test("product tour persistence failures fail open", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(isProductTourComplete(storage), false);
  assert.doesNotThrow(() => markProductTourComplete(storage));
  assert.doesNotThrow(() => clearProductTourCompletion(storage));
});

test("tour targets navigate to the correct desktop surface", () => {
  assert.equal(productTourNavigationForTarget("accounts", "main"), "relationships");
  assert.equal(productTourNavigationForTarget("home-accounts", "main"), "home");
  assert.equal(productTourNavigationForTarget("evidence-inbox", "main"), "email");
  assert.equal(productTourNavigationForTarget("meetings", "main"), "meetings");
  assert.equal(productTourNavigationForTarget("evidence-nav", "main"), "knowledge");
  assert.equal(productTourNavigationForTarget("tools", "main"), "home");
  assert.equal(productTourNavigationForTarget("attention-queue", "main"), "relationships");
  assert.equal(productTourNavigationForTarget("meeting-notes", "meetings"), "meetings");
  assert.equal(productTourNavigationForTarget("actions", "actions"), "actions");
  assert.equal(productTourNavigationForTarget("chat-composer", "main"), "chat");
  assert.equal(
    productTourNavigationForTarget("relationship-action", "relationships"),
    "relationships",
  );
  assert.equal(productTourNavigationForTarget("relationship-action", "main"), "home");
  assert.equal(productTourNavigationForTarget("settings", "main"), "none");
});

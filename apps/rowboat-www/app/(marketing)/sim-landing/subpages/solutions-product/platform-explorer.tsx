"use client";

import { useId, useState } from "react";

import { Chip } from "@sim/emcn";

import { SimCtaLink } from "../../primitives";
import { EdgeFade } from "../../edge-fade";
import type { ProductPreviewKey } from "./product-previews";
import { ProductStagePreview } from "./product-stage-preview";

const PRODUCTS = [
  { id: "register" as const, label: "Register", href: "/features/commitment-register" },
  { id: "web" as const, label: "Web", href: "/web" },
  { id: "desktop" as const, label: "Desktop", href: "/desktop" },
  { id: "voice" as const, label: "Voice", href: "/voice-app" },
] as const;

type ExplorerProductId = (typeof PRODUCTS)[number]["id"];

/** Switchable product stage — interactive register + animated module previews. */
export function PlatformExplorer() {
  const previewId = useId();
  const [selectedId, setSelectedId] = useState<ExplorerProductId>("register");
  const selected = PRODUCTS.find((product) => product.id === selectedId) ?? PRODUCTS[0];
  const stageProduct: ProductPreviewKey | "register-interactive" =
    selected.id === "register" ? "register-interactive" : selected.id;

  return (
    <div
      className="sim-product-preview absolute inset-0 bg-[var(--bg)]"
      data-platform-explorer=""
      data-product-preview=""
    >
      <div
        aria-label="Choose a product preview"
        className="pointer-events-auto absolute inset-x-0 top-7 z-20 overflow-x-auto px-7 pb-2 max-sm:top-3"
        role="group"
      >
        <div className="mx-auto flex w-max items-center gap-2">
          {PRODUCTS.map((product) => (
            <Chip
              active={selectedId === product.id}
              aria-controls={previewId}
              aria-pressed={selectedId === product.id}
              key={product.id}
              onClick={() => setSelectedId(product.id)}
            >
              {product.label}
            </Chip>
          ))}
        </div>
      </div>
      <div
        aria-label={`${selected.label} preview`}
        className="pointer-events-auto absolute inset-x-0 top-20 bottom-16 max-sm:top-14 max-sm:bottom-12"
        id={previewId}
        role="region"
      >
        <ProductStagePreview
          interactive={selected.id === "register"}
          key={selected.id}
          product={stageProduct}
        />
        <EdgeFade depth="stage" edges={["bottom"]} ground="canvas" />
      </div>
      <div className="pointer-events-auto absolute inset-x-7 bottom-6 z-20 flex justify-center max-sm:bottom-3">
        <SimCtaLink href={selected.href} variant="outline" withArrow>
          Explore {selected.label}
        </SimCtaLink>
      </div>
      <p aria-live="polite" className="sr-only" role="status">
        Showing {selected.label}
      </p>
    </div>
  );
}

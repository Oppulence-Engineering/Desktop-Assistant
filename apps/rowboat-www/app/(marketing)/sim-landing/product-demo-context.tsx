"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { ProductDemoBeatId } from "./product-demo-beats";

interface ProductDemoBeatContextValue {
  beat: ProductDemoBeatId;
  setBeat: (beat: ProductDemoBeatId) => void;
}

const ProductDemoBeatContext = createContext<ProductDemoBeatContextValue | null>(null);

export function ProductDemoBeatProvider({ children }: { children: ReactNode }) {
  const [beat, setBeat] = useState<ProductDemoBeatId>("read");
  const value = useMemo(() => ({ beat, setBeat }), [beat]);
  return <ProductDemoBeatContext value={value}>{children}</ProductDemoBeatContext>;
}

export function useProductDemoBeat() {
  const context = useContext(ProductDemoBeatContext);
  if (!context) {
    throw new Error("useProductDemoBeat must be used within ProductDemoBeatProvider");
  }
  return context;
}

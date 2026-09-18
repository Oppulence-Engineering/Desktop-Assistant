"use client";

import {
  AccountMenuPreview,
  DesktopMenuPreview,
  GovernMenuPreview,
  RegisterMenuPreview,
  type ProductPreviewKey,
  VoiceMenuPreview,
  WebMenuPreview,
} from "./product-previews";
import { TablesRecordsPreview } from "../../tables-records-preview";

interface ProductModulePreviewProps {
  product: ProductPreviewKey | "register-interactive";
  layout?: "menu" | "hero" | "stage";
}

/** Showcase and feature visuals — live UI chrome instead of static PNGs. */
export function ProductModulePreview({ product, layout = "menu" }: ProductModulePreviewProps) {
  if (product === "register-interactive") {
    return <TablesRecordsPreview layout={layout === "hero" ? "hero" : "stage"} />;
  }

  switch (product) {
    case "register":
      return <RegisterMenuPreview layout={layout} />;
    case "web":
      return <WebMenuPreview layout={layout} />;
    case "desktop":
      return <DesktopMenuPreview layout={layout} />;
    case "voice":
      return <VoiceMenuPreview layout={layout} />;
    case "account":
      return <AccountMenuPreview layout={layout} />;
    case "govern":
      return <GovernMenuPreview layout={layout} />;
    default:
      return <RegisterMenuPreview layout={layout} />;
  }
}

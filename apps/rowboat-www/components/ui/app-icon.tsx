"use client";

import * as React from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/**
 * Console icon: a stroke ("regular") glyph with a stacked "fill" variant that
 * cross-fades in when the icon is active, or on hover of the nearest
 * `group/item` when `filledOnHover` is set. Pair with @phosphor-icons/react
 * icons, which ship both weights for every glyph.
 */
export function AppIcon({
  icon: Icon,
  filled = false,
  filledOnHover = false,
  className,
}: {
  icon: PhosphorIcon;
  filled?: boolean;
  filledOnHover?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-4 shrink-0", className)}>
      <Icon
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-200",
          filled && "opacity-0",
          filledOnHover && "group-hover/item:opacity-0",
        )}
        weight="regular"
      />
      <Icon
        className={cn(
          "absolute inset-0 size-full opacity-0 transition-opacity duration-200",
          filled && "opacity-100",
          filledOnHover && "group-hover/item:opacity-100",
        )}
        weight="fill"
      />
    </span>
  );
}

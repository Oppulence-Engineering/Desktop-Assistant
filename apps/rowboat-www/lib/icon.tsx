"use client";

import type { IconComponent, IconProps, IconWeight } from "@/lib/icons";

export type { IconComponent, IconProps, IconWeight };

export type AppIconProps = IconProps & {
  icon: IconComponent;
};

/** Render a Phosphor glyph with shared `app-icon` styling. */
export function AppIcon({ icon: Icon, className, weight = "regular", ...props }: AppIconProps) {
  return <Icon aria-hidden className={className} weight={weight} {...props} />;
}

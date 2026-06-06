/* eslint-disable react-refresh/only-export-components -- shared icon barrel:
   re-exports the full Lucide set plus the ElevenLabs convention defaults/helper.
   Fast-refresh's components-only constraint doesn't apply to a re-export module. */
import { type LucideIcon, type LucideProps } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Centralized icon surface for the app.
 *
 * ElevenLabs' design system (ElevenLabs UI, https://github.com/elevenlabs/ui)
 * is built on shadcn/ui and uses **Lucide** as its icon library. We use the
 * same library so the desktop app reads like the ElevenLabs developer console.
 *
 * Import icons from here (`@/lib/icons`) rather than `lucide-react` directly so
 * every call site inherits ElevenLabs' conventions:
 *   - 16px default size (Tailwind `size-4`)
 *   - 1.5 stroke weight (thin, refined — matches the ElevenLabs console)
 *   - `currentColor` so icons take the surrounding text color
 *
 * The 1.5 stroke is also enforced globally via `.lucide { stroke-width: 1.5 }`
 * in App.css, so even icons imported directly from `lucide-react` render with
 * the ElevenLabs weight. This module is the typed, documented entry point and
 * the home for the shared defaults + the `<Icon>` helper.
 */

/** ElevenLabs-console icon defaults. */
export const ICON_STROKE_WIDTH = 1.5
export const ICON_SIZE = 16

/** Re-export every Lucide icon so `@/lib/icons` is the single import surface. */
export * from "lucide-react"
export type { LucideIcon, LucideProps }

export interface IconProps extends Omit<LucideProps, "ref"> {
  /** The Lucide icon component to render. */
  icon: LucideIcon
}

/**
 * Thin wrapper that renders a Lucide icon with the ElevenLabs defaults applied.
 * Useful when an icon is passed around as data (e.g. nav configs):
 *
 *   <Icon icon={Settings} className="size-4 text-muted-foreground" />
 */
export function Icon({ icon: IconComponent, className, strokeWidth = ICON_STROKE_WIDTH, ...props }: IconProps) {
  return (
    <IconComponent
      className={cn("size-4 shrink-0", className)}
      strokeWidth={strokeWidth}
      {...props}
    />
  )
}

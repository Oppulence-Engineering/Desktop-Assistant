import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight scroll container. A native overflow wrapper (not Radix) to avoid an
 * extra dependency — the app's global themed thin scrollbar (App.css) styles the
 * bar. Use for settings panes and other long content.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("min-h-0 overflow-y-auto", className)} {...props}>
      {children}
    </div>
  ),
);
ScrollArea.displayName = "ScrollArea";

/**
 * Toast notifications.
 *
 * This module used to keep its own array of toasts and its own listener set,
 * and nothing ever rendered them. App.tsx mounts <Toaster /> from
 * @oppulence/ui/components/sonner, which draws sonner's store — not this one —
 * and no component imported subscribe() or getToasts(). Every toast raised
 * through here across seven view components was therefore invisible: pushed
 * onto an array, auto-removed three seconds later, never once on screen.
 * Found while dogfooding on 2026-08-07, when an error toast for a failed
 * billing click produced no feedback of any kind.
 *
 * The wrapper stays so the seven existing call sites keep working, but the
 * store behind it is now the one that is actually mounted.
 */
import { toast as sonner } from "sonner";

export type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "info"): void {
  switch (type) {
    case "success":
      sonner.success(message);
      return;
    case "error":
      // Errors hold longer than the default: they are the ones worth reading,
      // and the old implementation's fixed 3s was not enough for a sentence.
      sonner.error(message, { duration: 6000 });
      return;
    default:
      sonner(message);
  }
}

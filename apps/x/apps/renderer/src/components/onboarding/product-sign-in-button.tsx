import { ArrowRight, CheckCircle2, Loader2 } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { PRODUCT_NAME } from "@x/shared/branding";

interface ProductSignInButtonProps {
  connected?: boolean;
  connecting?: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
}

export function ProductSignInButton({
  connected = false,
  connecting = false,
  onClick,
  label = `Continue with ${PRODUCT_NAME}`,
  className,
}: ProductSignInButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={connecting}
      className={[
        "group h-11 w-full justify-between rounded-lg border-white/10 bg-white/[0.055] px-3 text-left text-sm text-white/82 shadow-none hover:border-white/18 hover:bg-white/[0.085] hover:text-white focus-visible:border-white/40 disabled:opacity-70",
        connected ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-100" : "",
        className ?? "",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <img src="/logo-only.png" alt="" className="size-4 shrink-0 invert" />
        <span className="truncate">{label}</span>
      </span>
      {connected ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
      ) : connecting ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-white/48" />
      ) : (
        <ArrowRight className="size-4 shrink-0 text-white/42 transition-transform group-hover:translate-x-0.5 group-hover:text-white/72" />
      )}
    </Button>
  );
}

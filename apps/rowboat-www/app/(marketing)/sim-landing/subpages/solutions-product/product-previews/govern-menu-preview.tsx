import { Button, Chip } from "@sim/emcn";
import { Mail } from "@sim/emcn/icons";

import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface GovernMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

/** Draft held at approve — matches governed-actions product story. */
export function GovernMenuPreview({ layout = "menu" }: GovernMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="govern" layout={layout}>
      <div className="w-[420px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
          <Mail className="size-[14px] text-[var(--text-icon)]" />
          <span className="text-[var(--text-primary)]">Follow-up draft</span>
          <Chip className="ml-auto">Held</Chip>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[var(--text-primary)] leading-[1.45]">
            Hi Maya — confirming the security review we discussed lands Friday. Let me know if the
            window still works on your side.
          </p>
          <p className="text-[var(--text-muted)] text-xs">Source: thread from Mar 14 · Acme Corp</p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="primary">
              Approve send
            </Button>
            <Button size="sm" variant="outline">
              Edit draft
            </Button>
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  );
}

import { Badge } from "@sim/emcn";
import { Building } from "@sim/emcn/icons";

import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface AccountMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

const TIMELINE = [
  { label: "Outbound promise", detail: "Security review by Friday", status: "Open" },
  { label: "Inbound promise", detail: "Signed order form", status: "Kept" },
  { label: "Change", detail: "Champion went quiet for 9 days", status: "At risk" },
] as const;

/** Single-account detail with commitment rows and evidence labels. */
export function AccountMenuPreview({ layout = "menu" }: AccountMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="account" layout={layout}>
      <div className="w-[480px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
          <Building className="size-[14px] text-[var(--text-icon)]" />
          <span className="text-[var(--text-primary)]">Acme Corp</span>
          <Badge className="ml-auto" variant="amber">
            Needs you
          </Badge>
        </div>
        <ul className="flex flex-col">
          {TIMELINE.map((item) => (
            <li
              className="flex flex-col gap-0.5 border-[var(--border)] border-b px-4 py-3 last:border-b-0"
              key={item.label}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--text-muted)] text-xs uppercase tracking-[0.06em]">
                  {item.label}
                </span>
                <Badge variant={item.status === "Kept" ? "green" : "amber"}>{item.status}</Badge>
              </div>
              <span className="text-[var(--text-primary)]">{item.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </MenuPreviewFrame>
  );
}

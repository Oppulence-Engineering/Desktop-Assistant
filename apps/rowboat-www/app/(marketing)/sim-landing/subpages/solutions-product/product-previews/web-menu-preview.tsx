import { Badge, Chip } from "@sim/emcn";
import { ChevronDown, Layout, ListFilter, TagIcon, TypeNumber, TypeText } from "@sim/emcn/icons";

import { cn } from "@/lib/sim/cn";

import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from "../../../shared/menu-preview-header/menu-preview-header";
import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface WebMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

const ACCOUNTS = [
  { name: "Beta Corp", health: "At risk", value: "$48k", signal: "Reply missing" },
  { name: "Acme Industries", health: "Watch", value: "$112k", signal: "Date slipped" },
  { name: "Northstar Labs", health: "Stable", value: "$36k", signal: "New thread" },
  { name: "Meridian Health", health: "Watch", value: "$89k", signal: "Owner quiet" },
] as const;

const COLUMNS = [
  { name: "Account", icon: TypeText },
  { name: "Health", icon: TagIcon },
  { name: "Value", icon: TypeNumber },
  { name: "Why now", icon: TypeText },
] as const;

/** Oppulence Web account list — production-style ruled table in a menu preview frame. */
export function WebMenuPreview({ layout = "menu" }: WebMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="web" layout={layout}>
      <div className="w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <MenuPreviewHeader icon={Layout} title="Attention queue" actions="4 accounts" />
        <MenuPreviewToolbar>
          <Chip rightIcon={ChevronDown}>Your patch</Chip>
          <Chip leftIcon={ListFilter}>Filter</Chip>
        </MenuPreviewToolbar>
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[180px]" />
            <col className="w-[100px]" />
            <col className="w-[90px]" />
            <col className="w-[250px]" />
          </colgroup>
          <thead>
            <tr className="h-[34px] border-[var(--border)] border-b">
              {COLUMNS.map(({ name, icon: Icon }) => (
                <th
                  className="border-[var(--border)] border-r px-2.5 font-normal last:border-r-0"
                  key={name}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-[14px] text-[var(--text-icon)]" />
                    {name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCOUNTS.map((account, index) => (
              <tr
                className={cn(
                  "h-[37px] border-[var(--border)] border-b",
                  index === 0 && "bg-[var(--surface-3)]",
                )}
                key={account.name}
              >
                <td className="border-[var(--border)] border-r px-2.5 font-medium text-[var(--text-primary)]">
                  {account.name}
                </td>
                <td className="border-[var(--border)] border-r px-2.5">
                  <Badge
                    variant={
                      account.health === "Stable"
                        ? "green"
                        : account.health === "At risk"
                          ? "red"
                          : "amber"
                    }
                  >
                    {account.health}
                  </Badge>
                </td>
                <td className="border-[var(--border)] border-r px-2.5 tabular-nums">{account.value}</td>
                <td className="px-2.5 text-[var(--text-secondary)]">{account.signal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MenuPreviewFrame>
  );
}

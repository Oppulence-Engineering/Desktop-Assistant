import { Badge, Chip } from "@sim/emcn";
import {
  ChevronDown,
  Columns3,
  ListFilter,
  Plus,
  Table,
  TagIcon,
  TypeNumber,
  TypeText,
} from "@sim/emcn/icons";

import { cn } from "@/lib/sim/cn";

import {
  MenuPreviewHeader,
  MenuPreviewToolbar,
} from "../../../shared/menu-preview-header/menu-preview-header";
import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface RegisterMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

const ROWS = [
  { company: "Acme Corp", score: 94, status: "Confirmed", contact: "Maya Chen" },
  { company: "Northstar", score: 88, status: "Confirmed", contact: "Daniel Park" },
  { company: "Meridian", score: 72, status: "Review", contact: "Eva Chen" },
  { company: "Forma", score: 91, status: "Confirmed", contact: "Sam Rivera" },
  { company: "Brightwave", score: 86, status: "Confirmed", contact: "Morgan Lee" },
] as const;

const COLUMNS = [
  { name: "Company", icon: TypeText },
  { name: "Score", icon: TypeNumber },
  { name: "Status", icon: TagIcon },
  { name: "Contact", icon: TypeText },
] as const;

/** Commitment register table — production column types and ruled cells like sim.ai Tables. */
export function RegisterMenuPreview({ layout = "menu" }: RegisterMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="register" layout={layout}>
      <div className="w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <MenuPreviewHeader
          icon={Table}
          title="Commitment register"
          actions={`${ROWS.length} rows`}
        />
        <MenuPreviewToolbar>
          <Chip rightIcon={ChevronDown}>All records</Chip>
          <Chip leftIcon={ListFilter}>Filter</Chip>
          <span className="ml-auto">
            <Chip leftIcon={Columns3}>Columns</Chip>
          </span>
        </MenuPreviewToolbar>
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-10" />
            <col className="w-[174px]" />
            <col className="w-[82px]" />
            <col className="w-[138px]" />
            <col className="w-[184px]" />
          </colgroup>
          <thead>
            <tr className="h-[34px] border-[var(--border)] border-b">
              <th className="border-[var(--border)] border-r text-center font-normal text-[var(--text-muted)]">
                #
              </th>
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
            {ROWS.map((row, index) => (
              <tr
                className={cn(
                  "h-[37px] border-[var(--border)] border-b",
                  index === 0 && "bg-[var(--surface-3)]",
                )}
                key={row.company}
              >
                <td className="border-[var(--border)] border-r text-center text-[var(--text-muted)] tabular-nums">
                  {index + 1}
                </td>
                <td className="border-[var(--border)] border-r px-2.5 font-medium text-[var(--text-primary)]">
                  {row.company}
                </td>
                <td className="border-[var(--border)] border-r px-2.5 tabular-nums">{row.score}</td>
                <td className="border-[var(--border)] border-r px-2.5">
                  <Badge variant={row.status === "Confirmed" ? "green" : "amber"}>
                    {row.status}
                  </Badge>
                </td>
                <td className="truncate px-2.5 text-[var(--text-secondary)]">{row.contact}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex h-9 items-center gap-2 px-3 text-[var(--text-muted)]">
          <Plus className="size-[14px]" />
          <span>New row</span>
        </div>
      </div>
    </MenuPreviewFrame>
  );
}

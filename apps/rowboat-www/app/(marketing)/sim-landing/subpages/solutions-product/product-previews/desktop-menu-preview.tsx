import { Chip } from "@sim/emcn";
import { BookOpen, Calendar, MessageSquareText, Mic, Search, Sparkles } from "@sim/emcn/icons";

import { cn } from "@/lib/sim/cn";

import { MenuPreviewFrame } from "../../../shared/menu-preview-frame";

interface DesktopMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

const SIDEBAR = [
  { label: "Ask", icon: MessageSquareText, active: true },
  { label: "Meetings", icon: Calendar },
  { label: "Notes", icon: BookOpen },
  { label: "Search", icon: Search },
] as const;

const MESSAGES = [
  { role: "You", text: "What did we last promise Acme about the security review?" },
  {
    role: "Oppulence",
    text: "Mar 14 email: your team committed to a review by Friday. Source attached on the row.",
  },
  {
    role: "You",
    text: "Draft a follow-up that references the register row.",
  },
] as const;

/** Desktop app window — sidebar + chat thread like sim.ai Desktop nav preview. */
export function DesktopMenuPreview({ layout = "menu" }: DesktopMenuPreviewProps) {
  return (
    <MenuPreviewFrame kind="desktop" layout={layout}>
      <div className="flex w-[720px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small shadow-xs">
        <aside className="flex w-[238px] shrink-0 flex-col border-[var(--border)] border-r bg-[var(--surface-1)]">
          <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
            <Sparkles className="size-[14px] text-[var(--text-icon)]" />
            <span className="font-medium text-[var(--text-primary)]">Oppulence</span>
            <Chip className="ml-auto">Desktop</Chip>
          </div>
          <nav className="flex flex-col gap-0.5 p-2">
            {SIDEBAR.map(({ label, icon: Icon, ...rest }) => (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2",
                  "active" in rest && rest.active
                    ? "bg-[var(--surface-3)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)]",
                )}
                key={label}
              >
                <Icon className="size-[14px] shrink-0" />
                {label}
              </div>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 items-center gap-2 border-[var(--border)] border-b px-4">
            <MessageSquareText className="size-[14px] text-[var(--text-icon)]" />
            <span className="truncate text-[var(--text-primary)]">Ask about Acme Corp</span>
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
            {MESSAGES.map((message, index) => (
              <div
                className={cn(
                  "max-w-[92%] rounded-lg px-3 py-2 leading-[1.45]",
                  message.role === "You"
                    ? "ml-auto bg-[var(--surface-3)]"
                    : "border border-[var(--border)]",
                )}
                key={`${message.role}-${index}`}
              >
                <p className="mb-1 text-[var(--text-muted)] text-xs">{message.role}</p>
                <p className="text-[var(--text-primary)]">{message.text}</p>
              </div>
            ))}
          </div>
          <div className="border-[var(--border)] border-t px-4 py-3 text-[var(--text-muted)]">
            Reply with context from your register…
          </div>
        </div>
      </div>
    </MenuPreviewFrame>
  );
}

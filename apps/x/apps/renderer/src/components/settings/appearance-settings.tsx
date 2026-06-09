import { Check } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/theme-context";
import { SettingsSection } from "./settings-ui";

/**
 * Appearance settings. Each option is a real visual PREVIEW (a mini light/dark
 * window for themes; mini pane-layout diagrams for chat placement/size) rather
 * than a generic icon — so the choice depicts what it does.
 */

/** Selectable card: a preview, a label row, and a check badge when active. */
function OptionCard({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-2 rounded-none border p-2 text-left transition-all",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      {children}
      <div className="flex items-center justify-between px-0.5">
        <span
          className={cn(
            "text-xs font-medium",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
            selected ? "opacity-100" : "opacity-0",
          )}
        >
          <Check className="size-3" />
        </span>
      </div>
    </button>
  );
}

/** Mini app-window mockup in light or dark tones (theme-independent on purpose). */
function MiniWindow({ tone }: { tone: "light" | "dark" }) {
  const c =
    tone === "light"
      ? {
          bg: "bg-white",
          side: "bg-zinc-100",
          border: "border-zinc-200",
          a: "bg-zinc-300",
          b: "bg-zinc-200",
        }
      : {
          bg: "bg-zinc-900",
          side: "bg-zinc-800",
          border: "border-zinc-700",
          a: "bg-zinc-600",
          b: "bg-zinc-700",
        };
  return (
    <div className={cn("flex h-16 w-full overflow-hidden", c.bg)}>
      <div className={cn("w-1/3 space-y-1 border-r p-1.5", c.side, c.border)}>
        <div className={cn("h-1 w-3/4 rounded-full", c.a)} />
        <div className={cn("h-1 w-1/2 rounded-full", c.b)} />
        <div className={cn("h-1 w-2/3 rounded-full", c.b)} />
      </div>
      <div className="flex-1 space-y-1 p-1.5">
        <div className={cn("h-1.5 w-1/2 rounded-full", c.a)} />
        <div className={cn("h-1 w-full rounded-full", c.b)} />
        <div className={cn("h-1 w-5/6 rounded-full", c.b)} />
        <div className={cn("h-1 w-2/3 rounded-full", c.b)} />
      </div>
    </div>
  );
}

function ThemePreview({ kind }: { kind: "light" | "dark" | "system" }) {
  if (kind === "system") {
    // Split: left light / right dark.
    return (
      <div className="flex h-16 w-full overflow-hidden border">
        <div className="w-1/2 space-y-1 bg-white p-1.5">
          <div className="h-1 w-3/4 rounded-full bg-zinc-300" />
          <div className="h-1 w-1/2 rounded-full bg-zinc-200" />
          <div className="h-1 w-2/3 rounded-full bg-zinc-200" />
        </div>
        <div className="w-1/2 space-y-1 bg-zinc-900 p-1.5">
          <div className="h-1 w-3/4 rounded-full bg-zinc-600" />
          <div className="h-1 w-1/2 rounded-full bg-zinc-700" />
          <div className="h-1 w-2/3 rounded-full bg-zinc-700" />
        </div>
      </div>
    );
  }
  return (
    <div className="w-full overflow-hidden border">
      <MiniWindow tone={kind} />
    </div>
  );
}

/** Mini layout diagram: a thin sidebar + content/chat panes (chat = accent). */
function MiniLayout({ panes }: { panes: { grow: number; accent?: boolean }[] }) {
  return (
    <div className="flex h-16 w-full gap-1 overflow-hidden border bg-muted/30 p-1.5">
      <div className="h-full w-1.5 shrink-0 rounded-none bg-muted-foreground/25" />
      {panes.map((p, i) => (
        <div
          key={i}
          style={{ flexGrow: p.grow }}
          className={cn(
            "h-full min-w-0 rounded-none",
            p.accent ? "bg-primary/80" : "border bg-card",
          )}
        />
      ))}
    </div>
  );
}

export function AppearanceSettings() {
  const {
    theme,
    setTheme,
    chatPanePlacement,
    setChatPanePlacement,
    chatPaneSize,
    setChatPaneSize,
  } = useTheme();

  return (
    <div className="space-y-8">
      <SettingsSection title="Theme" description="Select your preferred color scheme">
        <div className="grid grid-cols-3 gap-3">
          <OptionCard label="Light" selected={theme === "light"} onClick={() => setTheme("light")}>
            <ThemePreview kind="light" />
          </OptionCard>
          <OptionCard label="Dark" selected={theme === "dark"} onClick={() => setTheme("dark")}>
            <ThemePreview kind="dark" />
          </OptionCard>
          <OptionCard
            label="System"
            selected={theme === "system"}
            onClick={() => setTheme("system")}
          >
            <ThemePreview kind="system" />
          </OptionCard>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Chat placement"
        description="Choose where chat sits when another pane is open"
      >
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            label="Right"
            selected={chatPanePlacement === "right"}
            onClick={() => setChatPanePlacement("right")}
          >
            <MiniLayout panes={[{ grow: 2 }, { grow: 1, accent: true }]} />
          </OptionCard>
          <OptionCard
            label="Middle"
            selected={chatPanePlacement === "middle"}
            onClick={() => setChatPanePlacement("middle")}
          >
            <MiniLayout panes={[{ grow: 1 }, { grow: 1.2, accent: true }, { grow: 1 }]} />
          </OptionCard>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Chat size"
        description="Choose how much width chat gets when another pane is open"
      >
        <div className="grid grid-cols-3 gap-3">
          <OptionCard
            label="Smaller"
            selected={chatPaneSize === "chat-smaller"}
            onClick={() => setChatPaneSize("chat-smaller")}
          >
            <MiniLayout panes={[{ grow: 3 }, { grow: 1, accent: true }]} />
          </OptionCard>
          <OptionCard
            label="Equal"
            selected={chatPaneSize === "chat-equal"}
            onClick={() => setChatPaneSize("chat-equal")}
          >
            <MiniLayout panes={[{ grow: 1 }, { grow: 1, accent: true }]} />
          </OptionCard>
          <OptionCard
            label="Bigger"
            selected={chatPaneSize === "chat-bigger"}
            onClick={() => setChatPaneSize("chat-bigger")}
          >
            <MiniLayout panes={[{ grow: 1 }, { grow: 3, accent: true }]} />
          </OptionCard>
        </div>
      </SettingsSection>
    </div>
  );
}

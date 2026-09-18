import type { ComponentType } from "react";

import { cn } from "@/lib/sim/cn";

import {
  ApprovalMark,
  KeysMark,
  LocalMark,
  SelfHostMark,
  SourceMark,
  SyncMark,
  type GovernanceMarkProps,
} from "./governance-marks";
import { HOME_INSET, HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

/** Everything under the title — mark and description stay on the quiet tier. */
const CONTROL_QUIET = "text-[var(--text-secondary)]";

/** Same caption measure as Sim's feature rail and lifecycle grid (15px/1.45). */
const CONTROL_COPY = "text-[15px] leading-[1.45]";

interface Control {
  title: string;
  description: string;
  Mark: ComponentType<GovernanceMarkProps>;
}

const controls: Control[] = [
  {
    title: "Approval before send",
    description: "Gmail, Slack, and HubSpot writes are drafted and held for a person.",
    Mark: ApprovalMark,
  },
  {
    title: "Source on every row",
    description: "Each commitment links back to the email, meeting, or CRM record that created it.",
    Mark: SourceMark,
  },
  {
    title: "Local when needed",
    description: "Meeting audio, vault notes, and on-device transcription can stay on the desktop.",
    Mark: LocalMark,
  },
  {
    title: "Signed-in sync",
    description: "Relationship state syncs between web and desktop when you sign in.",
    Mark: SyncMark,
  },
  {
    title: "Bring your own keys",
    description: "Use your model provider keys where the desktop stack supports it.",
    Mark: KeysMark,
  },
  {
    title: "Documented self-host path",
    description:
      "The desktop coworker stack runs on your machine today; backend deployment is documented for teams who need it.",
    Mark: SelfHostMark,
  },
];

/** Sim `WorkspaceControls` — six-cell governance grid with quiet outline marks. */
export function SimWorkspaceControls() {
  return (
    <section
      aria-label="Governance on the ledger"
      className={cn("flex w-full flex-col", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
      id="controls"
    >
      <div className={cn(HOME_INSET, "pt-12 max-sm:pt-8")}>
        <ul className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] max-sm:grid-cols-1 max-lg:grid-cols-2">
          {controls.map(({ title, description, Mark }) => (
            <li
              className="flex flex-col items-start gap-3 bg-[var(--surface-2)] p-7 max-sm:p-6"
              key={title}
            >
              <Mark className={cn("size-[56px]", CONTROL_QUIET)} />
              <div>
                <h3 className={cn("text-[var(--text-primary)]", HOME_TYPE.body)}>{title}</h3>
                <p className={cn("mt-1.5 max-w-[30ch] text-pretty", CONTROL_QUIET, CONTROL_COPY)}>
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

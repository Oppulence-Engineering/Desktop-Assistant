import { Table } from "@sim/emcn/icons";
import { GmailIcon } from "@/components/sim/icons";
import { ActivityStatus } from "@/components/sim/activity-status";
import { getToolStatusDisplayTitle } from "@/lib/sim-port/copilot/tools/tool-display";
import type {
  ToolActivityPresentation,
  ToolCallItemProps,
} from "@/sim-port/workspace/home/components/message-content/components/agent-group/tool-call-item";
import { getToolIcon } from "@/sim-port/workspace/home/components/message-content/utils";

/** Demo fixtures have known brands, so the landing page never loads the block registry. */
export function HeroToolCallItem({
  toolCallId,
  renderStatus,
  toolName,
  displayTitle,
  activityDescription,
  status,
}: ToolCallItemProps) {
  const Icon =
    toolCallId === "hero-read-gmail"
      ? GmailIcon
      : toolCallId === "hero-read-table"
        ? Table
        : getToolIcon(toolName);
  const activity: ToolActivityPresentation = {
    label: getToolStatusDisplayTitle(displayTitle, status, toolName, activityDescription),
    activeLabel: getToolStatusDisplayTitle(
      displayTitle,
      status === "success" ? "executing" : status,
      toolName,
      activityDescription,
    ),
    isActive: status === "executing",
    icon: <Icon className="size-full" />,
  };
  return renderStatus ? renderStatus(activity) : <ActivityStatus {...activity} />;
}

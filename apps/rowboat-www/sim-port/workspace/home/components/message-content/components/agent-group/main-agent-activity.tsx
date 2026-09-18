import { type ComponentType, Fragment, type ReactNode } from 'react'
import { RETIRED_BROWSER_REQUEST_TAKEOVER_ID } from '@/lib/sim-port/copilot/tools/retired-tools'
import type { AgentGroupItem } from '@/sim-port/workspace/home/components/message-content/components/agent-group/agent-group-view'
import { ToolActivityGroup } from '@/sim-port/workspace/home/components/message-content/components/agent-group/tool-activity-group'
import type { ToolCallItemProps } from '@/sim-port/workspace/home/components/message-content/components/agent-group/tool-call-item'
import { needsToolInput } from '@/sim-port/workspace/home/components/message-content/components/agent-group/tool-interactions'
import type { ToolCallData } from '@/sim-port/workspace/home/types'

interface MainAgentActivityProps {
  items: AgentGroupItem[]
  ToolCallComponent: ComponentType<ToolCallItemProps>
  renderItem: (item: AgentGroupItem, index: number) => ReactNode
  autoScrollActivity: boolean
  isActive: boolean
}

/** Keep answers and interactions in the transcript, outside collapsible tool history. */
function isStandaloneItem(item: AgentGroupItem): boolean {
  return (
    item.type !== 'tool' ||
    needsToolInput(item.data) ||
    item.data.toolName === RETIRED_BROWSER_REQUEST_TAKEOVER_ID
  )
}

export function MainAgentActivity({
  items,
  ToolCallComponent,
  renderItem,
  autoScrollActivity,
  isActive,
}: MainAgentActivityProps) {
  const activity: ReactNode[] = []
  let tools: ToolCallData[] = []
  const flushTools = (active = false) => {
    if (tools.length === 0) return
    activity.push(
      <ToolActivityGroup
        key={tools[0].id}
        tools={tools}
        isActive={active}
        ToolCallComponent={ToolCallComponent}
        autoScrollActivity={autoScrollActivity}
      />
    )
    tools = []
  }

  for (const [index, item] of items.entries()) {
    if (item.type === 'tool' && !isStandaloneItem(item)) {
      tools.push(item.data)
      continue
    }
    flushTools()
    activity.push(
      <Fragment
        key={
          item.type === 'tool'
            ? item.data.id
            : item.type === 'agent_group'
              ? item.group.id
              : `text-${index}`
        }
      >
        {renderItem(item, index)}
      </Fragment>
    )
  }
  flushTools(isActive)

  return <div className='flex min-w-0 flex-col gap-1.5'>{activity}</div>
}

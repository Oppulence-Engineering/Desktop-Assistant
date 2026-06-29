'use client';

import { useState } from 'react';
import { Tabs, Tab } from '@/components/ui/tabs';
import { CustomMcpServers } from './CustomMcpServer';
import { SelectIntegrationToolkit } from './SelectIntegrationToolkit';
import { IntegrationToolsPanel } from './IntegrationToolsPanel';
import { AddWebhookTool } from './AddWebhookTool';
import type { Key } from 'react';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { ZToolkit } from "@/src/application/lib/integration/types";
import { z } from 'zod';

interface ToolsConfigProps {
  projectId: string;
  useIntegrationTools: boolean;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
  initialToolkitSlug?: string | null;
}

type ToolkitType = z.infer<typeof ZToolkit>;

export function ToolsConfig({
  projectId,
  useIntegrationTools,
  tools,
  onAddTool,
  initialToolkitSlug
}: ToolsConfigProps) {
  let defaultActiveTab = 'mcp';
  if (useIntegrationTools) {
    defaultActiveTab = 'integration';
  }
  const [activeTab, setActiveTab] = useState(defaultActiveTab);
  const [selectedToolkit, setSelectedToolkit] = useState<ToolkitType | null>(null);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);
  const useBilling = process.env.NEXT_PUBLIC_USE_BILLING === "true";

  const handleTabChange = (key: Key) => {
    setActiveTab(key.toString());
  };

  const handleSelectToolkit = (toolkit: ToolkitType) => {
    setSelectedToolkit(toolkit);
    setIsToolsPanelOpen(true);
  };

  const handleCloseToolsPanel = () => {
    setSelectedToolkit(null);
    setIsToolsPanelOpen(false);
  };

  const handleAddTool = (tool: z.infer<typeof WorkflowTool>) => {
    onAddTool(tool);
    handleCloseToolsPanel();
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs 
        selectedKey={activeTab}
        onSelectionChange={handleTabChange}
        aria-label="Tool configuration options"
        className="w-full"
        fullWidth
      >
        {useIntegrationTools && (
          <Tab key="integration" title="Library">
            <div className="mt-4 p-6">
              <SelectIntegrationToolkit
                projectId={projectId}
                tools={tools}
                onSelectToolkit={handleSelectToolkit}
                initialToolkitSlug={initialToolkitSlug}
                filterByTools={true}
              />
            </div>
          </Tab>
        )}
        <Tab key="mcp" title="Custom MCP Servers">
          <div className="mt-4 p-6">
            <CustomMcpServers
              tools={tools}
              onAddTool={onAddTool}
            />
          </div>
        </Tab>
        {!useBilling && <Tab key="webhook" title="Webhook">
          <div className="mt-4 p-6">
            <AddWebhookTool
              projectId={projectId}
              onAddTool={onAddTool}
            />
          </div>
        </Tab>}
      </Tabs>
      
      {/* Tools Panel */}
      {selectedToolkit && (
        <IntegrationToolsPanel
          toolkit={selectedToolkit}
          isOpen={isToolsPanelOpen}
          onClose={handleCloseToolsPanel}
          tools={tools}
          onAddTool={handleAddTool}
        />
      )}
    </div>
  );
} 
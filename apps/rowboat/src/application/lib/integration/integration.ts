import { z } from "zod";
import {
    ZAuthConfig,
    ZConnectedAccount,
    ZCreateAuthConfigRequest,
    ZCreateAuthConfigResponse,
    ZCreateConnectedAccountRequest,
    ZCreateConnectedAccountResponse,
    ZDeleteOperationResponse,
    ZGetToolkitResponse,
    ZListResponse,
    ZTool,
    ZToolkit,
    ZTriggerType,
} from "./types";

function disabled(): never {
    throw new Error("Legacy toolkit discovery has been replaced by Rowboat managed integrations.");
}

function emptyList<T>(): { items: T[]; next_cursor: null; total_pages: number; current_page: number; total_items: number } {
    return { items: [], next_cursor: null, total_pages: 0, current_page: 1, total_items: 0 };
}

export const integration = {
    tools: {
        execute: async (_slug: string, _request: unknown): Promise<{ successful: boolean; data?: unknown; error?: string }> => ({
            successful: false,
            error: "Legacy toolkit execution has been replaced by Rowboat managed integrations.",
        }),
    },
    triggers: {
        create: async (_projectId: string, _triggerTypeSlug: string, _request: unknown): Promise<{ triggerId: string }> => disabled(),
        delete: async (_triggerId: string): Promise<void> => undefined,
    },
};

export async function listToolkits(_cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    return emptyList();
}

export async function getToolkit(_toolkitSlug: string): Promise<z.infer<typeof ZGetToolkitResponse>> {
    disabled();
}

export async function listTools(_toolkitSlug: string, _searchQuery: string | null = null, _cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    return emptyList();
}

export async function getTool(_toolSlug: string): Promise<z.infer<typeof ZTool>> {
    disabled();
}

export async function listAuthConfigs(_toolkitSlug: string, _cursor: string | null = null, _managedOnly: boolean = false): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>> {
    return emptyList();
}

export async function createAuthConfig(_request: z.infer<typeof ZCreateAuthConfigRequest>): Promise<z.infer<typeof ZCreateAuthConfigResponse>> {
    disabled();
}

export async function getAuthConfig(_authConfigId: string): Promise<z.infer<typeof ZAuthConfig>> {
    disabled();
}

export async function deleteAuthConfig(_authConfigId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    return { success: true };
}

export async function createConnectedAccount(_request: z.infer<typeof ZCreateConnectedAccountRequest>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    disabled();
}

export async function getConnectedAccount(_connectedAccountId: string): Promise<z.infer<typeof ZConnectedAccount>> {
    disabled();
}

export async function deleteConnectedAccount(_connectedAccountId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    return { success: true };
}

export async function listTriggersTypes(_toolkitSlug: string, _cursor?: string): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTriggerType>>>> {
    return emptyList();
}

export async function getTriggersType(_triggerTypeSlug: string): Promise<z.infer<typeof ZTriggerType>> {
    disabled();
}

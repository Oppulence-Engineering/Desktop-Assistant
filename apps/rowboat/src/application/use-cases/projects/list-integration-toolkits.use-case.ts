import { z } from "zod";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { listToolkits } from "@/src/application/lib/integration/integration";
import { ZListResponse } from "../../lib/integration/types";
import { ZToolkit } from "../../lib/integration/types";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().nullable().optional(),
});

export interface IListIntegrationToolkitsUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>>;
}

export class ListIntegrationToolkitsUseCase implements IListIntegrationToolkitsUseCase {
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
        const { caller, userId, apiKey, projectId, cursor } = request;
        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);
        return await listToolkits(cursor ?? null);
    }
}



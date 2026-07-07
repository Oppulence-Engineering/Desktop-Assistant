import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IIntegrationTriggerDeploymentsRepository } from '../../repositories/integration-trigger-deployments.repository.interface';
import { IntegrationTriggerDeployment } from '@/src/entities/models/integration-trigger-deployment';
import { PaginatedList } from '@/src/entities/common/paginated-list';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListIntegrationTriggerDeploymentsUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>>;
}

export class ListIntegrationTriggerDeploymentsUseCase implements IListIntegrationTriggerDeploymentsUseCase {
    private readonly integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        integrationTriggerDeploymentsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.integrationTriggerDeploymentsRepository = integrationTriggerDeploymentsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>> {
        // extract projectid from conversation
        const { projectId, limit } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        // fetch deployments for project
        return await this.integrationTriggerDeploymentsRepository.listByProjectId(projectId, request.cursor, limit);
    }
}
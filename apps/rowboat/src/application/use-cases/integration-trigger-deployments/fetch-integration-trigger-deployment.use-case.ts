import { NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IIntegrationTriggerDeploymentsRepository } from '../../repositories/integration-trigger-deployments.repository.interface';
import { IntegrationTriggerDeployment } from '@/src/entities/models/integration-trigger-deployment';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    deploymentId: z.string(),
});

export interface IFetchIntegrationTriggerDeploymentUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>>;
}

export class FetchIntegrationTriggerDeploymentUseCase implements IFetchIntegrationTriggerDeploymentUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>> {
        // fetch deployment first to get projectId
        const deployment = await this.integrationTriggerDeploymentsRepository.fetch(request.deploymentId);
        if (!deployment) {
            throw new NotFoundError(`Integration trigger deployment ${request.deploymentId} not found`);
        }

        const { projectId } = deployment;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        return deployment;
    }
}



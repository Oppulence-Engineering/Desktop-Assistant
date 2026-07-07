import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IIntegrationTriggerDeploymentsRepository } from '../../repositories/integration-trigger-deployments.repository.interface';
import { IProjectsRepository } from '../../repositories/projects.repository.interface';
import { integration } from '../../lib/integration/integration';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    deploymentId: z.string(),
});

export interface IDeleteIntegrationTriggerDeploymentUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteIntegrationTriggerDeploymentUseCase implements IDeleteIntegrationTriggerDeploymentUseCase {
    private readonly integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository;   
    private readonly projectsRepository: IProjectsRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        integrationTriggerDeploymentsRepository,
        projectsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository,
        projectsRepository: IProjectsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.integrationTriggerDeploymentsRepository = integrationTriggerDeploymentsRepository;
        this.projectsRepository = projectsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // extract projectid from conversation
        const { projectId } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        // ensure deployment belongs to this project
        const deployment = await this.integrationTriggerDeploymentsRepository.fetch(request.deploymentId);
        if (!deployment || deployment.projectId !== projectId) {
            throw new NotFoundError('Deployment not found');
        }

        // delete trigger from integration
        await integration.triggers.delete(deployment.triggerId);

        // delete deployment
        return await this.integrationTriggerDeploymentsRepository.delete(request.deploymentId);
    }
}
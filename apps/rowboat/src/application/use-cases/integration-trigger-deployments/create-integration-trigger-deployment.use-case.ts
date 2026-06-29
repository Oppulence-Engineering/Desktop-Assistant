import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IIntegrationTriggerDeploymentsRepository } from '../../repositories/integration-trigger-deployments.repository.interface';
import { IProjectsRepository } from '../../repositories/projects.repository.interface';
import { integration, getTriggersType } from '../../lib/integration/integration';
import { IntegrationTriggerDeployment } from '@/src/entities/models/integration-trigger-deployment';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    data: IntegrationTriggerDeployment.pick({
        triggerTypeSlug: true,
        connectedAccountId: true,
        triggerConfig: true,
    }),
});

export interface ICreateIntegrationTriggerDeploymentUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>>;
}

export class CreateIntegrationTriggerDeploymentUseCase implements ICreateIntegrationTriggerDeploymentUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>> {
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

        // get trigger type info
        const triggerType = await getTriggersType(request.data.triggerTypeSlug);

        // get toolkit info
        const toolkit = triggerType.toolkit;

        // ensure that connected account exists on project
        const project = await this.projectsRepository.fetch(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }

        // ensure connected account exists
        const account = project.integrationConnectedAccounts?.[toolkit.slug];
        if (!account || account.id !== request.data.connectedAccountId) {
            throw new BadRequestError('Invalid connected account');
        }

        // ensure that a trigger deployment does not exist for this trigger type and connected account
        const existingDeployment = await this.integrationTriggerDeploymentsRepository.fetchBySlugAndConnectedAccountId(request.data.triggerTypeSlug, request.data.connectedAccountId);
        if (existingDeployment) {
            throw new BadRequestError('Trigger deployment already exists');
        }

        // create trigger on integration
        const result = await integration.triggers.create(projectId, request.data.triggerTypeSlug, {
            connectedAccountId: request.data.connectedAccountId,
            triggerConfig: request.data.triggerConfig,
        });

        // create trigger deployment in db
        return await this.integrationTriggerDeploymentsRepository.create({
            projectId,
            toolkitSlug: toolkit.slug,
            logo: toolkit.logo,
            triggerId: result.triggerId,
            connectedAccountId: request.data.connectedAccountId,
            triggerTypeSlug: request.data.triggerTypeSlug,
            triggerTypeName: triggerType.name,
            triggerConfig: request.data.triggerConfig,
        });
    }
}
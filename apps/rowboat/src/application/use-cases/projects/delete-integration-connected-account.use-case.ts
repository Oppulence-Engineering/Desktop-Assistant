import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { IIntegrationTriggerDeploymentsRepository } from "../../repositories/integration-trigger-deployments.repository.interface";
import { BadRequestError, NotFoundError } from "@/src/entities/errors/common";
import { deleteConnectedAccount } from "../../lib/integration/integration";
import { getAuthConfig } from "../../lib/integration/integration";
import { deleteAuthConfig } from "../../lib/integration/integration";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
});

export interface IDeleteIntegrationConnectedAccountUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteIntegrationConnectedAccountUseCase implements IDeleteIntegrationConnectedAccountUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository;

    constructor({
        projectsRepository,
        projectActionAuthorizationPolicy,
        usageQuotaPolicy,
        integrationTriggerDeploymentsRepository,
    }: {
        projectsRepository: IProjectsRepository,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
        usageQuotaPolicy: IUsageQuotaPolicy,
        integrationTriggerDeploymentsRepository: IIntegrationTriggerDeploymentsRepository,
    }) {
        this.projectsRepository = projectsRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.integrationTriggerDeploymentsRepository = integrationTriggerDeploymentsRepository;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
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

        // fetch project
        const project = await this.projectsRepository.fetch(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }

        // ensure connected account exists
        const account = project.integrationConnectedAccounts?.[request.toolkitSlug];
        if (!account) {
            throw new BadRequestError('Invalid connected account');
        }

        // delete the connected account from integration
        // this will also delete any trigger instances associated with the connected account
        const result = await deleteConnectedAccount(account.id);
        if (!result.success) {
            throw new Error(`Failed to delete connected account ${account.id}`);
        }

        // delete trigger deployments data from db
        await this.integrationTriggerDeploymentsRepository.deleteByConnectedAccountId(account.id);

        // get auth config data
        const authConfig = await getAuthConfig(account.authConfigId);

        // delete the auth config if it is NOT managed by integration
        if (!authConfig.is_integration_managed) {
            const result = await deleteAuthConfig(account.authConfigId);
            if (!result.success) {
                throw new Error(`Failed to delete auth config ${account.authConfigId}`);
            }
        }

        // delete connected account from project
        await this.projectsRepository.deleteIntegrationConnectedAccount(projectId, request.toolkitSlug);
    }
}
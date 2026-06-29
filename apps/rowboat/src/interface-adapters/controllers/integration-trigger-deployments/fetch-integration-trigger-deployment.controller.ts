import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchIntegrationTriggerDeploymentUseCase } from "@/src/application/use-cases/integration-trigger-deployments/fetch-integration-trigger-deployment.use-case";
import { IntegrationTriggerDeployment } from "@/src/entities/models/integration-trigger-deployment";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    deploymentId: z.string(),
});

export interface IFetchIntegrationTriggerDeploymentController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>>;
}

export class FetchIntegrationTriggerDeploymentController implements IFetchIntegrationTriggerDeploymentController {
    private readonly fetchIntegrationTriggerDeploymentUseCase: IFetchIntegrationTriggerDeploymentUseCase;
    
    constructor({
        fetchIntegrationTriggerDeploymentUseCase,
    }: {
        fetchIntegrationTriggerDeploymentUseCase: IFetchIntegrationTriggerDeploymentUseCase,
    }) {
        this.fetchIntegrationTriggerDeploymentUseCase = fetchIntegrationTriggerDeploymentUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, deploymentId } = result.data;

        return await this.fetchIntegrationTriggerDeploymentUseCase.execute({
            caller,
            userId,
            apiKey,
            deploymentId,
        });
    }
}



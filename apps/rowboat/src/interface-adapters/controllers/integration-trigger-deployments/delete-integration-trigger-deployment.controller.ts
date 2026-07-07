import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteIntegrationTriggerDeploymentUseCase } from "@/src/application/use-cases/integration-trigger-deployments/delete-integration-trigger-deployment.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    deploymentId: z.string(),
});

export interface IDeleteIntegrationTriggerDeploymentController {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteIntegrationTriggerDeploymentController implements IDeleteIntegrationTriggerDeploymentController {
    private readonly deleteIntegrationTriggerDeploymentUseCase: IDeleteIntegrationTriggerDeploymentUseCase;
    
    constructor({
        deleteIntegrationTriggerDeploymentUseCase,
    }: {
        deleteIntegrationTriggerDeploymentUseCase: IDeleteIntegrationTriggerDeploymentUseCase,
    }) {
        this.deleteIntegrationTriggerDeploymentUseCase = deleteIntegrationTriggerDeploymentUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, deploymentId } = result.data;

        // execute use case
        return await this.deleteIntegrationTriggerDeploymentUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            deploymentId,
        });
    }
}

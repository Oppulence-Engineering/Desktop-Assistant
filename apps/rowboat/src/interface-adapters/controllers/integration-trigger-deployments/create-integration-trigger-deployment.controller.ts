import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateIntegrationTriggerDeploymentUseCase } from "@/src/application/use-cases/integration-trigger-deployments/create-integration-trigger-deployment.use-case";
import { IntegrationTriggerDeployment } from "@/src/entities/models/integration-trigger-deployment";

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

export interface ICreateIntegrationTriggerDeploymentController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>>;
}

export class CreateIntegrationTriggerDeploymentController implements ICreateIntegrationTriggerDeploymentController {
    private readonly createIntegrationTriggerDeploymentUseCase: ICreateIntegrationTriggerDeploymentUseCase;
    
    constructor({
        createIntegrationTriggerDeploymentUseCase,
    }: {
        createIntegrationTriggerDeploymentUseCase: ICreateIntegrationTriggerDeploymentUseCase,
    }) {
        this.createIntegrationTriggerDeploymentUseCase = createIntegrationTriggerDeploymentUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, data } = result.data;

        // execute use case
        return await this.createIntegrationTriggerDeploymentUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            data,
        });
    }
}

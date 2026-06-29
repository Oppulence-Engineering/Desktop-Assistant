import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListIntegrationTriggerDeploymentsUseCase } from "@/src/application/use-cases/integration-trigger-deployments/list-integration-trigger-deployments.use-case";
import { IntegrationTriggerDeployment } from "@/src/entities/models/integration-trigger-deployment";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListIntegrationTriggerDeploymentsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>>;
}

export class ListIntegrationTriggerDeploymentsController implements IListIntegrationTriggerDeploymentsController {
    private readonly listIntegrationTriggerDeploymentsUseCase: IListIntegrationTriggerDeploymentsUseCase;
    
    constructor({
        listIntegrationTriggerDeploymentsUseCase,
    }: {
        listIntegrationTriggerDeploymentsUseCase: IListIntegrationTriggerDeploymentsUseCase,
    }) {
        this.listIntegrationTriggerDeploymentsUseCase = listIntegrationTriggerDeploymentsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listIntegrationTriggerDeploymentsUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}

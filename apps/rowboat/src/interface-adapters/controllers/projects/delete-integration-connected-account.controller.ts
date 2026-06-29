import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteIntegrationConnectedAccountUseCase } from "@/src/application/use-cases/projects/delete-integration-connected-account.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
});

export interface IDeleteIntegrationConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteIntegrationConnectedAccountController implements IDeleteIntegrationConnectedAccountController {
    private readonly deleteIntegrationConnectedAccountUseCase: IDeleteIntegrationConnectedAccountUseCase;
    
    constructor({
        deleteIntegrationConnectedAccountUseCase,
    }: {
        deleteIntegrationConnectedAccountUseCase: IDeleteIntegrationConnectedAccountUseCase,
    }) {
        this.deleteIntegrationConnectedAccountUseCase = deleteIntegrationConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, toolkitSlug } = result.data;

        // execute use case
        return await this.deleteIntegrationConnectedAccountUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            toolkitSlug,
        });
    }
}

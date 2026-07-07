import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateIntegrationManagedConnectedAccountUseCase } from "@/src/application/use-cases/projects/create-integration-managed-connected-account.use-case";
import { ZCreateConnectedAccountResponse } from "@/src/application/lib/integration/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    callbackUrl: z.string(),
});

export interface ICreateIntegrationManagedConnectedAccountController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
}

export class CreateIntegrationManagedConnectedAccountController implements ICreateIntegrationManagedConnectedAccountController {
    private readonly createIntegrationManagedConnectedAccountUseCase: ICreateIntegrationManagedConnectedAccountUseCase;

    constructor({ createIntegrationManagedConnectedAccountUseCase }: { createIntegrationManagedConnectedAccountUseCase: ICreateIntegrationManagedConnectedAccountUseCase }) {
        this.createIntegrationManagedConnectedAccountUseCase = createIntegrationManagedConnectedAccountUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.createIntegrationManagedConnectedAccountUseCase.execute(result.data);
    }
}



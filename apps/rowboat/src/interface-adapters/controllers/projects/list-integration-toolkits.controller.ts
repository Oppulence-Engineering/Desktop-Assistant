import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListIntegrationToolkitsUseCase } from "@/src/application/use-cases/projects/list-integration-toolkits.use-case";
import { ZListResponse } from "@/src/application/lib/integration/types";
import { ZToolkit } from "@/src/application/lib/integration/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().nullable().optional(),
});

export interface IListIntegrationToolkitsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>>;
}

export class ListIntegrationToolkitsController implements IListIntegrationToolkitsController {
    private readonly listIntegrationToolkitsUseCase: IListIntegrationToolkitsUseCase;

    constructor({ listIntegrationToolkitsUseCase }: { listIntegrationToolkitsUseCase: IListIntegrationToolkitsUseCase }) {
        this.listIntegrationToolkitsUseCase = listIntegrationToolkitsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.listIntegrationToolkitsUseCase.execute(result.data);
    }
}



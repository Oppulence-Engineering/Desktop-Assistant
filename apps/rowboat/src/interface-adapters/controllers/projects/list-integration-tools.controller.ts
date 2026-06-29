import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListIntegrationToolsUseCase } from "@/src/application/use-cases/projects/list-integration-tools.use-case";
import { ZListResponse } from "@/src/application/lib/integration/types";
import { ZTool } from "@/src/application/lib/integration/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    searchQuery: z.string().nullable().optional(),
    cursor: z.string().nullable().optional(),
});

export interface IListIntegrationToolsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>>;
}

export class ListIntegrationToolsController implements IListIntegrationToolsController {
    private readonly listIntegrationToolsUseCase: IListIntegrationToolsUseCase;

    constructor({ listIntegrationToolsUseCase }: { listIntegrationToolsUseCase: IListIntegrationToolsUseCase }) {
        this.listIntegrationToolsUseCase = listIntegrationToolsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.listIntegrationToolsUseCase.execute(result.data);
    }
}



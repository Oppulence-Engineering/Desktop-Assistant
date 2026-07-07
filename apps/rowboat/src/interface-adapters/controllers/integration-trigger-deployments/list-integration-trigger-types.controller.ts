import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListIntegrationTriggerTypesUseCase } from "@/src/application/use-cases/integration-trigger-deployments/list-integration-trigger-types.use-case";
import { IntegrationTriggerType } from "@/src/entities/models/integration-trigger-type";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    toolkitSlug: z.string(),
    cursor: z.string().optional(),
});

export interface IListIntegrationTriggerTypesController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerType>>>>;
}

export class ListIntegrationTriggerTypesController implements IListIntegrationTriggerTypesController {
    private readonly listIntegrationTriggerTypesUseCase: IListIntegrationTriggerTypesUseCase;
    
    constructor({
        listIntegrationTriggerTypesUseCase,
    }: {
        listIntegrationTriggerTypesUseCase: IListIntegrationTriggerTypesUseCase,
    }) {
        this.listIntegrationTriggerTypesUseCase = listIntegrationTriggerTypesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerType>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { toolkitSlug, cursor } = result.data;

        // execute use case
        return await this.listIntegrationTriggerTypesUseCase.execute({
            toolkitSlug,
            cursor,
        });
    }
}

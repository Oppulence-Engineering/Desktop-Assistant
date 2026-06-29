import { z } from "zod";
import { listTriggersTypes } from '../../lib/integration/integration';
import { PaginatedList } from '@/src/entities/common/paginated-list';
import { IntegrationTriggerType } from '@/src/entities/models/integration-trigger-type';

const inputSchema = z.object({
    toolkitSlug: z.string(),
    cursor: z.string().optional(),
});

export interface IListIntegrationTriggerTypesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerType>>>>;
}

export class ListIntegrationTriggerTypesUseCase implements IListIntegrationTriggerTypesUseCase {
    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerType>>>> {
        // call integration api to fetch trigger types
        const result = await listTriggersTypes(request.toolkitSlug, request.cursor);

        // return paginated list of trigger types
        return {
            items: result.items,
            nextCursor: result.next_cursor,
        };
    }
}
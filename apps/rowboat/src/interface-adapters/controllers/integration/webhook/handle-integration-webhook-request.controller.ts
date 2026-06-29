import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IHandleIntegrationWebhookRequestUseCase } from "@/src/application/use-cases/integration/webhook/handle-integration-webhook-request.use-case";

const inputSchema = z.object({
    headers: z.record(z.string(), z.string()),
    payload: z.string(),
});

export interface IHandleIntegrationWebhookRequestController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class HandleIntegrationWebhookRequestController implements IHandleIntegrationWebhookRequestController {
    private readonly handleIntegrationWebhookRequestUseCase: IHandleIntegrationWebhookRequestUseCase;
    
    constructor({
        handleIntegrationWebhookRequestUseCase,
    }: {
        handleIntegrationWebhookRequestUseCase: IHandleIntegrationWebhookRequestUseCase,
    }) {
        this.handleIntegrationWebhookRequestUseCase = handleIntegrationWebhookRequestUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { headers, payload } = result.data;

        // execute use case
        return await this.handleIntegrationWebhookRequestUseCase.execute({
            headers,
            payload,
        });
    }
}

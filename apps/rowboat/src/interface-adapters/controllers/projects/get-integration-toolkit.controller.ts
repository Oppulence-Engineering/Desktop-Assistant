import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IGetIntegrationToolkitUseCase } from "@/src/application/use-cases/projects/get-integration-toolkit.use-case";
import { ZGetToolkitResponse } from "@/src/application/lib/integration/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
});

export interface IGetIntegrationToolkitController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>>;
}

export class GetIntegrationToolkitController implements IGetIntegrationToolkitController {
    private readonly getIntegrationToolkitUseCase: IGetIntegrationToolkitUseCase;

    constructor({ getIntegrationToolkitUseCase }: { getIntegrationToolkitUseCase: IGetIntegrationToolkitUseCase }) {
        this.getIntegrationToolkitUseCase = getIntegrationToolkitUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        return await this.getIntegrationToolkitUseCase.execute(result.data);
    }
}



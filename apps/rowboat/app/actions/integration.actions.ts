"use server";
import { z } from "zod";
import { ZListResponse } from "@/src/application/lib/integration/types";
import { ZCreateConnectedAccountResponse } from "@/src/application/lib/integration/types";
import { ZCredentials } from "@/src/application/lib/integration/types";
import { ZTool } from "@/src/application/lib/integration/types";
import { ZGetToolkitResponse } from "@/src/application/lib/integration/types";
import { ZToolkit } from "@/src/application/lib/integration/types";
import { ZAuthScheme } from "@/src/application/lib/integration/types";
import { IntegrationConnectedAccount } from "@/src/entities/models/project";
import { container } from "@/di/container";
import { ICreateIntegrationTriggerDeploymentController } from "@/src/interface-adapters/controllers/integration-trigger-deployments/create-integration-trigger-deployment.controller";
import { IListIntegrationTriggerDeploymentsController } from "@/src/interface-adapters/controllers/integration-trigger-deployments/list-integration-trigger-deployments.controller";
import { IDeleteIntegrationTriggerDeploymentController } from "@/src/interface-adapters/controllers/integration-trigger-deployments/delete-integration-trigger-deployment.controller";
import { IListIntegrationTriggerTypesController } from "@/src/interface-adapters/controllers/integration-trigger-deployments/list-integration-trigger-types.controller";
import { IFetchIntegrationTriggerDeploymentController } from "@/src/interface-adapters/controllers/integration-trigger-deployments/fetch-integration-trigger-deployment.controller";
import { IDeleteIntegrationConnectedAccountController } from "@/src/interface-adapters/controllers/projects/delete-integration-connected-account.controller";
import { authCheck } from "./auth.actions";
import { ICreateIntegrationManagedConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-integration-managed-connected-account.controller";
import { ICreateCustomConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-custom-connected-account.controller";
import { ISyncConnectedAccountController } from "@/src/interface-adapters/controllers/projects/sync-connected-account.controller";
import { IListIntegrationToolkitsController } from "@/src/interface-adapters/controllers/projects/list-integration-toolkits.controller";
import { IGetIntegrationToolkitController } from "@/src/interface-adapters/controllers/projects/get-integration-toolkit.controller";
import { IListIntegrationToolsController } from "@/src/interface-adapters/controllers/projects/list-integration-tools.controller";

const createIntegrationTriggerDeploymentController = container.resolve<ICreateIntegrationTriggerDeploymentController>("createIntegrationTriggerDeploymentController");
const listIntegrationTriggerDeploymentsController = container.resolve<IListIntegrationTriggerDeploymentsController>("listIntegrationTriggerDeploymentsController");
const deleteIntegrationTriggerDeploymentController = container.resolve<IDeleteIntegrationTriggerDeploymentController>("deleteIntegrationTriggerDeploymentController");
const listIntegrationTriggerTypesController = container.resolve<IListIntegrationTriggerTypesController>("listIntegrationTriggerTypesController");
const fetchIntegrationTriggerDeploymentController = container.resolve<IFetchIntegrationTriggerDeploymentController>("fetchIntegrationTriggerDeploymentController");
const deleteIntegrationConnectedAccountController = container.resolve<IDeleteIntegrationConnectedAccountController>("deleteIntegrationConnectedAccountController");
const createIntegrationManagedConnectedAccountController = container.resolve<ICreateIntegrationManagedConnectedAccountController>("createIntegrationManagedConnectedAccountController");
const createCustomConnectedAccountController = container.resolve<ICreateCustomConnectedAccountController>("createCustomConnectedAccountController");
const syncConnectedAccountController = container.resolve<ISyncConnectedAccountController>("syncConnectedAccountController");
const listIntegrationToolkitsController = container.resolve<IListIntegrationToolkitsController>("listIntegrationToolkitsController");
const getIntegrationToolkitController = container.resolve<IGetIntegrationToolkitController>("getIntegrationToolkitController");
const listIntegrationToolsController = container.resolve<IListIntegrationToolsController>("listIntegrationToolsController");

const ZCreateCustomConnectedAccountRequest = z.object({
    toolkitSlug: z.string(),
    authConfig: z.object({
        authScheme: ZAuthScheme,
        credentials: ZCredentials,
    }),
    callbackUrl: z.string(),
});

export async function listToolkits(projectId: string, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    const user = await authCheck();
    return await listIntegrationToolkitsController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        cursor,
    });
}

export async function getToolkit(projectId: string, toolkitSlug: string): Promise<z.infer<typeof ZGetToolkitResponse>> {
    const user = await authCheck();
    return await getIntegrationToolkitController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug,
    });
}

export async function listTools(projectId: string, toolkitSlug: string, searchQuery: string | null, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    const user = await authCheck();
    return await listIntegrationToolsController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug,
        searchQuery,
        cursor,
    });
}

export async function createIntegrationManagedOauth2ConnectedAccount(projectId: string, toolkitSlug: string, callbackUrl: string): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const user = await authCheck();
    return await createIntegrationManagedConnectedAccountController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug,
        callbackUrl,
    });
}

export async function createCustomConnectedAccount(projectId: string, request: z.infer<typeof ZCreateCustomConnectedAccountRequest>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const user = await authCheck();
    return await createCustomConnectedAccountController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug: request.toolkitSlug,
        authConfig: request.authConfig,
        callbackUrl: request.callbackUrl,
    });
}

export async function syncConnectedAccount(projectId: string, toolkitSlug: string, connectedAccountId: string): Promise<z.infer<typeof IntegrationConnectedAccount>> {
    const user = await authCheck();
    return await syncConnectedAccountController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug,
        connectedAccountId,
    });
}

export async function deleteConnectedAccount(projectId: string, toolkitSlug: string): Promise<boolean> {
    const user = await authCheck();

    await deleteIntegrationConnectedAccountController.execute({
        caller: 'user',
        userId: user.id,
        projectId,
        toolkitSlug,
    });

    return true;
}

export async function listIntegrationTriggerTypes(toolkitSlug: string, cursor?: string) {
    await authCheck();

    return await listIntegrationTriggerTypesController.execute({
        toolkitSlug,
        cursor,
    });
}

export async function createIntegrationTriggerDeployment(request: {
    projectId: string,
    triggerTypeSlug: string,
    connectedAccountId: string,
    triggerConfig?: Record<string, unknown>,
}) {
    const user = await authCheck();

    // create trigger deployment
    return await createIntegrationTriggerDeploymentController.execute({
        caller: 'user',
        userId: user.id,
        projectId: request.projectId,
        data: {
            triggerTypeSlug: request.triggerTypeSlug,
            connectedAccountId: request.connectedAccountId,
            triggerConfig: request.triggerConfig ?? {},
        },
    });
}

export async function listIntegrationTriggerDeployments(request: {
    projectId: string,
    cursor?: string,
    limit?: number,
}) {
    const user = await authCheck();

    // list trigger deployments
    return await listIntegrationTriggerDeploymentsController.execute({
        caller: 'user',
        userId: user.id,
        projectId: request.projectId,
        cursor: request.cursor,
        limit: request.limit,
    });
}

export async function deleteIntegrationTriggerDeployment(request: {
    projectId: string,
    deploymentId: string,
}) {
    const user = await authCheck();

    // delete trigger deployment
    return await deleteIntegrationTriggerDeploymentController.execute({
        caller: 'user',
        userId: user.id,
        projectId: request.projectId,
        deploymentId: request.deploymentId,
    });
}

export async function fetchIntegrationTriggerDeployment(request: { deploymentId: string }) {
    const user = await authCheck();
    return await fetchIntegrationTriggerDeploymentController.execute({
        caller: 'user',
        userId: user.id,
        deploymentId: request.deploymentId,
    });
}

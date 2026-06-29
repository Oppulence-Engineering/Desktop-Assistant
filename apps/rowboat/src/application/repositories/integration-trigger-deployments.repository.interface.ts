import { IntegrationTriggerDeployment } from "@/src/entities/models/integration-trigger-deployment";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { z } from "zod";

/**
 * Schema for creating a new Integration trigger deployment.
 * Includes only the required fields for deployment creation.
 */
export const CreateDeploymentSchema = IntegrationTriggerDeployment
    .pick({
        projectId: true,
        triggerId: true,
        connectedAccountId: true,
        toolkitSlug: true,
        logo: true,
        triggerTypeSlug: true,
        triggerTypeName: true,
        triggerConfig: true,
    });

/**
 * Repository interface for managing Integration trigger deployments.
 * 
 * This interface defines the contract for operations related to Integration trigger deployments,
 * including creating, deleting, and querying deployments by various criteria.
 * 
 * Integration trigger deployments represent the connection between a project's trigger
 * and a connected account, enabling automated workflows based on external events.
 */
export interface IIntegrationTriggerDeploymentsRepository {
    /**
     * Creates a new Integration trigger deployment.
     * 
     * @param data - The deployment data containing projectId, triggerId, connectedAccountId, and triggerTypeSlug
     * @returns Promise resolving to the created deployment with full details including id, timestamps, and disabled status
     */
    create(data: z.infer<typeof CreateDeploymentSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>>;

    /**
     * Fetches a trigger deployment by its ID.
     * 
     * @param id - The unique identifier of the deployment to fetch
     * @returns Promise resolving to the deployment if found, null if not found
     */
    fetch(id: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null>;

    /**
     * Fetches a trigger deployment by its Integration trigger ID.
     * 
     * @param triggerId - The unique identifier of the Integration trigger
     * @returns Promise resolving to the deployment if found, null if not found
     */
    fetchByIntegrationTriggerId(triggerId: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null>;
    
    /**
     * Deletes a Integration trigger deployment by its ID.
     * 
     * @param id - The unique identifier of the deployment to delete
     * @returns Promise resolving to true if the deployment was deleted, false if not found
     */
    delete(id: string): Promise<boolean>;

    /**
     * Fetches a trigger deployment by its trigger type slug and connected account ID.
     * 
     * @param triggerTypeSlug - The slug identifier of the trigger type
     * @param connectedAccountId - The unique identifier of the connected account
     * @returns Promise resolving to the deployment if found, null if not found
     */
    fetchBySlugAndConnectedAccountId(triggerTypeSlug: string, connectedAccountId: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null>;
    
    /**
     * Retrieves all trigger deployments for a specific project.
     * 
     * @param projectId - The unique identifier of the project
     * @param cursor - Optional cursor for pagination
     * @param limit - Optional limit for the number of items to return
     * @returns Promise resolving to a paginated list of deployments associated with the project
     */
    listByProjectId(projectId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>>;
    
    /**
     * Deletes all trigger deployments associated with a specific connected account.
     * 
     * This method is typically used when a connected account is disconnected
     * or when cleaning up deployments for a specific integration.
     * 
     * @param connectedAccountId - The unique identifier of the connected account
     * @returns Promise resolving to the number of records deleted
     */
    deleteByConnectedAccountId(connectedAccountId: string): Promise<number>;

    /**
     * Deletes all trigger deployments associated with a specific project.
     * 
     * @param projectId - The unique identifier of the project
     * @returns Promise resolving to void
     */
    deleteByProjectId(projectId: string): Promise<void>;
}
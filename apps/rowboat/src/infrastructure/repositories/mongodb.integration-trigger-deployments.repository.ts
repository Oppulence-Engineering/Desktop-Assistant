import { z } from "zod";
import { Filter, ObjectId } from "mongodb";
import { db } from "@/app/lib/mongodb";
import { CreateDeploymentSchema, IIntegrationTriggerDeploymentsRepository } from "@/src/application/repositories/integration-trigger-deployments.repository.interface";
import { IntegrationTriggerDeployment } from "@/src/entities/models/integration-trigger-deployment";
import { PaginatedList } from "@/src/entities/common/paginated-list";

/**
 * MongoDB document schema for IntegrationTriggerDeployment.
 * Excludes the 'id' field as it's represented by MongoDB's '_id'.
 */
const DocSchema = IntegrationTriggerDeployment.omit({
    id: true,
});

/**
 * MongoDB implementation of the IntegrationTriggerDeploymentsRepository.
 * 
 * This repository manages Integration trigger deployments in MongoDB,
 * providing CRUD operations and paginated queries for deployments.
 */
export class MongodbIntegrationTriggerDeploymentsRepository implements IIntegrationTriggerDeploymentsRepository {
    private readonly collection = db.collection<z.infer<typeof DocSchema>>("integration_trigger_deployments");

    /**
     * Creates a new Integration trigger deployment.
     */
    async create(data: z.infer<typeof CreateDeploymentSchema>): Promise<z.infer<typeof IntegrationTriggerDeployment>> {
        const now = new Date().toISOString();
        const _id = new ObjectId();

        const doc = {
            ...data,
            createdAt: now,
            updatedAt: now,
        };

        await this.collection.insertOne({
            ...doc,
            _id,
        });

        return {
            ...doc,
            id: _id.toString(),
        };
    }

    /**
     * Fetches a trigger deployment by its ID.
     */
    async fetch(id: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null> {
        const result = await this.collection.findOne({ _id: new ObjectId(id) });

        if (!result) {
            return null;
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Fetches a trigger deployment by its Integration trigger ID.
     */
    async fetchByIntegrationTriggerId(triggerId: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null> {
        const result = await this.collection.findOne({ triggerId });

        if (!result) {
            return null;
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Deletes a Integration trigger deployment by its ID.
     */
    async delete(id: string): Promise<boolean> {
        const result = await this.collection.deleteOne({
            _id: new ObjectId(id),
        });

        return result.deletedCount > 0;
    }

    /**
     * Fetches a trigger deployment by its trigger type slug and connected account ID.
     */
    async fetchBySlugAndConnectedAccountId(triggerTypeSlug: string, connectedAccountId: string): Promise<z.infer<typeof IntegrationTriggerDeployment> | null> {
        const result = await this.collection.findOne({
            triggerTypeSlug,
            connectedAccountId,
        });

        if (!result) {
            return null;
        }

        const { _id, ...rest } = result;

        return {
            ...rest,
            id: _id.toString(),
        };
    }

    /**
     * Retrieves all trigger deployments for a specific project with pagination.
     */
    async listByProjectId(projectId: string, cursor?: string, limit: number = 50): Promise<z.infer<ReturnType<typeof PaginatedList<typeof IntegrationTriggerDeployment>>>> {
        const query: Filter<z.infer<typeof DocSchema>> = { projectId };

        if (cursor) {
            query._id = { $gt: new ObjectId(cursor) };
        }

        const results = await this.collection
            .find(query)
            .sort({ _id: 1 })
            .limit(limit + 1) // Fetch one extra to determine if there's a next page
            .toArray();

        const hasNextPage = results.length > limit;
        const items = results.slice(0, limit).map(doc => {
            const { _id, ...rest } = doc;
            return {
                ...rest,
                id: _id.toString(),
            };
        });

        return {
            items,
            nextCursor: hasNextPage ? results[limit - 1]._id.toString() : null,
        };
    }

    /**
     * Deletes all trigger deployments associated with a specific connected account.
     */
    async deleteByConnectedAccountId(connectedAccountId: string): Promise<number> {
        const result = await this.collection.deleteMany({
            connectedAccountId,
        });

        return result.deletedCount;
    }

    /**
     * Deletes all trigger deployments associated with a specific project.
     */
    async deleteByProjectId(projectId: string): Promise<void> {
        await this.collection.deleteMany({ projectId });
    }
}
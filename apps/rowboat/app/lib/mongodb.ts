import { MongoClient } from "mongodb";
import { TwilioConfig, TwilioInboundCall } from "./types/voice_types";
import { z } from 'zod';
import type { SharedChat, SharedChatMessage } from "./types/rowboat_shared_types";

const client = new MongoClient(process.env["MONGODB_CONNECTION_STRING"] || "mongodb://localhost:27017");

export const db = client.db("rowboat");
export const chatsCollection = db.collection<SharedChat>("chats");
export const chatMessagesCollection = db.collection<SharedChatMessage>("chat_messages");
export const twilioConfigsCollection = db.collection<z.infer<typeof TwilioConfig>>("twilio_configs");
export const twilioInboundCallsCollection = db.collection<z.infer<typeof TwilioInboundCall>>("twilio_inbound_calls");

// Create indexes
// twilioConfigsCollection.createIndexes([
//     {
//         key: { workflow_id: 1, status: 1 },
//         name: "workflow_status_idx",
//         // This ensures only one active config per workflow
//         unique: true,
//         partialFilterExpression: { status: "active" }
//     }
// ]);

import { NextRequest } from "next/server";
import { db } from "../../../../../lib/mongodb";
import { ObjectId } from "mongodb";
import { authCheck } from "../../utils";
import type { SharedChat } from "../../../../../lib/types/rowboat_shared_types";

const chatsCollection = db.collection<SharedChat>("chats");

// get chat
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
    return await authCheck(req, async (session) => {
        const { chatId } = await params;

        // fetch the chat from the database
        let chatIdObj: ObjectId;
        try {
            chatIdObj = new ObjectId(chatId);
        } catch (e) {
            return Response.json({ error: "Invalid chat ID" }, { status: 400 });
        }

        const chat = await chatsCollection.findOne({
            projectId: session.projectId,
            userId: session.userId,
            _id: chatIdObj
        });

        if (!chat) {
            return Response.json({ error: "Chat not found" }, { status: 404 });
        }

        // return the chat
        return Response.json({
            ...chat,
            id: chat._id.toString(),
            _id: undefined,
        });
    });
}

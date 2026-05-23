import type { apiV1 } from "rowboat-shared";

type SharedInfer<T> = T extends { _output: infer Output } ? Output : never;

export type SharedChat = SharedInfer<typeof apiV1.Chat>;
export type SharedChatMessage = SharedInfer<typeof apiV1.ChatMessage>;
export type SharedApiCreateChatResponse = SharedInfer<typeof apiV1.ApiCreateChatResponse>;
export type SharedApiCreateGuestSessionResponse = SharedInfer<typeof apiV1.ApiCreateGuestSessionResponse>;
export type SharedApiGetChatMessagesResponse = SharedInfer<typeof apiV1.ApiGetChatMessagesResponse>;
export type SharedApiGetChatsResponse = SharedInfer<typeof apiV1.ApiGetChatsResponse>;

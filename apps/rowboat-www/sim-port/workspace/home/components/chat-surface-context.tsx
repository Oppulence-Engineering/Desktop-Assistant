"use client";

import { createContext, useContext, type ReactNode } from "react";

const ChatSurfaceContext = createContext<{ chatId: string | null }>({ chatId: null });

export function useChatSurface() {
  return useContext(ChatSurfaceContext);
}

export function ChatSurfaceProvider({ children }: { children: ReactNode }) {
  return <ChatSurfaceContext.Provider value={{ chatId: "landing-preview" }}>{children}</ChatSurfaceContext.Provider>;
}

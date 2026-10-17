// Общее для ленты и треда одного разговора: кто я, что можно, что сейчас правится и подсвечено.
import { createContext, useContext } from "react";
import type { BootDto, ConversationDto } from "@teamchat/shared";
import type { Sources } from "../editor/RichEditor";

export type ChatCtx = {
  boot: BootDto;
  conv: ConversationDto;
  canPost: boolean; // участник и разговор не в архиве
  sources: Sources;
  // Правка идёт в одном месте: в ленте или в треде (родитель треда — тоже «тред»).
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  highlightId: string | null;
  openThread: (parentId: string, focusId?: string) => void;
  onMessageUser?: (userId: string) => void;
};

export type Editing = { id: string; where: "feed" | "thread" };

export const ChatContext = createContext<ChatCtx | null>(null);

export function useChat(): ChatCtx {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat вне ChatContext");
  return ctx;
}

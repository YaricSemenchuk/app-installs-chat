// Разговоры: заголовки, открытие ЛС, вступление и выход — с обновлением boot-кэша.
import { isChannelKind, type BootDto, type ConversationDto } from "@teamchat/shared";
import { api } from "../api/http";
import { displayOf, updateBoot } from "./boot";
import { useMessages } from "./messages";

export function upsertConversation(c: ConversationDto): void {
  updateBoot((b) => ({
    ...b,
    conversations: b.conversations.some((x) => x.id === c.id) ? b.conversations.map((x) => (x.id === c.id ? c : x)) : [...b.conversations, c],
  }));
}

export function removeConversation(id: string): void {
  updateBoot((b) => ({ ...b, conversations: b.conversations.filter((c) => c.id !== id) }));
}

// Собеседники в ЛС (без меня); в ЛС с собой — только я.
export function dmPeople(boot: BootDto, c: ConversationDto) {
  const others = c.memberIds.filter((id) => id !== boot.me.id);
  const ids = others.length > 0 ? others : [boot.me.id];
  return ids.map((id) => boot.users.find((u) => u.id === id)).filter((u) => u !== undefined);
}

export function conversationTitle(boot: BootDto, c: ConversationDto): string {
  if (isChannelKind(c.kind)) return c.name ?? "";
  if (c.kind === "group_dm" && c.name) return c.name;
  return dmPeople(boot, c)
    .map((u) => displayOf(u))
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

export const isSelfDm = (boot: BootDto, c: ConversationDto) => c.kind === "dm" && c.memberIds.length === 1 && c.memberIds[0] === boot.me.id;

export async function openDm(userIds: string[]): Promise<ConversationDto> {
  const c = await api<ConversationDto>("/conversations/dm", { method: "POST", body: { userIds } });
  upsertConversation(c);
  return c;
}

export async function joinChannel(id: string): Promise<ConversationDto> {
  const c = await api<ConversationDto>(`/conversations/${id}/join`, { method: "POST", body: {} });
  upsertConversation(c);
  // Лента, загруженная до вступления, могла отстать: события канала не приходили.
  useMessages.getState().forget(id);
  return c;
}

export async function leaveChannel(id: string): Promise<void> {
  await api(`/conversations/${id}/leave`, { method: "POST", body: {} });
  removeConversation(id);
}

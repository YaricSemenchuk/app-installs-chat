import { QueryClient, useQuery } from "@tanstack/react-query";
import type { BootDto, ConversationDto, UserDto } from "@teamchat/shared";
import { api, isUnauthorized } from "../api/http";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => !isUnauthorized(err) && count < 2, refetchOnWindowFocus: false },
  },
});

export const bootKey = ["boot"] as const;
export const adminUsersKey = ["admin", "users"] as const;
export const invitesKey = ["admin", "invites"] as const;

export function useBoot() {
  return useQuery({ queryKey: bootKey, queryFn: () => api<BootDto>("/boot"), staleTime: Infinity });
}

export function getBoot(): BootDto | undefined {
  return queryClient.getQueryData<BootDto>(bootKey);
}

export function updateBoot(fn: (boot: BootDto) => BootDto): void {
  queryClient.setQueryData<BootDto>(bootKey, (boot) => (boot ? fn(boot) : boot));
}

export function updateConversation(id: string, fn: (c: ConversationDto) => ConversationDto): void {
  updateBoot((b) => ({ ...b, conversations: b.conversations.map((c) => (c.id === id ? fn(c) : c)) }));
}

export function upsertUser(user: UserDto): void {
  updateBoot((b) => ({
    ...b,
    users: b.users.some((u) => u.id === user.id) ? b.users.map((u) => (u.id === user.id ? user : u)) : [...b.users, user],
  }));
}

export function userName(boot: BootDto | undefined, id: string): string {
  const u = boot?.users.find((x) => x.id === id);
  return u ? displayOf(u) : "Неизвестный";
}

// В ленте и сайдбаре — короткое имя, которое человек выбрал; полное — в карточке.
export const displayOf = (u: UserDto) => u.displayName || u.realName;

// presence может не прийти от старого API во время выкатки — не падаем.
export const isOnline = (boot: BootDto | undefined, id: string) => boot?.presence?.[id] === "active";

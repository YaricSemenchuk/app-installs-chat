// Задачи из Jira и превью Figma: серверные данные в кэше запросов. Вкладка канала обновляется сама раз в минуту
// и при возврате в окно; событие TASKS_EVENT (кто-то поменял источники) перечитывает её сразу.
import { useQuery } from "@tanstack/react-query";
import type { ChannelTasksDto, FigmaPreviewDto, IntegrationsDto, JiraIssueDto, JiraProjectDto, MyTasksDto, TaskSourceInput } from "@teamchat/shared";
import { api } from "../api/http";
import { queryClient } from "./boot";

const REFRESH_MS = 60_000;

export const integrationsKey = ["integrations"] as const;
export const channelTasksKey = (conversationId: string) => ["tasks", "channel", conversationId] as const;
export const myTasksKey = ["tasks", "mine"] as const;

// Что подключено на сервере. Не ответил — считаем, что ничего: вкладок просто не будет.
export function useIntegrations(): IntegrationsDto {
  const { data } = useQuery({ queryKey: integrationsKey, queryFn: () => api<IntegrationsDto>("/integrations"), staleTime: Infinity });
  return data ?? { jira: null, figma: false };
}

export function useChannelTasks(conversationId: string) {
  return useQuery({
    queryKey: channelTasksKey(conversationId),
    queryFn: () => api<ChannelTasksDto>(`/conversations/${conversationId}/tasks`),
    staleTime: 20_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useMyTasks(enabled: boolean) {
  return useQuery({
    queryKey: myTasksKey,
    queryFn: () => api<MyTasksDto>("/me/tasks"),
    enabled,
    staleTime: 20_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useJiraProjects(enabled: boolean) {
  return useQuery({ queryKey: ["jira", "projects"], queryFn: () => api<JiraProjectDto[]>("/jira/projects"), enabled, staleTime: 10 * 60_000, retry: false });
}

// Превью макета по ссылке: сервер кэширует его на сутки, здесь — на 10 минут.
export function useFigmaPreview(url: string, enabled = true) {
  return useQuery({
    queryKey: ["figma", "preview", url],
    queryFn: () => api<FigmaPreviewDto>(`/figma/preview?url=${encodeURIComponent(url)}`),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export async function saveTaskSource(conversationId: string, input: TaskSourceInput): Promise<ChannelTasksDto> {
  const dto = await api<ChannelTasksDto>(`/conversations/${conversationId}/tasks/source`, { method: "PUT", body: input });
  queryClient.setQueryData(channelTasksKey(conversationId), dto);
  return dto;
}

export function refreshChannelTasks(conversationId: string): void {
  void queryClient.invalidateQueries({ queryKey: channelTasksKey(conversationId) });
}

export type PriorityGroup = { key: string; priority: JiraIssueDto["priority"]; issues: JiraIssueDto[] };

// Задачи уже идут от самой важной (так сортирует Jira): группы — в порядке первого появления, без приоритета — в конце.
export function groupByPriority(issues: JiraIssueDto[]): PriorityGroup[] {
  const groups = new Map<string, PriorityGroup>();
  for (const issue of issues) {
    const key = issue.priority?.id ?? "none";
    const g = groups.get(key) ?? { key, priority: issue.priority, issues: [] };
    g.issues.push(issue);
    groups.set(key, g);
  }
  const none = groups.get("none");
  groups.delete("none");
  return none ? [...groups.values(), none] : [...groups.values()];
}

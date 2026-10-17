// Вкладка «Задачи» канала и «Мои задачи»: собирает задачи Jira и правки из Figma для человека.
// Видит то же, что служебные аккаунты Jira и Figma; права в чате — как у чтения канала.
import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import {
  TASKS_EVENT,
  figmaFileUrl,
  parseFigmaUrl,
  type ChannelTasksDto,
  type IntegrationsDto,
  type JiraListDto,
  type JiraProjectDto,
  type MyTasksDto,
  type TaskSourceDto,
  type TaskSourceInput,
  type TasksEventDto,
} from "@teamchat/shared";
import { assertMember, isChannel, loadAccess } from "../conversations/access.js";
import { PrismaService } from "../db/prisma.service.js";
import type { channel_task_sources, users } from "../generated/prisma/client.js";
import { RealtimeHub } from "../realtime/hub.service.js";
import { FigmaService } from "./figma.service.js";
import { JiraError, JiraService, stripOrderBy, type ResolvePerson } from "./jira.service.js";

const WARM_CONCURRENCY = 4;

@Injectable()
export class TasksService {
  private readonly log = new Logger("tasks");
  private warming = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: RealtimeHub,
    private readonly jira: JiraService,
    private readonly figma: FigmaService,
  ) {}

  integrations(): IntegrationsDto {
    return { jira: this.jira.site ? { site: this.jira.site } : null, figma: this.figma.enabled };
  }

  async channel(me: users, conversationId: string): Promise<ChannelTasksDto> {
    const access = await loadAccess(this.prisma, me, conversationId);
    if (!isChannel(access.conv)) throw new BadRequestException("Задачи бывают только у каналов");
    const src = await this.prisma.channel_task_sources.findUnique({ where: { conversation_id: conversationId } });
    const files = src?.figma_files ?? [];
    const [source, jira, figma] = await Promise.all([
      this.sourceDto(src),
      src?.jira_jql && this.jira.enabled ? this.list(`(${stripOrderBy(src.jira_jql)}) AND statusCategory != Done`) : null,
      files.length > 0 && this.figma.enabled ? this.figma.openComments(files) : null,
    ]);
    return { source, jira, figma };
  }

  // Привязать канал к JQL и файлам Figma. Менять может любой участник, как тему канала; JQL сразу проверяем в Jira.
  async setSource(me: users, conversationId: string, input: TaskSourceInput): Promise<ChannelTasksDto> {
    const access = await loadAccess(this.prisma, me, conversationId);
    assertMember(access);
    if (!isChannel(access.conv)) throw new BadRequestException("Задачи бывают только у каналов");
    if (access.conv.archived_at) throw new ForbiddenException("Канал в архиве");
    if (input.jql && !this.jira.enabled) throw new BadRequestException("Jira не подключена: серверу нужны JIRA_BASE_URL, JIRA_EMAIL и JIRA_API_TOKEN");
    if (input.figmaFiles.length > 0 && !this.figma.enabled) throw new BadRequestException("Figma не подключена: серверу нужен FIGMA_TOKEN");

    const jql = input.jql ? stripOrderBy(input.jql) : null;
    if (input.jql && !jql) throw new BadRequestException("В JQL только сортировка: добавьте условие, например project = DEV");
    if (jql) {
      try {
        await this.jira.issues(`(${jql}) AND statusCategory != Done`, () => null);
      } catch (err) {
        if (!(err instanceof JiraError)) throw err;
        if (err.kind === "jql") throw new BadRequestException(`Jira не приняла JQL: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
    }
    const keys = [...new Set(input.figmaFiles.map((u) => parseFigmaUrl(u)!.fileKey))];
    for (const fileKey of keys) {
      const preview = await this.figma.preview({ fileKey, nodeId: null });
      if (preview.status === "forbidden") throw new BadRequestException(`Нет доступа к файлу Figma ${figmaFileUrl(fileKey)}: откройте его аккаунту, чей токен у сервера`);
      if (preview.status === "missing") throw new BadRequestException(`Файл Figma не найден: ${figmaFileUrl(fileKey)}`);
    }

    if (!jql && keys.length === 0) {
      await this.prisma.channel_task_sources.deleteMany({ where: { conversation_id: conversationId } });
    } else {
      const data = { jira_jql: jql, figma_files: keys, updated_by: me.id };
      await this.prisma.channel_task_sources.upsert({ where: { conversation_id: conversationId }, create: { conversation_id: conversationId, ...data }, update: data });
    }
    this.hub.toConversation(conversationId, TASKS_EVENT, { conversationId } satisfies TasksEventDto);
    return this.channel(me, conversationId);
  }

  // Открытые задачи, где я исполнитель. Аккаунт Jira ищем по почте из чата.
  async mine(me: users): Promise<MyTasksDto> {
    if (!this.jira.enabled) throw new ServiceUnavailableException("Jira не подключена");
    let account;
    try {
      account = await this.jira.accountFor(me.email);
    } catch (err) {
      if (!(err instanceof JiraError)) throw err;
      return { account: null, jira: { issues: [], truncated: false, error: err.message } };
    }
    if (!account) return { account: null, jira: { issues: [], truncated: false, error: null } };
    const { email: _email, ...person } = account;
    return { account: { ...person, userId: me.id }, jira: await this.list(this.jira.assigneeJql(account.accountId)) };
  }

  async projects(): Promise<JiraProjectDto[]> {
    if (!this.jira.enabled) throw new ServiceUnavailableException("Jira не подключена");
    try {
      return await this.jira.projects();
    } catch (err) {
      if (err instanceof JiraError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }

  async preview(url: string) {
    if (!this.figma.enabled) throw new ServiceUnavailableException("Figma не подключена");
    return this.figma.preview(parseFigmaUrl(url)!);
  }

  private async list(jql: string): Promise<JiraListDto> {
    const resolve = await this.people();
    try {
      const { issues, truncated } = await this.jira.issues(jql, resolve);
      return { issues, truncated, error: null };
    } catch (err) {
      if (!(err instanceof JiraError)) throw err;
      return { issues: [], truncated: false, error: err.kind === "jql" ? `Jira не приняла JQL: ${err.message}` : err.message };
    }
  }

  // Исполнитель → человек в чате. Кого ещё не искали в Jira по почте, ищем в фоне: аватары появятся при следующем обновлении.
  private async people(): Promise<ResolvePerson> {
    const rows = await this.prisma.users.findMany({ where: { deactivated_at: null }, select: { id: true, email: true } });
    const byEmail = new Map(rows.map((u) => [u.email.toLowerCase(), u.id]));
    void this.warm(rows.map((u) => u.email));
    return (_accountId, email) => (email ? (byEmail.get(email) ?? null) : null);
  }

  private async warm(emails: string[]): Promise<void> {
    if (this.warming) return;
    this.warming = true;
    try {
      const queue = [...emails];
      await Promise.all(
        Array.from({ length: WARM_CONCURRENCY }, async () => {
          for (let email = queue.shift(); email; email = queue.shift()) await this.jira.accountFor(email).catch(() => null);
        }),
      );
    } catch (err) {
      this.log.warn(`warm: ${(err as Error).message}`);
    } finally {
      this.warming = false;
    }
  }

  private async sourceDto(src: channel_task_sources | null): Promise<TaskSourceDto> {
    if (!src) return { jql: null, figmaFiles: [], updatedBy: null, updatedAt: null };
    const previews = await this.prisma.figma_previews.findMany({ where: { file_key: { in: src.figma_files }, node_id: "" } });
    const names = new Map(previews.map((p) => [p.file_key, p.file_name || null]));
    return {
      jql: src.jira_jql,
      figmaFiles: src.figma_files.map((fileKey) => ({ fileKey, name: names.get(fileKey) ?? null, url: figmaFileUrl(fileKey) })),
      updatedBy: src.updated_by,
      updatedAt: src.updated_at.toISOString(),
    };
  }
}


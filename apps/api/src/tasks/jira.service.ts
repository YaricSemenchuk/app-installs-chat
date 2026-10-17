// Jira Cloud через REST API v3 одним служебным токеном (Basic: почта + API-токен). Только чтение.
// Задачи в базе не храним: JQL-поиск с кэшем на полминуты, одинаковые запросы в это время ждут один ответ.
// Порядок задач задаёт сама Jira (ORDER BY priority DESC), уровень приоритета здесь нужен только для значка.
import { Injectable, Logger } from "@nestjs/common";
import {
  JIRA_ISSUES_MAX,
  parseFigmaUrl,
  type FigmaRefDto,
  type JiraIssueDto,
  type JiraPersonDto,
  type JiraProjectDto,
  type PriorityLevel,
  type StatusCategory,
} from "@teamchat/shared";
import { config } from "../config.js";

const PAGE_SIZE = 100;
const TIMEOUT_MS = 15_000;
const SEARCH_TTL_MS = 30_000;
const PROJECTS_TTL_MS = 10 * 60_000;
const ACCOUNT_TTL_MS = 60 * 60_000;
const ACCOUNT_MISS_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
const FIGMA_PER_ISSUE = 5;
const FIELDS = ["summary", "status", "priority", "assignee", "issuetype", "duedate", "updated", "description"];
const ACCOUNT_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
const FIGMA_TEXT_RE = /https:\/\/(?:www\.)?figma\.com\/[^\s<>"'`)\]]+/g;

// jql — Jira не приняла запрос (текст ошибки — от неё); auth — токен не подходит; unavailable — сеть, 429, 5xx.
export class JiraError extends Error {
  constructor(
    readonly kind: "jql" | "auth" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

type RawUser = {
  accountId: string;
  accountType?: string;
  active?: boolean;
  displayName?: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
};

type RawIssue = {
  key: string;
  fields: {
    summary?: string;
    status?: { name: string; statusCategory?: { key?: string } };
    priority?: { id: string; name: string; iconUrl?: string } | null;
    assignee?: RawUser | null;
    issuetype?: { name: string } | null;
    duedate?: string | null;
    updated?: string;
    description?: unknown;
  };
};

// Кто в чате стоит за аккаунтом Jira: по почте, если Jira её отдаёт, иначе по прошлым поискам по почте.
export type ResolvePerson = (accountId: string, email: string | undefined) => string | null;

// Стандартные схемы приоритетов: имя файла значка или название (в том числе в русском интерфейсе Jira).
const PRIORITY_LEVEL: Record<string, PriorityLevel> = {
  highest: 1,
  blocker: 1,
  critical: 1,
  наивысший: 1,
  блокирующий: 1,
  критический: 1,
  high: 2,
  major: 2,
  высокий: 2,
  серьезный: 2,
  серьёзный: 2,
  medium: 3,
  normal: 3,
  средний: 3,
  нормальный: 3,
  low: 4,
  minor: 4,
  низкий: 4,
  незначительный: 4,
  lowest: 5,
  trivial: 5,
  "самый низкий": 5,
  тривиальный: 5,
};

function priorityLevel(p: { name: string; iconUrl?: string }): PriorityLevel {
  const icon = p.iconUrl?.match(/\/priorities\/([a-z]+)\.(?:svg|png)/i)?.[1]?.toLowerCase();
  return (icon && PRIORITY_LEVEL[icon]) || PRIORITY_LEVEL[p.name.trim().toLowerCase()] || 3;
}

const CATEGORIES = new Set<StatusCategory>(["new", "indeterminate", "done"]);
const statusCategory = (key: string | undefined): StatusCategory => (CATEGORIES.has(key as StatusCategory) ? (key as StatusCategory) : "indeterminate");

// Ссылки на макеты в описании задачи (ADF): ссылки-метки, карточки ссылок и просто адреса в тексте.
export function figmaLinks(description: unknown): FigmaRefDto[] {
  const found = new Map<string, FigmaRefDto>();
  const add = (url: string) => {
    const ref = parseFigmaUrl(url);
    const key = ref && `${ref.fileKey}:${ref.nodeId ?? ""}`;
    if (ref && key && !found.has(key) && found.size < FIGMA_PER_ISSUE) found.set(key, ref);
  };
  const walk = (node: unknown, depth: number) => {
    if (typeof node === "string") return void node.match(FIGMA_TEXT_RE)?.forEach(add);
    if (!node || typeof node !== "object" || depth > 64) return;
    const n = node as {
      text?: unknown;
      attrs?: { url?: unknown; href?: unknown };
      marks?: { type?: string; attrs?: { href?: unknown } }[];
      content?: unknown;
    };
    if (typeof n.attrs?.url === "string") add(n.attrs.url);
    if (Array.isArray(n.marks)) for (const m of n.marks) if (m?.type === "link" && typeof m.attrs?.href === "string") add(m.attrs.href);
    if (typeof n.text === "string") walk(n.text, depth);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c, depth + 1);
  };
  walk(description, 0);
  return [...found.values()];
}

// Свой ORDER BY и «только открытые» ставит сервер, поэтому сортировку из JQL канала убираем.
export const stripOrderBy = (jql: string) => jql.replace(/\border\s+by\b[\s\S]*$/i, "").trim();

@Injectable()
export class JiraService {
  private readonly log = new Logger("jira");
  private readonly auth = config.JIRA_EMAIL && config.JIRA_API_TOKEN ? `Basic ${Buffer.from(`${config.JIRA_EMAIL}:${config.JIRA_API_TOKEN}`).toString("base64")}` : null;
  private readonly cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
  // accountId → почта, под которой его нашли: так у исполнителя появляется аватар из чата, даже если Jira прячет почту.
  private readonly emailByAccount = new Map<string, string>();

  get enabled(): boolean {
    return this.auth !== null && config.JIRA_BASE_URL !== undefined;
  }

  get site(): string | null {
    return this.enabled ? config.JIRA_BASE_URL! : null;
  }

  knownEmail(accountId: string): string | undefined {
    return this.emailByAccount.get(accountId);
  }

  // Задачи по JQL, не больше JIRA_ISSUES_MAX. В jql уже нет ORDER BY (см. stripOrderBy).
  async issues(jql: string, resolve: ResolvePerson): Promise<{ issues: JiraIssueDto[]; truncated: boolean }> {
    const raw = await this.cached(`search:${jql}`, SEARCH_TTL_MS, () => this.searchAll(`${jql} ORDER BY priority DESC, updated DESC`));
    return { issues: raw.issues.map((i) => this.toIssue(i, resolve)), truncated: raw.truncated };
  }

  // Аккаунт Jira с этой почтой. Поиск по полной почте находит только её владельца, даже когда Jira прячет адрес в ответе.
  async accountFor(email: string): Promise<(Omit<JiraPersonDto, "userId"> & { email: string }) | null> {
    const key = `account:${email.toLowerCase()}`;
    const found = await this.cached(
      key,
      ACCOUNT_TTL_MS,
      async () => {
        const users = await this.request<RawUser[]>(`/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=10`);
        const people = users.filter((u) => u.accountType === "atlassian" && u.active !== false && ACCOUNT_ID_RE.test(u.accountId));
        const exact = people.filter((u) => u.emailAddress?.toLowerCase() === email.toLowerCase());
        const user = exact[0] ?? (people.length === 1 && !people[0]!.emailAddress ? people[0] : undefined);
        if (!user) return null;
        this.emailByAccount.set(user.accountId, email.toLowerCase());
        return { ...this.person(user), email: email.toLowerCase() };
      },
      (v) => (v === null ? ACCOUNT_MISS_TTL_MS : ACCOUNT_TTL_MS),
    );
    if (found) this.emailByAccount.set(found.accountId, found.email);
    return found;
  }

  // Что запросить для «Моих задач». accountId вставляется в JQL, поэтому проверяем его формат.
  assigneeJql(accountId: string): string {
    if (!ACCOUNT_ID_RE.test(accountId)) throw new JiraError("jql", "Некорректный аккаунт Jira");
    return `assignee = "${accountId}" AND statusCategory != Done`;
  }

  projects(): Promise<JiraProjectDto[]> {
    return this.cached("projects", PROJECTS_TTL_MS, async () => {
      const page = await this.request<{ values: { key: string; name: string; avatarUrls?: Record<string, string> }[] }>(
        "/rest/api/3/project/search?maxResults=100&orderBy=name",
      );
      return page.values.map((p) => ({ key: p.key, name: p.name, avatarUrl: p.avatarUrls?.["48x48"] ?? null }));
    });
  }

  private async searchAll(jql: string): Promise<{ issues: RawIssue[]; truncated: boolean }> {
    const issues: RawIssue[] = [];
    let nextPageToken: string | undefined;
    for (;;) {
      const page = await this.request<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>("/rest/api/3/search/jql", {
        method: "POST",
        body: { jql, fields: FIELDS, maxResults: Math.min(PAGE_SIZE, JIRA_ISSUES_MAX - issues.length), ...(nextPageToken ? { nextPageToken } : {}) },
      });
      issues.push(...page.issues);
      const more = Boolean(page.nextPageToken) && page.isLast !== true;
      if (!more) return { issues, truncated: false };
      if (issues.length >= JIRA_ISSUES_MAX) return { issues: issues.slice(0, JIRA_ISSUES_MAX), truncated: true };
      nextPageToken = page.nextPageToken;
    }
  }

  private person(u: RawUser): Omit<JiraPersonDto, "userId"> {
    return { accountId: u.accountId, name: u.displayName ?? "Без имени", avatarUrl: u.avatarUrls?.["48x48"] ?? null };
  }

  private toIssue(i: RawIssue, resolve: ResolvePerson): JiraIssueDto {
    const f = i.fields;
    const a = f.assignee;
    return {
      key: i.key,
      url: `${config.JIRA_BASE_URL}/browse/${encodeURIComponent(i.key)}`,
      summary: f.summary ?? "",
      type: f.issuetype?.name ?? "",
      status: { name: f.status?.name ?? "—", category: statusCategory(f.status?.statusCategory?.key) },
      priority: f.priority ? { id: f.priority.id, name: f.priority.name, level: priorityLevel(f.priority) } : null,
      assignee: a ? { ...this.person(a), userId: resolve(a.accountId, a.emailAddress?.toLowerCase() ?? this.knownEmail(a.accountId)) } : null,
      dueDate: f.duedate ?? null,
      updatedAt: f.updated ? new Date(f.updated).toISOString() : new Date(0).toISOString(),
      figma: figmaLinks(f.description),
    };
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.enabled) throw new JiraError("unavailable", "Jira не подключена");
    const method = init.method ?? "GET";
    let res: Response;
    try {
      res = await fetch(`${config.JIRA_BASE_URL}${path}`, {
        method,
        headers: {
          authorization: this.auth!,
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.log.warn(`${method} ${path.split("?")[0]}: ${(err as Error).message}`);
      throw new JiraError("unavailable", "Jira не отвечает, попробуйте позже");
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null;
    const detail = [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].join(" ").slice(0, 500);
    if (res.status === 400) throw new JiraError("jql", detail || "Jira не приняла запрос");
    if (res.status === 401) throw new JiraError("auth", "Jira не принимает служебный токен: проверьте JIRA_EMAIL и JIRA_API_TOKEN");
    if (res.status === 403) throw new JiraError("auth", "У служебного аккаунта нет доступа к Jira");
    if (res.status === 429) throw new JiraError("unavailable", "Jira просит подождать: слишком много запросов");
    // Адрес без query: в поиске людей там почта.
    this.log.warn(`${method} ${path.split("?")[0]}: ${res.status} ${detail}`);
    throw new JiraError("unavailable", "Jira не отвечает, попробуйте позже");
  }

  // Ошибки не кэшируем: следующий запрос спросит Jira снова.
  private cached<T>(key: string, ttl: number, load: () => Promise<T>, ttlOf?: (v: T) => number): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < hit.ttl) return hit.value as Promise<T>;
    if (this.cache.size >= CACHE_MAX) {
      for (const [k, v] of this.cache) if (now - v.at >= v.ttl) this.cache.delete(k);
    }
    const value = load();
    const entry = { at: now, ttl, value: value as Promise<unknown> };
    this.cache.set(key, entry);
    value.then(
      (v) => {
        if (ttlOf) entry.ttl = ttlOf(v);
      },
      () => {
        if (this.cache.get(key) === entry) this.cache.delete(key);
      },
    );
    return value;
  }
}

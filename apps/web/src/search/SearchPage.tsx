// S26 — результаты поиска: сообщения (с фильтрами «где» и «от кого»), файлы, люди, каналы.
// Запрос и фильтры живут в адресе: /search?q=…&tab=…&in=<разговор>&from=<человек>.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Hash, Lock, MessageSquareText, Paperclip, Search, SearchX, Users, X } from "lucide-react";
import {
  isChannelKind,
  matchRank,
  type BootDto,
  type ConversationDto,
  type DirectoryChannelDto,
  type FilesPageDto,
  type SearchHitDto,
  type SearchPageDto,
} from "@teamchat/shared";
import { api } from "../api/http";
import { Markup } from "../chat/Markup";
import { displayOf, isOnline, useBoot, userName } from "../data/boot";
import { conversationTitle, openDm } from "../data/conversations";
import { FileTile } from "../files/Attachments";
import { dayLabel, formatTime } from "../lib/format";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Menu, type MenuEntry } from "../ui/Menu";
import { Tabs } from "../ui/Tabs";
import { TextField } from "../ui/TextField";
import { rememberSearch } from "./recent";
import ps from "../channels/channels.module.scss";
import s from "./search.module.scss";

type Tab = "messages" | "files" | "people" | "channels";

export function SearchPage() {
  const boot = useBoot().data;
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const tab = (params.get("tab") as Tab | null) ?? "messages";
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  if (!boot) return null;
  return (
    <div className={ps.page}>
      <form
        className={s.bar}
        onSubmit={(e) => {
          e.preventDefault();
          rememberSearch(draft);
          set({ q: draft.trim() });
        }}
      >
        <TextField
          label="Поиск по чату"
          hideLabel
          icon={<Search />}
          placeholder="Слова из сообщений, «точная фраза», -лишнее"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus={!q}
        />
        <Button type="submit">Найти</Button>
      </form>
      <Tabs
        label="Что искать"
        value={tab}
        onValueChange={(v) => set({ tab: v === "messages" ? null : v })}
        items={[
          { value: "messages", label: "Сообщения" },
          { value: "files", label: "Файлы" },
          { value: "people", label: "Люди" },
          { value: "channels", label: "Каналы" },
        ]}
      />
      <div className={s.results}>
        {!q ? (
          <EmptyState icon={<Search />} title="Что ищем?" text="Слова находятся в любой форме: «релиз» найдёт и «релизы». «Фраза в кавычках» — точно, -слово — исключить" />
        ) : tab === "messages" ? (
          <Messages boot={boot} q={q} inConv={params.get("in")} from={params.get("from")} set={set} />
        ) : tab === "files" ? (
          <Files q={q} />
        ) : tab === "people" ? (
          <People boot={boot} q={q} />
        ) : (
          <Channels boot={boot} q={q} />
        )}
      </div>
    </div>
  );
}

function Messages({
  boot,
  q,
  inConv,
  from,
  set,
}: {
  boot: BootDto;
  q: string;
  inConv: string | null;
  from: string | null;
  set: (p: Record<string, string | null>) => void;
}) {
  const pages = useInfiniteQuery({
    queryKey: ["search", q, inConv, from],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ q, limit: "20" });
      if (inConv) qs.set("conversationId", inConv);
      if (from) qs.set("userId", from);
      if (pageParam) qs.set("before", String(pageParam));
      return api<SearchPageDto>(`/search/messages?${qs}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const hits = pages.data?.pages.flatMap((p) => p.hits) ?? [];

  const convItems: MenuEntry[] = [
    { kind: "item", label: "Во всех разговорах", onSelect: () => set({ in: null }) },
    { kind: "separator" },
    ...[...boot.conversations]
      .sort((a, b) => conversationTitle(boot, a).localeCompare(conversationTitle(boot, b)))
      .map((c): MenuEntry => ({
        kind: "item",
        label: c.name ? `#${c.name}` : conversationTitle(boot, c),
        onSelect: () => set({ in: c.id }),
      })),
  ];
  const peopleItems: MenuEntry[] = [
    { kind: "item", label: "От всех", onSelect: () => set({ from: null }) },
    { kind: "separator" },
    ...boot.users
      .filter((u) => !u.deactivated)
      .sort((a, b) => displayOf(a).localeCompare(displayOf(b)))
      .map((u): MenuEntry => ({ kind: "item", label: u.id === boot.me.id ? `${displayOf(u)} (вы)` : displayOf(u), onSelect: () => set({ from: u.id }) })),
  ];
  const convLabel = inConv ? <ConversationLabel boot={boot} id={inConv} /> : "Во всех разговорах";
  const fromLabel = from ? userName(boot, from) : "От всех";

  return (
    <>
      <div className={s.filters}>
        <Filter label={convLabel} active={!!inConv} items={convItems} onClear={() => set({ in: null })} />
        <Filter label={fromLabel} active={!!from} items={peopleItems} onClear={() => set({ from: null })} />
      </div>
      {pages.isPending ? (
        <Skeletons />
      ) : pages.isError ? (
        <EmptyState icon={<SearchX />} title="Поиск не сработал" text={pages.error.message} action={{ label: "Повторить", onClick: () => void pages.refetch() }} />
      ) : hits.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={`По запросу «${q}» ничего нет`}
          text={inConv || from ? "Попробуйте убрать фильтры" : "Проверьте написание или поищите другими словами"}
        />
      ) : (
        <ul className={s.hits}>
          {hits.map((h) => (
            <Hit key={h.message.id} hit={h} boot={boot} />
          ))}
        </ul>
      )}
      {pages.hasNextPage && (
        <div className={s.more}>
          <Button variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
    </>
  );
}

function Filter({ label, active, items, onClear }: { label: ReactNode; active: boolean; items: MenuEntry[]; onClear: () => void }) {
  return (
    <span className={s.filter}>
      <Menu
        align="start"
        items={items}
        trigger={
          <button type="button" className={active ? `${s.filterButton} ${s.filterActive}` : s.filterButton}>
            {label}
            <ChevronDown />
          </button>
        }
      />
      {active && (
        <button type="button" className={s.filterClear} aria-label="Сбросить фильтр" onClick={onClear}>
          <X />
        </button>
      )}
    </span>
  );
}

// Название разговора: свой — из boot, открытый чужой канал — запросом.
function ConversationLabel({ boot, id }: { boot: BootDto; id: string }) {
  const known = boot.conversations.find((c) => c.id === id);
  const fetched = useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<ConversationDto>(`/conversations/${id}`),
    enabled: !known,
    retry: false,
    staleTime: Infinity,
  });
  const c = known ?? fetched.data;
  if (!c) return <>…</>;
  return <>{c.name ? `#${c.name}` : conversationTitle(boot, c)}</>;
}

function Hit({ hit, boot }: { hit: SearchHitDto; boot: BootDto }) {
  const navigate = useNavigate();
  const m = hit.message;
  const open = () => navigate(`/c/${m.conversationId}?m=${m.id}`);
  return (
    <li>
      <div
        className={s.hit}
        role="link"
        tabIndex={0}
        aria-label={`Открыть сообщение от ${userName(boot, m.userId)}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) return; // ссылки внутри сообщения работают сами
          open();
        }}
        onKeyDown={(e) => e.key === "Enter" && open()}
      >
        <div className={s.hitMeta}>
          <span className={s.hitWhere}>
            <ConversationLabel boot={boot} id={m.conversationId} />
          </span>
          {m.parentId && (
            <span className={s.hitThread}>
              <MessageSquareText />в треде
            </span>
          )}
          <span>· {dayLabel(m.createdAt).toLowerCase()} в {formatTime(m.createdAt)}</span>
        </div>
        <div className={s.hitBody}>
          <Avatar name={userName(boot, m.userId)} id={m.userId} size="m" decorative />
          <div className={s.hitText}>
            <span className={s.hitAuthor}>{userName(boot, m.userId)}</span>
            {m.text.trim() && <Markup text={m.text} boot={boot} mentionsMe={false} highlight={hit.highlights} />}
            {m.files.length > 0 && (
              <span className={s.hitFiles}>
                <Paperclip />
                {m.files.map((f) => f.name).join(", ")}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Files({ q }: { q: string }) {
  const pages = useInfiniteQuery({
    queryKey: ["files", "all", q, false],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ query: q, limit: "50" });
      if (pageParam) qs.set("before", pageParam);
      return api<FilesPageDto>(`/files?${qs}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const navigate = useNavigate();
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  if (pages.isPending) return <Skeletons />;
  if (items.length === 0) return <EmptyState icon={<SearchX />} title={`Файлов с «${q}» в имени нет`} text="Поиск по файлам идёт по имени файла" />;
  return (
    <ul className={s.fileHits}>
      {items.map((it) => (
        <li key={`${it.messageId}:${it.file.id}`} className={s.fileHit}>
          <FileTile file={it.file} />
          <Button variant="ghost" size="s" onClick={() => navigate(`/c/${it.conversationId}?m=${it.messageId}`)}>
            К сообщению
          </Button>
        </li>
      ))}
    </ul>
  );
}

function People({ boot, q }: { boot: BootDto; q: string }) {
  const navigate = useNavigate();
  const people = boot.users.filter((u) => !u.deactivated && [displayOf(u), u.realName, u.email, u.title].some((v) => v && matchRank(v, q) >= 0));
  if (people.length === 0) return <EmptyState icon={<Users />} title={`Никого по запросу «${q}»`} text="Ищем по имени, полному имени, должности и почте" />;
  return (
    <ul className={ps.dirList}>
      {people.map((u) => (
        <li key={u.id} className={ps.dirRow}>
          <Avatar name={displayOf(u)} id={u.id} size="l" presence={isOnline(boot, u.id) ? "active" : "away"} decorative />
          <div className={ps.dirText}>
            <span className={ps.dirName}>{displayOf(u)}</span>
            <span className={ps.dirMeta}>{[u.realName !== displayOf(u) ? u.realName : "", u.title].filter(Boolean).join(" · ") || u.email}</span>
          </div>
          <Button variant="secondary" size="s" onClick={() => void openDm([u.id]).then((c) => navigate(`/c/${c.id}`))}>
            Написать
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Channels({ boot, q }: { boot: BootDto; q: string }) {
  const navigate = useNavigate();
  const directory = useQuery({ queryKey: ["directory", ""], queryFn: () => api<DirectoryChannelDto[]>("/conversations/browse"), staleTime: 60_000 });
  const all = new Map<string, { id: string; name: string; purpose: string; private: boolean; member: boolean }>();
  for (const c of boot.conversations.filter((x) => isChannelKind(x.kind))) all.set(c.id, { id: c.id, name: c.name ?? "", purpose: c.purpose, private: c.kind === "private", member: true });
  for (const c of directory.data ?? []) if (!all.has(c.id)) all.set(c.id, { id: c.id, name: c.name ?? "", purpose: c.purpose, private: false, member: c.isMember });
  const found = [...all.values()].filter((c) => matchRank(c.name, q) >= 0 || (c.purpose && matchRank(c.purpose, q) >= 0));
  if (found.length === 0) return <EmptyState icon={<Hash />} title={`Каналов по запросу «${q}» нет`} text="Ищем по названию и описанию" />;
  return (
    <ul className={ps.dirList}>
      {found.map((c) => (
        <li key={c.id} className={ps.dirRow}>
          <div className={ps.dirText}>
            <span className={ps.dirName}>
              {c.private ? <Lock /> : <Hash />}
              {c.name}
            </span>
            {c.purpose && <span className={ps.dirMeta}>{c.purpose}</span>}
          </div>
          <Button variant={c.member ? "ghost" : "secondary"} size="s" onClick={() => navigate(`/c/${c.id}`)}>
            {c.member ? "Открыть" : "Заглянуть"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Skeletons() {
  return (
    <div className={s.skeletons}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} width="100%" height={72} />
      ))}
    </div>
  );
}

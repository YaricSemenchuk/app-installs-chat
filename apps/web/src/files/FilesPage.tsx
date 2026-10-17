// S28 — все файлы из моих разговоров: тип, поиск по имени, «только мои», подгрузка страницами.
import { useDeferredValue, useState } from "react";
import { useNavigate } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Ellipsis, ExternalLink, FileStack, Search, Trash2 } from "lucide-react";
import { isAdminRole, type FilesPageDto, type SharedFileDto } from "@teamchat/shared";
import { api } from "../api/http";
import { queryClient, useBoot, userName } from "../data/boot";
import { dayLabel, formatTime } from "../lib/format";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { Tabs } from "../ui/Tabs";
import { TextField } from "../ui/TextField";
import { Checkbox } from "../ui/Toggle";
import { toast } from "../ui/Toaster";
import { isPreviewable } from "./Attachments";
import { fileKind, fileUrls, formatBytes } from "./kind";
import { Lightbox } from "./Lightbox";
import ps from "../channels/channels.module.scss";
import s from "./FilesPage.module.scss";

type Type = "all" | "images" | "documents";

export const filesKey = ["files"] as const;

export function FilesPage() {
  const boot = useBoot().data;
  const navigate = useNavigate();
  const [type, setType] = useState<Type>("all");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [viewing, setViewing] = useState<SharedFileDto | null>(null);
  const deferred = useDeferredValue(query.trim());

  const pages = useInfiniteQuery({
    queryKey: [...filesKey, type, deferred, mine],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ type, mine: String(mine), limit: "50" });
      if (deferred) qs.set("query", deferred);
      if (pageParam) qs.set("before", pageParam);
      return api<FilesPageDto>(`/files?${qs}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (!boot) return null;
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const where = (id: string) => {
    const c = boot.conversations.find((x) => x.id === id);
    if (!c) return "разговор";
    return c.name ? `#${c.name}` : "личная переписка";
  };

  async function remove(item: SharedFileDto) {
    try {
      await api(`/files/${item.file.id}`, { method: "DELETE" });
      toast("Файл удалён");
      void queryClient.invalidateQueries({ queryKey: filesKey });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className={ps.page}>
      <header className={ps.pageHeader}>
        <h1 className={ps.pageTitle}>Файлы</h1>
      </header>
      <div className={s.filters}>
        <Tabs
          label="Тип файлов"
          value={type}
          onValueChange={(v) => setType(v as Type)}
          variant="pills"
          items={[
            { value: "all", label: "Все" },
            { value: "images", label: "Картинки" },
            { value: "documents", label: "Документы и прочее" },
          ]}
        />
        <div className={s.search}>
          <TextField label="Найти файл" hideLabel size="s" icon={<Search />} placeholder="Имя файла" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Checkbox label="Только мои" checked={mine} onCheckedChange={setMine} />
      </div>

      {pages.isPending ? (
        <div className={s.skeletons}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={56} />
          ))}
        </div>
      ) : pages.isError ? (
        <EmptyState icon={<FileStack />} title="Список не загрузился" text={pages.error.message} action={{ label: "Повторить", onClick: () => void pages.refetch() }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title={deferred ? `Файлов по запросу «${deferred}» нет` : mine ? "Вы ещё ничего не выкладывали" : "Файлов пока нет"}
          text="Здесь собираются файлы из всех ваших каналов и переписок. Прикрепите файл скрепкой или перетащите его в разговор"
        />
      ) : (
        <ul className={s.list}>
          {items.map((it) => {
            const f = it.file;
            const k = fileKind(f);
            const Icon = k.icon;
            const canDelete = f.uploaderId === boot.me.id || isAdminRole(boot.me.role);
            const open = () => (isPreviewable(f) ? setViewing(it) : (window.location.href = fileUrls(f.id).download));
            return (
              <li key={`${it.messageId}:${f.id}`} className={s.row}>
                <button type="button" className={s.preview} onClick={open} aria-label={isPreviewable(f) ? `Открыть ${f.name}` : `Скачать ${f.name}`}>
                  {isPreviewable(f) ? (
                    <img src={fileUrls(f.id).thumb(360)} alt="" loading="lazy" />
                  ) : (
                    <span className={s.icon} style={{ background: `var(--color-avatar-${k.tone})` }}>
                      <Icon />
                    </span>
                  )}
                </button>
                <div className={s.text}>
                  <button type="button" className={s.name} onClick={open} title={f.name}>
                    {f.name}
                  </button>
                  <span className={s.meta}>
                    {userName(boot, it.userId)} в {where(it.conversationId)} · {dayLabel(it.sharedAt).toLowerCase()} в {formatTime(it.sharedAt)} ·{" "}
                    {k.label} · {formatBytes(f.size)}
                  </span>
                </div>
                <IconButton label="Открыть в разговоре" size="s" onClick={() => navigate(`/c/${it.conversationId}?m=${it.messageId}`)}>
                  <ExternalLink />
                </IconButton>
                <Menu
                  trigger={
                    <IconButton label="Ещё" size="s">
                      <Ellipsis />
                    </IconButton>
                  }
                  items={[
                    { kind: "item", label: "Скачать", onSelect: () => (window.location.href = fileUrls(f.id).download) },
                    ...(canDelete
                      ? [{ kind: "separator" as const }, { kind: "item" as const, label: "Удалить файл", icon: <Trash2 />, danger: true, onSelect: () => void remove(it) }]
                      : []),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
      {pages.hasNextPage && (
        <div className={s.more}>
          <Button variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
      {viewing && (
        <Lightbox
          images={[viewing.file]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setViewing(null)}
          author={userName(boot, viewing.userId)}
          time={`${dayLabel(viewing.sharedAt).toLowerCase()} в ${formatTime(viewing.sharedAt)}`}
        />
      )}
    </div>
  );
}

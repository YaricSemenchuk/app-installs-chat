// Вкладка «Задачи» канала справа (вместо треда): открытые задачи Jira по приоритету и правки из комментариев Figma.
import { useState } from "react";
import { ListTodo, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import type { BootDto, ConversationDto } from "@teamchat/shared";
import { userName } from "../data/boot";
import { useChannelTasks, useIntegrations } from "../data/tasks";
import { dayLabel } from "../lib/format";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Tabs } from "../ui/Tabs";
import { FigmaCommentRow, InlineError, PriorityGroups } from "./parts";
import { TaskSourceDialog } from "./TaskSourceDialog";
import ps from "../chat/ThreadPanel.module.scss";
import s from "./tasks.module.scss";

type Who = "all" | "mine";

export function TasksPanel({ boot, conv, onClose }: { boot: BootDto; conv: ConversationDto; onClose: () => void }) {
  const tasks = useChannelTasks(conv.id);
  const integrations = useIntegrations();
  const [who, setWho] = useState<Who>("all");
  const [editing, setEditing] = useState(false);
  const canEdit = conv.isMember && !conv.archived;
  const data = tasks.data;
  const source = data?.source;
  const empty = data && !data.jira && !data.figma;

  const issues = data?.jira?.issues ?? [];
  const mine = issues.filter((i) => i.assignee?.userId === boot.me.id);
  const shown = who === "mine" ? mine : issues;
  const jiraSearch = integrations.jira && source?.jql ? `${integrations.jira.site}/issues/?jql=${encodeURIComponent(source.jql)}` : null;

  return (
    <aside
      className={ps.panel}
      aria-label="Задачи канала"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) onClose();
      }}
    >
      <header className={ps.header}>
        <div className={ps.titles}>
          <h2 className={ps.title}>Задачи</h2>
          <span className={ps.caption}>#{conv.name}</span>
        </div>
        {data && !empty && (
          <IconButton label="Обновить" size="s" onClick={() => void tasks.refetch()} disabled={tasks.isFetching}>
            <RefreshCw />
          </IconButton>
        )}
        {canEdit && data && !empty && (
          <IconButton label="Откуда брать задачи" size="s" onClick={() => setEditing(true)}>
            <SlidersHorizontal />
          </IconButton>
        )}
        <IconButton label="Закрыть" shortcut="Esc" size="s" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className={ps.body}>
        {tasks.isPending && (
          <div className={s.skeleton} aria-busy="true">
            <Skeleton width={120} height={12} />
            <Skeleton width="90%" height={14} />
            <Skeleton width="70%" height={14} />
            <Skeleton width="80%" height={14} />
          </div>
        )}
        {tasks.isError && (
          <EmptyState icon={<ListTodo />} title="Задачи не загрузились" text={tasks.error.message} action={{ label: "Повторить", onClick: () => void tasks.refetch() }} />
        )}
        {empty && (
          <EmptyState
            icon={<ListTodo />}
            title="К каналу не привязаны задачи"
            text={
              canEdit
                ? `Укажите проект Jira — здесь появятся его открытые задачи по приоритету.${integrations.figma ? " Файлы Figma добавят правки из комментариев к макетам" : ""}`
                : `Привязать ${integrations.figma ? "проект Jira или файлы Figma" : "проект Jira"} может любой участник канала`
            }
            action={canEdit ? { label: "Привязать", onClick: () => setEditing(true) } : undefined}
          />
        )}

        {data?.jira && (
          <section className={s.section} aria-label="Задачи Jira">
            <div className={s.toolbar}>
              <Tabs
                label="Чьи задачи"
                variant="pills"
                value={who}
                onValueChange={(v) => setWho(v as Who)}
                items={[
                  { value: "all", label: "Все", count: issues.length },
                  { value: "mine", label: "Мои", count: mine.length },
                ]}
              />
            </div>
            {data.jira.error && <InlineError text={data.jira.error} />}
            {!data.jira.error && shown.length === 0 && (
              <p className={s.sectionNote}>{who === "mine" ? "На вас здесь нет открытых задач" : "Открытых задач нет"}</p>
            )}
            <PriorityGroups boot={boot} issues={shown} />
            {data.jira.truncated && <p className={s.sectionNote}>Показаны первые {issues.length} задач. Уточните JQL, чтобы видеть все</p>}
          </section>
        )}

        {data?.figma && (
          <section className={s.section} aria-label="Правки в макетах">
            <h3 className={s.sectionTitle}>
              Правки в макетах
              <span className={s.count}>{data.figma.comments.length}</span>
            </h3>
            {data.figma.error && <InlineError text={data.figma.error} />}
            {!data.figma.error && data.figma.comments.length === 0 && <p className={s.sectionNote}>Нерешённых комментариев в файлах нет</p>}
            <ul className={s.comments}>
              {data.figma.comments.map((c) => (
                <FigmaCommentRow key={`${c.fileKey}:${c.id}`} comment={c} />
              ))}
            </ul>
          </section>
        )}

        {source && !empty && (
          <footer className={s.source}>
            {source.jql && <code title={source.jql}>{source.jql}</code>}
            {source.figmaFiles.length > 0 && (
              <span>
                Figma: {source.figmaFiles.map((f) => f.name ?? f.fileKey).join(", ")}
              </span>
            )}
            {source.updatedBy && source.updatedAt && (
              <span>
                · {userName(boot, source.updatedBy)}, {dayLabel(source.updatedAt).toLowerCase()}
              </span>
            )}
            {jiraSearch && (
              <a href={jiraSearch} target="_blank" rel="noreferrer">
                Открыть в Jira
              </a>
            )}
          </footer>
        )}
      </div>

      <TaskSourceDialog conversationId={conv.id} channelName={conv.name ?? ""} current={source} open={editing} onOpenChange={setEditing} />
    </aside>
  );
}

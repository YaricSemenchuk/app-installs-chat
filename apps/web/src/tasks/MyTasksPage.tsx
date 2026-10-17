// «Мои задачи»: открытые задачи Jira, где я исполнитель, от самой важной; фильтр по статусу.
import { useState } from "react";
import { ListChecks } from "lucide-react";
import type { StatusCategory } from "@teamchat/shared";
import { useBoot } from "../data/boot";
import { useIntegrations, useMyTasks } from "../data/tasks";
import { Avatar } from "../ui/Avatar";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Tabs } from "../ui/Tabs";
import { InlineError, PriorityGroups } from "./parts";
import ps from "../channels/channels.module.scss";
import s from "./tasks.module.scss";

type Filter = "all" | Exclude<StatusCategory, "done">;

export function MyTasksPage() {
  const boot = useBoot().data;
  const integrations = useIntegrations();
  const tasks = useMyTasks(integrations.jira !== null);
  const [filter, setFilter] = useState<Filter>("all");
  if (!boot) return null;

  const data = tasks.data;
  const issues = data?.jira.issues ?? [];
  const working = issues.filter((i) => i.status.category === "indeterminate");
  const todo = issues.filter((i) => i.status.category === "new");
  const shown = filter === "indeterminate" ? working : filter === "new" ? todo : issues;

  let body;
  if (!integrations.jira) {
    body = <EmptyState icon={<ListChecks />} title="Jira не подключена" text="Администратору нужно задать серверу JIRA_BASE_URL, JIRA_EMAIL и JIRA_API_TOKEN" />;
  } else if (tasks.isPending) {
    body = (
      <div className={s.skeleton} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height={44} />
        ))}
      </div>
    );
  } else if (tasks.isError) {
    body = <EmptyState icon={<ListChecks />} title="Задачи не загрузились" text={tasks.error.message} action={{ label: "Повторить", onClick: () => void tasks.refetch() }} />;
  } else if (data?.jira.error) {
    body = <InlineError text={data.jira.error} />;
  } else if (!data?.account) {
    body = (
      <EmptyState
        icon={<ListChecks />}
        title="Не нашли вас в Jira"
        text={`Ищем аккаунт Jira с почтой ${boot.me.email}. Если в Jira у вас другая почта, задачи сюда не попадут`}
      />
    );
  } else if (issues.length === 0) {
    body = <EmptyState icon={<ListChecks />} title="Открытых задач нет" text="Здесь появятся задачи Jira, где вы исполнитель, — сначала самые важные" />;
  } else {
    body = (
      <>
        <div className={s.filters}>
          <Tabs
            label="Статус"
            variant="pills"
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            items={[
              { value: "all", label: "Все", count: issues.length },
              { value: "indeterminate", label: "В работе", count: working.length },
              { value: "new", label: "К выполнению", count: todo.length },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          <p className={s.sectionNote}>Задач с таким статусом нет</p>
        ) : (
          <div className={s.pageList}>
            <PriorityGroups boot={boot} issues={shown} showAssignee={false} />
          </div>
        )}
        {data.jira.truncated && <p className={s.sectionNote}>Показаны первые {issues.length} задач</p>}
      </>
    );
  }

  return (
    <div className={ps.page}>
      <div className={s.pageBody}>
        <header className={ps.pageHeader}>
          <h1 className={ps.pageTitle}>Мои задачи</h1>
          {data?.account && (
            <span className={s.account}>
              <Avatar name={data.account.name} id={data.account.accountId} src={data.account.avatarUrl} size="s" decorative />
              {data.account.name} в Jira
            </span>
          )}
        </header>
        {body}
      </div>
    </div>
  );
}

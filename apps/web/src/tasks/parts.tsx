// Части вкладки «Задачи» и страницы «Мои задачи»: группы по приоритету, строка задачи, статус,
// карточка макета Figma и правка из комментария Figma.
import { useState } from "react";
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, CircleAlert, Equal, ExternalLink, Frame, X } from "lucide-react";
import type { BootDto, FigmaCommentDto, FigmaPreviewDto, JiraIssueDto, PriorityLevel, StatusCategory } from "@teamchat/shared";
import { displayOf } from "../data/boot";
import { groupByPriority, useFigmaPreview, useIntegrations } from "../data/tasks";
import { cx } from "../lib/cx";
import { dayLabel, formatTime, plural } from "../lib/format";
import { Avatar } from "../ui/Avatar";
import { Skeleton } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import s from "./tasks.module.scss";

const PRIORITY_ICON = { 1: ChevronsUp, 2: ChevronUp, 3: Equal, 4: ChevronDown, 5: ChevronsDown } as const;

export function PriorityIcon({ level }: { level: PriorityLevel }) {
  const Icon = PRIORITY_ICON[level];
  return <Icon className={cx(s.priority, s[`level${level}`])} aria-hidden />;
}

export function StatusPill({ name, category }: { name: string; category: StatusCategory }) {
  return <span className={cx(s.status, s[category])}>{name}</span>;
}

const shortDate = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" });

// Срок из Jira — дата без времени: сравниваем с сегодняшним днём по местному времени.
function Due({ date }: { date: string }) {
  const [y, m, d] = date.split("-").map(Number);
  const due = new Date(y!, m! - 1, d!);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const late = due < today;
  return <span className={cx(s.due, late && s.late)}>{late ? `просрочена, ${shortDate.format(due)}` : `до ${shortDate.format(due)}`}</span>;
}

function Assignee({ boot, issue }: { boot: BootDto; issue: JiraIssueDto }) {
  const a = issue.assignee;
  if (!a) return <span className={s.unassigned}>Не назначена</span>;
  const user = a.userId ? (boot.me.id === a.userId ? boot.me : boot.users.find((u) => u.id === a.userId)) : undefined;
  const name = user ? displayOf(user) : a.name;
  return (
    <span className={s.assignee}>
      {user ? <Avatar name={name} id={user.id} size="xs" decorative /> : <Avatar name={name} id={a.accountId} src={a.avatarUrl} size="xs" decorative />}
      <span className={s.assigneeName}>{user?.id === boot.me.id ? "Вы" : name}</span>
    </span>
  );
}

export function IssueRow({ boot, issue, showAssignee = true }: { boot: BootDto; issue: JiraIssueDto; showAssignee?: boolean }) {
  const [designs, setDesigns] = useState(false);
  // Без токена Figma превью строить нечем: макеты — просто ссылками в Figma.
  const previews = useIntegrations().figma;
  const count = previews ? issue.figma.length : 0;
  return (
    <li className={s.issue}>
      <a className={s.summary} href={issue.url} target="_blank" rel="noreferrer">
        <span className={s.key}>{issue.key}</span> {issue.summary || "Без названия"}
      </a>
      <div className={s.meta}>
        <StatusPill name={issue.status.name} category={issue.status.category} />
        {showAssignee && <Assignee boot={boot} issue={issue} />}
        {issue.dueDate && <Due date={issue.dueDate} />}
        {!previews &&
          issue.figma.map((ref, i) => (
            <a key={ref.url} className={s.designToggle} href={ref.url} target="_blank" rel="noreferrer">
              <Frame aria-hidden />
              {issue.figma.length > 1 ? `Макет ${i + 1}` : "Макет"}
              <ExternalLink aria-hidden />
            </a>
          ))}
        {count > 0 && (
          <button type="button" className={s.designToggle} aria-expanded={designs} onClick={() => setDesigns((v) => !v)}>
            <Frame aria-hidden />
            {count === 1 ? "Макет" : plural(count, "макет", "макета", "макетов")}
            <ChevronDown className={designs ? s.flipped : undefined} aria-hidden />
          </button>
        )}
      </div>
      {designs && (
        <div className={s.designs}>
          {issue.figma.map((ref) => (
            <FigmaLinkCard key={ref.url} url={ref.url} />
          ))}
        </div>
      )}
    </li>
  );
}

export function PriorityGroups({ boot, issues, showAssignee = true }: { boot: BootDto; issues: JiraIssueDto[]; showAssignee?: boolean }) {
  return (
    <>
      {groupByPriority(issues).map((g) => (
        <section key={g.key} className={s.group} aria-label={g.priority ? `Приоритет ${g.priority.name}` : "Без приоритета"}>
          <h3 className={s.groupTitle}>
            {g.priority && <PriorityIcon level={g.priority.level} />}
            {g.priority?.name ?? "Без приоритета"}
            <span className={s.count}>{g.issues.length}</span>
          </h3>
          <ul className={s.issues}>
            {g.issues.map((issue) => (
              <IssueRow key={issue.key} boot={boot} issue={issue} showAssignee={showAssignee} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function InlineError({ text }: { text: string }) {
  return (
    <p className={s.error} role="alert">
      <CircleAlert aria-hidden />
      {text}
    </p>
  );
}

const when = (iso: string) => `${dayLabel(iso).toLowerCase()} в ${formatTime(iso)}`;

const unavailable: Partial<Record<FigmaPreviewDto["status"], string>> = {
  forbidden: "Нет доступа: файл не открыт аккаунту Figma, чей токен у чата",
  missing: "Файл не найден в Figma",
  pending: "Превью ещё готовится",
  failed: "Превью не получилось, откройте макет в Figma",
};

// Как карточка ссылки (LinkUnfurl), только картинка кадра под текстом: в 80 px макет не разглядеть.
export function FigmaPreviewCard({ preview, onHide }: { preview: FigmaPreviewDto; onHide?: () => void }) {
  const title = preview.nodeName || preview.fileName || "Макет в Figma";
  const note = preview.status === "ready" ? (preview.lastModified ? `изменён ${when(preview.lastModified)}` : null) : unavailable[preview.status];
  return (
    <div className={s.figma}>
      <div className={s.figmaText}>
        <span className={s.figmaSite}>Figma{preview.nodeName && preview.fileName ? ` · ${preview.fileName}` : ""}</span>
        <a className={s.figmaTitle} href={preview.url} target="_blank" rel="noreferrer" title={title}>
          {title}
        </a>
        {note && <span className={s.figmaNote}>{note}</span>}
      </div>
      {preview.image && (
        <a
          className={s.figmaImage}
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Открыть в Figma: ${title}`}
          style={{ aspectRatio: `${preview.image.width} / ${preview.image.height}` }}
        >
          <img src={preview.image.url} alt="" loading="lazy" />
        </a>
      )}
      {onHide && (
        <IconButton label="Убрать карточку" size="xs" className={s.figmaHide} onClick={onHide}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

// Макет из описания задачи: превью спрашиваем у сервера, только когда карточку раскрыли.
export function FigmaLinkCard({ url }: { url: string }) {
  const q = useFigmaPreview(url);
  if (q.isPending) {
    return (
      <div className={s.figma} aria-busy="true">
        <div className={s.figmaText}>
          <Skeleton width={60} height={10} />
          <Skeleton width={180} height={14} />
        </div>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className={s.figma}>
        <div className={s.figmaText}>
          <span className={s.figmaSite}>Figma</span>
          <a className={s.figmaTitle} href={url} target="_blank" rel="noreferrer">
            Открыть макет
          </a>
          <span className={s.figmaNote}>{q.error.message}</span>
        </div>
      </div>
    );
  }
  return <FigmaPreviewCard preview={q.data} />;
}

export function FigmaCommentRow({ comment }: { comment: FigmaCommentDto }) {
  return (
    <li>
      <a className={s.comment} href={comment.url} target="_blank" rel="noreferrer">
        <Avatar name={comment.author.handle} id={`figma:${comment.author.handle}`} src={comment.author.avatarUrl} size="m" decorative />
        <span className={s.commentBody}>
          <span className={s.commentHead}>
            <span className={s.commentAuthor}>{comment.author.handle}</span>
            <span className={s.commentWhere}>
              {comment.fileName} · {when(comment.createdAt)}
            </span>
          </span>
          <span className={s.commentText}>{comment.text}</span>
          <span className={s.commentFoot}>
            {comment.replyCount > 0 && <span>{plural(comment.replyCount, "ответ", "ответа", "ответов")}</span>}
            <span className={s.commentOpen}>
              Открыть в Figma
              <ExternalLink aria-hidden />
            </span>
          </span>
        </span>
      </a>
    </li>
  );
}

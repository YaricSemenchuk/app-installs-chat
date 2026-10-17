// Откуда вкладка «Задачи» берёт задачи: JQL для Jira и файлы Figma, чьи нерешённые комментарии — правки по дизайну.
import { useEffect, useState } from "react";
import { FIGMA_FILES_MAX, JQL_MAX, parseFigmaUrl, type ChannelTasksDto } from "@teamchat/shared";
import { saveTaskSource, useIntegrations, useJiraProjects } from "../data/tasks";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextArea, TextField } from "../ui/TextField";
import { toast } from "../ui/Toaster";
import s from "./tasks.module.scss";

export function TaskSourceDialog({
  conversationId,
  channelName,
  current,
  open,
  onOpenChange,
}: {
  conversationId: string;
  channelName: string;
  current: ChannelTasksDto["source"] | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const integrations = useIntegrations();
  const projects = useJiraProjects(open && integrations.jira !== null);
  const [jql, setJql] = useState("");
  const [files, setFiles] = useState("");
  const [error, setError] = useState<{ field: "jql" | "figma" | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setJql(current?.jql ?? "");
    setFiles((current?.figmaFiles ?? []).map((f) => f.url).join("\n"));
    setError(null);
    // Форму заполняем при каждом открытии, а не при каждом обновлении вкладки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hadSource = Boolean(current?.jql || current?.figmaFiles.length);
  const projectOf = /^\s*project\s*=\s*"?([A-Z][A-Z0-9_]*)"?\s*$/i.exec(jql)?.[1]?.toUpperCase();

  async function save(next: { jql: string | null; figmaFiles: string[] }) {
    setBusy(true);
    setError(null);
    try {
      await saveTaskSource(conversationId, next);
      onOpenChange(false);
      toast(next.jql || next.figmaFiles.length ? "Задачи канала обновлены" : "Задачи от канала отвязаны");
    } catch (err) {
      const text = (err as Error).message;
      setError({ field: /JQL|Jira/.test(text) ? "jql" : /Figma/.test(text) ? "figma" : null, text });
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const urls = files
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    const bad = urls.find((u) => !parseFigmaUrl(u));
    if (bad) return setError({ field: "figma", text: `Это не ссылка на файл Figma: ${bad}` });
    if (urls.length > FIGMA_FILES_MAX) return setError({ field: "figma", text: `Не больше ${FIGMA_FILES_MAX} файлов` });
    void save({ jql: jql.trim() || null, figmaFiles: urls });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Задачи в #${channelName}`}
      description="Вкладку видят все в канале. Чат только читает Jira и Figma: статусы меняют там"
      size="m"
      footer={
        <>
          {hadSource && (
            <Button variant="dangerGhost" onClick={() => void save({ jql: null, figmaFiles: [] })} disabled={busy}>
              Отвязать всё
            </Button>
          )}
          <span className={s.footerSpacer} />
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button loading={busy} onClick={submit}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {integrations.jira && (
          <div>
            <TextField
              label="Задачи Jira (JQL)"
              placeholder="project = DEV AND component = Ads"
              value={jql}
              maxLength={JQL_MAX}
              autoFocus
              onChange={(e) => setJql(e.target.value)}
              error={error?.field === "jql" ? error.text : undefined}
              hint="Завершённые задачи не показываются, порядок — по приоритету, как в Jira"
            />
            {projects.data && projects.data.length > 0 && (
              <div className={s.projects} role="group" aria-label="Проекты Jira">
                {projects.data.slice(0, 12).map((p) => (
                  <button key={p.key} type="button" className={s.project} aria-pressed={projectOf === p.key} onClick={() => setJql(`project = ${p.key}`)}>
                    <strong>{p.key}</strong>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {integrations.figma && (
          <TextArea
            label="Файлы Figma"
            placeholder="https://www.figma.com/design/…"
            rows={3}
            value={files}
            onChange={(e) => setFiles(e.target.value)}
            error={error?.field === "figma" ? error.text : undefined}
            hint="Ссылки на файлы, по одной в строке. Нерешённые комментарии из них попадут во вкладку как правки по дизайну"
          />
        )}
        {error && error.field === null && <p className={s.figmaNote}>{error.text}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

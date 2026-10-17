// S11 — каталог открытых каналов: найти, заглянуть, вступить.
import { useDeferredValue, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Hash, Plus, Search } from "lucide-react";
import type { DirectoryChannelDto } from "@teamchat/shared";
import { api } from "../api/http";
import { joinChannel } from "../data/conversations";
import { plural } from "../lib/format";
import { Button } from "../ui/Button";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { TextField } from "../ui/TextField";
import { CreateChannelDialog } from "./CreateChannelDialog";
import s from "./channels.module.scss";

const members = (n: number) => plural(n, "участник", "участника", "участников");

export function DirectoryPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["directory", deferred],
    queryFn: () => api<DirectoryChannelDto[]>(`/conversations/browse${deferred ? `?query=${encodeURIComponent(deferred)}` : ""}`),
    placeholderData: (prev) => prev,
  });

  async function join(c: DirectoryChannelDto) {
    setJoining(c.id);
    setError(null);
    try {
      await joinChannel(c.id);
      navigate(`/c/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(null);
    }
  }

  return (
    <div className={s.page}>
      <header className={s.pageHeader}>
        <h1 className={s.pageTitle}>Каналы</h1>
        <Button icon={<Plus />} onClick={() => setCreating(true)}>
          Создать канал
        </Button>
      </header>
      <div className={s.search}>
        <TextField label="Найти канал" hideLabel icon={<Search />} placeholder="Название канала" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      {error && (
        <p role="alert" className={s.footerError}>
          {error}
        </p>
      )}
      {list.isPending ? (
        <div className={s.section}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={48} />
          ))}
        </div>
      ) : list.data && list.data.length === 0 ? (
        <EmptyState
          icon={<Hash />}
          title={deferred ? `Каналов по запросу «${deferred}» нет` : "Каналов пока нет"}
          text="Создайте свой, если такого ещё нет"
          action={{ label: "Создать канал", onClick: () => setCreating(true) }}
        />
      ) : (
        <ul className={s.dirList}>
          {list.data?.map((c) => (
            <li key={c.id} className={s.dirRow}>
              <div className={s.dirText}>
                <span className={s.dirName}>
                  {c.archived ? <Archive /> : <Hash />}
                  {c.name}
                  {c.archived && <span className={s.tag}>в архиве</span>}
                  {c.isMember && <span className={s.tag}>вы участник</span>}
                </span>
                <span className={s.dirMeta}>
                  {members(c.memberCount)}
                  {c.purpose || c.topic ? ` · ${c.purpose || c.topic}` : ""}
                </span>
              </div>
              {c.isMember || c.archived ? (
                <Button variant="ghost" size="s" onClick={() => navigate(`/c/${c.id}`)}>
                  Открыть
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="s" onClick={() => navigate(`/c/${c.id}`)}>
                    Заглянуть
                  </Button>
                  <Button variant="secondary" size="s" loading={joining === c.id} onClick={() => void join(c)}>
                    Вступить
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <CreateChannelDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// S18 — пикер эмодзи: поиск (фокус сразу), недавние, разделы, вкладки разделов снизу.
// Сетка листается стрелками, Enter выбирает. Тон кожи и свои эмодзи — позже.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Apple, Clock, Flag, Hand, Leaf, Lightbulb, Plane, Search, Shapes, Smile, Trophy } from "lucide-react";
import { TextField } from "../ui/TextField";
import { Spinner } from "../ui/Spinner";
import { loadEmoji, searchEmoji, useEmoji, useRecentEmoji, type Emoji } from "./emoji";
import s from "./EmojiPicker.module.scss";

const COLUMNS = 8;
const CELL_PX = 42; // (352 − отступы) / 8: высота заглушки для ещё не нарисованного раздела
const GROUP_ICONS: Record<number, typeof Smile> = { 0: Smile, 1: Hand, 3: Leaf, 4: Apple, 5: Plane, 6: Trophy, 7: Lightbulb, 8: Shapes, 9: Flag };

// Раздел рисуется, когда подъезжает к видимой области: все ~1900 кнопок сразу открывали пикер секунды.
function LazyGrid({ eager, count, root, children }: { eager: boolean; count: number; root: RefObject<HTMLDivElement | null>; children: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(eager);
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { root: root.current, rootMargin: "300px 0px" },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown, root]);
  return (
    <div ref={ref} className={s.grid} role="grid" style={shown ? undefined : { height: Math.ceil(count / COLUMNS) * CELL_PX }}>
      {shown && children()}
    </div>
  );
}

export function EmojiPicker({ onPick }: { onPick: (emoji: Emoji) => void }) {
  const index = useEmoji((st) => st.index);
  const recent = useRecentEmoji((st) => st.names);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<Emoji | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmoji();
  }, []);

  const sections = useMemo(() => {
    if (!index) return [];
    if (query.trim()) return [{ id: -2, title: "Найдено", items: searchEmoji(index, query, 200) }];
    const recentItems = recent.flatMap((n) => index.byName.get(n) ?? []);
    return [
      { id: -1, title: "Недавние", items: recentItems },
      ...index.groups.map((g) => ({ id: g.id, title: g.title, items: index.all.filter((e) => e.group === g.id) })),
    ];
  }, [index, query, recent]);

  function buttons(): HTMLButtonElement[] {
    return [...(body.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]") ?? [])];
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, at + step))]?.focus();
  }

  function jump(id: number) {
    setQuery("");
    requestAnimationFrame(() => body.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: "start" }));
  }

  const found = sections[0]?.id === -2 ? sections[0].items : null;

  return (
    <div className={s.picker} role="dialog" aria-label="Эмодзи">
      <div className={s.search}>
        <TextField
          label="Найти эмодзи"
          hideLabel
          size="s"
          icon={<Search />}
          placeholder="Найти: огонь, ok, :tada:"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              buttons()[0]?.focus();
            }
            if (e.key === "Enter" && found?.[0]) {
              e.preventDefault();
              onPick(found[0]);
            }
          }}
          autoFocus
        />
      </div>
      <div ref={body} className={s.body} onKeyDown={onGridKey}>
        {!index && (
          <div className={s.center}>
            <Spinner />
          </div>
        )}
        {found && found.length === 0 && <p className={s.empty}>Ничего не нашлось. Попробуйте другое слово</p>}
        {sections.map(
          (sec) =>
            sec.items.length > 0 && (
              <section key={sec.id} className={s.section} data-section={sec.id} aria-label={sec.title}>
                <h3 className={s.title}>{sec.title}</h3>
                <LazyGrid eager={sec.id < 1} count={sec.items.length} root={body}>
                  {() =>
                    sec.items.map((e) => (
                    <button
                      key={e.name}
                      type="button"
                      data-emoji
                      className={s.cell}
                      aria-label={e.label}
                      onClick={() => onPick(e)}
                      onMouseEnter={() => setHovered(e)}
                      onFocus={() => setHovered(e)}
                    >
                      {e.char}
                    </button>
                  ))
                  }
                </LazyGrid>
              </section>
            ),
        )}
      </div>
      <div className={s.footer}>
        {hovered ? (
          <span className={s.preview}>
            <span className={s.previewChar}>{hovered.char}</span>
            <span className={s.previewText}>
              <span className={s.previewLabel}>{hovered.label}</span>
              <span className={s.previewName}>:{hovered.name}:</span>
            </span>
          </span>
        ) : (
          <nav className={s.tabs} aria-label="Разделы">
            <button type="button" className={s.tab} aria-label="Недавние" onClick={() => jump(-1)}>
              <Clock />
            </button>
            {index?.groups.map((g) => {
              const Icon = GROUP_ICONS[g.id] ?? Smile;
              return (
                <button key={g.id} type="button" className={s.tab} aria-label={g.title} title={g.title} onClick={() => jump(g.id)}>
                  <Icon />
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

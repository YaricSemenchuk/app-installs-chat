// S05 «Канал» + S07 «Тред» на статичных данных: проверка системы в контексте, не рабочий экран.
import { useLayoutEffect, useRef } from "react";
import { Bookmark, FileStack, Inbox, MessageSquareText, SendHorizontal, UserPlus, X } from "lucide-react";
import { Composer } from "../chat/Composer";
import { ConversationHeader } from "../chat/ConversationHeader";
import {
  CodeBlock,
  DateDivider,
  FileCard,
  InlineCode,
  MentionChip,
  Message,
  SystemMessage,
  UnreadDivider,
} from "../chat/Message";
import { Sidebar, SidebarItem, SidebarSection } from "../chat/Sidebar";
import { Titlebar } from "../chat/Titlebar";
import { IconButton } from "../ui/IconButton";
import s from "./ChannelPreview.module.scss";

const ME = "Марк Бондар";
const ANNA = "Аня Ковальчук";
const OLEG = "Олег Мартынюк";
const DIMA = "Дима Левченко";
const IRA = "Ира Савчук";

export function ChannelPreview({ thread = true }: { thread?: boolean }) {
  // Лента чата открывается внизу, на последних сообщениях.
  const feed = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, []);

  return (
    <div className={s.app}>
      <Titlebar me={ME} activity={2} />
      <div className={s.body}>
        <Sidebar workspace="appinstallschat">
          <ul className={s.navList}>
            <SidebarItem entry={{ kind: "nav", label: "Треды", icon: <MessageSquareText /> }} state={{ unread: true }} />
            <SidebarItem entry={{ kind: "nav", label: "Черновики и отправленные", icon: <SendHorizontal /> }} />
            <SidebarItem entry={{ kind: "nav", label: "Сохранённое", icon: <Bookmark /> }} />
            <SidebarItem entry={{ kind: "nav", label: "Файлы", icon: <FileStack /> }} />
          </ul>
          <SidebarSection title="Важное">
            <SidebarItem entry={{ kind: "channel", name: "releases" }} state={{ selected: true }} />
            <SidebarItem entry={{ kind: "channel", name: "apple-ads" }} state={{ unread: true, mentions: 1 }} />
          </SidebarSection>
          <SidebarSection title="Каналы">
            <SidebarItem entry={{ kind: "channel", name: "general" }} />
            <SidebarItem entry={{ kind: "channel", name: "design" }} state={{ unread: true }} />
            <SidebarItem entry={{ kind: "channel", name: "backend" }} state={{ hover: true }} />
            <SidebarItem entry={{ kind: "channel", name: "frontend-team", private: true }} />
            <SidebarItem entry={{ kind: "channel", name: "random" }} state={{ muted: true, unread: true }} />
          </SidebarSection>
          <SidebarSection title="Личные сообщения">
            <SidebarItem entry={{ kind: "dm", name: ANNA, presence: "active" }} state={{ unread: true, mentions: 2 }} />
            <SidebarItem entry={{ kind: "dm", name: OLEG, presence: "away" }} />
            <SidebarItem entry={{ kind: "dm", name: IRA, presence: "dnd" }} />
            <SidebarItem entry={{ kind: "group", names: ["Аня", "Дима", "Олег"] }} state={{ draft: true }} />
            <SidebarItem entry={{ kind: "dm", name: ME, presence: "active", self: true }} />
          </SidebarSection>
          <ul className={s.navList}>
            <SidebarItem entry={{ kind: "nav", label: "Пригласить коллег", icon: <UserPlus /> }} />
          </ul>
        </Sidebar>

        <main className={s.conversation}>
          <ConversationHeader
            name="releases"
            topic="Выкатки бэкенда и фронта. Чек-лист — в закладке, вопросы по откату — Олегу"
            members={[OLEG, ANNA, DIMA, IRA, ME]}
            pins={3}
            bookmark="Чек-лист релиза"
          />
          <div ref={feed} className={s.feed} role="log" aria-label="Сообщения в #releases">
            <DateDivider label="Вчера" />
            <Message id="m1" author={OLEG} time="18:42" isoTime="2026-10-16T18:42" reactions={[{ emoji: "👀", count: 2, who: "Аня, Дима" }]}>
              <p>
                Бэкенд 2.14 на стейдже. Миграция <InlineCode>rule_engine_scope</InlineCode> прошла за 40 секунд, данные сверил
                с продом.
              </p>
            </Message>
            <Message id="m2" author={OLEG} time="18:43" isoTime="2026-10-16T18:43" continuation>
              <p>Завтра в 11:00 выкатываем на прод, если QA не найдёт блокеров.</p>
            </Message>
            <SystemMessage icon={<Inbox />}>Ира Савчук вступила в канал</SystemMessage>

            <UnreadDivider />
            <DateDivider label="Сегодня" />
            <Message
              id="m3"
              author={ANNA}
              time="10:58"
              isoTime="2026-10-17T10:58"
              state="hover"
              reactions={[
                { emoji: "👍", count: 3, mine: true, who: "Вы, Олег, Ира" },
                { emoji: "🎨", count: 1, who: "Дима" },
              ]}
              thread={{ names: [DIMA, ANNA, OLEG], count: 4, last: "Последний ответ в 11:20", unread: true }}
            >
              <p>
                Новые карточки отчёта готовы, макеты в <a href="#">Figma</a>. <MentionChip name="Дима" /> посмотри отступы в тёмной
                теме: на 1280 таблица налезает на фильтры.
              </p>
            </Message>
            <Message id="m4" author={DIMA} time="11:24" isoTime="2026-10-17T11:24" state="mentionsMe" edited>
              <p>
                <MentionChip name="Марк" me /> обновил чек-лист релиза, глянь пункт про сброс кэша CDN. Без него клиенты
                увидят старые бандлы.
              </p>
            </Message>
            <Message id="m5" author={OLEG} time="11:31" isoTime="2026-10-17T11:31" status="🚀">
              <p>Прогнал сухую миграцию на копии прода:</p>
              <CodeBlock>{"npm run migrate:prod -- --dry-run\n✓ 3 migrations pending, no destructive changes"}</CodeBlock>
            </Message>
            <Message id="m6" author={IRA} time="11:40" isoTime="2026-10-17T11:40">
              <p>Черновик заметок для клиентов, правки прямо в документе.</p>
              <FileCard name="Release-notes-2.14.pdf" kind="PDF" size="412 КБ" />
            </Message>
            <Message id="m7" author={ME} time="11:42" isoTime="2026-10-17T11:42" state="sending">
              <p>Ок, смотрю пункт про CDN.</p>
            </Message>
          </div>
          <Composer placeholder="Сообщение в #releases" typing="Олег печатает…" />
        </main>

        {thread && (
          <aside className={s.thread} aria-label="Тред">
            <header className={s.threadHeader}>
              <div>
                <h2 className={s.threadTitle}>Тред</h2>
                <p className={s.threadChannel}># releases</p>
              </div>
              <IconButton label="Закрыть тред" shortcut="Esc" size="s">
                <X />
              </IconButton>
            </header>
            <div className={s.threadFeed}>
              <Message id="t0" author={ANNA} time="10:58" isoTime="2026-10-17T10:58">
                <p>
                  Новые карточки отчёта готовы, макеты в <a href="#">Figma</a>. <MentionChip name="Дима" /> посмотри отступы в
                  тёмной теме: на 1280 таблица налезает на фильтры.
                </p>
              </Message>
              <div className={s.replyCount}>4 ответа</div>
              <Message id="t1" author={DIMA} time="11:05" isoTime="2026-10-17T11:05">
                <p>Вижу. На 1280 фильтры переносятся на вторую строку, а таблица этого не учитывает. Поправлю сегодня.</p>
              </Message>
              <Message id="t2" author={ANNA} time="11:12" isoTime="2026-10-17T11:12" reactions={[{ emoji: "🙏", count: 1, who: "Дима" }]}>
                <p>Спасибо! И проверь пустое состояние, там кнопка без отступа снизу.</p>
              </Message>
              <Message id="t3" author={DIMA} time="11:20" isoTime="2026-10-17T11:20">
                <p>Ок, оба фикса будут в 2.14.</p>
              </Message>
            </div>
            <Composer placeholder="Ответить…" toolbar={false} broadcastTo="releases" />
          </aside>
        )}
      </div>
    </div>
  );
}

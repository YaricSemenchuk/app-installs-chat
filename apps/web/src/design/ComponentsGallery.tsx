// Все примитивы во всех состояниях — проверка дизайн-системы до экранов.
import { useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  Bookmark,
  Copy,
  Hash,
  Link2,
  MessageSquareText,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import tokens from "../../../../replica/design/tokens.json";
import { MentionChip, ReactionPill, ThreadSummary } from "../chat/Message";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog, DialogSurface } from "../ui/Dialog";
import { Badge, ConnectionBanner, EmptyState, Skeleton, ToastSurface } from "../ui/Feedback";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import { Menu, MenuSurface, type MenuEntry } from "../ui/Menu";
import { Spinner } from "../ui/Spinner";
import { Tabs } from "../ui/Tabs";
import { TextField } from "../ui/TextField";
import { Checkbox, Switch } from "../ui/Toggle";
import { TooltipSurface } from "../ui/Tooltip";
import s from "./ComponentsGallery.module.scss";

const messageMenu: MenuEntry[] = [
  { kind: "item", label: "Ответить в треде", icon: <MessageSquareText />, kbd: "T" },
  { kind: "item", label: "Копировать ссылку", icon: <Link2 />, kbd: "L" },
  { kind: "item", label: "Закрепить в канале", icon: <Pin />, kbd: "P" },
  { kind: "item", label: "Отметить непрочитанным", icon: <Bookmark />, kbd: "U" },
  { kind: "separator" },
  { kind: "item", label: "Изменить", icon: <Pencil />, kbd: "E" },
  { kind: "item", label: "Удалить сообщение", icon: <Trash2 />, kbd: "⌫", danger: true },
];

const colorRoles = Object.keys(tokens.color).filter((k) => !k.startsWith("_"));
const typeRoles = Object.entries(tokens.type).filter(([k]) => !k.startsWith("_")) as Array<
  [string, { size: number; line: number; weight: number; _use: string }]
>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      {label && <span className={s.rowLabel}>{label}</span>}
      <div className={s.rowItems}>{children}</div>
    </div>
  );
}

export function ComponentsGallery() {
  const [tab, setTab] = useState("all");
  const [pillTab, setPillTab] = useState("mentions");
  const [check, setCheck] = useState(true);
  const [sw, setSw] = useState(true);

  return (
    <div className={s.gallery}>
      <Section title="Цветовые роли">
        <div className={s.swatches}>
          {colorRoles.map((role) => (
            <div key={role} className={s.swatch}>
              <span className={s.swatchColor} style={{ background: `var(--color-${role})` }} />
              <span className={s.swatchName}>{role}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Типографика (Rubik)">
        <div className={s.typeList}>
          {typeRoles.map(([name, t]) => (
            <div key={name} className={s.typeRow}>
              <span className={s.typeMeta}>
                {name} · {t.size}/{t.line} · {t.weight}
              </span>
              <span
                style={{
                  fontSize: `var(--type-${name}-size)`,
                  lineHeight: `var(--type-${name}-line)`,
                  fontWeight: `var(--type-${name}-weight)`,
                  fontFamily: name === "code" ? "var(--font-mono)" : undefined,
                }}
              >
                {name === "code" ? "npm run migrate:prod -- --dry-run" : "Бэкенд 2.14 на стейдже, выкатываем завтра в 11:00"}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button">
        <Row label="варианты">
          <Button>Создать канал</Button>
          <Button variant="secondary">Добавить описание</Button>
          <Button variant="ghost">Отмена</Button>
          <Button variant="danger">Удалить канал</Button>
          <Button variant="dangerGhost">Покинуть канал</Button>
        </Row>
        <Row label="размеры">
          <Button size="s" icon={<Plus />}>
            s 32
          </Button>
          <Button size="m" icon={<Plus />}>
            m 40
          </Button>
          <Button size="l">l 48 — Войти</Button>
        </Row>
        <Row label="состояния">
          <Button disabled>Недоступно</Button>
          <Button loading>Создаём…</Button>
          <Button variant="secondary" loading>
            Отправляем
          </Button>
        </Row>
      </Section>

      <Section title="IconButton, Tooltip, Kbd">
        <Row label="ghost / toggled / primary">
          <IconButton label="Поиск" shortcut="⌘G">
            <Search />
          </IconButton>
          <IconButton label="Уведомления канала">
            <Bell />
          </IconButton>
          <IconButton label="Жирный" shortcut="⌘B" size="xs" pressed>
            <span style={{ fontWeight: 700 }}>Ж</span>
          </IconButton>
          <IconButton label="Новый канал" tone="primary">
            <Plus />
          </IconButton>
          <IconButton label="Архив" disabled>
            <Archive />
          </IconButton>
        </Row>
        <Row label="tooltip">
          <TooltipSurface label="Ответить в треде" shortcut="T" />
          <TooltipSurface label="Аня, Олег и ещё 3 человека" />
        </Row>
        <Row label="kbd">
          <Kbd>⌘K</Kbd>
          <Kbd>⌘⇧A</Kbd>
          <Kbd>Esc</Kbd>
        </Row>
      </Section>

      <Section title="TextField">
        <div className={s.grid2}>
          <TextField label="Название канала" prefix={<Hash />} placeholder="например, apple-ads" hint="Строчные буквы, цифры, «-» и «_», до 80 символов" />
          <TextField label="Поиск людей" hideLabel icon={<Search />} placeholder="Имя или email" size="s" />
          <TextField label="Название канала" prefix={<Hash />} defaultValue="General" error="Только строчные буквы: «general» уже занят" />
          <TextField label="Email" defaultValue="anna@promobile.app" disabled />
        </div>
      </Section>

      <Section title="Checkbox, Switch, Tabs">
        <Row label="checkbox">
          <Checkbox label="Также отправить в #releases" checked={check} onCheckedChange={setCheck} />
          <Checkbox label="Выбраны не все" checked="indeterminate" />
          <Checkbox label="Недоступно" checked={false} disabled />
        </Row>
        <Row label="switch">
          <Switch label="Десктоп-уведомления" checked={sw} onCheckedChange={setSw} />
          <Switch label="Звук" checked={false} />
        </Row>
        <Row label="tabs underline">
          <Tabs
            label="Результаты поиска"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "all", label: "Сообщения", count: 24 },
              { value: "files", label: "Файлы", count: 3 },
              { value: "people", label: "Люди" },
              { value: "channels", label: "Каналы" },
            ]}
          />
        </Row>
        <Row label="tabs pills">
          <Tabs
            label="Фильтр активности"
            variant="pills"
            value={pillTab}
            onValueChange={setPillTab}
            items={[
              { value: "all", label: "Всё" },
              { value: "mentions", label: "Упоминания" },
              { value: "threads", label: "Треды" },
              { value: "reactions", label: "Реакции" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Avatar, PresenceDot, Badge">
        <Row label="размеры">
          <Avatar name="Аня Ковальчук" size="xs" />
          <Avatar name="Аня Ковальчук" size="s" />
          <Avatar name="Аня Ковальчук" size="m" />
          <Avatar name="Аня Ковальчук" size="l" />
          <Avatar name="Аня Ковальчук" size="xl" presence="active" />
        </Row>
        <Row label="присутствие и тона">
          <Avatar name="Олег Мартынюк" presence="active" />
          <Avatar name="Дима Левченко" presence="away" />
          <Avatar name="Ира Савчук" presence="dnd" />
          <Avatar name="Марк Бондар" />
          <Avatar name="Лена Ткач" />
          <Avatar name="Саша Гнатюк" />
          <Avatar name="Бывший Сотрудник" deactivated />
        </Row>
        <Row label="badge">
          <Badge count={1} />
          <Badge count={12} />
          <Badge count={240} />
          <Badge count={8} variant="muted" />
        </Row>
      </Section>

      <Section title="Сообщения: упоминания, реакции, тред">
        <Row label="mention">
          <span className={s.inlineSample}>
            Привет, <MentionChip name="Дима" /> и <MentionChip name="Марк" me />!
          </span>
        </Row>
        <Row label="reactions">
          <ReactionPill emoji="👍" count={3} mine who="Вы, Олег, Ира" />
          <ReactionPill emoji="🎨" count={1} who="Дима" />
          <ReactionPill emoji="🚀" count={12} who="12 человек" />
        </Row>
        <Row label="thread">
          <ThreadSummary names={["Дима Левченко", "Аня Ковальчук", "Олег Мартынюк"]} count={4} last="Последний ответ в 11:20" unread />
          <ThreadSummary names={["Ира Савчук"]} count={1} last="Вчера в 18:02" />
        </Row>
      </Section>

      <Section title="Menu и Dialog">
        <div className={s.overlays}>
          <div className={s.overlayCol}>
            <MenuSurface items={messageMenu} highlighted={2} />
            <Menu trigger={<Button variant="secondary" size="s">Открыть меню</Button>} items={messageMenu} />
          </div>
          <div className={s.overlayCol}>
            <DialogSurface
              title="Создать канал"
              description="В каналах команда обсуждает одну тему. Название потом можно поменять."
              footer={
                <>
                  <Button variant="ghost">Отмена</Button>
                  <Button>Создать</Button>
                </>
              }
            >
              <TextField label="Название" prefix={<Hash />} defaultValue="apple-ads" />
              <Checkbox label="Сделать приватным" checked={false} />
            </DialogSurface>
            <Dialog
              trigger={<Button variant="secondary" size="s">Открыть модалку</Button>}
              title="Удалить сообщение?"
              description="Сообщение исчезнет у всех. Ответы в треде останутся."
              footer={
                <>
                  <Button variant="ghost">Отмена</Button>
                  <Button variant="danger">Удалить</Button>
                </>
              }
            />
          </div>
        </div>
      </Section>

      <Section title="Состояния: соединение, тост, загрузка, пусто">
        <div className={s.stack}>
          <ConnectionBanner state="reconnecting" />
          <ConnectionBanner state="offline" />
          <ConnectionBanner state="restored" />
        </div>
        <Row label="toast">
          <ToastSurface text="3 разговора отмечены прочитанными" action="Отменить" />
          <ToastSurface text="Не удалось загрузить файл" tone="error" action="Повторить" />
        </Row>
        <Row label="loading">
          <Spinner />
          <Skeleton width={36} height={36} round />
          <span className={s.skeletonLines}>
            <Skeleton width={140} height={12} />
            <Skeleton width={320} height={12} />
          </span>
        </Row>
        <div className={s.emptyBox}>
          <EmptyState
            icon={<Copy />}
            title="Тредов пока нет"
            text="Ответьте в треде на любое сообщение, и он появится здесь"
          />
        </div>
      </Section>
    </div>
  );
}

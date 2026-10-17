// Композер на TipTap: лента, тред и правка сообщения. Наружу отдаёт разметку (editor/doc.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useStore } from "zustand";
import {
  AtSign,
  Bold,
  Code,
  Hash,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Megaphone,
  SendHorizontal,
  Smile,
  SquareCode,
  Strikethrough,
  TextQuote,
} from "lucide-react";
import { MESSAGE_MAX_LENGTH } from "@teamchat/shared";
import { EmojiPicker } from "../emoji/EmojiPicker";
import { loadEmoji, rememberEmoji, searchEmoji } from "../emoji/emoji";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Popover } from "../ui/Popover";
import { TextField } from "../ui/TextField";
import { docToMarkup, markupToDoc, type MentionNames } from "./doc";
import { composerExtensions, createPopup, popupBusy, type EditorHooks, type Popup, type SuggestItem } from "./extensions";
import s from "./RichEditor.module.scss";

export type Sources = {
  people: (query: string) => SuggestItem[];
  channels: (query: string) => Promise<SuggestItem[]>;
  names: MentionNames;
};

type Props = {
  placeholder: string;
  sources: Sources;
  onSubmit: (markup: string) => void; // после отправки поле очищается (кроме правки)
  variant?: "feed" | "thread" | "edit";
  initial?: string; // разметка для правки
  disabledReason?: string;
  onCancel?: () => void; // Esc при правке
  onEditLast?: () => void; // ↑ в пустом поле
  below?: ReactNode; // строка под полем: «Также отправить в канал»
  autoFocus?: boolean;
};

export function RichEditor({
  placeholder,
  sources,
  onSubmit,
  variant = "feed",
  initial,
  disabledReason,
  onCancel,
  onEditLast,
  below,
  autoFocus = true,
}: Props) {
  const popup = useRef<Popup>(createPopup()).current;
  const [linkOpen, setLinkOpen] = useState(false);
  const [tooLong, setTooLong] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  // Последние значения пропсов для расширений: редактор создаётся один раз.
  const latest = useRef({ sources, onSubmit, onCancel, onEditLast, disabledReason, variant });
  latest.current = { sources, onSubmit, onCancel, onEditLast, disabledReason, variant };

  const hooks = useMemo<EditorHooks>(
    () => ({
      popup,
      people: (q) => latest.current.sources.people(q),
      channels: (q) => latest.current.sources.channels(q),
      emoji: async (q) =>
        searchEmoji(await loadEmoji(), q, 8).map((e) => ({ kind: "emoji" as const, id: e.name, label: e.label, char: e.char })),
      onEmojiChosen: rememberEmoji,
      submit: () => submit(),
      cancel: () => {
        if (!latest.current.onCancel) return false;
        latest.current.onCancel();
        return true;
      },
      editLast: () => {
        if (!latest.current.onEditLast) return false;
        latest.current.onEditLast();
        return true;
      },
      openLink: () => {
        setLinkOpen(true);
        return true;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions: composerExtensions(placeholder, () => hooks),
    content: initial !== undefined ? markupToDoc(initial, sources.names) : undefined,
    editable: !disabledReason,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: s.field!,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder,
        "aria-describedby": `hint-${variant}`,
      },
    },
    onUpdate: ({ editor: e }) => setTooLong(e.getText().length > MESSAGE_MAX_LENGTH),
  });
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(!disabledReason);
  }, [editor, disabledReason]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            empty: e.isEmpty,
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            codeBlock: e.isActive("codeBlock"),
            quote: e.isActive("blockquote"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            link: e.isActive("link"),
          }
        : null,
  });

  function submit(): boolean {
    const e = editorRef.current;
    if (!e || latest.current.disabledReason) return true;
    const markup = docToMarkup(e.getJSON());
    if (!markup.trim() || markup.length > MESSAGE_MAX_LENGTH) {
      setTooLong(markup.length > MESSAGE_MAX_LENGTH);
      return true;
    }
    latest.current.onSubmit(markup);
    // Вместе с текстом сбрасываем «висящие» метки: иначе следующее сообщение начнётся ссылкой или жирным.
    if (latest.current.variant !== "edit") e.chain()
        .clearContent(true)
        .command(({ tr }) => {
          tr.setStoredMarks([]);
          return true;
        })
        .run();
    return true;
  }

  if (!editor) return null;
  const run = (fn: (e: Editor) => void) => () => fn(editor);
  const edit = variant === "edit";

  return (
    <div className={cx(s.wrap, edit && s.editWrap)}>
      <div className={cx(s.composer, disabledReason && s.disabled)}>
        <SuggestionList popup={popup} />
        {!edit && (
          <div className={s.toolbar} role="toolbar" aria-label="Форматирование">
            <IconButton label="Жирный" shortcut="⌘B" size="xs" pressed={state?.bold} onClick={run((e) => e.chain().focus().toggleBold().run())}>
              <Bold />
            </IconButton>
            <IconButton label="Курсив" shortcut="⌘I" size="xs" pressed={state?.italic} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
              <Italic />
            </IconButton>
            <IconButton label="Зачёркнутый" shortcut="⌘⇧X" size="xs" pressed={state?.strike} onClick={run((e) => e.chain().focus().toggleStrike().run())}>
              <Strikethrough />
            </IconButton>
            <span className={s.divider} />
            <LinkButton editor={editor} open={linkOpen} onOpenChange={setLinkOpen} active={!!state?.link} />
            <IconButton label="Нумерованный список" shortcut="⌘⇧7" size="xs" pressed={state?.ordered} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
              <ListOrdered />
            </IconButton>
            <IconButton label="Маркированный список" shortcut="⌘⇧8" size="xs" pressed={state?.bullet} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
              <List />
            </IconButton>
            <span className={s.divider} />
            <IconButton label="Цитата" shortcut="⌘⇧9" size="xs" pressed={state?.quote} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}>
              <TextQuote />
            </IconButton>
            <IconButton label="Код" shortcut="⌘E" size="xs" pressed={state?.code} onClick={run((e) => e.chain().focus().toggleCode().run())}>
              <Code />
            </IconButton>
            <IconButton label="Блок кода" shortcut="⌘⌥C" size="xs" pressed={state?.codeBlock} onClick={run((e) => e.chain().focus().toggleCodeBlock().run())}>
              <SquareCode />
            </IconButton>
          </div>
        )}
        <EditorContent editor={editor} />
        <div className={s.bottom}>
          <div className={s.tools}>
            <EmojiButton editor={editor} />
            <IconButton
              label="Упомянуть"
              size="xs"
              disabled={!!disabledReason}
              onClick={run((e) => {
                const before = e.state.doc.textBetween(Math.max(0, e.state.selection.from - 1), e.state.selection.from);
                e.chain().focus().insertContent(before && !/\s/.test(before) ? " @" : "@").run();
              })}
            >
              <AtSign />
            </IconButton>
            <span id={`hint-${variant}`} className={tooLong ? s.error : s.hint}>
              {disabledReason ??
                (tooLong
                  ? `Слишком длинно: больше ${MESSAGE_MAX_LENGTH.toLocaleString("ru")} символов`
                  : edit
                    ? "Esc — отмена, Enter — сохранить"
                    : "Enter — отправить, Shift+Enter — новая строка")}
            </span>
          </div>
          {edit ? (
            <span className={s.editActions}>
              <Button variant="ghost" size="s" onClick={() => onCancel?.()}>
                Отмена
              </Button>
              <Button size="s" onClick={() => void submit()} disabled={state?.empty || tooLong}>
                Сохранить
              </Button>
            </span>
          ) : (
            <IconButton
              label="Отправить"
              shortcut="Enter"
              size="xs"
              tone="primary"
              disabled={state?.empty || tooLong || !!disabledReason}
              onClick={() => void submit()}
            >
              <SendHorizontal />
            </IconButton>
          )}
        </div>
      </div>
      {below}
    </div>
  );
}

// Список подсказок над полем: люди и @here/@channel, каналы, эмодзи.
function SuggestionList({ popup }: { popup: Popup }) {
  const { open, items, active, choose, trigger } = useStore(popup);
  if (!open || items.length === 0) return null;
  const label = trigger === "#" ? "Каналы" : trigger === ":" ? "Эмодзи" : "Кого упомянуть";
  return (
    <ul className={s.suggestions} role="listbox" aria-label={label}>
      {items.map((it, i) => (
        <li key={`${it.kind}:${it.id}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            tabIndex={-1}
            className={s.option}
            aria-selected={i === active}
            onMouseEnter={() => popup.setState({ active: i })}
            onMouseDown={(e) => {
              e.preventDefault(); // фокус остаётся в поле
              choose?.(it);
            }}
          >
            <OptionIcon item={it} />
            <span className={s.optionLabel}>{optionLabel(it)}</span>
            {"hint" in it && it.hint && <span className={s.optionHint}>{it.hint}</span>}
            {it.kind === "emoji" && <span className={s.optionHint}>:{it.id}:</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function optionLabel(it: SuggestItem) {
  switch (it.kind) {
    case "user":
      return it.label;
    case "conversation":
      return it.label;
    case "emoji":
      return it.label;
    default:
      return `@${it.label}`;
  }
}

function OptionIcon({ item }: { item: SuggestItem }) {
  switch (item.kind) {
    case "user":
      return <Avatar name={item.label} id={item.id} size="s" decorative />;
    case "conversation":
      return <span className={s.optionIcon}>{item.private ? <Lock /> : <Hash />}</span>;
    case "emoji":
      return <span className={s.optionEmoji}>{item.char}</span>;
    default:
      return (
        <span className={s.optionIcon}>
          <Megaphone />
        </span>
      );
  }
}

function EmojiButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      bare
      label="Эмодзи"
      trigger={
        <IconButton label="Эмодзи" size="xs" disabled={!editor.isEditable}>
          <Smile />
        </IconButton>
      }
    >
      <EmojiPicker
        onPick={(e) => {
          rememberEmoji(e.name);
          setOpen(false);
          editor.chain().focus().insertContent(e.char).run();
        }}
      />
    </Popover>
  );
}

function LinkButton({
  editor,
  open,
  onOpenChange,
  active,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active: boolean;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasSelection = !editor.state.selection.empty;

  useEffect(() => {
    if (!open) return;
    const current = editor.getAttributes("link").href as string | undefined;
    setUrl(current ?? "");
    setLabel("");
    setError(null);
  }, [open, editor]);

  function apply() {
    const href = /^https?:\/\//i.test(url.trim()) ? url.trim() : url.trim() ? `https://${url.trim()}` : "";
    if (href && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(href)) {
      setError("Похоже, это не адрес сайта");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (hasSelection || active) chain.setLink({ href }).run();
    else chain.insertContent({ type: "text", text: label.trim() || href, marks: [{ type: "link", attrs: { href } }] }).insertContent(" ").run();
    onOpenChange(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="top"
      label="Ссылка"
      trigger={
        <IconButton label="Ссылка" shortcut="⌘⇧U" size="xs" pressed={active}>
          <Link2 />
        </IconButton>
      }
    >
      <form
        className={s.linkForm}
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <TextField label="Адрес" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} error={error ?? undefined} autoFocus />
        {!hasSelection && !active && <TextField label="Текст ссылки (необязательно)" value={label} onChange={(e) => setLabel(e.target.value)} />}
        <div className={s.linkActions}>
          {active && (
            <Button
              variant="ghost"
              size="s"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                onOpenChange(false);
              }}
            >
              Убрать ссылку
            </Button>
          )}
          <Button size="s" type="submit">
            Готово
          </Button>
        </div>
      </form>
    </Popover>
  );
}

export { popupBusy };

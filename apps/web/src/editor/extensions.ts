// Расширения TipTap для композера. Всё, что зависит от экрана (кого упоминать, что делать по Enter),
// приходит через getters, поэтому редактор не пересоздаётся при каждом обновлении данных.
import { Extension, markInputRule, mergeAttributes, type Editor } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { Italic } from "@tiptap/extension-italic";
import { Mention } from "@tiptap/extension-mention";
import { Strike } from "@tiptap/extension-strike";
import { Placeholder } from "@tiptap/extensions";
import { PluginKey } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { createStore, type StoreApi } from "zustand/vanilla";
import { SAFE_URL_RE } from "@teamchat/shared";
import type { MentionKind } from "./doc";

// Только сенсорный экран без мыши: телефон или планшет.
const touchOnly = () => window.matchMedia("(hover: none) and (pointer: coarse)").matches;

// ───────────── подсказки @ # : ─────────────

export type SuggestItem =
  | { kind: "user"; id: string; label: string; hint?: string }
  | { kind: "here" | "channel"; id: string; label: string; hint: string }
  | { kind: "conversation"; id: string; label: string; hint?: string; private: boolean }
  | { kind: "emoji"; id: string; label: string; char: string };

export type PopupState = {
  open: boolean;
  trigger: string;
  items: SuggestItem[];
  active: number;
  query: string;
  choose: ((item: SuggestItem) => void) | null;
};

export const createPopup = () =>
  createStore<PopupState>(() => ({ open: false, trigger: "@", items: [], active: 0, query: "", choose: null }));

export type Popup = StoreApi<PopupState>;

function popupRender(popup: Popup, trigger: string) {
  return () => ({
    onStart: (props: SuggestionProps<SuggestItem, SuggestItem>) =>
      popup.setState({ open: true, trigger, items: props.items, active: 0, query: props.query, choose: props.command }),
    onUpdate: (props: SuggestionProps<SuggestItem, SuggestItem>) =>
      popup.setState((st) => ({
        open: st.open || st.query !== props.query,
        items: props.items,
        active: st.query === props.query ? Math.min(st.active, Math.max(0, props.items.length - 1)) : 0,
        query: props.query,
        choose: props.command,
      })),
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      const st = popup.getState();
      if (!st.open || st.items.length === 0) return false;
      const n = st.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        popup.setState({ active: (st.active + (event.key === "ArrowDown" ? 1 : n - 1)) % n });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        st.choose?.(st.items[st.active]!);
        return true;
      }
      if (event.key === "Escape") {
        popup.setState({ open: false });
        return true;
      }
      return false;
    },
    onExit: () => popup.setState({ open: false, items: [], choose: null, query: "" }),
  });
}

export const popupBusy = (popup: Popup) => {
  const st = popup.getState();
  return st.open && st.items.length > 0;
};

// ───────────── метки: *жирный*, _курсив_, ~зачёркнутый~ ─────────────

const star = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;
const doubleStar = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
const underscore = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/;
const tilde = /(?:^|\s)(~(?!\s+~)((?:[^~]+))~(?!\s+~))$/;
const doubleTilde = /(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~(?!\s+~~))$/;

const SlackBold = Bold.extend({
  addInputRules() {
    return [markInputRule({ find: doubleStar, type: this.type }), markInputRule({ find: star, type: this.type })];
  },
  addPasteRules() {
    return [];
  },
});

const SlackItalic = Italic.extend({
  addInputRules() {
    return [markInputRule({ find: underscore, type: this.type })];
  },
  addPasteRules() {
    return [];
  },
});

const SlackStrike = Strike.extend({
  addInputRules() {
    return [markInputRule({ find: doubleTilde, type: this.type }), markInputRule({ find: tilde, type: this.type })];
  },
  addPasteRules() {
    return [];
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike(), "Mod-Shift-s": () => this.editor.commands.toggleStrike() };
  },
});

const SlackCode = Code.extend({
  addKeyboardShortcuts() {
    return { "Mod-e": () => this.editor.commands.toggleCode(), "Mod-Shift-c": () => this.editor.commands.toggleCode() };
  },
});

const SlackQuote = Blockquote.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-9": () => this.editor.commands.toggleBlockquote(), "Mod-Shift-b": () => this.editor.commands.toggleBlockquote() };
  },
});

// ───────────── упоминания: @человек, @here, @channel, #канал ─────────────

const TeamMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: "user",
        parseHTML: (el) => el.getAttribute("data-kind") ?? "user",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },
});

const prefix = (kind: MentionKind) => (kind === "conversation" ? "#" : "@");

// ───────────── сборка ─────────────

export type EditorHooks = {
  popup: Popup;
  people: (query: string) => SuggestItem[];
  channels: (query: string) => Promise<SuggestItem[]>;
  emoji: (query: string) => Promise<SuggestItem[]>;
  onEmojiChosen: (name: string) => void;
  submit: () => boolean;
  cancel: () => boolean;
  editLast: () => boolean;
  openLink: () => boolean;
};

export function composerExtensions(placeholder: string, hooks: () => EditorHooks) {
  const h = () => hooks();
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      hardBreak: false,
      underline: false,
      trailingNode: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      blockquote: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        isAllowedUri: (url) => SAFE_URL_RE.test(url),
        HTMLAttributes: { rel: "noopener noreferrer", target: null },
      },
    }),
    SlackBold,
    SlackItalic,
    SlackStrike,
    SlackCode,
    SlackQuote,
    Placeholder.configure({ placeholder }),
    TeamMention.configure({
      HTMLAttributes: { class: "mention" },
      renderText: ({ node }) => `${prefix(node.attrs.kind as MentionKind)}${node.attrs.label ?? ""}`,
      renderHTML: ({ options, node }) => [
        "span",
        mergeAttributes({ class: node.attrs.kind === "conversation" ? "mention channel" : "mention" }, options.HTMLAttributes),
        `${prefix(node.attrs.kind as MentionKind)}${node.attrs.label ?? ""}`,
      ],
      suggestions: [
        {
          char: "@",
          pluginKey: new PluginKey("mentionPeople"),
          items: ({ query }) => h().people(query),
          command: ({ editor, range, props }) => insertMention(editor, range, props as SuggestItem),
          render: popupRender(hooks().popup, "@"),
        },
        {
          char: "#",
          pluginKey: new PluginKey("mentionChannels"),
          items: ({ query }) => h().channels(query),
          command: ({ editor, range, props }) => insertMention(editor, range, props as SuggestItem),
          render: popupRender(hooks().popup, "#"),
        },
      ],
    }),
    Extension.create({
      name: "emojiSuggest",
      addProseMirrorPlugins() {
        return [
          Suggestion<SuggestItem, SuggestItem>({
            editor: this.editor,
            char: ":",
            pluginKey: new PluginKey("emojiSuggest"),
            items: ({ query }) => (query.length < 2 ? [] : h().emoji(query)),
            command: ({ editor, range, props }) => {
              if (props.kind !== "emoji") return;
              editor.chain().focus().insertContentAt(range, props.char).run();
              h().onEmojiChosen(props.id);
            },
            render: popupRender(hooks().popup, ":"),
          }),
        ];
      },
    }),
    Extension.create({
      name: "composerKeys",
      // Раньше списков и кода: Enter отправляет везде, кроме блока кода.
      priority: 1000,
      addKeyboardShortcuts() {
        const busy = () => popupBusy(h().popup);
        const newline = ({ editor }: { editor: Editor }) => {
          if (busy()) return false;
          if (editor.isActive("codeBlock")) return editor.commands.newlineInCode();
          if (editor.isActive("listItem")) {
            return editor.commands.first(({ commands }) => [() => commands.splitListItem("listItem"), () => commands.liftListItem("listItem")]);
          }
          return editor.commands.first(({ commands }) => [() => commands.liftEmptyBlock(), () => commands.splitBlock()]);
        };
        return {
          // На телефоне Enter экранной клавиатуры — новая строка, отправляют кнопкой, как в мессенджерах.
          Enter: ({ editor }) => (touchOnly() ? newline({ editor }) : busy() || editor.isActive("codeBlock") ? false : h().submit()),
          "Mod-Enter": () => (busy() ? false : h().submit()),
          "Shift-Enter": newline,
          Escape: () => (busy() ? false : h().cancel()),
          ArrowUp: ({ editor }) => (!busy() && editor.isEmpty ? h().editLast() : false),
          "Mod-Shift-u": () => h().openLink(),
        };
      },
    }),
  ];
}

function insertMention(editor: Editor, range: { from: number; to: number }, item: SuggestItem) {
  if (item.kind === "emoji") return;
  const nodeAfter = editor.view.state.selection.$to.nodeAfter;
  const to = nodeAfter?.text?.startsWith(" ") ? range.to + 1 : range.to;
  editor
    .chain()
    .focus()
    .insertContentAt({ from: range.from, to }, [
      { type: "mention", attrs: { id: item.id, label: item.label, kind: item.kind } },
      { type: "text", text: " " },
    ])
    .run();
}

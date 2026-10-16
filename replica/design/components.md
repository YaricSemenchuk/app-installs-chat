# Components

Айдентика Promobile: Rubik 400/500/600, акцент `#4262ff`, светлые нейтральные поверхности,
радиусы 8/10/12/16/999, контролы 28/32/40/48. Токены — `tokens.json` и `tokens.dark.json`.
В коде компоненты используют только CSS-переменные из `tokens.css`, без hex.

Основа:
- **Radix Primitives** — Dialog, AlertDialog, DropdownMenu, ContextMenu, Popover, Tooltip,
  Tabs, Switch, Checkbox, RadioGroup, Select, Toast, ScrollArea, VisuallyHidden;
- **TipTap** — композер;
- **react-virtuoso** — ленты;
- **Lucide** (ISC) — иконки 16 px в слоте 20 px;
- эмодзи — Unicode-набор с данными из `emojibase` (MIT). Картинки эмодзи — системные (native),
  чужие спрайты не берём.

Общие правила:
- **Фокус.** У всего интерактивного `:focus-visible` даёт кольцо 2 px `--focus-ring` с
  отступом 2 px. Ховер не заменяет фокус.
- **Минимальная цель** — 28×28 (`control-xs`); иконки-кнопки в тулбаре сообщения тоже 28.
- **Состояния.** Каждый компонент описан с default / hover / active / focus-visible / disabled;
  где есть данные — loading / empty / error.
- **Движение.** `--motion-fast` для ховеров, `--motion-base` для появления поповеров и модалок;
  при `prefers-reduced-motion` остаётся только opacity.
- **Тексты** пишем свои, по-русски, без калек со Slack.

---

## Primitives

```
Button
  variants  primary (accent), secondary (accent-soft + link text), ghost (прозрачная, text-secondary),
            danger (danger), danger-ghost (danger-text)
  sizes     s 32px (padding 0 12, font body), m 40px (0 16, font body), l 48px (0 24, 16/20 500)
  states    default, hover (primary → accent-hover, ghost → surface-hover), active (translateY 0, без
            «нажатия»), focus-visible (кольцо), disabled (opacity .45, cursor not-allowed),
            loading (спиннер вместо иконки, подпись остаётся для скринридера, aria-busy)
  tokens    radius button 10, gap 8, иконка 16 слева
  a11y      настоящий <button>; type="button" по умолчанию; у кнопки-иконки обязателен aria-label
  used on   S01, S02, S08–S13, S16, S17, S20, S32, S36–S39

IconButton
  variants  ghost (по умолчанию), toggled (aria-pressed: accent-soft + link)
  sizes     xs 28, s 32
  states    как Button + tooltip по hover/focus с задержкой 400 мс
  a11y      aria-label = текст тултипа; горячая клавиша в тултипе через Kbd
  used on   S05 (шапка), S15 (тулбар сообщения), композер, S07

TextField / Textarea
  variants  default, with-icon (поиск), with-prefix («#» в имени канала)
  sizes     m 40 (поля форм), s 32 (фильтры)
  states    default (border-input), hover (border text-muted), focus (border accent + кольцо),
            error (border danger-text + текст ошибки под полем, aria-invalid + aria-describedby),
            disabled, read-only
  tokens    radius input 12, padding 0 12, bg bg, placeholder text-muted
  a11y      <label> всегда (видимый или VisuallyHidden); счётчик символов для имени канала (80)
            и темы (250) объявляется через aria-live=polite
  used on   S01, S02, S08, S10, S12, S13, S17, S32, S36, S39

Checkbox / Switch / RadioGroup
  states    off, on, indeterminate (checkbox), hover, focus-visible, disabled
  tokens    on → accent; рамка border-input; радиус 4 у checkbox, pill у switch
  a11y      Radix: role и aria-checked из коробки; подпись кликабельна
  used on   S07 (также в канал), S16, S34, S35, S38

Select
  states    closed, open, option hover/selected, disabled
  tokens    триггер как TextField m; список — Popover
  used on   S20, S33, S34, S36, S38

Tooltip
  tokens    bg tooltip-bg (фирменный синий Promobile), text tooltip-text, caption 12/16 500,
            radius chip 8, padding 4 8, без стрелки
  behaviour задержка 400 мс; при переходе между соседними иконками — без задержки
  a11y      только дублирует aria-label, ничего важного только в тултипе
  used on   везде

Popover / DropdownMenu / ContextMenu
  tokens    bg raised, border border, shadow pop, radius input 12, padding 4;
            пункт 32 px, radius chip 8, hover surface-hover, danger-пункт danger-text
  states    item default, hover/highlighted, disabled, с подменю, с Kbd справа, разделитель
  a11y      стрелки ↑↓, Enter, Esc закрывает и возвращает фокус; ContextMenu по правому клику
            на сообщении = то же меню, что «…» в тулбаре
  used on   S04 (меню раздела), S15, S30, S33, S35

Dialog / ConfirmDialog
  sizes     s 440, m 560, l 720 (ширина), высота по содержимому, max 85vh, скролл внутри
  tokens    bg raised, radius card 16, shadow modal, overlay (overlay 40%), padding 24,
            заголовок heading-s
  states    open, submitting (кнопка loading, поля disabled), error (баннер ошибки над футером)
  a11y      фокус-ловушка, Esc закрывает (не во время отправки), фокус на первое поле,
            возврат фокуса на триггер; ConfirmDialog = AlertDialog, опасное действие — danger
            и не в фокусе по умолчанию
  used on   S08–S13, S16 (удаление), S17, S32, S36, S39, S40

Tabs
  variants  underline (вкладки канала, поиска), pills (фильтры Activity)
  states    default (text-secondary), hover (text), selected (text + 2px accent снизу | accent-soft
            для pills), focus-visible, с бейджем
  a11y      Radix Tabs: ←→ между вкладками
  used on   S05, S08, S21, S24, S26

Toast
  variants  info, success (иконка success), error (иконка danger-text), undo (кнопка «Отменить»)
  tokens    bg text (инверсия: тёмный тост на светлой теме, светлый на тёмной), text bg,
            radius input 12, внизу слева над композером, 5 с (undo — 8 с)
  a11y      role=status; undo доступен с клавиатуры (F6 → тост)
  used on   S23 (прочитано, отменить), S16, S17, F12

Avatar
  sizes     xs 16, s 20, m 24, l 36 (сообщения), xl 72 (профиль)
  variants  фото, инициалы (bg из 6 тонов status-01…06 Promobile по хэшу id, text на них ≥4.5),
            группа (2 аватара внахлёст для группового ЛС)
  states    с PresenceDot, деактивирован (grayscale + opacity .6)
  tokens    radius avatar 999
  a11y      alt = имя; декоративный рядом с именем — alt=""
  used on   везде

PresenceDot
  variants  active (presence-active, залитый), away (кольцо presence-away), dnd (луна 10 px)
  sizes     8 при аватаре s/m, 10 при l, 14 при xl; обводка 2 px цветом фона под аватаром
  a11y      текст состояния в aria-label аватара («Аня, в сети»)

Badge (счётчик)
  variants  mention (accent + on-accent), count-muted (border-strong + text для «12 новых»)
  tokens    label 12/16 500, min-width 18, height 18, radius pill, padding 0 6; 99+
  a11y      «3 упоминания» в aria-label пункта, не голая цифра
  used on   S04, S22, S24, Titlebar (иконка Activity)

StatusChip
  variants  emoji + текст (в профиле), только emoji (у имени в сайдбаре и сообщениях)
  states    истекает (тултип «до 18:00»)
  used on   S04, S05, S31

Kbd
  tokens    caption 12/16 500, bg surface, border border-strong, radius 4, padding 0 4; ⌘ ⇧ ⌥ на
            macOS, Ctrl/Shift/Alt на Windows
  used on   тултипы, S40, меню

Skeleton / Spinner
  Skeleton  border-strong (surface-hover почти не виден на bg в обеих темах), radius по форме;
            пульсация opacity 1.2 с (выкл. при reduced-motion)
  Spinner   16/20, цвет текущего текста; aria-label «Загрузка»
  used on   S05 (история), S11, S24, S26, S28

EmptyState
  layout    по центру области: иконка Lucide 24 в text-muted (без иллюстраций), заголовок title,
            текст body-read text-secondary до 360 px, одно действие (Button secondary)
  тексты    свои для каждого места (см. «Тексты пустых состояний»)
  used on   S11, S14, S21–S25, S28, S29

Banner (ConnectionBanner)
  variants  reconnecting (warning-край, «Переподключаемся…», спиннер), offline («Нет сети. Сообщения
            уйдут, когда связь вернётся»), restored (success-text, исчезает через 2 с)
  tokens    высота 32, над лентой, body, bg highlight
  a11y      role=status, aria-live=polite
  used on   S43
```

## Shell and navigation

```
Titlebar
  height    44, bg surface, нижняя граница border
  parts     слева — отступ под «светофор» macOS (78 px в Electron, 12 в браузере) и кнопки назад/вперёд;
            по центру — SearchField (max 640); справа — Activity (с Badge), аватар (меню профиля S30)
  electron  -webkit-app-region: drag на фоне, no-drag на контролах
  used on   S03

Sidebar
  width     264 по умолчанию, ресайз 200–400 за правую границу (курсор col-resize, ←→ с клавиатуры)
  bg        surface; в тёмной теме самый тёмный слой (#0a0a0a), лента светлее
  parts     шапка: название workspace (title) + меню (пригласить, настройки — для админов);
            быстрые пункты: Activity, Треды, Черновики и отправленные, Сохранённое, Файлы;
            разделы: свои, Каналы, Личные сообщения
  a11y      <nav aria-label="Разговоры">; ⌥↑/↓ по пунктам, ⌥⇧↑/↓ по непрочитанным
  used on   S04

SidebarSection
  parts     заголовок label 12/16 500 text-muted, шеврон, «+» и «…» по hover
  states    развёрнут, свёрнут (показывает только непрочитанные и выбранный)
  a11y      заголовок = кнопка с aria-expanded

SidebarItem
  height    28, padding 0 8, radius chip 8, иконка/аватар 16–20, gap 8
  variants  канал (# или замок), ЛС (Avatar s + PresenceDot), групповое ЛС (число участников в
            квадратике), служебный пункт (иконка Lucide)
  states    read (body-read text-secondary), unread (name 600 text), mention (unread + Badge mention),
            muted (text-muted, без жирного, без бейджа), selected (bg accent-soft, text, 600),
            hover (surface-hover), focus-visible, черновик (иконка карандаша справа вместо бейджа),
            dragging (shadow pop, opacity .9)
  a11y      ссылка; aria-current="page" у выбранного; в aria-label число непрочитанных и упоминаний

ConversationHeader
  height    52, bg bg, нижняя граница border, padding 0 20
  parts     название (title, # или замок; ЛС — аватар + имя + статус), тема (caption text-muted,
            одна строка с многоточием), справа: аватары участников + число, IconButton
            колокольчик (S35), детали (S08)
  states    канал, ЛС, групповое ЛС, архив (бейдж «Архив»)
  used on   S05, S06

ConversationTabs
  variants  underline-Tabs под заголовком: Сообщения, Закреплённое, закладки-ссылки, «+»
  used on   S05, S29

ThreadPanel
  width     400, ресайз 320–600, левая граница border; < 1024 px — поверх ленты с overlay
  parts     шапка «Тред» + название канала caption, закрыть, «открыть в окне» (Electron);
            родитель, разделитель «N ответов», ответы, композер-тред
  used on   S07
```

## Messages

```
MessageList
  impl      react-virtuoso, обратная прокрутка, firstItemIndex для подгрузки вверх, followOutput
            «если внизу»; кнопка «↓ К новым (N)» справа снизу, когда пользователь выше
  parts     DateDivider, UnreadDivider, Message, системные сообщения, «Начало канала»-интро
  states    loading (3 skeleton-сообщения), empty (интро канала, см. тексты), history-loading
            (спиннер сверху), error (баннер + «Повторить»), jumped (прыжок к сообщению из поиска
            или ссылки: подсветка highlight 2 с)
  a11y      role="log" aria-live="polite" только для новых сообщений снизу; F6 переводит фокус в ленту,
            ↑↓ между сообщениями, Enter открывает тред, остальные клавиши — как в recon (R, E, F, P, A, M)

DateDivider
  look      линия border, по центру пилюля caption 12/16 500 в bg с рамкой: «Сегодня», «Вчера»,
            «Пятница, 10 октября», «10 октября 2025» для прошлых лет
  behaviour sticky под шапкой при прокрутке

UnreadDivider
  look      линия accent 1 px, справа подпись label «Новые» цветом link
  behaviour уходит после отметки прочтения и переключения разговора

Message
  layout    gutter 20; аватар l 36 слева; строка имени: name + время caption text-muted
            (hover → полная дата в тултипе) + StatusChip; текст message 14/22 400
  variants  first (с аватаром и именем), continuation (тот же автор < 5 мин: без аватара, время
            появляется слева на hover), system (иконка 16 + caption text-secondary, без аватара),
            deleted («Сообщение удалено» курсивом text-muted, только у родителей с ответами),
            forwarded (карточка источника с левой линией border-strong), broadcast из треда
            («ответил(а) в треде: …» caption)
  states    default, hover (bg surface-hover + MessageActions), focused (то же + кольцо),
            mentions-me (bg highlight + левая линия 2 px highlight-edge), highlighted (после
            перехода по ссылке), sending (opacity .6), failed (danger-text «Не отправлено» +
            «Повторить» / «Удалить»), edited (caption «(изменено)» с датой в тултипе)
  content   разметка: *жирный* 600, _курсив_, ~зачёркнутый~, `код` (code-bg, code-text, radius 4),
            блок кода (code-bg, border, radius 8, mono 13/20, горизонтальный скролл), цитата
            (левая линия 3 px border-strong, text-secondary), списки, ссылки (link, подчёркивание
            на hover), упоминания (MentionChip), эмодзи 20 px в тексте; сообщение только из
            1–3 эмодзи — 32 px
  a11y      article с aria-label «Аня, 14:02»; время — <time datetime>

MentionChip
  variants  user (mention-bg + mention-text, 500), me (mention-me-bg + mention-me-text),
            channel («#имя»), here/channel/everyone (как me у всех, кого задело)
  states    hover (подчёркивание + карточка UserCard по клику)

MessageActions (hover toolbar)
  position  справа сверху над сообщением, -16 px, bg raised, border, shadow pop, radius input 12
  items     3 быстрые реакции (последние использованные), добавить реакцию, ответить в треде,
            переслать, сохранить, «…» (DropdownMenu S15)
  a11y      появляется и по фокусу сообщения; Tab идёт по кнопкам
  used on   S05–S07, S15

ThreadSummary
  look      строка под сообщением: до 5 аватаров xs, «12 ответов» (link 500), «Последний ответ
            сегодня в 14:30» caption text-muted (на hover — «Открыть тред»)
  states    default, unread (точка accent перед счётчиком), hover (bg raised + border)

ReactionPill
  look      height 24, padding 0 6, radius pill, эмодзи 16 + счётчик label 12/16 500,
            bg surface, border transparent
  states    default, mine (bg accent-soft, border accent, счётчик link), hover (border border-strong,
            тултип «Аня, Петя и ещё 3»), disabled (архивный канал)
  ReactionAdd  та же форма с иконкой smile-plus, видна на hover сообщения
  a11y      aria-pressed = поставил ли я; aria-label «Реакция 👍, 4, вы среди них»

TypingIndicator
  look      под композером, caption text-muted: «Аня печатает…», «Аня и Петя печатают…»,
            «Несколько человек печатают…»; три точки без анимации при reduced-motion
```

## Composer

```
Composer
  look      над низом ленты, отступ 0 20 20; рамка border-input, radius input 12, bg bg;
            focus-within → border accent + кольцо; min 44, max 50vh со скроллом
  parts     FormattingToolbar (сверху, скрываемый), поле TipTap, нижняя строка: «+» (файлы),
            эмодзи, «@», справа Send (IconButton primary, 32) + стрелка расписания (S20)
  variants  channel («Сообщение в #design»), thread («Ответить…» + чекбокс «Также отправить в
            #канал»), edit (inline в сообщении: «Esc — отмена, Enter — сохранить»), dm («Сообщение Ане»)
  states    empty (Send disabled), typing, with-attachments (FileChips над полем с прогрессом),
            sending, disabled (архив: «Канал в архиве» / нет прав на постинг: «Писать могут только
            администраторы»), drag-over (рамка accent пунктиром + «Отпустите, чтобы прикрепить»)
  a11y      поле — role=textbox aria-multiline; подсказка про Enter/Shift+Enter в aria-describedby;
            ↑ в пустом поле — правка последнего сообщения

FormattingToolbar
  items     Ж, К, Ч(подчёркивание), Зачёркнутый, Ссылка, Нумерованный, Маркированный, Цитата,
            Код, Блок кода — IconButton xs toggled; Kbd в тултипах (⌘B, ⌘I, ⌘U, ⌘⇧X, ⌘⇧U, ⌘⇧7,
            ⌘⇧8, ⌘⇧9, ⌘⇧C, ⌘⌥⇧C)

AutocompletePopover
  triggers  @ люди и @here/@channel, # каналы, : эмодзи (с 2 символов), / команды
  look      Popover над курсором, до 8 пунктов, пункт 36 (аватар s + имя 500 + display/real name
            caption), выделенный — surface-hover
  states    loading, empty («Никого не нашли»), @channel в канале от 6 человек → ConfirmDialog
            при отправке
  a11y      combobox + listbox, ↑↓ Enter Tab, Esc закрывает без вставки

EmojiPicker
  size      352 × 400, Popover
  parts     поиск (фокус сразу), «Недавние», категории-вкладки снизу, свои эмодзи workspace, тон кожи
  a11y      grid с ←↑→↓, Enter выбирает, имя эмодзи в aria-label

FileChip (в композере)
  look      48 высота, иконка типа / миниатюра 36, имя (обрезка в середине), размер caption,
            крестик; прогресс — полоса accent снизу
  states    uploading (%), ready, error (danger-text «Не загрузилось» + повтор), too-large
            («Файл больше 100 МБ»)
```

## Content in messages

```
FileCard
  variants  image (до 360×360, radius input 12, клик → Lightbox), several images (сетка 2×2 / ряд),
            pdf / doc / archive / other (карточка 56: иконка типа в квадрате tone-цвета Promobile,
            имя, «PDF · 2,4 МБ», скачать), video (нативный <video controls>, постер-миниатюра)
  states    loading (skeleton нужного размера по width/height), failed, deleted
  a11y      alt из alt_text, иначе имя файла

Lightbox
  overlay   overlay 85%, изображение по центру, имя, кто и когда, скачать, ←→ между картинками
            сообщения, Esc закрывает

LinkUnfurl
  look      левая линия 3 px border-strong, site_name caption text-muted, заголовок link 600,
            описание text-secondary до 3 строк, картинка 80×80 справа (radius chip)
  states    loading (не показываем), ready, hidden (автор убрал — исчезает)
```

## Lists, search, people

```
SearchField (titlebar)
  look      TextField s, иконка search, плейсхолдер «Поиск по чату», Kbd ⌘G справа
  open      dropdown: недавние запросы, подсказки модификаторов (in: from: has: before: after:),
            люди и каналы по совпадению

SearchResults (S26)
  layout    вкладки Сообщения / Файлы / Люди / Каналы + фильтры (Popover-кнопки: в канале, от кого,
            дата); результат — Message compact с названием канала и подсветкой совпадений
            (mark: bg highlight, без жирного)
  states    loading, empty (тексты), error

QuickSwitcher (S27)
  look      Dialog s без заголовка, наверху поле, список: непрочитанные сверху, потом недавние;
            пункт 36 как SidebarItem + раздел caption справа
  a11y      combobox; Enter открывает, ⌘Enter — в новом окне (Electron)

UserCard (S31)
  variants  popover (по клику на имя/аватар: Avatar xl, имя heading-s, должность, статус, «Местное
            время 14:02», кнопки «Написать», «…»), panel (полный профиль справа, как ThreadPanel)
  states    away, dnd («Уведомления на паузе до 15:00»), deactivated («Аккаунт отключён»)

ActivityItem (S24)
  layout    иконка типа (mention @, ответ, реакция, ЛС, напоминание) 16 в кружке tone-цвета,
            текст «Аня упомянула вас в #design», цитата сообщения 2 строки, время
  states    unread (точка accent слева + 600), read, cleared (исчезает с undo-тостом), hover
  variants  detailed / dense (одна строка)
```

## Тексты пустых состояний

Свои формулировки, короткие, с одним действием:

| место | заголовок | текст | действие |
| --- | --- | --- | --- |
| новый канал | «Это начало #design» | тема канала или «Опишите, о чём этот канал, чтобы новички понимали, куда писать» | «Добавить описание» |
| новое ЛС | имя и аватар собеседника | «Здесь будет ваша переписка с Аней. Видите её только вы двое» | — |
| ЛС с собой | «Ваше личное место» | «Заметки, ссылки и черновики для себя. Никто, кроме вас, это не видит» | — |
| Треды | «Тредов пока нет» | «Ответьте в треде на любое сообщение, и он появится здесь» | — |
| Activity | «Ничего нового» | «Упоминания, ответы и реакции на ваши сообщения будут здесь» | — |
| Сохранённое | «Пока пусто» | «Сохраняйте сообщения, к которым нужно вернуться: наведите на сообщение и нажмите закладку» | — |
| Черновики | «Черновиков нет» | «Незаконченные сообщения сохраняются сами и ждут вас здесь» | — |
| Файлы | «Файлов ещё нет» | «Всё, что отправят в ваши каналы и личные сообщения, соберётся здесь» | — |
| Поиск, нет результатов | «Ничего не нашли по „…“» | «Проверьте написание или уберите фильтры» | «Сбросить фильтры» |
| Каталог каналов | «Каналов по запросу нет» | «Создайте свой, если такого ещё нет» | «Создать канал» |
| Закреплённое | «Ничего не закреплено» | «Закрепляйте важное через меню сообщения, и оно будет под рукой у всех в канале» | — |

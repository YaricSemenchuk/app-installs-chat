# Recon map: Slack (web + desktop Electron)

Scope: ядро переписки — один workspace, каналы, личные и групповые ЛС, треды,
реакции, упоминания, файлы, поиск, непрочитанное, уведомления, статусы, десктоп-приложение.
Без звонков (huddles), ботов и интеграций в v1.
For: внутренний чат своей компании, до 30 человек. Хостинг — Railway (предварительно).
Date: 2026-10-17

Метод: clean-room. Только публичные источники — help center, публичная API-документация,
pricing, release notes, карточки в сторах. Код Slack не читали, JS-бандлы не открывали,
сетевые вызовы не логировали, ни в какой аккаунт не входили. REA к Slack не применялся
(см. «Роль REA» в конце). Условия Slack про reverse engineering проверить не удалось:
Acceptable Use Policy лежит в PDF на стороне Salesforce, а страница пользовательских условий
такого пункта не содержит. Поэтому работаем только от публичных страниц.

Обозначения ссылок: `H/<id>` = `https://slack.com/help/articles/<id>`,
`D/<path>` = `https://docs.slack.dev/<path>`.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center: quick start | https://slack.com/help/articles/360059928654 | структура окна, вкладки навбара |
| 2 | help center: sidebar | H/212596808, H/360043207674 | сайдбар, разделы (разделы — платно) |
| 3 | help center: messages | H/201457107, H/202395258, H/202288908 | отправка, правка/удаление/unsend, форматирование |
| 4 | help center: threads | H/115000769927 | треды, подписка, вид «Треды» |
| 5 | help center: channels | H/201402297, H/213185307, H/201375146, H/201980108, H/201898998 | создание, архив, выход, участники, каналы по умолчанию |
| 6 | help center: DMs | H/212281468 | ЛС, групповые ЛС до 9 человек |
| 7 | help center: notifications | H/201355156, H/360056534254, H/214908388 | глобальные/поканальные настройки, пауза, расписание |
| 8 | help center: read state | H/226410907, H/46751260742035 | Unreads, новый Activity |
| 9 | help center: search | H/202528808 | модификаторы, вкладки результатов |
| 10 | help center: pins/bookmarks/saved/forward | H/205239997, H/360042650274, H/203274767, H/1500012915082 | пины, вкладки канала, сохранённое, пересылка, отложенная отправка |
| 11 | help center: status, roles, admin | H/201864558, H/201314026, H/204475027, H/206870177, H/201330256, H/212675257 | статусы, роли, деактивация, emoji, инвайты, вход |
| 12 | help center: shortcuts | H/201374536, H/217626598 | горячие клавиши, ⌘K |
| 13 | help center: changelog | https://slack.com/help/articles/115004846068 | изменения сен 2025 – окт 2026 |
| 14 | pricing | https://slack.com/pricing | что гейтится планом |
| 15 | desktop release notes | https://slack.com/release-notes/mac | 4.52.178 от 5 окт 2026, только багфиксы |
| 16 | system requirements | H/115002037526 | macOS 13+, Windows 11 23H2+ |
| 17 | App Store / Mac App Store | https://apps.apple.com/us/app/slack/id618783545, https://apps.apple.com/us/app/slack-for-desktop/id803453959?mt=12 | iOS 4.1★ (54K) |
| 18 | public API: objects | D/reference/objects/user-object, D/reference/objects/conversation-object, D/reference/objects/file-object/ | модель данных |
| 19 | public API: methods | D/reference/methods/chat.postMessage/, conversations.history, conversations.mark, conversations.open, reactions.add, pins.add, bookmarks.add, chat.scheduleMessage, reminders.add, usergroups.create, emoji.list, files.getUploadURLExternal | поля, лимиты, ошибки |
| 20 | public API: events | D/reference/events/, D/reference/events/message/, presence_change, user_typing, reaction_added, member_joined_channel | realtime-события |
| 21 | public API: formatting | D/messaging/formatting-message-text, D/messaging/retrieving-messages/ | mrkdwn, кодирование упоминаний, треды |
| 22 | deep links | D/interactivity/deep-linking/ | `slack://channel?team=&id=` и т. п. |
| 23 | blog: Activity | https://slack.com/blog/news/slack-activity-triage-for-notifications | Activity-редизайн, май 2026 |
| 24 | собственный аккаунт пользователя | — | не использовался. Скриншоты своего Slack можно положить в `replica/screens/` как референс |

Что ценят пользователи (судя по тому, что Slack закрывает платным планом): вся история
и поиск по ней (Free видит 90 дней), групповые звонки, разделы сайдбара, группы пользователей,
SSO, интеграции. Для своего клона это бесплатно: вся история доступна сразу.

## Core loop

Человек открывает приложение, видит, где есть непрочитанное или упоминание, читает и отвечает
в канале, ЛС или треде — и всё это моментально доходит до остальных с уведомлением.

## Screens

Состояния, отмеченные *(guess)*, в документации не описаны; это наш вывод.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Вход | `/signin` | вход в workspace | поле email, Continue, ввод кода из письма | ввод, код отправлен, неверный код *(guess)*, просроченный инвайт *(guess)* |
| S02 | Принятие инвайта | ссылка Join Now из письма или invite-link | создать профиль | имя, аватар, Continue | валидный, просрочен (30 дней), лимит ссылки исчерпан |
| S03 | Оболочка приложения | после входа | каркас | навбар (Home, DMs, Activity, Files, More), сайдбар, верхний поиск, аватар | загрузка, офлайн/переподключение *(guess)* |
| S04 | Сайдбар | левая колонка Home | навигация по разговорам | пункты Unreads/Threads/Drafts & sent/Saved, разделы Каналы и ЛС, свои разделы, меню «Manage sidebar» | пусто (новый пользователь), жирное = непрочитано, бейдж упоминаний, замьючено (серым) |
| S05 | Канал | клик по каналу; `/c/:id` | читать и писать | шапка (имя, тема, участники), вкладки (Messages, Pins, закладки), лента, композер | пустой канал, загрузка истории вверх, архивный (только чтение), нет доступа |
| S06 | ЛС / групповое ЛС | клик по ЛС; `/d/:id` | личная переписка | шапка с именами/аватарами, карандаш переименования, добавить людей, лента, композер | первое сообщение (пусто), собеседник деактивирован *(guess)* |
| S07 | Панель треда | «Reply in thread» или `T` | ответы на сообщение | родитель, ответы, композер, чекбокс «также отправить в канал», кнопка «в отдельное окно» | нет ответов, родитель удалён *(guess)* |
| S08 | Детали канала | клик по имени канала; ⌘⇧I | инфо и управление | вкладки About (тема, описание ≤250), Members, Settings | только чтение для не-менеджеров |
| S09 | Настройки канала | Детали → Settings | администрирование канала | архив, удаление, сделать приватным, права на постинг, разрешить @here/@channel | #general защищён, нет прав |
| S10 | Создание канала | «+» → Channel | новый канал | имя, public/private, Create | имя занято, недопустимые символы, нет прав |
| S11 | Каталог каналов | ⌘⇧L / Directories → Channels | найти и вступить | поиск, список, фильтр Archived, Join | пусто, ничего не найдено |
| S12 | Добавить людей | Детали → Members → Add people | добавить в канал | поиск по имени/email, вставка списка, Add | уже участник, гость нельзя *(guess)* |
| S13 | Новое сообщение | «+» → Message; ⌘N | начать ЛС/групповое ЛС | выбор получателей (до 8 + я), композер | существующее ЛС открывается вместо нового |
| S14 | Вкладка DMs | навбар DMs; ⌘⇧K | список ЛС | поиск, список с превью последнего сообщения | пусто |
| S15 | Меню действий сообщения | hover над сообщением | действия | реакция, ответ в треде, переслать, сохранить, «…»: редактировать, удалить, закрепить, копировать ссылку, отметить непрочитанным, напомнить | недоступные действия скрыты по правам |
| S16 | Правка / удаление | меню → Edit / Delete; `↑` / ⌘Z | изменить отправленное | инлайн-редактор, Save, подтверждение удаления, Unsend (15 с) | окно правки истекло (админ-настройка) |
| S17 | Пересылка | меню → Forward; `F` | переслать | выбор адресата, комментарий, Forward, «запланировать» | приватный источник: «показать сообщение / только ссылку» |
| S18 | Эмодзи-пикер | смайлик в композере / реакция | вставить эмодзи | поиск, категории, недавние, свои эмодзи, тон кожи | — |
| S19 | Автодополнение | `@`, `#`, `:`, `/` в композере | упоминания, каналы, эмодзи, команды | список с подсветкой, @here/@channel | подтверждение @channel в канале от 6 человек |
| S20 | Отложенная отправка | стрелка у кнопки Send | отправить позже | пресеты времени, свой выбор даты/времени | время в прошлом *(guess)* |
| S21 | Drafts & sent | пункт в сайдбаре | черновики и отправленное | вкладки Drafts / Scheduled / Sent, правка, отмена, отправить сейчас | пусто |
| S22 | Треды | Home → Threads; ⌘⇧T | все мои треды | непрочитанные сверху, ответ на месте | пусто |
| S23 | Непрочитанное | Unreads; ⌘⇧A | разобрать всё новое | группы по разговорам, сортировка, «Mark as read» (с Undo), «Mark all read» | всё прочитано |
| S24 | Activity | навбар Activity; ⌘⇧M | лента событий про меня | фильтры All / DMs / Mentions / Threads / Reactions / Reminders, только непрочитанные, плотный/детальный вид, clear | пусто *(guess)* |
| S25 | Сохранённое | Home → Saved | закладки «на потом» | список, открыть, убрать, напоминание | пусто *(guess)* |
| S26 | Результаты поиска | верхний поиск; ⌘G | найти | подсказки и недавние, вкладки Messages / Files / People / Channels, фильтры | ничего не найдено *(guess)* |
| S27 | Быстрый переключатель | ⌘K | прыжок к разговору | поле, список с непрочитанными | ничего не найдено |
| S28 | Файлы | навбар Files | все файлы | список, фильтр по типу, поиск | пусто |
| S29 | Вкладка Pins / закладки | вкладки над лентой канала | закреплённое и ссылки | список пинов, закладки (≤100), «+» добавить | пусто |
| S30 | Меню профиля | клик по своему аватару | личные действия | статус, away/active, пауза уведомлений, Preferences, Profile, Sign out | — |
| S31 | Карточка/профиль пользователя | клик по имени/аватару | о человеке | имя, должность, локальное время, статус, «Message» | деактивирован *(guess)* |
| S32 | Установка статуса | меню профиля → статус; ⌘⇧Y | статус | эмодзи, текст (≤100), «убрать через…», пресеты, пауза до конца статуса | — |
| S33 | Пауза уведомлений | меню профиля → Notifications | DND | 30 мин / 1 ч / 2 ч / до завтра / своё / расписание | активна (иконка у имени) |
| S34 | Preferences | меню профиля; ⌘, | личные настройки | разделы Notifications, Sidebar/Home, Navigation, Appearance (тема), Advanced (Enter vs ⌘Enter, разметка) | — |
| S35 | Уведомления разговора | колокольчик в шапке | исключение из правил | All new posts / Just mentions / Mute, «Follow every thread» | — |
| S36 | Приглашение людей | меню workspace → Invite | добавить сотрудников | email-адреса, каналы для новичка, копировать ссылку, настройки ссылки | email уже в workspace *(guess)* |
| S37 | Админка: люди | Admin → People | управление участниками | список, роль, деактивировать / реактивировать | нельзя деактивировать primary owner |
| S38 | Админка: настройки workspace | Admin → Settings | политики | каналы по умолчанию, кто создаёт/архивирует каналы, окно правки сообщений, кто приглашает, кто добавляет emoji | — |
| S39 | Свои эмодзи | эмодзи-пикер → Add / Admin → Emoji | добавить эмодзи | загрузка картинки, имя, алиас, список | имя занято, файл слишком большой |
| S40 | Горячие клавиши | ⌘/ | справка | модалка со списком | — |
| S41 | Desktop: системные поверхности | ОС | присутствие вне окна | системное уведомление, бейдж на иконке, меню в трее/меню-баре, диплинк открывает разговор | уведомления запрещены в ОС, приложение свернуто в трей |
| S42 | Напомнить о сообщении | меню → Remind me; `M`; `/remind` | напоминание | пресеты (20 мин, 1 ч, 3 ч, завтра, неделя), своё | — |
| S43 | Баннер соединения *(guess)* | автоматически | показать обрыв realtime | «Переподключение…», «Нет сети», догрузка пропущенного | офлайн, переподключение, восстановлено |

## Flows

```
F01 Сотрудник принимает приглашение и попадает в чат
    email → S02 (имя, аватар) → S03 → S05 #general
    happy path clicks: 3
    edge: инвайт просрочен (30 дней), ссылка исчерпала лимит, email уже зарегистрирован

F02 Вход на новом устройстве
    S01 email → код из письма → S03
    happy path clicks: 2 (+ ввод кода)
    edge: неверный/просроченный код, деактивированный аккаунт

F03 Админ приглашает команду
    S03 → меню workspace → S36 → emails + каналы → Send
    happy path clicks: 3
    edge: email уже в workspace, копировать ссылку вместо email

F04 Прочитать новое и ответить в канале
    S04 (жирный канал) → S05 (разделитель «Новые») → композер → Enter
    happy path clicks: 1 + ввод
    edge: история не влезает — подгрузка вверх; сообщения пришли во время чтения; обрыв соединения

F05 Упомянуть коллегу
    S05 → «@» → S19 → выбрать → Enter
    happy path clicks: 2
    edge: @channel в канале от 6 человек → подтверждение; упомянутый не в канале → предложить добавить (guess); у упомянутого пауза уведомлений

F06 Ответить в треде
    S05 hover → S15 «Reply in thread» → S07 → ответ (опц. «также в канал») → Enter
    happy path clicks: 2 + ввод
    edge: родитель удалён; ответ в архивном канале запрещён; подписка на тред автоматически

F07 Написать в ЛС или групповое ЛС
    ⌘N → S13 выбрать людей → Enter
    happy path clicks: 2 + ввод
    edge: такое ЛС уже есть — открывается оно; >9 человек — предложить приватный канал

F08 Создать канал и позвать людей
    «+» → S10 имя + public/private → Create → S12 → Add
    happy path clicks: 4
    edge: имя занято / недопустимые символы / >80 символов; нет прав на создание

F09 Найти и вступить в канал
    ⌘⇧L → S11 поиск → Join
    happy path clicks: 2
    edge: архивный канал (только чтение), приватные не видны

F10 Отправить файл
    S05 → drag-and-drop или «+» → подпись → Enter
    happy path clicks: 1 (drag) + Enter
    edge: файл больше лимита, 10+ файлов, обрыв загрузки, неподдерживаемое превью

F11 Отреагировать эмодзи
    hover → S15 реакция → S18 → эмодзи
    happy path clicks: 2 (1 — клик по существующей реакции)
    edge: повторная реакция снимает её; архивный канал запрещает

F12 Исправить или удалить своё сообщение
    `↑` или S15 → Edit → S16 → Save | Delete → подтверждение
    happy path clicks: 2
    edge: окно правки истекло (настройка админа); удаление родителя треда; Unsend в течение 15 с

F13 Найти старое сообщение
    ⌘G → S26 запрос с модификаторами (in: from: has: before: after: during: is:thread) → результат → прыжок к сообщению в S05
    happy path clicks: 2 + ввод
    edge: ничего не найдено; сообщение в канале, из которого вышел (приватный — не показываем)

F14 Быстро перейти к разговору
    ⌘K → S27 ввод → Enter
    happy path clicks: 1 + ввод

F15 Разобрать непрочитанное
    ⌘⇧A → S23 → прочитать группу → Mark as read (Undo) | Mark all read
    happy path clicks: 2
    edge: новые сообщения пришли во время разбора; прочитано на другом устройстве — синхронизация

F16 Разобрать упоминания и ответы
    ⌘⇧M → S24 фильтр → открыть → ответить
    happy path clicks: 2
    edge: clear скрывает, но новый ответ возвращает элемент

F17 Отметить сообщение непрочитанным / сохранить / напомнить
    S15 → Mark unread | Save | Remind me → S42
    happy path clicks: 2

F18 Отложить отправку
    композер → стрелка у Send → S20 время → Schedule; управление в S21
    happy path clicks: 3
    edge: отмена возвращает в черновики; отправка в архивный канал к моменту отправки (guess)

F19 Настроить уведомления
    ⌘, → S34 Notifications: Everything | Mentions & DMs, ключевые слова, расписание; колокольчик → S35 для исключений
    happy path clicks: 3

F20 Поставить статус и паузу
    S30 → S32 эмодзи + текст + срок → Save; S30 → S33 пауза на 1 час
    happy path clicks: 3
    edge: статус истёк — автоочистка; пауза до конца статуса

F21 Закрепить сообщение и добавить ссылку в закладки
    S15 → Pin to channel; S29 «+» → ссылка
    happy path clicks: 2
    edge: пин в ЛС (у Slack только каналы — решим сами); лимит закладок 100

F22 Переслать сообщение
    S15 → Forward → S17 адресат + комментарий → Forward
    happy path clicks: 3
    edge: источник приватный — выбор «показать / только ссылка»

F23 Архивировать канал
    S08 → S09 → Archive → подтверждение
    happy path clicks: 3
    edge: #general нельзя; разархивировать из S11 (фильтр Archived)

F24 Офбординг сотрудника
    Admin → S37 → «…» → Deactivate → подтверждение
    happy path clicks: 3
    edge: выход из всех сессий сразу, сообщения остаются, primary owner защищён, реактивация

F25 Открыть разговор из уведомления или диплинка (desktop)
    S41 клик по уведомлению / ссылка `<scheme>://channel?id=` → S05/S06/S07 на нужном сообщении
    happy path clicks: 1
    edge: приложение не запущено, разговор недоступен, подтверждение открытия внешней ссылки
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| App shell / навбар | вкладки Home, DMs, Activity, Files, More | активная, бейдж, свернутый | S03 |
| Sidebar item | канал (#/замок), ЛС (аватар + присутствие), групповое ЛС, пункт навигации | обычный, жирный (непрочитано), бейдж упоминаний, muted, активный, hover, перетаскивание | S04 |
| Sidebar section | Channels, DMs, своя | развёрнут, свёрнут, меню «…» | S04 |
| Message | обычное, продолжение (без аватара, группировка по автору/времени), системное, с файлами, с превью ссылки, удалено (заглушка), правлено «(изменено)» | hover (тулбар), выделено (permalink/поиск), отправляется, ошибка отправки, фокус клавиатурой | S05, S06, S07, S22, S23, S26 |
| Message hover toolbar | быстрые реакции, тред, переслать, сохранить, «…» | — | S15 |
| Thread summary | аватары до 5, «N ответов», время последнего | непрочитанные ответы | S05, S06 |
| Reaction pill | эмодзи + счётчик | моя (подсвечена), hover (кто поставил), «+» добавить | S05–S07 |
| Composer | канал, тред, правка, ЛС | пусто, черновик, форматирование вкл/выкл, загрузка файлов, disabled (архив/нет прав) | S05–S07 |
| Formatting toolbar | B, I, U, S, code, block quote, code block, ol, ul, link | активная кнопка | композер |
| Autocomplete popover | люди, каналы, эмодзи, команды | загрузка, пусто, выделен пункт | S19 |
| Emoji picker | вставка, реакция | поиск, категории, недавние, свои, тон кожи | S18 |
| Unread divider / «Jump to» | «Новые», «Перейти к первому непрочитанному» | — | S05, S06 |
| Date divider | Сегодня / Вчера / дата | sticky | ленты |
| Typing indicator | 1 / 2 / несколько человек | — | S05–S07 |
| Avatar | 16/20/24/36/72, с индикатором присутствия | active, away, DND, деактивирован | везде |
| Presence dot | active / away / DND | — | S04, S31 |
| Status chip | эмодзи + текст | истекает | S04, S31, сообщения |
| Modal | маленький, большой, подтверждение (danger) | открыт, отправка, ошибка | S08–S13, S16, S17, S32, S36 |
| Popover menu | меню сообщения, меню профиля, меню раздела | — | S15, S30, S04 |
| Tabs | вкладки канала, вкладки поиска, фильтры Activity | активная, с бейджем | S05, S24, S26 |
| Search field | глобальный, внутри разговора | подсказки, недавние, модификаторы | S26, S27 |
| File card | изображение (превью), PDF, видео, другой файл | загрузка (прогресс), ошибка, полноэкранный просмотр | S05, S28 |
| Link unfurl | заголовок + описание + картинка | убрать превью | S05 |
| Toast / snackbar | успех, Undo, ошибка | — | везде |
| Connection banner | переподключение, офлайн | — | S43 |
| Button | primary, secondary, ghost, danger, icon | default, hover, focus, disabled, loading | везде |
| Input / textarea / select / checkbox / toggle | — | default, focus, error, disabled | формы |
| Empty state | для каждого списка | — | S11, S14, S21–S25, S28 |
| Keyboard shortcut hint | — | — | S40, тултипы |

## Inferred data model

Это модель Slack, восстановленная по публичной API-документации. Идеи берём, идентификаторы
и формат — нет: схему пишет `/replica-architect`.

```
Workspace  id, name, domain, icon_url, created_at, settings (json: кто создаёт каналы,
           окно правки, кто приглашает, кто добавляет emoji)
           evidence: D/reference/methods/team.info/, H/201314026, H/202395258
           confidence: high (поля), guess (форма настроек)

User       id, workspace_id, email, role (primary_owner | owner | admin | member | guest),
           deactivated_at, tz (IANA), locale, created_at, updated_at
           profile: display_name, real_name, title, phone, pronouns, avatar_url (+ размеры),
                    status_text (≤100), status_emoji, status_expires_at
           evidence: D/reference/objects/user-object, H/204475027
           confidence: high. Деактивация — мягкая: строка остаётся, чтобы старые сообщения резолвились

Presence   (эфемерно, не в БД) user_id, state (active | away), manual_away, connection_count,
           last_activity_at; авто-away через ~10 мин бездействия
           evidence: D/reference/methods/users.getPresence/, D/reference/events/presence_change/, H/201864558
           confidence: high

DndSettings  user_id, snooze_until, schedule (дни недели + с/по), — другим видно только «DND вкл»
           evidence: D/reference/methods/dnd.info/, H/214908388
           confidence: high (снуз), guess (форма расписания)

Conversation  id, workspace_id, kind (public | private | dm | group_dm), name (≤80, a-z0-9-_,
           уникально; нет у ЛС), topic (≤250) + topic_set_by/at, purpose (≤250),
           is_general, archived_at, created_by, created_at, updated_at,
           posting_policy (json: кто постит, кто может @here/@channel)
           evidence: D/reference/objects/conversation-object, D/reference/methods/conversations.create/, setTopic
           confidence: high. ЛС и групповые ЛС уникальны по набору участников (повторный open
           возвращает существующее)

ConversationMember  conversation_id, user_id, joined_at, last_read_ts (курсор прочитанного),
           notify_level (all | mentions | mute | default), is_open (видно ли ЛС в сайдбаре),
           sidebar_section_id, starred
           evidence: D/reference/methods/conversations.mark/, H/360056534254, H/212596808
           confidence: high (курсор), medium (что это одна таблица)

SidebarSection  id, user_id, name, emoji, sort (a_z | recent | manual), position
           evidence: H/360043207674
           confidence: medium

Message    conversation_id, ts (ключ сортировки и id в пределах разговора), user_id,
           text (разметка; упоминания хранятся как токены с id, не с именами),
           subtype (null | join | leave | topic | purpose | rename | archive | pinned |
                    thread_broadcast | file_share), thread_ts (null | = ts у родителя | ts родителя у ответа),
           reply_count, reply_users (≤5), reply_users_count, latest_reply_ts (денормализовано на родителе),
           edited_at, edited_by, deleted_at, client_msg_id (дедупликация повторной отправки)
           evidence: D/reference/events/message/, D/reference/methods/chat.postMessage/,
                     D/messaging/retrieving-messages/, D/messaging/formatting-message-text
           confidence: high (треды, ts, subtypes), guess (client_msg_id)

Reaction   conversation_id, message_ts, user_id, emoji_name (+ тон кожи); уникально по
           (сообщение, эмодзи, пользователь)
           evidence: D/reference/methods/reactions.add/, D/reference/events/reaction_added/
           confidence: high

Mention    (производный индекс) conversation_id, message_ts, target (user | usergroup | here | channel)
           evidence: D/messaging/formatting-message-text
           confidence: guess — нужен для Activity, уведомлений и счётчика упоминаний

ThreadSubscription  user_id, conversation_id, thread_ts, last_read_ts, subscribed
           evidence: D/messaging/retrieving-messages/ (subscribed, last_read на треде), H/115000769927
           confidence: medium

File       id, workspace_id, uploader_id, name, title, mimetype, size, storage_key,
           thumbnails (json), width, height, alt_text (≤1000), created_at, deleted_at
           FileShare: file_id, conversation_id, message_ts — один файл, много шарингов
           evidence: D/reference/objects/file-object/, D/reference/methods/files.getUploadURLExternal/
           confidence: high. Загрузка в 3 шага: получить URL → залить байты → завершить и расшарить

Pin        conversation_id, message_ts, pinned_by, pinned_at
           evidence: D/reference/methods/pins.add/, H/205239997
           confidence: medium

Bookmark   id, conversation_id, title, url, emoji, rank (строка для ручной сортировки),
           created_by, created_at, updated_at; ≤100 на разговор
           evidence: D/reference/methods/bookmarks.add/
           confidence: high

SavedItem  user_id, conversation_id, message_ts, created_at, completed_at, remind_at
           evidence: H/360042650274, D/reference/events/ (star_added)
           confidence: guess (у Slack нет публичного API для Later/To-dos)

Reminder   id, user_id, text, message ref (опц.), remind_at, recurrence (daily | weekly | ...),
           completed_at
           evidence: D/reference/methods/reminders.add/
           confidence: high

ScheduledMessage  id, user_id, conversation_id, thread_ts, text, post_at (≤120 дней вперёд)
           evidence: D/reference/methods/chat.scheduleMessage/, H/1500012915082
           confidence: high

Draft      user_id, conversation_id, thread_ts, text, updated_at — один на разговор/тред,
           синхронизируется между устройствами по updated_at
           evidence: D/reference/methods/chat.postMessage/ (current_draft_last_updated_ts)
           confidence: guess

Usergroup  id, workspace_id, name, handle (уникален среди людей и групп), description,
           members, default_channels, deleted_at
           evidence: D/reference/methods/usergroups.create/
           confidence: high

CustomEmoji  workspace_id, name (уникально), image_url | alias_of, created_by
           evidence: D/reference/methods/emoji.list/, H/206870177
           confidence: high

Invite     id, workspace_id, email (или null для ссылки), invited_by, channels, expires_at (30 дней),
           max_uses (до 400 для ссылки), uses, accepted_at
           evidence: H/201330256, H/212675257
           confidence: medium

NotificationPrefs  user_id, level (all | mentions_and_dms), keywords[], desktop_enabled,
           sound, show_preview, schedule (дни + с/по), include_thread_replies_in_badge
           evidence: H/201355156
           confidence: high (опции), guess (форма)
```

Relationships:
Workspace 1-n User, Conversation, Usergroup, CustomEmoji, Invite ·
Conversation n-n User через ConversationMember (с курсором прочитанного) ·
Conversation 1-n Message (ключ conversation_id + ts) ·
Message 1-n Message через thread_ts (один уровень вложенности) ·
Message n-n User через Reaction · Message 1-n Mention ·
File n-n Conversation через FileShare (каждый шаринг — отдельное сообщение) ·
Conversation 1-n Pin, Bookmark ·
User 1-n SavedItem, Reminder, ScheduledMessage, Draft, SidebarSection, ThreadSubscription ·
User n-n Usergroup.

Realtime-события, которые нужны клиенту (по образцу Events API): `message`
(новое, правка, удаление, thread_broadcast), `reaction_added/removed`,
`member_joined/left`, `conversation_created/renamed/archived`, `read_marker` (курсор
сдвинулся — синхронизировать другие устройства), `typing`, `presence_change`
(по подписке, пачками), `user_changed` (профиль/статус), `pin_added/removed`,
`emoji_changed`, `dnd_changed`.

Идеи, которые стоит взять (из публичной документации):
- `ts` одновременно id, порядок и указатель треда. У родителя `thread_ts == ts`.
- Курсор прочитанного — это `ts`, а не счётчик. Непрочитанное = сообщения после курсора.
  Отметки дебаунсить (~5 с) и рассылать на все устройства пользователя.
- Системные события живут в том же потоке, что и сообщения.
- Упоминания хранятся как id-токены, а не имена, поэтому переименования ничего не ломают.
- Мягкое удаление пользователей и архив каналов: история остаётся читаемой.
- Ловушка: у Slack разные единицы времени в разных полях. Берём одну.

## Feature matrix

См. `features.csv`. Must: 44, should: 40, could: 28, skip: 13.

## Out of scope (cannot or should not be cloned)

- Slack Connect — общие каналы с другими компаниями. Это сеть Slack, а у нас внутренний чат.
- Маркетплейс приложений, Workflows, Agents & tools — партнёрская экосистема Slack.
- Slack AI, Slackbot-агент, сводки, AI-поиск — отдельный продукт; позже можно сделать своё на Claude.
- Canvases, Lists, Clips — отдельные продукты внутри Slack, не ядро переписки.
- Huddles (звонки) — вне выбранного среза v1. Отдельный этап, если понадобится (WebRTC через LiveKit).
- Боты и входящие вебхуки — вне среза v1. Следующий этап после ядра.
- SAML SSO, Enterprise Grid, org-политики, кастомные роли — для команды до 30 человек не нужно.
- Мобильные приложения и мобильный push — платформы вне скоупа (web + desktop).
- Бренд Slack: имя, логотип, иконки, цвета, звуки уведомлений, иллюстрации, шрифты, тексты интерфейса.
  Всё своё (`/replica-brand`, `/replica-design`).

## Size

Screens 43, flows 25, entities 20 (+ эфемерные presence/typing). Size: **L** (квартал) на
весь must + should; **M** (несколько недель) на MVP только из must.

Hard parts:
1. **Realtime с гарантией доставки.** Один WebSocket на клиента; heartbeat; автопереподключение;
   после обрыва — догрузка пропущенного по курсору (последний известный `ts`/номер события).
   На Railway это обязательно: платформа не гарантирует время жизни WS-соединения.
2. **Непрочитанное и уведомления.** Курсоры по разговорам и тредам, счётчики упоминаний,
   синхронизация между вкладками и устройствами. Правила, кому слать уведомление: уровень, mute,
   DND, ключевые слова, треды, @here/@channel. Десктоп-уведомления и бейдж должны совпадать с сайдбаром.
3. **Композер.** Форматирование + автодополнение `@ # : /` + эмодзи + вставка файлов + черновики.
   Хранение текста с id-токенами упоминаний и рендер обратно.
4. **Поиск с модификаторами** (`in: from: has: before: after: during: is:thread`) по всей истории.
   На 30 человек хватит полнотекстового поиска Postgres; отдельный поисковый движок не нужен.
5. **Файлы.** Presigned upload в S3-совместимое хранилище, миниатюры изображений, права доступа
   (файл виден только участникам разговоров, куда он расшарен).
6. **Electron.** Бейдж, трей, диплинки, автообновление. Подпись и нотаризация на macOS
   (нужен Apple Developer, $99/год), подпись на Windows.
7. **Превью ссылок (unfurl).** Сервер ходит по URL из сообщений — это SSRF. Нужны блок
   внутренних адресов, таймауты и лимит размера ответа.

## Хостинг: Railway

Подходит для команды до 30 человек:
- Сервис на Node с WebSocket. WS на Railway работают, но время жизни соединения не
  гарантировано (см. Hard parts, п. 1).
- Postgres-плагин.
- Railway Buckets — приватное S3-совместимое хранилище: $0.015 за ГБ-месяц, исходящий трафик
  из бакета бесплатный. Публичных бакетов нет, раздача через presigned URL или прокси через бэкенд.
  Для загрузки из браузера нужен CORS.
- Тарифы: Hobby $5/мес (включает $5 ресурсов, том до 5 ГБ), Pro $20/мес. На 30 человек ожидаемо
  Hobby–Pro, итог зависит от RAM сервиса.
- Самим надо настроить: бэкапы Postgres, отправку email (коды входа, инвайты) через внешний
  сервис, свой домен.

Источники: https://docs.railway.com/reference/pricing/plans, https://docs.railway.com/storage-buckets,
https://station.railway.com/questions/websockets-ttl-ping-pong-7af346b5 (WS: ответ сотрудника Railway).

## Роль REA

REA не применяется к коду Slack. Правила recon запрещают читать бандлы, декомпилировать клиент
и логировать сетевые вызовы, а копирование чужого кода — прямой риск по авторскому праву.
Для ядра чата это и не нужно: модель данных открыто описана в API-документации.

Где REA работает на нас, на собственных артефактах:
- `capture_browser_scenario` / `capture_electron_scenario` — прогон сценариев F01–F25 на нашем клоне
  с сохранением доказательств (для `/replica-test`).
- `compare_web_screenshots` — сравнение раскладки нашего UI с референс-скриншотами в
  `replica/screens/` (для `/replica-diff`).
- `inspect_electron_fuses` и `analyze_javascript_application` на собственной сборке `.app`/`.asar` —
  проверить фьюзы Electron, IPC-границы preload и что в бандл не утекли секреты или dev-код.
- `inspect_web_network_capture` на HAR нашего клиента — проверить, что realtime и загрузки
  ведут себя как задумано.

## Открытые вопросы для `/replica-architect` (решены 2026-10-17, см. `architecture.md`)

1. Вход: Google + код на email, только по приглашению.
2. Файлы: до 100 МБ.
3. История: бессрочно + ежедневные бэкапы (по умолчанию).
4. Домен и URL-схема: после `/replica-brand`, пока заглушки.
5. Подпись десктоп-сборок: пока без подписи.

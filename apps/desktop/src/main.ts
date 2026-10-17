// Десктоп-оболочка: окно с веб-клиентом с сервера, бейдж непрочитанного, системные уведомления,
// трей, ссылки teamchat:// и вход через Google в системном браузере (architecture.md → «Electron»).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, Notification, session, shell, Tray, type IpcMainEvent } from "electron";

const PROTOCOL = "teamchat";
const APP_ID = "app.appinstalls.chat";
const APP_URL = appUrl();
const ORIGIN = new URL(APP_URL).origin;
const ASSETS = path.join(__dirname, "..", "assets");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Link = { type: "open"; path: string } | { type: "auth"; code: string; verifier: string };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let googleVerifier: string | null = null; // ждёт кода из браузера; живёт только в памяти
let pending: Link | null = null; // ссылка пришла раньше, чем окно загрузилось

// Адрес чата: TEAMCHAT_URL в разработке, иначе вшитый при сборке (scripts/write-config.mjs).
function appUrl(): string {
  if (process.env.TEAMCHAT_URL) return new URL(process.env.TEAMCHAT_URL).origin;
  const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf8")) as { url: string };
  return cfg.url;
}

// ───────────── один экземпляр и протокол ─────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows и Linux: ссылка приходит аргументом второго запуска.
  app.on("second-instance", (_e, argv) => {
    const url = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (url) handleUrl(url);
    showWindow();
  });
  // macOS: ссылка приходит событием, в том числе до готовности приложения.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleUrl(url);
  });
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);
  app.setAppUserModelId(APP_ID); // без этого Windows не покажет уведомления
  void app.whenReady().then(start);
}

// teamchat://channel?id=…, teamchat://message?id=…, teamchat://auth?code=…
function handleUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  if (u.protocol !== `${PROTOCOL}:`) return;
  const kind = u.hostname || u.pathname.replace(/^\/+/, "");
  const id = u.searchParams.get("id") ?? "";
  if (kind === "auth") {
    const code = u.searchParams.get("code") ?? "";
    if (!googleVerifier || !/^[A-Za-z0-9_-]{20,100}$/.test(code)) return;
    deliver({ type: "auth", code, verifier: googleVerifier });
    googleVerifier = null;
  } else if (kind === "channel" && UUID.test(id)) deliver({ type: "open", path: `/c/${id}` });
  else if (kind === "message" && UUID.test(id)) deliver({ type: "open", path: `/m/${id}` });
}

function deliver(link: Link) {
  if (win && !win.webContents.isLoading()) win.webContents.send("desktop:link", link);
  else pending = link;
  showWindow();
}

// ───────────── окно ─────────────

function start() {
  Menu.setApplicationMenu(appMenu());
  lockDownSession();
  createWindow();
  createTray();
  registerIpc();
  app.on("activate", showWindow); // клик по значку в Dock
  app.on("before-quit", () => (quitting = true));
  const url = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (url) handleUrl(url); // Windows: приложение запущено самой ссылкой
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "AppInstalls Chat",
    show: false,
    icon: path.join(ASSETS, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  void win.loadURL(APP_URL);
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("did-finish-load", () => {
    if (pending) {
      win?.webContents.send("desktop:link", pending);
      pending = null;
    }
  });

  // Внутри окна — только свой сервер; всё остальное открывается в системном браузере.
  win.webContents.on("will-navigate", (e, url) => {
    if (sameOrigin(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  // Закрытие окна прячет приложение в трей (на macOS — как обычно, в Dock); выход — из меню или трея.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const sameOrigin = (url: string) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

function openExternal(url: string) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    // не ссылка — ничего не открываем
  }
}

// Разрешения сайту: копирование в буфер, полноэкранный режим и камера с микрофоном для звонков — только своему
// серверу. Уведомления идут через оболочку. Системный запрос доступа к камере и микрофону macOS покажет сам.
function lockDownSession() {
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen", "media"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(sameOrigin(wc.getURL()) && allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => origin === ORIGIN && allowed.has(permission));
  // Показ экрана в звонке. На macOS 15+ выбор экрана или окна — системным окном; где его нет, показываем весь первый экран.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!sameOrigin(request.frame?.url ?? "")) return callback({});
      void desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: process.platform === "win32" ? "loopback" : undefined } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );
}

// ───────────── мост с веб-клиентом ─────────────

// Слушаем только свой сервер: страница чужого сайта в этом окне оказаться не может, но проверим.
const trusted = (e: IpcMainEvent) => sameOrigin(e.senderFrame?.url ?? "");

function registerIpc() {
  ipcMain.on("desktop:version", (e) => {
    e.returnValue = app.getVersion();
  });

  ipcMain.on("desktop:badge", (e, count: unknown) => {
    if (!trusted(e) || typeof count !== "number" || !Number.isInteger(count) || count < 0) return;
    setBadge(count);
  });

  ipcMain.on("desktop:notify", (e, n: unknown) => {
    if (!trusted(e) || !n || typeof n !== "object") return;
    const { title, body, path: target } = n as { title?: unknown; body?: unknown; path?: unknown };
    if (typeof title !== "string" || typeof body !== "string" || typeof target !== "string" || !target.startsWith("/")) return;
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: title.slice(0, 200), body: body.slice(0, 500), silent: true });
    note.on("click", () => deliver({ type: "open", path: target }));
    note.show();
  });

  ipcMain.on("desktop:google", (e, invite: unknown) => {
    if (!trusted(e)) return;
    googleVerifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(googleVerifier).digest("base64url");
    const url = new URL("/api/auth/google/start", APP_URL);
    url.searchParams.set("desktop", challenge);
    if (typeof invite === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(invite)) url.searchParams.set("invite", invite);
    void shell.openExternal(url.toString());
  });
}

// ───────────── бейдж и трей ─────────────

let badgeImage: Electron.NativeImage | null = null;

function setBadge(count: number) {
  if (process.platform === "win32") {
    badgeImage ??= nativeImage.createFromPath(path.join(ASSETS, "badge.png"));
    win?.setOverlayIcon(count > 0 ? badgeImage : null, count > 0 ? `Непрочитанных: ${count}` : "");
  } else {
    app.setBadgeCount(count); // Dock на macOS, лаунчер на Linux
  }
  tray?.setToolTip(count > 0 ? `AppInstalls Chat — непрочитанных: ${count}` : "AppInstalls Chat");
}

function createTray() {
  const icon =
    process.platform === "darwin"
      ? nativeImage.createFromPath(path.join(ASSETS, "trayTemplate.png")) // template: macOS сам перекрасит под тему
      : nativeImage.createFromPath(path.join(ASSETS, "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("AppInstalls Chat");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть AppInstalls Chat", click: showWindow },
      // Только в собранном приложении: из разработки в автозагрузку попал бы сам Electron.
      ...(app.isPackaged
        ? [
            {
              label: "Запускать при входе в систему",
              type: "checkbox" as const,
              checked: app.getLoginItemSettings().openAtLogin,
              click: (item: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: item.checked }),
            },
          ]
        : []),
      { type: "separator" },
      {
        label: "Выйти",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

function appMenu(): Menu {
  const mac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "Вид",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
  ]);
}

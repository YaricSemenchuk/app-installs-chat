// Показ уведомлений. Кого уведомлять, решил сервер; здесь — только «не смотрит ли человек на это прямо сейчас»
// и куда показать: системное уведомление оболочки или браузерное.
import type { NotificationDto } from "@teamchat/shared";
import { desktop } from "../desktop/bridge";

let navigate: (path: string) => void = (path) => window.location.assign(path);
export function setNavigator(fn: (path: string) => void) {
  navigate = fn;
}

export const linkOf = (n: Pick<NotificationDto, "conversationId" | "messageId">) => `/c/${n.conversationId}?m=${n.messageId}`;

// Смотрит: окно в фокусе, открыт этот разговор, а для ответа в треде — и сам тред.
function isLookingAt(n: NotificationDto): boolean {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  if (window.location.pathname !== `/c/${n.conversationId}`) return false;
  if (!n.parentId) return true;
  return new URLSearchParams(window.location.search).get("thread") === n.parentId;
}

export function handleNotification(n: NotificationDto) {
  if (isLookingAt(n)) return;
  show(n.title, n.body, linkOf(n), n.sound, n.messageId);
}

export function show(title: string, body: string, path: string, sound: boolean, tag?: string) {
  if (sound) chime();
  if (desktop) {
    desktop.notify({ title, body, path });
    return;
  }
  if (browserPermission() !== "granted") return;
  const note = new Notification(title, { body, tag, silent: true, icon: "/favicon.svg" });
  note.onclick = () => {
    window.focus();
    navigate(path);
    note.close();
  };
}

export type Permission = "granted" | "denied" | "default" | "unsupported";

export function browserPermission(): Permission {
  if (desktop) return "granted"; // у оболочки свои системные уведомления
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function askPermission(): Promise<Permission> {
  if (desktop || typeof Notification === "undefined") return browserPermission();
  return Notification.requestPermission();
}

// Свой короткий звук из двух тонов — без чужих аудиофайлов. Браузер разрешит его после первого действия на странице.
let audio: AudioContext | null = null;
export function chime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {
    // без звука — не страшно
  }
}

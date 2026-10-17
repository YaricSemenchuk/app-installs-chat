// Полоски над разговором: предложить включить уведомления и сообщить о новой версии приложения.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Download, X } from "lucide-react";
import type { DesktopInfoDto, PreferencesDto } from "@teamchat/shared";
import { api } from "../api/http";
import { desktop, installerPlatform, isNewer } from "../desktop/bridge";
import { desktopKey } from "../desktop/InstallersPage";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { askPermission, browserPermission } from "./notify";
import s from "./notifications.module.scss";

const DISMISSED = "teamchat.notifyBannerDismissed";

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};

export function NotifyBanner({ prefs }: { prefs: PreferencesDto }) {
  const [hidden, setHidden] = useState(() => dismissed() || browserPermission() !== "default");
  if (hidden || !prefs.desktopNotifications || prefs.notifyLevel === "nothing") return null;
  const hide = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // просто не запомним
    }
    setHidden(true);
  };
  return (
    <div className={s.banner} role="region" aria-label="Уведомления">
      <BellRing />
      <span>Включите уведомления, чтобы не пропускать личные сообщения и упоминания, пока вкладка в фоне.</span>
      <Button size="s" onClick={() => void askPermission().then(() => setHidden(true))}>
        Включить
      </Button>
      <IconButton label="Не сейчас" size="xs" onClick={hide}>
        <X />
      </IconButton>
    </div>
  );
}

export function UpdateBanner() {
  // Раз в час: администратор мог загрузить новую сборку, пока приложение открыто.
  const info = useQuery({ queryKey: desktopKey, queryFn: () => api<DesktopInfoDto>("/desktop"), enabled: !!desktop, staleTime: 3600_000, refetchInterval: 3600_000 });
  const [hidden, setHidden] = useState(false);
  const platform = installerPlatform();
  const latest = platform ? info.data?.[platform]?.version : undefined;
  if (!desktop || hidden || !latest || !isNewer(latest, desktop.version)) return null;
  return (
    <div className={s.banner} role="region" aria-label="Обновление">
      <Download />
      <span>
        Вышла версия приложения {latest} (у вас {desktop.version}). Сам чат уже обновлён, новая версия нужна для оболочки.
      </span>
      <Link to="/download">Скачать</Link>
      <IconButton label="Скрыть" size="xs" onClick={() => setHidden(true)}>
        <X />
      </IconButton>
    </div>
  );
}

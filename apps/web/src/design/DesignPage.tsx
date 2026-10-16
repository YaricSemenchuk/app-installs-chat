import { useEffect, useState } from "react";
import { Tabs } from "../ui/Tabs";
import { ChannelPreview } from "./ChannelPreview";
import { ComponentsGallery } from "./ComponentsGallery";
import s from "./DesignPage.module.scss";

type View = "channel" | "components";
type Theme = "system" | "light" | "dark";

function readParam<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(location.search).get(key);
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function DesignPage() {
  const [view, setView] = useState<View>(() => readParam("view", ["channel", "components"] as const, "channel"));
  const [theme, setTheme] = useState<Theme>(() => readParam("theme", ["system", "light", "dark"] as const, "system"));

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const url = new URL(location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("theme", theme);
    history.replaceState(null, "", url);
  }, [view, theme]);

  return (
    <div className={s.page}>
      <div className={s.bar}>
        <span className={s.title}>Дизайн-система</span>
        <Tabs
          label="Раздел"
          variant="pills"
          value={view}
          onValueChange={(v) => setView(v as View)}
          items={[
            { value: "channel", label: "Экран канала" },
            { value: "components", label: "Компоненты" },
          ]}
        />
        <Tabs
          label="Тема"
          variant="pills"
          value={theme}
          onValueChange={(v) => setTheme(v as Theme)}
          items={[
            { value: "system", label: "Системная" },
            { value: "light", label: "Светлая" },
            { value: "dark", label: "Тёмная" },
          ]}
        />
      </div>
      <div className={s.content}>{view === "channel" ? <ChannelPreview /> : <ComponentsGallery />}</div>
    </div>
  );
}

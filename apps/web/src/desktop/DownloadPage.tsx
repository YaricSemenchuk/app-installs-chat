// /download — установщики десктоп-приложения и как открыть неподписанную сборку.
import { useQuery } from "@tanstack/react-query";
import { Apple, Monitor } from "lucide-react";
import type { DesktopInfoDto } from "@teamchat/shared";
import { api } from "../api/http";
import s from "../notifications/notifications.module.scss";

export function DownloadPage() {
  const info = useQuery({ queryKey: ["desktop"], queryFn: () => api<DesktopInfoDto>("/desktop") });
  const d = info.data;
  const none = d && !d.macUrl && !d.winUrl;
  return (
    <main className={s.standalone}>
      <div className={s.card}>
        <img className={s.logo} src="/favicon.svg" alt="" />
        <h1>Приложение для компьютера{d?.version ? ` ${d.version}` : ""}</h1>
        <p>То же, что в браузере, плюс значок с непрочитанным, системные уведомления и работа из трея. Сам чат обновляется без переустановки.</p>
        {info.isPending && <p>Загружаем ссылки…</p>}
        {none && <p>Сборки пока не выложены. Спросите администратора или пользуйтесь браузерной версией.</p>}
        <div className={s.downloads}>
          {d?.macUrl && (
            <a className={s.download} href={d.macUrl}>
              <Apple /> Скачать для macOS
            </a>
          )}
          {d?.winUrl && (
            <a className={s.download} href={d.winUrl}>
              <Monitor /> Скачать для Windows
            </a>
          )}
        </div>
        <p>Сборки не подписаны, поэтому система предупредит при первом запуске:</p>
        <ol className={s.steps}>
          <li>
            macOS (одна сборка для Apple Silicon и Intel): перетащите приложение в «Программы» и откройте. Система скажет, что не может
            проверить разработчика, — нажмите «Готово». Затем «Системные настройки» → «Конфиденциальность и безопасность», внизу у
            сообщения о Promobile Chat нажмите «Всё равно открыть» (Open Anyway) и подтвердите паролем. Это нужно один раз.
          </li>
          <li>Windows: на синем окне SmartScreen нажмите «Подробнее» → «Выполнить в любом случае».</li>
        </ol>
        <p>
          <a href="/">Вернуться в чат</a>
        </p>
      </div>
    </main>
  );
}

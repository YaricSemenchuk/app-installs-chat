// Свой экран ошибки вместо стандартного «Unexpected Application Error!» из React Router.
// Чат обновился, а вкладка просит файл прошлой сборки, — просто перезагружаемся.
import { useEffect } from "react";
import { useRouteError } from "react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { isStaleBuildError, reloadForNewBuild } from "../lib/staleBuild";
import { EmptyState } from "../ui/Feedback";
import s from "./RouteError.module.scss";

export function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuildError(error);
  useEffect(() => {
    if (stale) reloadForNewBuild();
  }, [stale]);

  return (
    <main className={s.page}>
      {stale ? (
        <EmptyState icon={<RefreshCw />} title="Чат обновился" text="Загружаем новую версию…" />
      ) : (
        <EmptyState
          icon={<TriangleAlert />}
          title="Что-то пошло не так"
          text="Перезагрузите страницу. Если ошибка повторится, напишите администратору, что вы делали перед ней"
          action={{ label: "Перезагрузить", onClick: () => window.location.reload() }}
        />
      )}
    </main>
  );
}

// Экраны, которые появятся в следующих этапах (M6+). Маршрут есть, чтобы навигация не вела в никуда.
import type { ReactNode } from "react";
import { EmptyState } from "../ui/Feedback";

export function StubPage({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
      <EmptyState icon={icon} title={title} text={text} />
    </div>
  );
}

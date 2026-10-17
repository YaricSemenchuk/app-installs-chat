// Короткие уведомления внизу экрана: «Ссылка скопирована», ошибки фоновых действий.
import { create } from "zustand";
import { ToastSurface } from "./Feedback";
import s from "./Toaster.module.scss";

type Toast = { id: number; text: string; tone: "info" | "error" };

const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let nextId = 0;

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = ++nextId;
  useToasts.setState((st) => ({ items: [...st.items.slice(-2), { id, text, tone }] }));
  setTimeout(() => useToasts.setState((st) => ({ items: st.items.filter((t) => t.id !== id) })), tone === "error" ? 6000 : 3000);
}

export function Toaster() {
  const items = useToasts((st) => st.items);
  return (
    <div className={s.stack} aria-live="polite">
      {items.map((t) => (
        <ToastSurface key={t.id} text={t.text} tone={t.tone} />
      ))}
    </div>
  );
}

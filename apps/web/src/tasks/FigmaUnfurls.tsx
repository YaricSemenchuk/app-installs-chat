// Карточки ссылок на Figma под сообщением. Автор может убрать карточку — ссылка в тексте остаётся.
import type { UnfurlDto } from "@teamchat/shared";
import { api } from "../api/http";
import { toast } from "../ui/Toaster";
import { FigmaPreviewCard } from "./parts";
import s from "./tasks.module.scss";

export function FigmaUnfurls({ messageId, unfurls, canHide }: { messageId: string; unfurls: UnfurlDto[]; canHide: boolean }) {
  async function hide(id: string) {
    try {
      await api(`/messages/${messageId}/unfurls/${id}/hide`, { method: "POST", body: {} });
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }
  return (
    <div className={s.unfurls}>
      {unfurls.map((u) => (
        <FigmaPreviewCard key={u.id} preview={u.figma} onHide={canHide ? () => void hide(u.id) : undefined} />
      ))}
    </div>
  );
}

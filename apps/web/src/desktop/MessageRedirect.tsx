// /m/:id — ссылка на сообщение без разговора (teamchat://message?id=…): узнаём, где оно, и переходим туда.
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { MessageLinkDto } from "@teamchat/shared";
import { api } from "../api/http";
import { toast } from "../ui/Toaster";

export function MessageRedirect() {
  const { messageId = "" } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    api<MessageLinkDto>(`/messages/${messageId}/link`)
      .then((l) => !cancelled && navigate(`/c/${l.conversationId}?m=${l.messageId}`, { replace: true }))
      .catch(() => {
        if (cancelled) return;
        toast("Сообщение не найдено: возможно, его удалили", "error");
        navigate("/", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [messageId, navigate]);
  return null;
}

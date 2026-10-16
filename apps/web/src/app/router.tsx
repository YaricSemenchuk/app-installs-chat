import { createBrowserRouter, Navigate } from "react-router";
import { Bookmark, FileStack, MessageSquareText, SearchX, SendHorizontal } from "lucide-react";
import { DesignPage } from "../design/DesignPage";
import { useBoot } from "../data/boot";
import { ConversationPage } from "../pages/ConversationPage";
import { SignInPage } from "../pages/SignInPage";
import { StubPage } from "../pages/StubPage";
import { AppShell } from "./AppShell";

function OpenDefaultConversation() {
  const boot = useBoot().data;
  const general = boot?.conversations.find((c) => c.isGeneral) ?? boot?.conversations[0];
  return general ? <Navigate to={`/c/${general.id}`} replace /> : null;
}

const later = "Этот раздел появится в одном из следующих обновлений";

export const router = createBrowserRouter([
  { path: "/signin", element: <SignInPage /> },
  { path: "/design", element: <DesignPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <OpenDefaultConversation /> },
      { path: "c/:conversationId", element: <ConversationPage /> },
      { path: "threads", element: <StubPage icon={<MessageSquareText />} title="Треды" text={later} /> },
      { path: "drafts", element: <StubPage icon={<SendHorizontal />} title="Черновики и отправленные" text={later} /> },
      { path: "saved", element: <StubPage icon={<Bookmark />} title="Сохранённое" text={later} /> },
      { path: "files", element: <StubPage icon={<FileStack />} title="Файлы" text={later} /> },
      { path: "*", element: <StubPage icon={<SearchX />} title="Такой страницы нет" text="Проверьте адрес или выберите разговор слева" /> },
    ],
  },
]);

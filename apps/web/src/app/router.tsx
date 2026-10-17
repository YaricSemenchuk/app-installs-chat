import { createBrowserRouter, Navigate } from "react-router";
import { Bookmark, MessageSquareText, SearchX, SendHorizontal } from "lucide-react";
import { DirectoryPage } from "../channels/DirectoryPage";
import { DesignPage } from "../design/DesignPage";
import { useBoot } from "../data/boot";
import { FilesPage } from "../files/FilesPage";
import { ConversationPage } from "../pages/ConversationPage";
import { InvitePage } from "../pages/InvitePage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { SignInPage } from "../pages/SignInPage";
import { StubPage } from "../pages/StubPage";
import { PeoplePage } from "../people/PeoplePage";
import { SearchPage } from "../search/SearchPage";
import { AppShell } from "./AppShell";

function OpenDefaultConversation() {
  const boot = useBoot().data;
  const general = boot?.conversations.find((c) => c.isGeneral) ?? boot?.conversations[0];
  return general ? <Navigate to={`/c/${general.id}`} replace /> : null;
}

const later = "Этот раздел появится в одном из следующих обновлений";

export const router = createBrowserRouter([
  { path: "/signin", element: <SignInPage /> },
  { path: "/invite/:token", element: <InvitePage /> },
  { path: "/welcome", element: <OnboardingPage /> },
  { path: "/design", element: <DesignPage /> },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <OpenDefaultConversation /> },
      { path: "c/:conversationId", element: <ConversationPage /> },
      { path: "admin/people", element: <PeoplePage /> },
      { path: "browse", element: <DirectoryPage /> },
      { path: "threads", element: <StubPage icon={<MessageSquareText />} title="Треды" text={later} /> },
      { path: "drafts", element: <StubPage icon={<SendHorizontal />} title="Черновики и отправленные" text={later} /> },
      { path: "saved", element: <StubPage icon={<Bookmark />} title="Сохранённое" text={later} /> },
      { path: "files", element: <FilesPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "*", element: <StubPage icon={<SearchX />} title="Такой страницы нет" text="Проверьте адрес или выберите разговор слева" /> },
    ],
  },
]);

import { useEffect } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Bookmark, MessageSquareText, SearchX, SendHorizontal } from "lucide-react";
import { DirectoryPage } from "../channels/DirectoryPage";
import { DesignPage } from "../design/DesignPage";
import { DesktopAuthPage } from "../desktop/DesktopAuthPage";
import { DownloadPage } from "../desktop/DownloadPage";
import { InstallersPage } from "../desktop/InstallersPage";
import { MessageRedirect } from "../desktop/MessageRedirect";
import { useBoot } from "../data/boot";
import { clearReturn, pendingReturn } from "../lib/afterSignIn";
import { FilesPage } from "../files/FilesPage";
import { ConversationPage } from "../pages/ConversationPage";
import { InvitePage } from "../pages/InvitePage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { SignInPage } from "../pages/SignInPage";
import { StubPage } from "../pages/StubPage";
import { PeoplePage } from "../people/PeoplePage";
import { SearchPage } from "../search/SearchPage";
import { AppShell } from "./AppShell";
import { RouteError } from "../pages/RouteError";

// Главная: туда, откуда отправили на вход (например, /download), иначе в #general.
function OpenDefaultConversation() {
  const boot = useBoot().data;
  const back = pendingReturn();
  useEffect(() => {
    if (back) clearReturn();
  }, [back]);
  if (back) return <Navigate to={back} replace />;
  const general = boot?.conversations.find((c) => c.isGeneral) ?? boot?.conversations[0];
  return general ? <Navigate to={`/c/${general.id}`} replace /> : null;
}

const later = "Этот раздел появится в одном из следующих обновлений";

export const router = createBrowserRouter([
  // Общий экран ошибки для всех страниц вместо стандартного из React Router.
  {
    errorElement: <RouteError />,
    children: [
      { path: "/signin", element: <SignInPage /> },
      { path: "/invite/:token", element: <InvitePage /> },
      { path: "/welcome", element: <OnboardingPage /> },
      { path: "/design", element: <DesignPage /> },
      { path: "/desktop-auth", element: <DesktopAuthPage /> },
      { path: "/download", element: <DownloadPage /> },
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <OpenDefaultConversation /> },
          { path: "c/:conversationId", element: <ConversationPage /> },
          { path: "m/:messageId", element: <MessageRedirect /> },
          { path: "admin/people", element: <PeoplePage /> },
          { path: "admin/desktop", element: <InstallersPage /> },
          { path: "browse", element: <DirectoryPage /> },
          { path: "threads", element: <StubPage icon={<MessageSquareText />} title="Треды" text={later} /> },
          { path: "drafts", element: <StubPage icon={<SendHorizontal />} title="Черновики и отправленные" text={later} /> },
          { path: "saved", element: <StubPage icon={<Bookmark />} title="Сохранённое" text={later} /> },
          { path: "files", element: <FilesPage /> },
          { path: "search", element: <SearchPage /> },
          { path: "*", element: <StubPage icon={<SearchX />} title="Такой страницы нет" text="Проверьте адрес или выберите разговор слева" /> },
        ],
      },
    ],
  },
]);

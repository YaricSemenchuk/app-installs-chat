import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/600.css";
import "./styles/tokens.css";
import "./styles/global.scss";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { Tooltip } from "radix-ui";
import { api } from "./api/http";
import { router } from "./app/router";
import { queryClient } from "./data/boot";
import { desktop } from "./desktop/bridge";

// ?theme=light|dark фиксирует тему (для скриншотов); иначе — системная.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

// teamchat://… из оболочки: разговор открываем в окне, код входа меняем на сессию этого окна.
desktop?.onLink((link) => {
  if (link.type === "open") void router.navigate(link.path);
  else
    void api("/auth/desktop/exchange", { method: "POST", body: { code: link.code, verifier: link.verifier } })
      .then(() => window.location.assign("/"))
      .catch(() => void router.navigate("/signin?error=desktop"));
});

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
        <RouterProvider router={router} />
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
);

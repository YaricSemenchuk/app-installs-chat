import "@fontsource/rubik/400.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/600.css";
import "./styles/tokens.css";
import "./styles/global.scss";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Tooltip } from "radix-ui";
import { DesignPage } from "./design/DesignPage";

// ?theme=light|dark фиксирует тему (для скриншотов); иначе — системная.
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
      <DesignPage />
    </Tooltip.Provider>
  </StrictMode>,
);

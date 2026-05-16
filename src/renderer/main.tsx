import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./views/App";
import "./styles.css";
import { createRendererLogger } from "./lib/debug-log";
import { capture } from "./services/analytics";

const log = createRendererLogger("renderer");
log.info("Renderer mounting", { href: window.location.href });
capture("app_opened", {
  rendererApp: new URLSearchParams(window.location.search).get("app") === "overlay" ? "overlay" : "settings",
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

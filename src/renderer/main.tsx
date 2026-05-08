import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./views/App";
import "./styles.css";
import { createRendererLogger } from "./lib/debug-log";

const log = createRendererLogger("renderer");
log.info("Renderer mounting", { href: window.location.href });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

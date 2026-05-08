import { useEffect } from "react";
import { OverlayApp } from "./OverlayApp";
import { SettingsApp } from "./SettingsApp";
import { createRendererLogger } from "../lib/debug-log";

const log = createRendererLogger("app-router");

export function App() {
  const params = new URLSearchParams(window.location.search);
  const app = params.get("app");
  log.debug("Rendering app route", { app });

  useEffect(() => {
    const appName = app === "overlay" ? "overlay" : "settings";
    document.documentElement.dataset.voxlyApp = appName;
    document.body.dataset.voxlyApp = appName;
    log.debug("Set renderer app dataset", { appName });

    return () => {
      delete document.documentElement.dataset.voxlyApp;
      delete document.body.dataset.voxlyApp;
    };
  }, [app]);

  if (app === "overlay") {
    return <OverlayApp />;
  }

  return <SettingsApp />;
}

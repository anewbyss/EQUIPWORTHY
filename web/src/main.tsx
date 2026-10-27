import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { init } from "./lib/store";
import { startAutoSync } from "./lib/syncManager";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
// Installable / offline-capable web app (production builds only).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}

// Ask the browser to keep our data. Safari can otherwise clear site storage after
// weeks without a visit (sites added to the Home Screen are exempt).
navigator.storage?.persist?.().catch(() => undefined);

init()
  .then(() => {
    startAutoSync();
    root.render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>,
    );
  })
  .catch((e) => root.render(<pre style={{ padding: 16 }}>Could not open local storage: {String(e)}</pre>));

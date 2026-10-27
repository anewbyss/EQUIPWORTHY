import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { init } from "./lib/store";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
init()
  .then(() =>
    root.render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>,
    ),
  )
  .catch((e) => root.render(<pre style={{ padding: 16 }}>Could not open local storage: {String(e)}</pre>));

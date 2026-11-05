import React from "react";
import { createRoot } from "react-dom/client";
import "./design.css";
import "./app.css";
import App from "./App";
import { SessionBoundary } from "./auth";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionBoundary>{() => <App />}</SessionBoundary>
  </React.StrictMode>,
);

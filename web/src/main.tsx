import React from "react";
import { createRoot } from "react-dom/client";
import "./design.css";
import "./app.css";
import App from "./App";
import { SessionBoundary } from "./auth";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionBoundary>{user => <App userId={user.id} />}</SessionBoundary>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/fonts.css";
import "@/styles/theme.css";
import "@/styles/components.css";
import "@/styles/newgame.css";
import "@/styles/player-notes.css";
import "@/styles/system.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/fonts.css";
import "@/styles/theme.css";
import "@/styles/components.css";
import "@/styles/newgame.css";
import "@/styles/player-notes.css";
import "@/styles/system.css";
import "@/styles/reference.css";
import "@/styles/players.css";
import "@/styles/roleChooser.css";
import "@/styles/player-popover.css";
import "@/styles/tablet-grimoire.css";
import "@/styles/storyteller-shell.css";
import "@/styles/shell-ending.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

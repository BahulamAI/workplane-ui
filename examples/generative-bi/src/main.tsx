import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@bahulam/workplane-ui/styles.css";
import "./app.css";
import { App } from "./app.js";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

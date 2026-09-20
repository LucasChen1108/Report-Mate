import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Mobile-first, high-contrast theme (task 12.1, Req 8.1-8.4). Imported here so
// the design tokens + base stylesheet apply app-wide and are part of the build.
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

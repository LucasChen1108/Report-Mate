import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
// Mobile-first, high-contrast theme (task 12.1, Req 8.1-8.4). Imported here so
// the design tokens + base stylesheet apply app-wide and are part of the build.
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

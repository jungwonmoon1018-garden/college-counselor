import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// All browser builds default to the same-origin backend. Desktop preload or a
// host page may set an explicit override before this module runs.
if (typeof window !== "undefined" && typeof window.__CC_PROXY_URL__ === "undefined") {
  window.__CC_PROXY_URL__ = "/api/chat";
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

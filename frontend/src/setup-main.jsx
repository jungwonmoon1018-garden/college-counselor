import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SetupPanel from "./SetupPanel.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SetupPanel />
  </StrictMode>
);

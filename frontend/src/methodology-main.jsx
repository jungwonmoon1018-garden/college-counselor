import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MethodologyPanel from "./MethodologyPanel.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MethodologyPanel />
  </StrictMode>
);

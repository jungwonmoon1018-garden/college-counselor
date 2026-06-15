import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PreSignupPage from "./PreSignupPage.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <PreSignupPage />
  </StrictMode>
);

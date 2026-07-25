import React from "react";
import { createRoot } from "react-dom/client";
import OrganizationApp from "./OrganizationApp.jsx";

const root = document.getElementById("organization-root");

if (!root) {
  throw new Error("Organization portal root element was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <OrganizationApp />
  </React.StrictMode>,
);

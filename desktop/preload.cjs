const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("collegeCounselorDesktop", Object.freeze({
  platform: process.platform,
  isDesktop: true,
  adminAuth: Object.freeze({
    bootstrap: (password) => ipcRenderer.invoke("admin-auth:bootstrap", { password }),
    recover: (recoveryCode, newPassword) => ipcRenderer.invoke("admin-auth:recover", { recoveryCode, newPassword }),
  }),
  adminSecrets: Object.freeze({
    status: () => ipcRenderer.invoke("admin-secrets:status"),
    set: (name, value, csrfToken) => ipcRenderer.invoke("admin-secrets:set", { name, value, csrfToken }),
    clear: (name, csrfToken) => ipcRenderer.invoke("admin-secrets:clear", { name, csrfToken }),
  }),
  runtime: Object.freeze({
    restart: (csrfToken) => ipcRenderer.invoke("runtime:restart", { csrfToken }),
  }),
}));

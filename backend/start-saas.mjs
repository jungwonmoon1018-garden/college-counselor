// SaaS is an explicit web deployment profile. Keep this tiny wrapper so local
// operators and container runtimes cannot accidentally start the public SaaS
// surface with desktop authorization defaults.
process.env.SAAS_DEPLOYMENT = "1";
process.env.WEB_DEPLOYMENT = "1";
await import("./start-web.mjs");

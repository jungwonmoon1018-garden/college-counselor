// ═══════════════════════════════════════════════════════════════════════
// LLM PATH LOGGING — tiering → dispatch → native module
// ═══════════════════════════════════════════════════════════════════════
// One tiny, dependency-free logger so we can see every inference path: which
// tier the policy router picked, which adapter the dispatcher called, whether
// the embedded models actually ran or fell back, and exactly where the native
// module was entered (critical for diagnosing a native segfault that JS can't
// catch).
//
//   llmLog(tag, msg, fields?)   — always-on milestone. Use sparingly for the
//                                 decisions a reader needs without a flag.
//   llmDebug(tag, msg, fields?) — verbose; only when LLM_DEBUG=1.
//   breadcrumb(tag, msg)        — synchronous stderr write. Use immediately
//                                 around a native call so the line is flushed
//                                 BEFORE a possible segfault (console.log is
//                                 buffered and can be lost on a hard crash).
//   since(start)                — elapsed ms from a hrtime/Date start.
//
// Tags in use: TIER, DISPATCH, LLAMA, EMBED, COUNCIL.
// ═══════════════════════════════════════════════════════════════════════

function fmtFields(fields) {
  if (!fields || typeof fields !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const val = typeof v === "string" ? v : JSON.stringify(v);
    parts.push(`${k}=${val}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function llmLog(tag, msg, fields) {
  console.log(`[LLM ${tag}] ${msg}${fmtFields(fields)}`);
}

export function isLlmDebug() {
  // Verbose model-path logging is a diagnostic aid, never a production
  // posture — force it off in prod regardless of a stray LLM_DEBUG=1 in the
  // deployment environment.
  if (process.env.NODE_ENV === "production") return false;
  return process.env.LLM_DEBUG === "1";
}

export function llmDebug(tag, msg, fields) {
  if (!isLlmDebug()) return;
  console.log(`[LLM ${tag}] ${msg}${fmtFields(fields)}`);
}

// Synchronous, unbuffered breadcrumb — survives a native crash where the next
// line would prove inference returned. A START with no matching END pinpoints
// the segfault.
export function breadcrumb(tag, msg) {
  try {
    process.stderr.write(`[LLM ${tag}] ${msg}\n`);
  } catch {
    /* never let logging throw */
  }
}

// Elapsed milliseconds. Accepts either Date.now() or process.hrtime.bigint().
export function since(start) {
  if (typeof start === "bigint") {
    return Number((process.hrtime.bigint() - start) / 1_000_000n);
  }
  return Date.now() - start;
}

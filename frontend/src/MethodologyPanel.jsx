import { useEffect, useState } from "react";

const C = {
  bg: "#0a0e17", panel: "#171d26", border: "#394453",
  text: "#edf2f7", sub: "#b4bfcc", muted: "#96a4b5",
  green: "#9ce5b6", orange: "#ffd28a", blue: "#9ed1ff",
};
const box = { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, marginBottom: 16 };
const h2 = { fontSize: 17, fontWeight: 700, margin:"0 0 10px", color: C.text };
const line = { color:C.sub, fontSize:13, lineHeight:1.65 };

function pct(value) { return `${Math.round((Number(value) || 0) * 100)}%`; }

export default function MethodologyPanel({ embedded = false } = {}) {
  const [methodology, setMethodology] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/methodology", { signal:controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(setMethodology)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, []);

  const content = (
    <div style={{maxWidth:760,margin:"0 auto"}}>
      <h1 style={{fontSize:26,margin:"0 0 6px",letterSpacing:0}}>How guidance works</h1>
      <p style={{...line,margin:"0 0 22px"}}>Weights, evidence boundaries, model processing, cost controls, and student rights.</p>

      {error && <p role="alert" style={{...box,borderColor:"#a94d55",color:"#ffb4ba"}}>Methodology is unavailable: {error}</p>}
      {!methodology && !error && <p role="status" style={{...box,color:C.muted}}>Loading methodology...</p>}

      {methodology && (
        <>
          <section style={{...box,borderColor:"#3f8a69"}} aria-labelledby="method-summary">
            <h2 id="method-summary" style={h2}>Rules first, evidence labeled</h2>
            <p style={line}>{methodology.summary}</p>
            <p style={line}>Claims are shown as verified official facts, student-provided facts, or coaching suggestions. Missing or expired evidence produces a limitation instead of a guessed answer.</p>
          </section>

          {methodology.ecScoring?.factors && (
            <section style={box} aria-labelledby="method-ec">
              <h2 id="method-ec" style={h2}>Extracurricular factors and weights</h2>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{color:C.muted,textAlign:"left"}}><th scope="col" style={{padding:8}}>Factor</th><th scope="col" style={{padding:8}}>Weight</th><th scope="col" style={{padding:8}}>What it measures</th></tr></thead>
                  <tbody>{methodology.ecScoring.factors.map((factor) => (
                    <tr key={factor.factor} style={{borderTop:`1px solid ${C.border}`}}>
                      <th scope="row" style={{padding:8,textAlign:"left"}}>{factor.label}</th>
                      <td style={{padding:8,color:C.blue,fontWeight:700}}>{pct(factor.weight)}</td>
                      <td style={{padding:8,color:C.sub}}>{factor.what}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}

          <section style={box} aria-labelledby="method-sources">
            <h2 id="method-sources" style={h2}>Data sources and freshness</h2>
            {Object.entries(methodology.dataSources || {}).filter(([, value]) => value && typeof value === "object").map(([key, value]) => (
              <p key={key} style={{...line,margin:"5px 0"}}><strong style={{color:C.text}}>{key}</strong>: {value.source || "Not reported"}{value.year ? ` (${value.year})` : ""}{value.freshness ? `; ${value.freshness}` : ""}</p>
            ))}
            {methodology.dataSources?.internationalCaveat && <p style={{...line,color:C.orange}}>{methodology.dataSources.internationalCaveat}</p>}
          </section>

          <section style={box} aria-labelledby="method-ai">
            <h2 id="method-ai" style={h2}>External AI processing and cost</h2>
            <p style={line}>The device administrator configures one OpenRouter key. Students never enter, receive, or select provider credentials.</p>
            <p style={line}>Only redacted request context needed for a response is sent to allowlisted OpenRouter models. The app does not use general web search for sourcing.</p>
            <p style={line}>Paid model use has a hard monthly limit of $10 for grades 9-11 and $15 for grade 12. Unknown-price models are blocked rather than counted as free.</p>
          </section>

          <section style={box} aria-labelledby="method-review">
            <h2 id="method-review" style={h2}>Human review is not active</h2>
            <p style={line}>No counselor or administrator is reviewing responses in this release. Regulated questions without sufficient current evidence must fail closed. AI output is informational and should be checked against official sources.</p>
          </section>

          <section style={box} aria-labelledby="method-rights">
            <h2 id="method-rights" style={h2}>Student controls</h2>
            <p style={line}>Students can export their complete account data, delete the account and associated records, cancel a pending request, and edit generated narrative drafts before saving.</p>
          </section>
        </>
      )}
    </div>
  );

  if (embedded) return <div style={{color:C.text}}>{content}</div>;
  return <main style={{minHeight:"100dvh",background:C.bg,color:C.text,padding:"32px 16px"}}>{content}</main>;
}

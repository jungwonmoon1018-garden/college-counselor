import { t } from "../i18n.js";

// ═══════════════════════════════════════════════════════════════════════
// DisclosurePanel — the full "how this tool works / your rights" page.
// Opened from the sidebar "Disclosures" toggle (activePanel === "disclosure").
//
// The chat header only has room for a one-line advisory banner; this panel
// is the long-form version. Content mirrors the backend's own disclosure
// strings (answer-composer.js buildAIDisclosure + i18n.js ai.disclosure.*)
// so a student sees one consistent voice. It is purely static — no network
// call — so it always renders, even if the backend is unreachable.
// ═══════════════════════════════════════════════════════════════════════

const SECTIONS = [
  { key: "ai",        accent: "#63b3ed" },
  { key: "advisory",  accent: "#f6ad55" },
  { key: "lanes",     accent: "#9ce5b6" },
  { key: "fafsa",     accent: "#f56565" },
  { key: "privacy",   accent: "#c4b5fd" },
];

export default function DisclosurePanel({ locale = "en-US" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#e8e6e3" }}>
          {t(locale, "disclosure.title")}
        </div>
        <div style={{ fontSize: 13, color: "#8a8a9a", marginTop: 6, lineHeight: 1.5 }}>
          {t(locale, "disclosure.intro")}
        </div>
      </div>

      {SECTIONS.map(({ key, accent }) => (
        <div
          key={key}
          style={{
            borderLeft: `3px solid ${accent}`,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 10,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e8e6e3", marginBottom: 4 }}>
            {t(locale, `disclosure.${key}.title`)}
          </div>
          <div style={{ fontSize: 12.5, color: "#b5b5c0", lineHeight: 1.6 }}>
            {t(locale, `disclosure.${key}.body`)}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "#6a6a7a", lineHeight: 1.5 }}>
        {t(locale, "disclosure.footer")}
      </div>
    </div>
  );
}

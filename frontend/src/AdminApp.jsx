import { useEffect, useMemo, useState } from "react";

const COPY = {
  en: {
    brand: "College Counselor Administrator",
    student: "Student app",
    title: "Local administrator",
    lede: "Configure the three secrets used by this installation. The administrator cannot inspect student profiles, chats, or application records.",
    loading: "Loading administrator status...",
    createTitle: "Create administrator account",
    loginTitle: "Administrator sign in",
    password: "Password",
    passwordHint: "Use at least 12 characters. This password is separate from student accounts.",
    confirm: "Confirm password",
    create: "Create administrator",
    signIn: "Sign in",
    recover: "Use recovery code",
    recoveryCode: "Recovery code",
    newPassword: "New password",
    reset: "Reset password",
    back: "Back to sign in",
    recoverySave: "Store this recovery code offline. It is shown only once.",
    logout: "Sign out",
    secretsTitle: "Installation secrets",
    encryption: "Vault encryption key",
    encryptionDesc: "Generated once and protected by the operating system credential store. It cannot be viewed or replaced.",
    openrouter: "OpenRouter API key",
    openrouterDesc: "Used for all model requests. Students never enter or receive this key.",
    scorecard: "IPEDS / College Scorecard API key",
    scorecardDesc: "Used only with the official College Scorecard data service.",
    configured: "Configured",
    missing: "Not configured",
    replace: "Replace",
    add: "Add",
    clear: "Clear",
    cancel: "Cancel",
    save: "Save and restart",
    value: "New secret value",
    restarting: "Saving securely and restarting the local service...",
    desktopOnly: "Secret changes are available only in the installed desktop app.",
    safeNote: "Secret values are submitted directly to the Electron main process, encrypted with DPAPI or Keychain, and never stored in browser storage.",
    genericError: "The request could not be completed.",
    mismatch: "Passwords do not match.",
    shortPassword: "Password must be at least 12 characters.",
    cleared: "Secret cleared.",
    saved: "Secret saved. The local service restarted.",
    clearConfirm: "Clear this secret? Related features will stop working.",
  },
  ko: {
    brand: "College Counselor 관리자",
    student: "학생 앱",
    title: "로컬 관리자",
    lede: "이 설치에서 사용하는 세 가지 비밀 키를 설정합니다. 관리자는 학생 프로필, 대화 또는 지원 기록을 볼 수 없습니다.",
    loading: "관리자 상태를 불러오는 중...",
    createTitle: "관리자 계정 만들기",
    loginTitle: "관리자 로그인",
    password: "비밀번호",
    passwordHint: "12자 이상을 사용하세요. 학생 계정 비밀번호와는 별개입니다.",
    confirm: "비밀번호 확인",
    create: "관리자 만들기",
    signIn: "로그인",
    recover: "복구 코드 사용",
    recoveryCode: "복구 코드",
    newPassword: "새 비밀번호",
    reset: "비밀번호 재설정",
    back: "로그인으로 돌아가기",
    recoverySave: "이 복구 코드를 오프라인에 보관하세요. 한 번만 표시됩니다.",
    logout: "로그아웃",
    secretsTitle: "설치 비밀 키",
    encryption: "보관함 암호화 키",
    encryptionDesc: "한 번 생성되어 운영 체제 자격 증명 저장소로 보호됩니다. 확인하거나 교체할 수 없습니다.",
    openrouter: "OpenRouter API 키",
    openrouterDesc: "모든 모델 요청에 사용됩니다. 학생은 이 키를 입력하거나 볼 수 없습니다.",
    scorecard: "IPEDS / College Scorecard API 키",
    scorecardDesc: "공식 College Scorecard 데이터 서비스에만 사용됩니다.",
    configured: "설정됨",
    missing: "설정 안 됨",
    replace: "교체",
    add: "추가",
    clear: "삭제",
    cancel: "취소",
    save: "저장 후 재시작",
    value: "새 비밀 키 값",
    restarting: "안전하게 저장하고 로컬 서비스를 재시작하는 중...",
    desktopOnly: "비밀 키 변경은 설치된 데스크톱 앱에서만 가능합니다.",
    safeNote: "비밀 키 값은 Electron 메인 프로세스로 직접 전송되고 DPAPI 또는 Keychain으로 암호화되며 브라우저 저장소에 저장되지 않습니다.",
    genericError: "요청을 완료하지 못했습니다.",
    mismatch: "비밀번호가 일치하지 않습니다.",
    shortPassword: "비밀번호는 12자 이상이어야 합니다.",
    cleared: "비밀 키를 삭제했습니다.",
    saved: "비밀 키를 저장하고 로컬 서비스를 재시작했습니다.",
    clearConfirm: "이 비밀 키를 삭제할까요? 관련 기능이 중지됩니다.",
  },
};

async function jsonRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
  return body;
}

export default function AdminApp() {
  const [locale, setLocale] = useState(() => navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en");
  const [bootstrapped, setBootstrapped] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [oneTimeRecovery, setOneTimeRecovery] = useState("");
  const [secrets, setSecrets] = useState(null);
  const [editing, setEditing] = useState(null);
  const [secretValue, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const c = COPY[locale];
  const desktop = window.collegeCounselorDesktop;

  useEffect(() => {
    document.documentElement.lang = locale === "ko" ? "ko" : "en";
  }, [locale]);

  useEffect(() => {
    jsonRequest("/api/admin/status")
      .then((body) => setBootstrapped(Boolean(body.bootstrapped)))
      .catch((error) => { setBootstrapped(false); setMessage({ type: "error", text: error.message }); });
  }, []);

  const normalizedSecrets = useMemo(() => {
    if (!secrets) return {};
    return secrets.secrets || secrets;
  }, [secrets]);

  async function refreshSecrets() {
    if (!desktop?.adminSecrets) throw new Error(c.desktopOnly);
    const status = await desktop.adminSecrets.status();
    setSecrets(status);
  }

  async function authenticate(event) {
    event.preventDefault();
    setMessage(null);
    if (password.length < 12) { setMessage({ type: "error", text: c.shortPassword }); return; }
    if (!bootstrapped && password !== confirmPassword) { setMessage({ type: "error", text: c.mismatch }); return; }
    setBusy(true);
    try {
      const body = bootstrapped
        ? await jsonRequest("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) })
        : await desktop?.adminAuth?.bootstrap(password);
      if (!body) throw new Error(c.desktopOnly);
      setAuthenticated(true);
      setCsrfToken(body.csrfToken || "");
      setBootstrapped(true);
      setOneTimeRecovery(body.recoveryCode || "");
      setPassword("");
      setConfirmPassword("");
      await refreshSecrets();
    } catch (error) {
      setMessage({ type: "error", text: error.message || c.genericError });
    } finally {
      setBusy(false);
    }
  }

  async function recover(event) {
    event.preventDefault();
    setMessage(null);
    if (newPassword.length < 12) { setMessage({ type: "error", text: c.shortPassword }); return; }
    setBusy(true);
    try {
      const body = await desktop?.adminAuth?.recover(recoveryCode.trim(), newPassword);
      if (!body) throw new Error(c.desktopOnly);
      setAuthenticated(true);
      setCsrfToken(body.csrfToken || "");
      setOneTimeRecovery(body.recoveryCode || "");
      setRecoveryCode("");
      setNewPassword("");
      setRecoveryMode(false);
      await refreshSecrets();
    } catch (error) {
      setMessage({ type: "error", text: error.message || c.genericError });
    } finally {
      setBusy(false);
    }
  }

  async function saveSecret(event) {
    event.preventDefault();
    if (!editing || !secretValue.trim()) return;
    setBusy(true);
    setMessage({ type: "success", text: c.restarting });
    try {
      await desktop.adminSecrets.set(editing, secretValue, csrfToken);
      setSecretValue("");
      setEditing(null);
      await refreshSecrets();
      setMessage({ type: "success", text: c.saved });
    } catch (error) {
      setMessage({ type: "error", text: error.message || c.genericError });
    } finally {
      setBusy(false);
    }
  }

  async function clearSecret(name) {
    if (!window.confirm(c.clearConfirm)) return;
    setBusy(true);
    setMessage({ type: "success", text: c.restarting });
    try {
      await desktop.adminSecrets.clear(name, csrfToken);
      await refreshSecrets();
      setMessage({ type: "success", text: c.cleared });
    } catch (error) {
      setMessage({ type: "error", text: error.message || c.genericError });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await jsonRequest("/api/admin/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    } catch {}
    setAuthenticated(false);
    setCsrfToken("");
    setSecrets(null);
    setOneTimeRecovery("");
    setMessage(null);
  }

  const secretRows = [
    { name: "encryption", title: c.encryption, description: c.encryptionDesc, mutable: false },
    { name: "openrouter", title: c.openrouter, description: c.openrouterDesc, mutable: true },
    { name: "scorecard", title: c.scorecard, description: c.scorecardDesc, mutable: true },
  ];

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <p className="admin-brand">{c.brand}</p>
        <nav className="admin-header-actions" aria-label="Administrator navigation">
          <a href="/index.html">{c.student}</a>
          <button className="admin-link-button" type="button" onClick={() => setLocale(locale === "en" ? "ko" : "en")} aria-label="Change language">
            {locale === "en" ? "한국어" : "English"}
          </button>
          {authenticated && <button className="admin-link-button" type="button" onClick={logout}>{c.logout}</button>}
        </nav>
      </header>
      <main className="admin-main">
        <h1>{c.title}</h1>
        <p className="admin-lede">{c.lede}</p>
        {message && <p className={"admin-alert " + message.type} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}

        {bootstrapped === null && <p role="status">{c.loading}</p>}

        {bootstrapped !== null && !authenticated && (
          <section className="admin-panel" aria-labelledby="admin-auth-title">
            <h2 id="admin-auth-title">{recoveryMode ? c.recover : (bootstrapped ? c.loginTitle : c.createTitle)}</h2>
            {recoveryMode ? (
              <form className="admin-form" onSubmit={recover}>
                <div className="admin-field">
                  <label htmlFor="admin-recovery">{c.recoveryCode}</label>
                  <input id="admin-recovery" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} autoComplete="off" required />
                </div>
                <div className="admin-field">
                  <label htmlFor="admin-new-password">{c.newPassword}</label>
                  <input id="admin-new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required />
                  <small>{c.passwordHint}</small>
                </div>
                <button className="admin-primary" disabled={busy} type="submit">{c.reset}</button>
                <button className="admin-secondary" type="button" onClick={() => setRecoveryMode(false)}>{c.back}</button>
              </form>
            ) : (
              <form className="admin-form" onSubmit={authenticate}>
                <div className="admin-field">
                  <label htmlFor="admin-password">{c.password}</label>
                  <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={bootstrapped ? "current-password" : "new-password"} minLength={12} required autoFocus />
                  <small>{c.passwordHint}</small>
                </div>
                {!bootstrapped && (
                  <div className="admin-field">
                    <label htmlFor="admin-confirm">{c.confirm}</label>
                    <input id="admin-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required />
                  </div>
                )}
                <button className="admin-primary" disabled={busy} type="submit">{bootstrapped ? c.signIn : c.create}</button>
                {bootstrapped && <button className="admin-secondary" type="button" onClick={() => setRecoveryMode(true)}>{c.recover}</button>}
              </form>
            )}
          </section>
        )}

        {authenticated && (
          <section className="admin-panel" aria-labelledby="admin-secrets-title">
            <h2 id="admin-secrets-title">{c.secretsTitle}</h2>
            {oneTimeRecovery && <div className="admin-recovery" role="status">{c.recoverySave}<code>{oneTimeRecovery}</code></div>}
            {!desktop?.adminSecrets && <p className="admin-alert error" role="alert">{c.desktopOnly}</p>}
            <div className="admin-secret-list">
              {secretRows.map((row) => {
                const configured = Boolean(normalizedSecrets[row.name]?.configured);
                return (
                  <article className="admin-secret" key={row.name}>
                    <div>
                      <h2>{row.title}</h2>
                      <p>{row.description}</p>
                      <span className={"admin-badge " + (configured ? "on" : "off")}>{configured ? c.configured : c.missing}</span>
                    </div>
                    {row.mutable && (
                      <div className="admin-secret-actions">
                        <button className="admin-secondary" type="button" disabled={busy || !desktop?.adminSecrets} onClick={() => { setEditing(row.name); setSecretValue(""); }}>
                          {configured ? c.replace : c.add}
                        </button>
                        {configured && <button className="admin-danger" type="button" disabled={busy || !desktop?.adminSecrets} onClick={() => clearSecret(row.name)}>{c.clear}</button>}
                      </div>
                    )}
                    {editing === row.name && (
                      <form className="admin-editor" onSubmit={saveSecret}>
                        <label htmlFor={"secret-" + row.name}>{c.value}</label>
                        <input id={"secret-" + row.name} type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} autoComplete="off" required autoFocus />
                        <button className="admin-primary" type="submit" disabled={busy}>{c.save}</button>
                        <button className="admin-secondary" type="button" onClick={() => { setEditing(null); setSecretValue(""); }}>{c.cancel}</button>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="admin-footnote">{c.safeNote}</p>
          </section>
        )}
      </main>
    </div>
  );
}

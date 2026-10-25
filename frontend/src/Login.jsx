import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ensureServerReady, login, register } from "./api";
import { setUser } from "./auth";

export default function LoginPage() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const nav = useNavigate();

  useEffect(() => {
    let active = true;
    ensureServerReady().then(
      () => { if (active) setConnection("ready"); },
      () => { if (active) setConnection("unavailable"); },
    );
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setConnection("connecting");
    try {
      await ensureServerReady();
      setConnection("ready");
      const user = mode === "login"
        ? await login(name, password)
        : await register(name, password, inviteCode);
      setUser(user);
      nav("/app");
    } catch (requestError) {
      if (!requestError.status) setConnection("unavailable");
      setError(requestError.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-update-control"><AppUpdater /></div>
      <section className="login-scene">
        <div className="login-sun" />
        <div className="login-city">TWO</div>
        <div className="login-scene-copy">
          <span>COUPLES TRAVEL PLANNER</span>
          <h2>Plan every journey.<br />Experience it together.</h2>
          <p>Build itineraries, manage shared lists, and keep every trip organized.</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-brand"><span>TT</span><small>TRIP TOOLS</small></div>
        <h1>{mode === "login" ? "Welcome back" : "Join the journey"}</h1>
        <p className="login-intro">{mode === "login" ? "Your shared trips, plans, and memories are waiting." : "Use the invitation from your travel partner."}</p>

        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Log in</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>Join a trip</button>
        </div>

        <form onSubmit={submit} className="login-form">
          <label>TRAVELER NAME<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="username" placeholder="Username" required /></label>
          <label>PASSWORD<input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Enter your password" type="password" required />{mode === "register" && <small>At least 6 characters with a letter and a number.</small>}</label>
          {mode === "register" && <label>INVITATION CODE<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="8-character code" maxLength={32} required /></label>}
          <small role="status" aria-live="polite">{connection === "connecting" ? "Connecting to the server… If it is asleep, this can take up to two minutes." : connection === "ready" ? "Server connected." : "Submit the form to try connecting again."}</small>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="login-submit" disabled={loading}>{loading ? connection === "connecting" ? "Connecting to server…" : "Opening your trip…" : mode === "login" ? "Enter Trip Tools  →" : "Join shared trip  →"}</button>
        </form>
        <p className="login-secure">Protected account · Private shared trip</p>
      </section>
    </main>
  );
}
import AppUpdater from "./AppUpdater";

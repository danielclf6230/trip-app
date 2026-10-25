import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePassword } from "./api";
import { getUser, logout } from "./auth";

export default function UserPage() {
  const user = getUser();
  const nav = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Your password has been updated.");
    } catch (requestError) {
      setError(requestError.message || "Could not update your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="profile-page">
      <header className="profile-topbar">
        <button className="profile-back" onClick={() => nav("/app")}>← Back to trip</button>
        <div className="brand"><span className="brand-mark">TT</span><div><strong>TRIP TOOLS</strong><small>TRAVELER ACCOUNT</small></div></div>
        <div className="profile-update-actions"><AppUpdater /><button className="profile-logout" onClick={() => { logout(); nav("/", { replace: true }); }}>Log out</button></div>
      </header>

      <section className="profile-layout">
        <aside className="profile-card">
          <div className="profile-avatar">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.name || "T")[0].toUpperCase()}
          </div>
          <span>TRAVELER PROFILE</span>
          <h1>{user?.name}</h1>
          <p>{user?.role === "admin" ? "Administrator" : "Trip member"}</p>
          <div className="profile-stamp">TT<br /><small>TRAVEL</small></div>
        </aside>

        <div className="password-card">
          <span className="profile-eyebrow">ACCOUNT SECURITY</span>
          <h2>Change your password</h2>
          <p>Confirm your identity with your current password, then choose a new secure password.</p>
          <form onSubmit={submit} className="password-form">
            <label>CURRENT PASSWORD<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label>NEW PASSWORD<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small>At least 6 characters with a letter and a number.</small></label>
            <label>CONFIRM NEW PASSWORD<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {error && <div className="profile-alert error">{error}</div>}
            {message && <div className="profile-alert success">✓ {message}</div>}
            <button disabled={saving}>{saving ? "Updating…" : "Update password"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
import AppUpdater from "./AppUpdater";

import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Stethoscope, Users, UserRound } from "lucide-react";
import { post } from "../api";
import { Brand, Spinner } from "../components/ui";
import type { Role } from "../types";
export default function Auth({
  onSuccess,
}: {
  onSuccess: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>("caregiver");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await post(`/auth/${mode}`, {
        ...fields,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      await post("/auth/demo", { role });
      await onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="welcome-layout">
      <section className="welcome-panel">
        <Brand />
        <div className="welcome-copy">
          <h1>Post-surgery recovery</h1>
          <p>
            Review prescriptions, follow dose schedules, and share recovery
            check-ins with your care team.
          </p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2 className="auth-title">RecoverTrack</h2>
          <div className="auth-tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Create account
            </button>
          </div>
          <form onSubmit={submit} className="form-stack">
            {mode === "register" && (
              <>
                <label className="field">
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="e.g. Ananya Sharma"
                    maxLength={100}
                  />
                </label>
                <label className="field">
                  Patient's name
                  <input
                    name="patientName"
                    required
                    placeholder="Patient name"
                    maxLength={100}
                  />
                </label>
              </>
            )}
            <label className="field">
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label className="field">
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "register" ? 10 : 1}
                placeholder={
                  mode === "register"
                    ? "At least 10 characters"
                    : "Enter your password"
                }
              />
            </label>
            {mode === "register" && (
              <>
                <p className="subtle-note">
                  Create a household for this patient. Invite other caregivers
                  after signing in.
                </p>
                <label className="check-row">
                  <input type="checkbox" required name="appConsent" />
                  <span>
                    I agree to store recovery records in RecoverTrack.
                  </span>
                </label>
              </>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : mode === "login" ? (
                "Sign in to RecoverTrack"
              ) : (
                "Create RecoverTrack account"
              )}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-divider">
            <span>Demo</span>
          </div>
          <div className="demo-intro">
            <div>
              <strong>Try the demo</strong>
              <p>Fictional patient data. Each session is separate.</p>
            </div>
          </div>
          <div className="demo-options">
            {(
              [
                { id: "caregiver", label: "Caregiver", icon: Users },
                { id: "patient", label: "Patient", icon: UserRound },
                { id: "doctor", label: "Clinician", icon: Stethoscope },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => setRole(item.id)}
                className={`role-option ${role === item.id ? "active" : ""}`}
              >
                <item.icon size={19} />
                {item.label}
              </button>
            ))}
          </div>
          <button
            className="button secondary auth-submit"
            disabled={busy}
            onClick={demo}
          >
            {busy ? <Spinner /> : "Explore demo"}
            <ArrowRight size={17} />
          </button>
          <p className="auth-disclaimer">
            Prototype. OCR needs review; attention scores are not clinically
            validated.
          </p>
        </div>
      </section>
    </div>
  );
}

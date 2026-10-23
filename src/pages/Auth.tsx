import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import { post } from "../api";
import { Brand, Spinner } from "../components/ui";
import type { Role } from "../types";
import "../auth.css";

type AuthMode = "login" | "register" | "demo";

export default function Auth({
  initialMode = "login",
  onSuccess,
  serviceError,
  onRetry,
}: {
  initialMode?: AuthMode;
  onSuccess: () => Promise<void>;
  serviceError?: string;
  onRetry?: () => Promise<void>;
}) {
  const mode = initialMode;
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>("caregiver");
  const [name, setName] = useState("");
  const [patientName, setPatientName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  const visibleError = error || serviceError;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    setError("");
    setPasswordVisible(false);
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || retrying || mode === "demo") return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await post(`/auth/${mode}`, {
        email: email.trim(),
        password,
        ...(mode === "register"
          ? {
              name,
              patientName,
              appConsent: consent ? "on" : "",
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : {}),
      });
      if (active.current) await onSuccess();
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function demo() {
    if (inFlight.current || retrying) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await post("/auth/demo", { role });
      if (active.current) await onSuccess();
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function retry() {
    if (!onRetry || inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setError("");
    try {
      await onRetry();
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      inFlight.current = false;
      if (active.current) setRetrying(false);
    }
  }

  const title =
    mode === "register"
      ? "Create your account."
      : mode === "demo"
        ? "Take a look around."
        : "Welcome back.";
  const description =
    mode === "register"
      ? "Set up a recovery record for the patient you support."
      : mode === "demo"
        ? "Choose a view to explore with fictional patient records."
        : "Sign in to your recovery workspace.";

  function connectionMessage() {
    return visibleError ? (
      <div className="auth-message" role="alert">
        <p>{visibleError}</p>
        {serviceError && onRetry && (
          <button type="button" onClick={retry} disabled={busy || retrying}>
            {retrying ? "Checking connection…" : "Try again"}
          </button>
        )}
      </div>
    ) : null;
  }

  return (
    <div className="auth-page">
      <a className="auth-skip" href="#auth-main">
        Skip to {mode === "demo" ? "demo" : "account form"}
      </a>
      <header className="auth-header">
        <Link to="/" aria-label="RecoverTrack home" className="auth-brand">
          <Brand />
        </Link>
        <Link to="/" className="auth-back">
          <ArrowLeft size={16} />
          Back to home
        </Link>
      </header>
      <main className="auth-main" id="auth-main">
        <aside className="auth-context" aria-label="About your workspace">
          <span className="auth-eyebrow">RECOVERY AT HOME</span>
          <h2>
            A clear record.
            <br />A shared routine.
          </h2>
          <p>
            Keep the prescription, daily doses and recovery check-ins together.
            Share access with the people helping you.
          </p>
          <ul>
            <li>
              <Check size={16} />
              Review every prescription before scheduling.
            </li>
            <li>
              <Check size={16} />
              Keep a record of doses and daily check-ins.
            </li>
            <li>
              <Check size={16} />
              Invite your care team with individual access.
            </li>
          </ul>
          <p className="auth-context-note">
            Follow your prescribed care plan. RecoverTrack does not diagnose
            conditions or recommend treatment changes.
          </p>
        </aside>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-heading">
            <span className="auth-eyebrow">
              {mode === "demo" ? "EXPLORE RECOVERTRACK" : "YOUR WORKSPACE"}
            </span>
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </div>
          {mode !== "demo" && (
            <nav className="auth-tabs" aria-label="Account access">
              <Link
                to="/signin"
                state={location.state}
                aria-current={mode === "login" ? "page" : undefined}
              >
                Sign in
              </Link>
              <Link
                to="/register"
                state={location.state}
                aria-current={mode === "register" ? "page" : undefined}
              >
                Create account
              </Link>
            </nav>
          )}
          {mode === "demo" ? (
            <div className="auth-demo">
              <div
                className="auth-demo-options"
                role="group"
                aria-label="Choose a demo view"
              >
                {(
                  [
                    {
                      id: "caregiver",
                      label: "Caregiver",
                      icon: Users,
                      detail: "Manage the daily plan",
                    },
                    {
                      id: "patient",
                      label: "Patient",
                      icon: UserRound,
                      detail: "Record doses and check-ins",
                    },
                    {
                      id: "doctor",
                      label: "Clinician",
                      icon: Stethoscope,
                      detail: "Review shared recovery records",
                    },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-label={item.label}
                    aria-pressed={role === item.id}
                    disabled={busy || retrying}
                    onClick={() => setRole(item.id)}
                  >
                    <span className="auth-role-icon">
                      <item.icon size={21} />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="auth-role-selected" aria-hidden="true">
                      {role === item.id && <Check size={13} />}
                    </span>
                  </button>
                ))}
              </div>
              <p className="auth-demo-note">
                Each session is separate. No personal information is needed.
              </p>
              {connectionMessage()}
              <button
                type="button"
                className="auth-primary"
                disabled={busy || retrying}
                onClick={demo}
              >
                {busy ? (
                  <>
                    <Spinner label="Opening demo" />
                    Opening demo…
                  </>
                ) : (
                  <>
                    Explore demo
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
              <p className="auth-switch">
                Already have an account?{" "}
                <Link to="/signin" state={location.state}>
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="auth-form" aria-busy={busy}>
                {mode === "register" && (
                  <>
                    <label className="auth-field">
                      Your name
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        placeholder="Your full name"
                        maxLength={100}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label className="auth-field">
                      Patient's name
                      <input
                        name="patientName"
                        autoComplete="off"
                        required
                        placeholder="Patient's full name"
                        maxLength={100}
                        value={patientName}
                        onChange={(event) => setPatientName(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  </>
                )}
                <label className="auth-field">
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    required
                    placeholder="you@example.com"
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <div className="auth-field">
                  <label htmlFor="account-password">Password</label>
                  <div className="auth-password">
                    <input
                      id="account-password"
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                      minLength={mode === "register" ? 10 : 1}
                      maxLength={128}
                      placeholder={
                        mode === "register"
                          ? "At least 10 characters"
                          : "Enter your password"
                      }
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      aria-label={
                        passwordVisible ? "Hide password" : "Show password"
                      }
                      aria-pressed={passwordVisible}
                    >
                      {passwordVisible ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>
                {mode === "register" && (
                  <label className="auth-consent">
                    <input
                      type="checkbox"
                      required
                      name="appConsent"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      I agree to store recovery records in RecoverTrack.
                    </span>
                  </label>
                )}
                {connectionMessage()}
                <button
                  type="submit"
                  className="auth-primary"
                  disabled={busy || retrying}
                >
                  {busy ? (
                    <>
                      <Spinner
                        label={
                          mode === "login" ? "Signing in" : "Creating account"
                        }
                      />
                      {mode === "login" ? "Signing in…" : "Creating account…"}
                    </>
                  ) : (
                    <>
                      {mode === "login"
                        ? "Sign in to RecoverTrack"
                        : "Create RecoverTrack account"}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
              <div className="auth-demo-link">
                <span>Want to see how it works first?</span>
                <Link to="/demo" state={location.state}>
                  Explore demo <ArrowRight size={15} />
                </Link>
              </div>
            </>
          )}
          <p className="auth-privacy">
            <LockKeyhole size={14} />
            Individual accounts. Access shared by invitation.
          </p>
        </section>
      </main>
      <footer className="auth-footer">
        <span>© {new Date().getFullYear()} RecoverTrack</span>
        <p>
          {mode === "demo"
            ? "Fictional records only. OCR requires review; attention scores are experimental."
            : "A shared recovery record for the days after discharge."}
        </p>
      </footer>
    </div>
  );
}

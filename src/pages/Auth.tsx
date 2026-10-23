import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  FileCheck2,
  HeartHandshake,
  LockKeyhole,
  Pill,
  ScanLine,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import { post } from "../api";
import { Brand, Spinner } from "../components/ui";
import type { Role } from "../types";
import "../landing.css";

const questions = [
  {
    question: "How do I add a prescription?",
    answer:
      "Upload a clear prescription image or enter the details manually. Check the medication, strength, dose, times and duration against the original, then confirm. OCR output never starts a schedule on its own.",
  },
  {
    question: "Can my family share the same recovery record?",
    answer:
      "Yes. A caregiver can create a private invitation code for another caregiver, the patient or a clinician. Each person uses their own account, and activity records show who made each check-in.",
  },
  {
    question: "Will I receive reminders after closing the app?",
    answer:
      "Reminders currently appear inside RecoverTrack while the app is open. Background push, text, email and phone-call delivery are not connected.",
  },
  {
    question: "What does the attention score mean?",
    answer:
      "It highlights patterns in recorded doses, pain and mobility using a set of transparent rules. It is experimental, not clinically validated, and does not diagnose a complication or recommend medication changes.",
  },
  {
    question: "Can I try it without entering personal information?",
    answer:
      "Choose a role and open the demo below. Each session gets a separate set of fictional records. Create an account only when you want to set up your own recovery record.",
  },
];

function ProductPreview() {
  return (
    <figure
      className="landing-preview"
      aria-label="Illustrative caregiver dashboard with fictional records"
    >
      <div className="preview-window">
        <div className="preview-topbar">
          <span className="preview-wordmark">Your recovery</span>
          <span className="preview-status">
            <i /> Caregiver view
          </span>
        </div>
        <div className="preview-profile">
          <span className="preview-avatar">AS</span>
          <div>
            <strong>Ananya S.</strong>
            <span>Recovery at home</span>
          </div>
          <span className="preview-day">Day 7</span>
        </div>
        <div className="preview-greeting">
          <span>TODAY'S PLAN</span>
          <h2>A routine, kept together.</h2>
          <p>Medication, check-ins and the people helping.</p>
        </div>
        <div className="preview-schedule">
          <div className="preview-schedule-heading">
            <strong>Medication schedule</strong>
            <CalendarDays size={16} />
          </div>
          <div className="preview-dose">
            <span className="preview-time">
              8:00<span>AM</span>
            </span>
            <span className="preview-pill sage">
              <Pill size={19} />
            </span>
            <div>
              <strong>MED-A</strong>
              <span>Reviewed prescription</span>
            </div>
            <span className="preview-done">
              <Check size={12} /> Recorded
            </span>
          </div>
          <div className="preview-dose">
            <span className="preview-time">
              12:00<span>PM</span>
            </span>
            <span className="preview-pill sand">
              <Pill size={19} />
            </span>
            <div>
              <strong>MED-B</strong>
              <span>Reviewed prescription</span>
            </div>
            <span className="preview-upcoming">Upcoming</span>
          </div>
        </div>
        <div className="preview-bottom">
          <div>
            <span className="preview-check">
              <Check size={15} />
            </span>
            <div>
              <strong>Daily check-in</strong>
              <span>Shared with your care team</span>
            </div>
          </div>
          <ArrowUpRight size={17} />
        </div>
      </div>
      <div className="preview-review">
        <span>
          <FileCheck2 size={23} />
        </span>
        <div>
          <strong>Reviewed by you.</strong>
          <p>Scheduled only after confirmation.</p>
        </div>
      </div>
      <figcaption>Product preview · fictional example</figcaption>
    </figure>
  );
}

export default function Auth({
  onSuccess,
  serviceError,
  onRetry,
}: {
  onSuccess: () => Promise<void>;
  serviceError?: string;
  onRetry?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>("caregiver");
  const visibleError = error || serviceError;

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

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    setError("");
    try {
      await onRetry();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="landing" id="top">
      <a className="landing-skip" href="#access">
        Skip to sign in
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <a
            href="#top"
            aria-label="RecoverTrack home"
            className="landing-brand-link"
          >
            <Brand />
          </a>
          <nav className="landing-nav" aria-label="About RecoverTrack">
            <a href="#how-it-works">How it works</a>
            <a href="#care-team">For your care team</a>
            <a href="#questions">Questions</a>
          </nav>
          <a className="landing-nav-access" href="#access">
            Sign in <ArrowUpRight size={15} />
          </a>
        </div>
      </header>
      <main>
        <section
          className="landing-hero landing-container"
          aria-labelledby="landing-title"
        >
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">
              <span /> THE DAYS AFTER DISCHARGE
            </span>
            <h1 id="landing-title">
              Recovery at home.
              <br />A plan everyone
              <br />
              can <em>follow.</em>
            </h1>
            <p className="landing-hero-description">
              Bring prescriptions, medication schedules and daily check-ins into
              one shared recovery record.
            </p>
            <div className="landing-hero-actions">
              <a href="#access" className="landing-button landing-button-dark">
                Open your workspace <ArrowRight size={17} />
              </a>
              <a href="#how-it-works" className="landing-text-link">
                See how it works <ArrowDown size={15} />
              </a>
            </div>
            <div className="landing-hero-note">
              <ShieldCheck size={16} />
              <span>
                Human review first. Your prescribed care plan stays in control.
              </span>
            </div>
          </div>
          <ProductPreview />
        </section>
        <div
          className="landing-principles landing-container"
          aria-label="Product principles"
        >
          <span>
            <ScanLine size={18} /> Prescription to reviewed plan
          </span>
          <span>
            <CalendarDays size={18} /> A clear daily routine
          </span>
          <span>
            <Users size={18} /> Connected by invitation
          </span>
        </div>

        <section
          className="landing-workflow landing-container landing-section"
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-eyebrow">HOW IT WORKS</span>
              <h2 id="workflow-title">
                Less to keep in your head.
                <br />
                More in one <em>place.</em>
              </h2>
            </div>
            <p>
              Recovery brings a new set of instructions. RecoverTrack helps you
              organize them, record what happens, and share the details that
              need a closer look.
            </p>
          </div>
          <div className="landing-workflow-grid">
            <article className="landing-step">
              <div className="landing-step-visual visual-prescription">
                <div className="visual-paper">
                  <span className="visual-paper-label">
                    <FileCheck2 size={16} /> Prescription review
                  </span>
                  <i />
                  <i />
                  <div>
                    <span>Medication</span>
                    <Check size={13} />
                  </div>
                  <div>
                    <span>Dose & schedule</span>
                    <Check size={13} />
                  </div>
                  <span className="visual-paper-review">
                    Confirm before scheduling
                  </span>
                </div>
                <span className="visual-step-number">01</span>
              </div>
              <h3>Check the prescription.</h3>
              <p>
                Scan a clear image or enter details manually. Review every field
                against the original before creating a schedule.
              </p>
            </article>
            <article className="landing-step">
              <div className="landing-step-visual visual-routine">
                <div className="visual-routine-list">
                  <span className="visual-routine-title">A daily routine</span>
                  <div>
                    <span className="visual-routine-dot complete">
                      <Check size={12} />
                    </span>
                    <span>Morning dose</span>
                    <small>Recorded</small>
                  </div>
                  <div>
                    <span className="visual-routine-dot current" />
                    <span>Daily check-in</span>
                    <small>Your report</small>
                  </div>
                  <div>
                    <span className="visual-routine-dot" />
                    <span>Evening dose</span>
                    <small>Upcoming</small>
                  </div>
                </div>
                <span className="visual-step-number">02</span>
              </div>
              <h3>Keep a simple record.</h3>
              <p>
                Record doses as taken or skipped. Add a daily pain and mobility
                check-in without another spreadsheet or message thread.
              </p>
            </article>
            <article className="landing-step">
              <div className="landing-step-visual visual-shared">
                <div className="visual-care-avatars">
                  <span>AS</span>
                  <span>PS</span>
                  <span>MP</span>
                </div>
                <div className="visual-shared-record">
                  <Users size={18} />
                  <strong>One shared record</strong>
                  <span>Patient · caregiver · clinician</span>
                </div>
                <span className="visual-step-number">03</span>
              </div>
              <h3>Keep your team informed.</h3>
              <p>
                Share access by role. Review dose history, symptom reports and
                attention flags, with a record of who did what.
              </p>
            </article>
          </div>
        </section>

        <section
          className="landing-roles"
          id="care-team"
          aria-labelledby="roles-title"
        >
          <div className="landing-container">
            <div className="landing-roles-heading">
              <span className="landing-eyebrow">
                RECOVERY IS A SHARED RESPONSIBILITY
              </span>
              <h2 id="roles-title">
                One record.
                <br />
                Three focused <em>views.</em>
              </h2>
              <p>
                Each person sees the tools they need, with access set by their
                role and the household's sharing choices.
              </p>
            </div>
            <div className="landing-role-grid">
              <article>
                <span className="landing-role-icon">
                  <UserRound size={24} />
                </span>
                <span className="landing-role-number">01 / PATIENT</span>
                <h3>
                  A quick check-in.
                  <br />
                  Then back to your day.
                </h3>
                <p>
                  See the next dose and record how you're feeling. The patient
                  view keeps the daily actions easy to find.
                </p>
              </article>
              <article>
                <span className="landing-role-icon">
                  <HeartHandshake size={24} />
                </span>
                <span className="landing-role-number">02 / CAREGIVER</span>
                <h3>
                  The plan, the details,
                  <br />
                  and the shared history.
                </h3>
                <p>
                  Review prescriptions, manage schedules and coordinate with
                  family members through a shared activity record.
                </p>
              </article>
              <article>
                <span className="landing-role-icon">
                  <Stethoscope size={24} />
                </span>
                <span className="landing-role-number">03 / CLINICIAN</span>
                <h3>
                  The context for
                  <br />a useful follow-up.
                </h3>
                <p>
                  Review authorized recovery records and resolve follow-up
                  flags. Medication and symptom records remain read-only.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section
          className="landing-boundaries landing-container landing-section"
          id="our-approach"
          aria-labelledby="boundaries-title"
        >
          <div className="landing-boundaries-copy">
            <span className="landing-eyebrow">CLEAR BOUNDARIES, BY DESIGN</span>
            <h2 id="boundaries-title">
              Organize the routine.
              <br />
              Keep people
              <br />
              in <em>control.</em>
            </h2>
            <p>
              Useful recovery software should make its limits as clear as its
              features.
            </p>
            <a href="#questions" className="landing-text-link">
              A few common questions <ArrowRight size={15} />
            </a>
          </div>
          <div className="landing-boundary-list">
            <div>
              <span>
                <FileCheck2 size={21} />
              </span>
              <div>
                <h3>Human review before reminders.</h3>
                <p>
                  Extracted text is a draft. Your confirmation creates the
                  medication schedule.
                </p>
              </div>
            </div>
            <div>
              <span>
                <LockKeyhole size={21} />
              </span>
              <div>
                <h3>Access with permission.</h3>
                <p>
                  Encrypted records, individual accounts and explicit sharing
                  choices for your care team.
                </p>
              </div>
            </div>
            <div>
              <span>
                <ShieldCheck size={21} />
              </span>
              <div>
                <h3>Signals for review, not a diagnosis.</h3>
                <p>
                  The experimental attention score summarizes recorded patterns.
                  It does not change your treatment.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing-faq landing-container landing-section"
          id="questions"
          aria-labelledby="faq-title"
        >
          <div className="landing-faq-heading">
            <span className="landing-eyebrow">BEFORE YOU BEGIN</span>
            <h2 id="faq-title">
              Good questions.
              <br />
              Straight <em>answers.</em>
            </h2>
          </div>
          <div className="landing-faq-list">
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="landing-access"
          id="access"
          aria-labelledby="access-title"
        >
          <div className="landing-container landing-access-grid">
            <div className="landing-access-copy">
              <span className="landing-eyebrow">YOUR RECOVERY WORKSPACE</span>
              <h2 id="access-title">
                Start with
                <br />
                the next <em>step.</em>
              </h2>
              <p>
                Sign in to your recovery record, create a household, or explore
                the app with fictional patient data.
              </p>
              <div className="landing-access-demo-note">
                <span>
                  <Users size={22} />
                </span>
                <div>
                  <h3>Take a look before you sign up.</h3>
                  <p>
                    The demo includes separate patient, caregiver and clinician
                    views. No personal information required.
                  </p>
                </div>
              </div>
              <span className="landing-access-footnote">
                Project-stage software. Follow your prescribed care plan.
              </span>
            </div>
            <div className="landing-auth-card">
              <div className="landing-auth-heading">
                <span className="landing-auth-tag">RECOVERTRACK</span>
                <h3>
                  {mode === "login"
                    ? "Welcome back."
                    : "Set up your household."}
                </h3>
                <p>
                  {mode === "login"
                    ? "Sign in to continue your recovery record."
                    : "Start a private record for the patient you support."}
                </p>
              </div>
              <div className="landing-auth-tabs">
                <button
                  type="button"
                  aria-pressed={mode === "login"}
                  className={mode === "login" ? "active" : ""}
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "register"}
                  className={mode === "register" ? "active" : ""}
                  onClick={() => {
                    setMode("register");
                    setError("");
                  }}
                >
                  Create account
                </button>
              </div>
              <form onSubmit={submit} className="landing-form">
                {mode === "register" && (
                  <>
                    <label className="landing-field">
                      Your name
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        placeholder="Your full name"
                        maxLength={100}
                      />
                    </label>
                    <label className="landing-field">
                      Patient's name
                      <input
                        name="patientName"
                        autoComplete="off"
                        required
                        placeholder="Patient's full name"
                        maxLength={100}
                      />
                    </label>
                  </>
                )}
                <label className="landing-field">
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>
                <label className="landing-field">
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
                  <label className="landing-consent">
                    <input type="checkbox" required name="appConsent" />
                    <span>
                      I agree to store recovery records in RecoverTrack.
                    </span>
                  </label>
                )}
                {visibleError && (
                  <div className="landing-message" role="alert">
                    <p>{visibleError}</p>
                    {serviceError && onRetry && (
                      <button type="button" onClick={retry} disabled={retrying}>
                        {retrying ? (
                          <Spinner label="Checking connection" />
                        ) : (
                          "Try again"
                        )}
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  className="landing-button landing-button-dark landing-full"
                  disabled={busy || retrying}
                >
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
              <div className="landing-auth-divider">
                <span>or explore first</span>
              </div>
              <div className="landing-demo-heading">
                <strong>Choose a demo view</strong>
                <span>Separate session · fictional records</span>
              </div>
              <div className="landing-demo-options">
                {(
                  [
                    { id: "caregiver", label: "Caregiver", icon: Users },
                    { id: "patient", label: "Patient", icon: UserRound },
                    { id: "doctor", label: "Clinician", icon: Stethoscope },
                  ] as const
                ).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={role === item.id}
                    onClick={() => setRole(item.id)}
                    className={role === item.id ? "active" : ""}
                  >
                    <item.icon size={17} />
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="landing-button landing-button-outline landing-full"
                disabled={busy || retrying}
                onClick={demo}
              >
                {busy ? <Spinner /> : "Explore demo"}
                <ArrowUpRight size={16} />
              </button>
              <p className="landing-auth-note">
                OCR requires review. Attention scores are not clinically
                validated.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-top">
            <div>
              <a href="#top" aria-label="RecoverTrack home">
                <Brand />
              </a>
              <p>A shared record for the days after discharge.</p>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#care-team">Care team views</a>
              <a href="#our-approach">Our approach</a>
              <a href="#questions">Questions</a>
              <a href="#access">Sign in / demo</a>
            </nav>
          </div>
          <div className="landing-footer-bottom">
            <span>© {new Date().getFullYear()} RecoverTrack</span>
            <p>
              For routine tracking. Contact your care team for medical advice
              and local emergency services for urgent help.
            </p>
            <a href="#top">
              Back to top <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

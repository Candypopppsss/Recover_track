import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  ClipboardCheck,
  HeartHandshake,
  LockKeyhole,
  Pill,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";
import { Brand } from "../components/ui";
import "../landing.css";

const questions = [
  {
    question: "How do I add a prescription?",
    answer:
      "Upload a clear prescription image or enter the details manually. Check each medication, dose, time and duration against the original before confirming. A scan stays a draft until you review it.",
  },
  {
    question: "Can my family share the same recovery record?",
    answer:
      "Yes. A caregiver can invite the patient, another caregiver or a clinician. Each person signs in with their own account. Access follows their role and your household's sharing choices.",
  },
  {
    question: "Will reminders work when the app is closed?",
    answer:
      "Reminders currently appear inside RecoverTrack while the app is open. Background push, text, email and phone-call notifications are not connected.",
  },
  {
    question: "What do the attention flags mean?",
    answer:
      "They highlight patterns in recorded doses, pain and mobility for a person to review. The rules are experimental and have not been clinically validated. Flags do not diagnose complications or recommend treatment changes.",
  },
  {
    question: "Can I look around before creating an account?",
    answer:
      "The demo has patient, caregiver and clinician views with fictional records. It creates a separate demo session, so you can explore without entering personal recovery information.",
  },
];

function WorkspacePreview() {
  return (
    <figure
      className="landing-preview"
      aria-label="Sample recovery workspace with fictional records"
    >
      <div className="preview-window">
        <div className="preview-topbar">
          <span className="preview-wordmark">
            <span className="preview-mini-mark">R</span> Recovery overview
          </span>
          <span className="preview-sample">Sample workspace</span>
        </div>
        <div className="preview-profile">
          <div>
            <span className="preview-eyebrow">RECOVERY AT HOME</span>
            <h2>Today, at a glance.</h2>
            <p>A shared plan for Ananya S.</p>
          </div>
          <span className="preview-profile-icon">
            <CalendarDays size={23} strokeWidth={1.5} />
          </span>
        </div>
        <div className="preview-summary">
          <div>
            <span className="preview-summary-icon">
              <Pill size={17} />
            </span>
            <strong>Medication</strong>
            <span>Daily schedule</span>
          </div>
          <div>
            <span className="preview-summary-icon">
              <HeartHandshake size={17} />
            </span>
            <strong>Check-in</strong>
            <span>How today feels</span>
          </div>
        </div>
        <div className="preview-schedule">
          <div className="preview-section-title">
            <h3>Today’s schedule</h3>
            <span>Reviewed plan</span>
          </div>
          <div className="preview-dose">
            <span className="preview-time">
              08:00 <small>AM</small>
            </span>
            <span className="preview-dose-symbol complete">
              <Check size={15} />
            </span>
            <div>
              <strong>Morning medication</strong>
              <span>Recorded by caregiver</span>
            </div>
            <span className="preview-dose-status taken">Taken</span>
          </div>
          <div className="preview-dose">
            <span className="preview-time">
              08:00 <small>PM</small>
            </span>
            <span className="preview-dose-symbol">
              <Pill size={15} />
            </span>
            <div>
              <strong>Evening medication</strong>
              <span>As prescribed</span>
            </div>
            <span className="preview-dose-status">Upcoming</span>
          </div>
        </div>
        <div className="preview-checkin">
          <span className="preview-checkin-icon">
            <CircleCheck size={20} strokeWidth={1.6} />
          </span>
          <div>
            <strong>Daily check-in recorded</strong>
            <span>Pain and mobility shared with the care team.</span>
          </div>
          <Check size={15} />
        </div>
        <div className="preview-team">
          <span>
            <i>AS</i>
            <i>PS</i>
            <i>MP</i>
          </span>
          <p>One record. Your care team.</p>
          <Users size={15} />
        </div>
      </div>
      <figcaption>Illustrative product view · fictional records</figcaption>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="landing" id="top">
      <a className="landing-skip" href="#main-content">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link
            to="/"
            className="landing-brand-link"
            aria-label="RecoverTrack home"
          >
            <Brand />
          </Link>
          <nav className="landing-nav" aria-label="About RecoverTrack">
            <a href="#how-it-works">How it works</a>
            <a href="#care-team">Your care team</a>
            <a href="#questions">Questions</a>
          </nav>
          <Link className="landing-nav-access" to="/signin">
            Sign in <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>

      <main id="main-content">
        <section
          className="landing-hero landing-container"
          aria-labelledby="hero-title"
        >
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">
              <span /> POST-SURGERY RECOVERY
            </span>
            <h1 id="hero-title">
              Recovery at home.
              <br />
              One clear record.
            </h1>
            <p>
              Keep medication schedules, daily check-ins and your care team
              together, from the first day home.
            </p>
            <div className="landing-hero-actions">
              <Link
                to="/register"
                className="landing-button landing-button-dark"
              >
                Get started <ArrowRight size={17} />
              </Link>
              <a href="#how-it-works" className="landing-text-link">
                See how it works <ArrowDown size={15} />
              </a>
            </div>
            <div className="landing-hero-note">
              <span className="landing-note-line" />
              <p>
                For patients, caregivers
                <br />
                and the people supporting them.
              </p>
            </div>
          </div>
          <WorkspacePreview />
        </section>

        <div className="landing-capabilities" aria-label="Core features">
          <div className="landing-container">
            <span>
              <ClipboardCheck size={18} strokeWidth={1.6} /> Reviewed
              prescriptions
            </span>
            <span>
              <CalendarDays size={18} strokeWidth={1.6} /> A daily medication
              plan
            </span>
            <span>
              <Users size={18} strokeWidth={1.6} /> Care that stays connected
            </span>
          </div>
        </div>

        <section
          className="landing-container landing-section"
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <div className="landing-section-heading">
            <div>
              <span className="landing-eyebrow">HOW IT WORKS</span>
              <h2 id="workflow-title">A simpler daily routine.</h2>
            </div>
            <p>
              Turn discharge instructions into a clear plan, then keep a record
              of the days that follow.
            </p>
          </div>
          <div className="landing-workflow-grid">
            <article className="landing-step">
              <div className="landing-step-top">
                <span className="landing-step-number">01</span>
                <ClipboardCheck size={26} strokeWidth={1.35} />
              </div>
              <h3>Review the plan.</h3>
              <p>
                Scan a prescription or enter it manually. Check every detail
                before confirming the medication schedule.
              </p>
              <span className="landing-step-detail">
                <Check size={13} /> Your review comes first
              </span>
            </article>
            <article className="landing-step">
              <div className="landing-step-top">
                <span className="landing-step-number">02</span>
                <CalendarDays size={26} strokeWidth={1.35} />
              </div>
              <h3>Record the day.</h3>
              <p>
                See upcoming doses, record taken or skipped medication, and add
                a daily pain and mobility check-in.
              </p>
              <span className="landing-step-detail">
                <Check size={13} /> A history you can return to
              </span>
            </article>
            <article className="landing-step">
              <div className="landing-step-top">
                <span className="landing-step-number">03</span>
                <Users size={26} strokeWidth={1.35} />
              </div>
              <h3>Keep others informed.</h3>
              <p>
                Invite the people helping with recovery. Share the same record,
                with access suited to each person’s role.
              </p>
              <span className="landing-step-detail">
                <Check size={13} /> Individual accounts, shared context
              </span>
            </article>
          </div>
        </section>

        <section
          className="landing-roles"
          id="care-team"
          aria-labelledby="roles-title"
        >
          <div className="landing-container landing-section">
            <div className="landing-section-heading">
              <div>
                <span className="landing-eyebrow">FOR YOUR CARE TEAM</span>
                <h2 id="roles-title">
                  Different roles.
                  <br />
                  The same recovery record.
                </h2>
              </div>
              <p>
                Focused views keep each person close to the information and
                actions they need.
              </p>
            </div>
            <div className="landing-role-grid">
              <article>
                <span className="landing-role-icon">
                  <UserRound size={25} strokeWidth={1.5} />
                </span>
                <h3>For patients</h3>
                <p>
                  A clear view of the next dose and a simple way to record how
                  you’re feeling.
                </p>
                <span className="landing-role-caption">
                  A little less to keep track of.
                </span>
              </article>
              <article>
                <span className="landing-role-icon">
                  <HeartHandshake size={25} strokeWidth={1.5} />
                </span>
                <h3>For caregivers</h3>
                <p>
                  Manage reviewed prescriptions, follow the schedule and
                  coordinate with family.
                </p>
                <span className="landing-role-caption">
                  The details, kept together.
                </span>
              </article>
              <article>
                <span className="landing-role-icon">
                  <Stethoscope size={25} strokeWidth={1.5} />
                </span>
                <h3>For clinicians</h3>
                <p>
                  Review authorized records and follow-up flags, with a history
                  of reported changes.
                </p>
                <span className="landing-role-caption">
                  More context for a conversation.
                </span>
              </article>
            </div>
            <Link to="/demo" className="landing-text-link landing-role-demo">
              Explore the demo <ArrowUpRight size={16} />
            </Link>
          </div>
        </section>

        <section
          className="landing-boundaries landing-container landing-section"
          id="our-approach"
          aria-labelledby="boundaries-title"
        >
          <div className="landing-boundaries-copy">
            <span className="landing-eyebrow">A CONSIDERED APPROACH</span>
            <h2 id="boundaries-title">
              Useful tools.
              <br />
              Clear boundaries.
            </h2>
            <p>
              RecoverTrack helps organize a prescribed care plan. Decisions
              about treatment stay with you and your care team.
            </p>
            <a href="#questions" className="landing-text-link">
              Read the common questions <ArrowRight size={15} />
            </a>
          </div>
          <div className="landing-boundary-list">
            <article>
              <span>
                <ClipboardCheck size={21} strokeWidth={1.6} />
              </span>
              <div>
                <h3>Every prescription gets reviewed.</h3>
                <p>
                  Scanned text stays a draft. A person checks and confirms the
                  details before any doses are scheduled.
                </p>
              </div>
            </article>
            <article>
              <span>
                <LockKeyhole size={21} strokeWidth={1.6} />
              </span>
              <div>
                <h3>Sharing is a choice.</h3>
                <p>
                  Records are encrypted, accounts are individual, and household
                  sharing settings control care-team access.
                </p>
              </div>
            </article>
            <article>
              <span>
                <HeartHandshake size={21} strokeWidth={1.6} />
              </span>
              <div>
                <h3>People make the care decisions.</h3>
                <p>
                  Experimental attention flags highlight recorded patterns for
                  review. They do not diagnose or change treatment.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section
          className="landing-faq landing-container landing-section"
          id="questions"
          aria-labelledby="faq-title"
        >
          <div className="landing-faq-heading">
            <span className="landing-eyebrow">BEFORE YOU BEGIN</span>
            <h2 id="faq-title">A few good questions.</h2>
            <p>What to expect from your recovery workspace.</p>
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
          className="landing-start landing-container"
          aria-labelledby="start-title"
        >
          <div>
            <span className="landing-eyebrow">YOUR NEXT STEP</span>
            <h2 id="start-title">Keep the details in one place.</h2>
            <p>
              Create a recovery record, or take a look around with fictional
              demo data.
            </p>
          </div>
          <div className="landing-start-actions">
            <Link
              className="landing-button landing-button-light"
              to="/register"
            >
              Get started <ArrowRight size={17} />
            </Link>
            <Link className="landing-start-demo" to="/demo">
              Explore demo <ArrowUpRight size={15} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">
          <div className="landing-footer-top">
            <div>
              <Link to="/" aria-label="RecoverTrack home">
                <Brand />
              </Link>
              <p>A shared record for recovery at home.</p>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#how-it-works">How it works</a>
              <a href="#care-team">Care team</a>
              <a href="#our-approach">Our approach</a>
              <a href="#questions">Questions</a>
              <Link to="/signin">Sign in</Link>
            </nav>
          </div>
          <div className="landing-footer-bottom">
            <span>© {new Date().getFullYear()} RecoverTrack</span>
            <p>
              Recovery tracking prototype. Follow your prescribed care plan.
              Contact local emergency services for urgent help.
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

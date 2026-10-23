import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail,
  ShieldCheck,
  Users,
  UserRound,
  Stethoscope,
  Activity,
  Check,
  Plus,
  Link2,
  Copy,
} from "lucide-react";
import { post } from "../api";
import { useApp, initials, formatDate } from "../context";
import {
  CardHeader,
  Empty,
  Modal,
  PageHeader,
  Spinner,
} from "../components/ui";
export default function CareTeam() {
  const { state, refresh, notify } = useApp();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"invite" | "join" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      setInvite(
        await post("/care-team/invitations", {
          role: fields.role,
          ...(fields.email ? { email: fields.email } : {}),
        }),
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await post("/care-team/join", { code: String(fields.code).trim() });
      await refresh();
      setDialog(null);
      navigate("/");
      notify("Joined the household.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyCode() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      notify("Invitation code copied.");
    } catch {
      setError(
        "Clipboard access is unavailable. Select and copy the code below.",
      );
    }
  }
  function closeDialog() {
    setDialog(null);
    setError("");
    setInvite(null);
    setCopied(false);
  }
  return (
    <>
      <PageHeader
        title="Care team"
        description={`People with access to ${state.patient.name}'s recovery record.`}
        action={
          <>
            <button
              className="button secondary"
              onClick={() => setDialog("join")}
              disabled={state.demo}
            >
              <Link2 size={16} />
              Join a household
            </button>
            {state.user.role === "caregiver" && (
              <button
                className="button primary"
                onClick={() => setDialog("invite")}
                disabled={state.demo}
              >
                <Plus size={16} />
                Invite a team member
              </button>
            )}
          </>
        }
      />
      <div className="member-grid">
        {state.careTeam.map((member, index) => (
          <section className="card member-card" key={member.id}>
            <span className={`team-avatar avatar-color-${index % 3}`}>
              {initials(member.name)}
            </span>
            <h2>{member.name}</h2>
            <span className="pill">
              {member.role === "doctor" ? (
                <Stethoscope size={12} />
              ) : member.role === "patient" ? (
                <UserRound size={12} />
              ) : (
                <Users size={12} />
              )}{" "}
              {member.relationship || member.role}
            </span>
            {member.email && (
              <p className="member-email">
                <Mail size={13} />
                {member.email}
              </p>
            )}
            <div className="member-access">
              <ShieldCheck size={13} />
              {member.role === "doctor"
                ? "Read-only recovery review"
                : member.role === "patient"
                  ? "Dose & daily check-ins"
                  : "Medication & recovery management"}
            </div>
          </section>
        ))}
      </div>
      <section className="card activity-card">
        <CardHeader
          title="Shared activity"
          subtitle="Recorded actions by team members."
        />
        {state.activity.length ? (
          <div className="timeline">
            {state.activity.slice(0, 15).map((item) => (
              <div className="activity-row" key={item.id}>
                <span
                  className={`activity-dot ${item.type === "taken" ? "green" : "purple"}`}
                >
                  {item.type === "taken" ? (
                    <Check size={13} />
                  ) : (
                    <Activity size={13} />
                  )}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <time>{formatDate(item.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="No activity yet"
            description="Team members’ actions will appear here."
          />
        )}
      </section>
      {state.demo && (
        <p className="subtle-note care-team-demo-note">
          Invitations are available with a personal account. This demo stays
          isolated with fictional patient data.
        </p>
      )}
      {dialog && (
        <Modal
          title={
            dialog === "invite" ? "Invite a team member" : "Join a household"
          }
          subtitle={
            dialog === "invite"
              ? "Create a single-use invitation code."
              : "Use the code shared privately by your caregiver."
          }
          onClose={closeDialog}
        >
          {dialog === "invite" ? (
            invite ? (
              <div className="invite-result">
                <span className="stat-icon green">
                  <Check size={23} />
                </span>
                <h3>Your invitation is ready</h3>
                <p>
                  Share this code privately with the person you want to connect.
                  They should create their own account, open Care team and
                  choose “Join a household”.
                </p>
                <label className="field">
                  Private invitation code
                  <input
                    className="invite-code"
                    readOnly
                    value={invite.code}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button className="button primary" onClick={copyCode}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied ? "Copied" : "Copy code"}
                </button>
                <p className="subtle-note">
                  Single use · Expires{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: state.patient.timeZone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  }).format(new Date(invite.expiresAt))}
                  . No email has been sent.
                </p>
              </div>
            ) : (
              <form className="form-stack invite-form" onSubmit={createInvite}>
                <label className="field">
                  Their role
                  <select name="role">
                    <option value="patient">
                      Patient — dose and daily check-ins
                    </option>
                    <option value="caregiver">
                      Caregiver — shared recovery management
                    </option>
                    <option value="doctor">
                      Clinician — read-only recovery review
                    </option>
                  </select>
                </label>
                <label className="field">
                  Their email <span>(optional, restricts who can join)</span>
                  <input
                    type="email"
                    name="email"
                    placeholder="person@example.com"
                    maxLength={254}
                  />
                </label>
                <p className="subtle-note">
                  A code lasts 48 hours and can be used once. Enable the
                  appropriate sharing consent in Settings before inviting a
                  caregiver or clinician.
                </p>
                <button className="button primary" disabled={busy}>
                  {busy ? <Spinner /> : <Plus size={16} />}Create invitation
                  code
                </button>
              </form>
            )
          ) : (
            <form className="form-stack invite-form" onSubmit={join}>
              <label className="field">
                Invitation code
                <input
                  name="code"
                  required
                  maxLength={100}
                  autoComplete="off"
                  placeholder="Paste the code shared with you"
                />
              </label>
              <p className="review-warning">
                Joining connects this account to the invited household and sets
                the invited role. Your current account must have no medication
                or recovery records.
              </p>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Link2 size={16} />}Join household
              </button>
            </form>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

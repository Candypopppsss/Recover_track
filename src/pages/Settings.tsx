import { useState } from "react";
import type { FormEvent } from "react";
import {
  Bell,
  Check,
  Clock3,
  Globe2,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useApp } from "../context";
import { patch } from "../api";
import type { Consent } from "../types";
import { PageHeader, CardHeader, Spinner } from "../components/ui";
export default function Settings() {
  const { state, mutate } = useApp();
  const [busy, setBusy] = useState(false);
  const [patient, setPatient] = useState({
    name: state.patient.name,
    surgery: state.patient.surgery,
    recoveryStart: state.patient.recoveryStart,
    recoveryDays: state.patient.recoveryDays,
  });
  const [settings, setSettings] = useState(state.settings);
  const [consent, setConsent] = useState<Consent>(
    state.consent ?? {
      app: true,
      caregiver: true,
      clinician: false,
      outreach: false,
    },
  );
  const writable = state.user.role === "caregiver";
  async function profile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await mutate(() => patch("/patient", patient), "Recovery profile saved.");
    setBusy(false);
  }
  async function saveSettings() {
    setBusy(true);
    await mutate(
      () => patch("/settings", settings),
      "Reminder preferences saved.",
    );
    setBusy(false);
  }
  async function saveConsent() {
    setBusy(true);
    await mutate(() => patch("/consent", consent), "Consent choices saved.");
    setBusy(false);
  }
  return (
    <>
      <PageHeader
        title="Settings"
        description="Patient profile, reminders and sharing consent."
      />
      <div className="settings-grid">
        <section className="card settings-section">
          <CardHeader
            title="Recovery profile"
            subtitle="Patient details and recovery dates."
            action={
              <span className="stat-icon purple">
                <UserRound size={19} />
              </span>
            }
          />
          <form onSubmit={profile} className="form-stack card-body">
            <label className="field">
              Patient name
              <input
                required
                value={patient.name}
                onChange={(e) =>
                  setPatient({ ...patient, name: e.target.value })
                }
                maxLength={100}
                disabled={!writable}
              />
            </label>
            <label className="field">
              Surgery / recovery context
              <input
                value={patient.surgery}
                onChange={(e) =>
                  setPatient({ ...patient, surgery: e.target.value })
                }
                maxLength={120}
                disabled={!writable}
              />
            </label>
            <div className="field-row">
              <label className="field">
                Recovery start date
                <input
                  type="date"
                  required
                  value={patient.recoveryStart}
                  onChange={(e) =>
                    setPatient({ ...patient, recoveryStart: e.target.value })
                  }
                  disabled={!writable}
                />
              </label>
              <label className="field">
                Planned recovery days
                <input
                  type="number"
                  min={1}
                  max={90}
                  required
                  value={patient.recoveryDays}
                  onChange={(e) =>
                    setPatient({
                      ...patient,
                      recoveryDays: Number(e.target.value),
                    })
                  }
                  disabled={!writable}
                />
              </label>
            </div>
            <div className="timezone-info">
              <Globe2 size={15} />
              <div>
                <strong>{state.patient.timeZone.replaceAll("_", " ")}</strong>
                <p>All dose times use this time zone.</p>
              </div>
            </div>
            {writable && (
              <button className="button primary settings-save" disabled={busy}>
                {busy ? <Spinner /> : <Save size={15} />}Save recovery profile
              </button>
            )}
          </form>
        </section>
        <section className="card settings-section">
          <CardHeader
            title="Reminders"
            subtitle="In-app reminders, while RecoverTrack is running."
            action={
              <span className="stat-icon amber">
                <Bell size={19} />
              </span>
            }
          />
          <div className="card-body">
            <div className="toggle-row">
              <div>
                <strong>Dose reminders</strong>
                <p>Highlight doses when their scheduled time arrives.</p>
              </div>
              <button
                className={`toggle ${settings.remindersEnabled ? "on" : ""}`}
                role="switch"
                aria-checked={settings.remindersEnabled}
                aria-label="Dose reminders"
                disabled={!writable}
                onClick={() =>
                  setSettings({
                    ...settings,
                    remindersEnabled: !settings.remindersEnabled,
                  })
                }
              >
                <span />
              </button>
            </div>
            <div className="toggle-row">
              <div>
                <strong>Missed check-in alerts</strong>
                <p>Add a caregiver alert after your grace period.</p>
              </div>
              <button
                className={`toggle ${settings.missedAlertsEnabled ? "on" : ""}`}
                role="switch"
                aria-checked={settings.missedAlertsEnabled}
                aria-label="Missed check-in alerts"
                disabled={!writable}
                onClick={() =>
                  setSettings({
                    ...settings,
                    missedAlertsEnabled: !settings.missedAlertsEnabled,
                  })
                }
              >
                <span />
              </button>
            </div>
            <label className="field grace-field">
              Check-in grace period
              <select
                value={settings.graceMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    graceMinutes: Number(e.target.value),
                  })
                }
                disabled={!writable}
              >
                {[15, 30, 45, 60, 90, 120].map((v) => (
                  <option value={v} key={v}>
                    {v} minutes
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-info">
              <Clock3 size={16} />
              <p>
                Reminders appear only while the app is open and the server is
                running. Background delivery is not connected.
              </p>
            </div>
            {writable && (
              <button
                className="button primary settings-save"
                disabled={busy}
                onClick={saveSettings}
              >
                {busy ? <Spinner /> : <Check size={15} />}Save reminder
                preferences
              </button>
            )}
          </div>
        </section>
      </div>
      <section className="card settings-section">
        <CardHeader
          title="Data and sharing consent"
          subtitle="Choose who can use and view the record."
          action={
            <span className="stat-icon green">
              <ShieldCheck size={19} />
            </span>
          }
        />
        <div className="card-body">
          <div className="consent-grid">
            {(
              [
                {
                  key: "app",
                  title: "Recovery record",
                  description:
                    "Allow the app to organize your medication and recovery check-ins.",
                },
                {
                  key: "caregiver",
                  title: "Caregiver access",
                  description:
                    "Allow your authorized caregiver to review this recovery record.",
                },
                {
                  key: "clinician",
                  title: "Clinician review",
                  description:
                    "Allow authorized clinicians in this household to review the record.",
                },
              ] as const
            ).map((item) => (
              <label
                className={`consent-card ${consent[item.key] ? "selected" : ""}`}
                key={item.key}
              >
                <input
                  type="checkbox"
                  checked={consent[item.key]}
                  disabled={!writable}
                  onChange={(e) =>
                    setConsent({ ...consent, [item.key]: e.target.checked })
                  }
                />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </label>
            ))}
          </div>
          <p className="subtle-note">
            Turning off the recovery record stops new recording. Existing
            records remain available; contact the deployment operator for
            deletion.
          </p>
          {writable && (
            <button
              className="button primary settings-save"
              disabled={busy}
              onClick={saveConsent}
            >
              {busy ? <Spinner /> : <ShieldCheck size={15} />}Save consent
              choices
            </button>
          )}
        </div>
      </section>
      <section className="card account-card">
        <CardHeader
          title="Your account"
          subtitle="Account details and access role."
        />
        <div className="account-details">
          <span>
            <strong>{state.user.name}</strong>
            <small>{state.user.email}</small>
          </span>
          <span className="pill">
            {state.user.role === "doctor"
              ? "Clinician"
              : state.user.role.charAt(0).toUpperCase() +
                state.user.role.slice(1)}
          </span>
          {state.demo && (
            <span className="badge purple">Fictional demo household</span>
          )}
        </div>
      </section>
    </>
  );
}

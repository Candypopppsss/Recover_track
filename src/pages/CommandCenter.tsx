import { useState } from "react";
import { Check, Download, Phone, ShieldCheck, Activity } from "lucide-react";
import {
  useApp,
  adherence,
  todayInZone,
  recoveryDay,
  formatDate,
} from "../context";
import { post } from "../api";
import { CardHeader, Empty, PageHeader, Spinner } from "../components/ui";
import { DoseList, PainChart, RiskCard } from "../components/recovery";
export default function CommandCenter() {
  const { state, mutate } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const rate = adherence(state.doses);
  const pendingFollowUps = (state.callbacks ?? []).filter(
    (callback) => callback.status !== "resolved",
  ).length;
  const callbacks = (state.callbacks ?? []).filter((c) =>
    tab === "open" ? c.status !== "resolved" : c.status === "resolved",
  );
  async function resolve(id: string) {
    setPending(id);
    await mutate(
      () => post(`/callbacks/${id}/resolve`),
      "Follow-up marked as reviewed.",
    );
    setPending(null);
  }
  return (
    <>
      <PageHeader
        title="Recovery board"
        description="Review this household’s recovery records and follow-ups."
        action={
          <a className="button secondary" href="/api/export" download>
            <Download size={16} />
            Export dose history
          </a>
        }
      />
      <div className="clinician-context">
        <ShieldCheck size={17} />
        <p>
          Authorized household view ·{" "}
          {state.demo
            ? "Fictional demonstration data"
            : "Shared recovery records"}{" "}
          · External hospital systems are not connected.
        </p>
      </div>
      <div className="context-strip">
        <span>
          Reviewing <strong>{state.patient.name}</strong>
        </span>
        <span>
          <strong>{pendingFollowUps}</strong> open follow-up
          {pendingFollowUps === 1 ? "" : "s"}
        </span>
      </div>
      <div className="command-grid">
        <section className="card patient-tile">
          <CardHeader
            title="Patient summary"
            subtitle="Current household"
            action={<span className="pill">1 patient</span>}
          />
          <div className="patient-tile-main">
            <span className="avatar avatar-lg">{state.patient.initials}</span>
            <div>
              <h2>{state.patient.name}</h2>
              <p>{state.patient.surgery}</p>
              <span>
                Day{" "}
                {recoveryDay(
                  state.patient.recoveryStart,
                  todayInZone(state.patient.timeZone),
                )}{" "}
                of {state.patient.recoveryDays}
              </span>
            </div>
            <span
              className={`badge ${state.risk.level === "low" ? "green" : state.risk.level === "high" ? "missed" : "amber"}`}
            >
              {state.risk.level === "unavailable"
                ? "Awaiting history"
                : `${state.risk.level} attention`}
            </span>
          </div>
          <div className="patient-tile-stats">
            <div>
              <strong>{rate === null ? "—" : `${rate}%`}</strong>
              <span>Recorded adherence</span>
            </div>
            <div>
              <strong>{state.checkIns.length}</strong>
              <span>Daily check-ins</span>
            </div>
            <div>
              <strong>{pendingFollowUps}</strong>
              <span>Open follow-ups</span>
            </div>
          </div>
        </section>
        <section className="card callback-card">
          <CardHeader
            title="Follow-up queue"
            subtitle="Records flagged for human review."
            action={
              <span className="stat-icon amber">
                <Phone size={18} />
              </span>
            }
          />
          <div className="section-tabs">
            <button
              className={`tab ${tab === "open" ? "active" : ""}`}
              onClick={() => setTab("open")}
            >
              Needs review
            </button>
            <button
              className={`tab ${tab === "resolved" ? "active" : ""}`}
              onClick={() => setTab("resolved")}
            >
              Reviewed
            </button>
          </div>
          {callbacks.length ? (
            <div className="callback-list">
              {callbacks.map((c) => (
                <div className="callback-row" key={c.id}>
                  <span className="activity-dot amber">
                    <Phone size={14} />
                  </span>
                  <div>
                    <h3>{state.patient.name}</h3>
                    <p>{c.reason}</p>
                    <time>{formatDate(c.createdAt)}</time>
                  </div>
                  {c.status !== "resolved" ? (
                    <button
                      className="button secondary small"
                      onClick={() => resolve(c.id)}
                      disabled={pending === c.id}
                    >
                      {pending === c.id ? <Spinner /> : <Check size={14} />}Mark
                      reviewed
                    </button>
                  ) : (
                    <span className="badge green">Reviewed</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title={
                tab === "open"
                  ? "No follow-ups waiting"
                  : "No reviewed follow-ups yet"
              }
              description={
                tab === "open"
                  ? "No records currently need follow-up."
                  : "Resolved follow-ups will stay in the audit trail."
              }
            />
          )}
        </section>
      </div>
      <div className="content-grid">
        <div className="main-column">
          <section className="card">
            <CardHeader
              title="Self-reported recovery"
              subtitle="Pain check-ins over time."
            />
            <PainChart />
          </section>
          <section className="card">
            <CardHeader
              title="Recent dose history"
              subtitle="A shared check-in record, not proof of ingestion."
            />
            <DoseList
              doses={[...state.doses]
                .filter((d) => Date.parse(d.scheduledAt) <= Date.now())
                .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
                .slice(0, 8)}
            />
          </section>
        </div>
        <div className="side-column">
          <RiskCard detailed />
        </div>
      </div>
      {Boolean(state.auditLog?.length) && (
        <section className="card audit-card">
          <CardHeader
            title="Access & action trail"
            subtitle="Recorded reads and changes in this household."
          />
          {state.auditLog?.slice(0, 12).map((entry, i) => (
            <div className="audit-row" key={entry.id || i}>
              <Activity size={14} />
              <strong>{entry.action.replaceAll(/[._]/g, " ")}</strong>
              <span>
                {entry.actorName || entry.actor || "Household member"}
              </span>
              <time>
                {entry.createdAt || entry.timestamp
                  ? formatDate(entry.createdAt || entry.timestamp!)
                  : ""}
              </time>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

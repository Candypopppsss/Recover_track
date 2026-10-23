import { useState } from "react";
import {
  Plus,
  Search,
  Pill,
  Clock3,
  CalendarDays,
  Pause,
  Play,
  Pencil,
  Archive,
  FileText,
} from "lucide-react";
import { useApp, formatDate } from "../context";
import type { Medication } from "../types";
import { api, patch } from "../api";
import { Badge, Empty, Modal, PageHeader, Spinner } from "../components/ui";
import PrescriptionModal from "../components/PrescriptionModal";
export default function Medications() {
  const { state, openPrescription, mutate } = useApp();
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Medication | null>(null);
  const [archiving, setArchiving] = useState<Medication | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"medications" | "prescriptions">(
    "medications",
  );
  const meds = state.medications.filter(
    (m) =>
      (filter === "all" || m.status === filter) &&
      `${m.name} ${m.strength}`.toLowerCase().includes(search.toLowerCase()),
  );
  const writable = state.user.role === "caregiver";
  async function archive() {
    if (!archiving) return;
    setBusy(true);
    const ok = await mutate(
      () => api(`/medications/${archiving.id}`, { method: "DELETE" }),
      "Medication archived. Past dose records are preserved.",
    );
    if (ok) setArchiving(null);
    setBusy(false);
  }
  return (
    <>
      <PageHeader
        title="Medications"
        description="Reviewed prescriptions and active schedules."
        action={
          writable && (
            <button className="button primary" onClick={openPrescription}>
              <Plus size={17} />
              Add prescription
            </button>
          )
        }
      />
      <div className="filter-row medication-filters">
        <div className="section-tabs standalone">
          <button
            className={`tab ${view === "medications" ? "active" : ""}`}
            onClick={() => setView("medications")}
          >
            Medications <span>{state.medications.length}</span>
          </button>
          <button
            className={`tab ${view === "prescriptions" ? "active" : ""}`}
            onClick={() => setView("prescriptions")}
          >
            Prescriptions <span>{state.prescriptions.length}</span>
          </button>
        </div>
        {view === "medications" && (
          <label className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search medication…"
              aria-label="Search medications"
            />
          </label>
        )}
      </div>
      {view === "medications" ? (
        <>
          <div className="medication-status-filters">
            {["active", "paused", "completed", "all"].map((status) => (
              <button
                className={`filter-pill ${filter === status ? "active" : ""}`}
                onClick={() => setFilter(status)}
                key={status}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
                <span>
                  {
                    state.medications.filter(
                      (m) => status === "all" || m.status === status,
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          {meds.length ? (
            <div className="medication-grid">
              {meds.map((m) => (
                <section className="card medication-card" key={m.id}>
                  <div className="medication-card-header">
                    <span className={`dose-icon ${m.color}`}>
                      <Pill size={23} />
                    </span>
                    <Badge status={m.status} />
                  </div>
                  <div className="medication-card-title">
                    <h2>{m.name}</h2>
                    <span>{m.strength}</span>
                  </div>
                  <p className="medication-dose">
                    {m.dose}
                    {m.instructions && (
                      <>
                        {" "}
                        <span>·</span> {m.instructions}
                      </>
                    )}
                  </p>
                  <div className="medication-details">
                    <div>
                      <Clock3 size={15} />
                      <span>
                        {m.times
                          .map((t) => {
                            const [h, min] = t.split(":");
                            return `${Number(h) % 12 || 12}:${min} ${Number(h) >= 12 ? "PM" : "AM"}`;
                          })
                          .join(" · ")}
                      </span>
                    </div>
                    <div>
                      <CalendarDays size={15} />
                      <span>
                        {formatDate(m.startDate)} <span>·</span>{" "}
                        {m.durationDays} days
                      </span>
                    </div>
                    <div>
                      <FileText size={15} />
                      <span>
                        {m.source === "ocr"
                          ? "Scanned & reviewed"
                          : m.source === "demo"
                            ? "Fictional demo prescription"
                            : "Manually entered & reviewed"}
                      </span>
                    </div>
                  </div>
                  <div className="medication-footer">
                    {writable && (
                      <div>
                        <button
                          className="icon-button"
                          title="Edit medication"
                          aria-label={`Edit ${m.name}`}
                          onClick={() => setEditing(m)}
                        >
                          <Pencil size={15} />
                        </button>
                        {m.status !== "completed" && (
                          <button
                            className="icon-button"
                            title={
                              m.status === "paused"
                                ? "Resume schedule"
                                : "Pause schedule"
                            }
                            aria-label={`${m.status === "paused" ? "Resume" : "Pause"} ${m.name}`}
                            onClick={() =>
                              mutate(
                                () =>
                                  patch(`/medications/${m.id}`, {
                                    status:
                                      m.status === "paused"
                                        ? "active"
                                        : "paused",
                                  }),
                                m.status === "paused"
                                  ? "Schedule resumed."
                                  : "Schedule paused.",
                              )
                            }
                          >
                            {m.status === "paused" ? (
                              <Play size={15} />
                            ) : (
                              <Pause size={15} />
                            )}
                          </button>
                        )}
                        <button
                          className="icon-button"
                          title="Archive medication"
                          aria-label={`Archive ${m.name}`}
                          onClick={() => setArchiving(m)}
                        >
                          <Archive size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="card">
              <Empty
                title={
                  search
                    ? "No medication matches your search"
                    : "No medications"
                }
                description={
                  search
                    ? "Try a different name or filter."
                    : "Add and review a prescription to create your first schedule."
                }
              >
                {writable && !search && (
                  <button className="button primary" onClick={openPrescription}>
                    <Plus size={16} />
                    Add prescription
                  </button>
                )}
              </Empty>
            </section>
          )}
        </>
      ) : (
        <section className="card">
          {state.prescriptions.length ? (
            <div className="prescription-history">
              {state.prescriptions.map((p) => (
                <div className="prescription-history-row" key={p.id}>
                  <span className="dose-icon purple">
                    <FileText size={22} />
                  </span>
                  <div>
                    <h3>{p.filename}</h3>
                    <p>
                      {formatDate(p.createdAt)} · {p.engine} · Version{" "}
                      {p.version}
                    </p>
                  </div>
                  <Badge status={p.status} />
                  {p.criticalityFlag && (
                    <span className="badge amber">Review flag</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="No scanned prescriptions"
              description="Scanned prescriptions and their review status will appear here. Images are not retained."
            />
          )}
        </section>
      )}
      {editing && (
        <PrescriptionModal
          medication={editing}
          onClose={() => setEditing(null)}
        />
      )}{" "}
      {archiving && (
        <Modal
          title="Archive this medication?"
          subtitle={archiving.name}
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button
                className="button secondary"
                onClick={() => setArchiving(null)}
              >
                Keep medication
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={archive}
              >
                {busy ? <Spinner /> : <Archive size={16} />}Archive medication
              </button>
            </>
          }
        >
          <p>
            Future unrecorded doses will be removed from your routine. Your past
            check-ins stay in your dose history.
          </p>
          <p className="subtle-note">
            Only archive when this matches the prescribed plan.
          </p>
        </Modal>
      )}
    </>
  );
}

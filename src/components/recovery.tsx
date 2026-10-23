import { useState } from "react";
import {
  Check,
  Clock3,
  Pill,
  RotateCcw,
  SkipForward,
  Heart,
  MoveRight,
  Info,
  CircleCheck,
  ArrowUpRight,
  Footprints,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useApp,
  dateInZone,
  todayInZone,
  shiftDate,
  formatDate,
  formatTime,
  adherence,
} from "../context";
import type { Dose } from "../types";
import { Badge, CardHeader, Empty, Spinner } from "./ui";
import { post } from "../api";
export function DoseList({
  doses,
  compact = false,
}: {
  doses: Dose[];
  compact?: boolean;
}) {
  const { state, mutate } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  async function act(dose: Dose, status: "taken" | "skipped" | "undo") {
    setPending(dose.id);
    await mutate(
      () =>
        post(
          `/doses/${encodeURIComponent(dose.id)}/${status === "undo" ? "undo" : "check-in"}`,
          status === "undo" ? {} : { status },
        ),
      status === "undo"
        ? "Check-in undone."
        : status === "taken"
          ? "Dose recorded."
          : "Dose recorded as skipped.",
    );
    setPending(null);
  }
  if (!doses.length)
    return (
      <Empty
        title="No scheduled doses"
        description="There are no doses scheduled for this day."
      />
    );
  return (
    <div className={`dose-list ${compact ? "compact" : ""}`}>
      {[...doses]
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
        .map((dose) => {
          const recorded = dose.status === "taken" || dose.status === "skipped";
          const actionable =
            state.user.role !== "doctor" &&
            Date.parse(dose.scheduledAt) <= Date.now() + 3600000;
          return (
            <div
              className={`dose-row ${dose.status === "taken" ? "dose-complete" : ""}`}
              key={dose.id}
            >
              <div className="dose-time">
                <strong>
                  {formatTime(dose.scheduledAt, state.patient.timeZone)}
                </strong>
                <span>
                  {dose.status === "taken" && dose.takenAt
                    ? `Taken ${formatTime(dose.takenAt, state.patient.timeZone)}`
                    : dose.status === "missed"
                      ? "No check-in yet"
                      : dose.status === "due"
                        ? "Time for a check-in"
                        : "Scheduled"}
                </span>
              </div>
              <span className={`dose-icon ${dose.color || "purple"}`}>
                <Pill size={20} />
              </span>
              <div className="dose-info">
                <h3 className="dose-name">
                  {dose.medicationName} <span>{dose.strength}</span>
                </h3>
                <p className="dose-detail">
                  {dose.dose}
                  {dose.instructions && (
                    <>
                      {" "}
                      <span>·</span> {dose.instructions}
                    </>
                  )}
                </p>
              </div>
              <div className="dose-actions">
                <Badge status={dose.status} />
                {pending === dose.id ? (
                  <Spinner />
                ) : (
                  actionable &&
                  (!recorded ? (
                    <>
                      <button
                        className="button small secondary take-dose"
                        onClick={() => act(dose, "taken")}
                        aria-label={`Mark ${dose.medicationName} at ${formatTime(dose.scheduledAt, state.patient.timeZone)} as taken`}
                      >
                        <Check size={15} />
                        Mark taken
                      </button>
                      <button
                        className="icon-button skip-button"
                        title="Record as skipped"
                        aria-label={`Skip ${dose.medicationName} at ${formatTime(dose.scheduledAt, state.patient.timeZone)}`}
                        onClick={() => act(dose, "skipped")}
                      >
                        <SkipForward size={15} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="icon-button"
                      onClick={() => act(dose, "undo")}
                      aria-label={`Undo ${dose.medicationName} check-in`}
                      title="Undo check-in"
                    >
                      <RotateCcw size={15} />
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
export function AdherenceChart({ large = false }: { large?: boolean }) {
  const { state } = useApp();
  const today = todayInZone(state.patient.timeZone);
  const data = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(today, i - 6);
    const doses = state.doses.filter(
      (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === date,
    );
    const rate = adherence(doses);
    return {
      date,
      day: formatDate(date, { weekday: "short" }),
      adherence: rate,
      doses: doses.filter((d) => d.status === "taken").length,
    };
  });
  const rate = adherence(
    state.doses.filter(
      (d) =>
        Date.parse(d.scheduledAt) <= Date.now() &&
        dateInZone(d.scheduledAt, state.patient.timeZone) >=
          shiftDate(today, -6),
    ),
  );
  return (
    <div className={`chart-wrap ${large ? "large" : ""}`}>
      <ResponsiveContainer width="100%" height={large ? 260 : 190}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 5, bottom: 0, left: -25 }}
          barSize={large ? 28 : 22}
        >
          <CartesianGrid
            strokeDasharray="3 5"
            vertical={false}
            stroke="#eeedf3"
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#9390a3" }}
            dy={7}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#a5a1b2" }}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #eeedf3",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(value) => [`${value ?? "—"}%`, "Recorded adherence"]}
            cursor={{ fill: "#f7f5fd" }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="adherence"
            fill="#9680eb"
            radius={[5, 5, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        <span>
          <i />
          Recorded doses / elapsed doses
        </span>
        <span>{rate !== null ? "Last 7 days" : "No elapsed doses yet"}</span>
      </div>
    </div>
  );
}
export function PainChart() {
  const { state } = useApp();
  const data = [...state.checkIns]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10)
    .map((c) => ({ ...c, day: formatDate(c.date) }));
  if (!data.length)
    return (
      <Empty
        title="No pain records"
        description="Record a daily check-in to start tracking pain."
      />
    );
  return (
    <div className="chart-wrap large">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 12, bottom: 0, left: -25 }}
        >
          <defs>
            <linearGradient id="painFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9b86e8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#9b86e8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 5"
            vertical={false}
            stroke="#eeedf3"
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#9390a3" }}
          />
          <YAxis
            domain={[0, 10]}
            ticks={[0, 5, 10]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#a5a1b2" }}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #eeedf3",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Area
            isAnimationActive={false}
            type="monotone"
            dataKey="pain"
            name="Self-reported pain"
            stroke="#9580db"
            strokeWidth={2.5}
            fill="url(#painFill)"
            dot={{ r: 3, fill: "#9580db", strokeWidth: 2, stroke: "white" }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="subtle-note">
        Self-reported pain: 0 (none) to 10 (severe).
      </p>
    </div>
  );
}
export function RiskCard({ detailed = false }: { detailed?: boolean }) {
  const { state } = useApp();
  const risk = state.risk;
  const score = risk.score;
  const color =
    risk.level === "high"
      ? "#d48b70"
      : risk.level === "moderate"
        ? "#d1a14e"
        : "#76a68d";
  const circumference = 2 * Math.PI * 51;
  return (
    <section className="card risk-card">
      <CardHeader
        title="Recovery attention"
        action={<span className="pill">Experimental</span>}
      />
      <div className="risk-summary">
        <div className="risk-gauge">
          <svg viewBox="0 0 126 126" aria-hidden="true">
            <circle
              cx="63"
              cy="63"
              r="51"
              fill="none"
              stroke="#f0f2ef"
              strokeWidth="9"
            />
            <circle
              cx="63"
              cy="63"
              r="51"
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${circumference * ((score ?? 0) / 100)} ${circumference}`}
              transform="rotate(-90 63 63)"
            />
          </svg>
          <div>
            <strong>{score === null ? "—" : score}</strong>
            <small>{score === null ? "Awaiting data" : "of 100"}</small>
          </div>
        </div>
        <span
          className={`badge ${risk.level === "low" ? "green" : risk.level === "moderate" ? "amber" : risk.level === "high" ? "missed" : "upcoming"}`}
        >
          {risk.level === "unavailable"
            ? "More history needed"
            : `${risk.level.charAt(0).toUpperCase() + risk.level.slice(1)} attention`}
        </span>
      </div>
      <div className="risk-factors">
        {(detailed ? risk.explanation : risk.explanation.slice(0, 3)).map(
          (ex, i) => (
            <div className="risk-factor" key={i}>
              <span className={`factor-dot ${risk.level}`} />
              <span>{ex}</span>
            </div>
          ),
        )}
      </div>
      <p className="subtle-note risk-note">
        <Info size={13} />
        Experimental score for human review. Not a clinical prediction.
      </p>
    </section>
  );
}
export function DailyCheckIn() {
  const { state, mutate } = useApp();
  const today = todayInZone(state.patient.timeZone);
  const existing = state.checkIns.find((c) => c.date === today);
  const [editing, setEditing] = useState(false);
  const [pain, setPain] = useState<number | null>(existing?.pain ?? null);
  const [mobility, setMobility] = useState(existing?.mobility ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pain === null || !mobility) return;
    setBusy(true);
    const ok = await mutate(
      () => post("/checkins", { pain, mobility, note }),
      "Daily check-in saved.",
    );
    if (ok) setEditing(false);
    setBusy(false);
  }
  return (
    <section className="card checkin-card">
      <CardHeader
        title="Daily check-in"
        subtitle="Record today's pain and mobility."
        action={
          <span className="stat-icon purple">
            <Heart size={18} />
          </span>
        }
      />
      {existing && !editing ? (
        <div className="checkin-saved">
          <span className="checkin-saved-icon">
            <CircleCheck size={25} />
          </span>
          <div>
            <h3>Today's check-in</h3>
            <p>
              Pain {existing.pain}/10 <span>·</span>{" "}
              {existing.mobility === "independent"
                ? "Moving independently"
                : existing.mobility === "assisted"
                  ? "Moving with support"
                  : "Resting today"}
            </p>
            {existing.note && <p className="checkin-note">“{existing.note}”</p>}
          </div>
          {state.user.role !== "doctor" && (
            <button
              className="text-button"
              onClick={() => {
                setPain(existing.pain);
                setMobility(existing.mobility);
                setNote(existing.note);
                setEditing(true);
              }}
            >
              Edit
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      ) : state.user.role === "doctor" ? (
        <Empty
          title="No check-in today"
          description="Daily check-ins are recorded by the patient or caregiver."
        />
      ) : (
        <div className="card-body">
          <div className="pain-label">
            <label htmlFor="pain-range">Your pain level</label>
            <strong>{pain === null ? "Select a level" : `${pain} / 10`}</strong>
          </div>
          <input
            id="pain-range"
            className="range-input"
            type="range"
            min="0"
            max="10"
            value={pain ?? 0}
            onChange={(e) => setPain(Number(e.target.value))}
            onClick={(e) => setPain(Number(e.currentTarget.value))}
            aria-label="Pain level from zero to ten"
          />
          <div className="range-labels">
            <span>No pain</span>
            <span>Severe pain</span>
          </div>
          <label className="field mobility-label">How is moving around?</label>
          <div className="mobility-options">
            {(
              [
                { id: "resting", label: "Resting", icon: Heart },
                { id: "assisted", label: "With support", icon: MoveRight },
                { id: "independent", label: "On my own", icon: Footprints },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                className={`mobility-option ${mobility === item.id ? "active" : ""}`}
                onClick={() => setMobility(item.id)}
              >
                <item.icon size={17} />
                {item.label}
              </button>
            ))}
          </div>
          <label className="field note-field">
            Notes <span>(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Symptoms, questions or updates"
            />
          </label>
          <button
            className="button primary checkin-submit"
            disabled={pain === null || !mobility || busy}
            onClick={save}
          >
            {busy ? <Spinner /> : <Check size={16} />}Save check-in
          </button>
        </div>
      )}
    </section>
  );
}
export function NextDose() {
  const { state } = useApp();
  const next = state.doses
    .filter((d) => d.status === "upcoming" || d.status === "due")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  return (
    <section className="next-dose-card">
      <div className="next-dose-heading">
        <span>
          <Clock3 size={16} /> NEXT DOSE
        </span>
      </div>
      {next ? (
        <>
          <h3>{next.medicationName}</h3>
          <p>
            {next.strength} <span>·</span> {next.dose}
          </p>
          <div className="next-dose-time">
            <strong>
              {formatTime(next.scheduledAt, state.patient.timeZone)}
            </strong>
            <span>
              {dateInZone(next.scheduledAt, state.patient.timeZone) ===
              todayInZone(state.patient.timeZone)
                ? "Today"
                : formatDate(
                    dateInZone(next.scheduledAt, state.patient.timeZone),
                  )}
            </span>
          </div>
          {next.instructions && (
            <div className="next-dose-instruction">
              <Info size={13} />
              {next.instructions}
            </div>
          )}
        </>
      ) : (
        <>
          <h3>No upcoming doses</h3>
          <p>Your upcoming doses will appear here.</p>
        </>
      )}
    </section>
  );
}

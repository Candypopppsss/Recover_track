import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CheckCheck, Heart, Pill, Plus, TrendingUp } from "lucide-react";
import {
  useApp,
  adherence,
  dateInZone,
  todayInZone,
  recoveryDay,
  formatDate,
} from "../context";
import { CardHeader, PageHeader, TextAction, Empty } from "../components/ui";
import {
  AdherenceChart,
  DailyCheckIn,
  DoseList,
  NextDose,
  RiskCard,
} from "../components/recovery";
export default function Overview() {
  const { state, openPrescription } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const today = todayInZone(state.patient.timeZone);
  const todayDoses = state.doses.filter(
    (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === today,
  );
  const taken = todayDoses.filter((d) => d.status === "taken").length;
  const rate = adherence(state.doses);
  const day = recoveryDay(state.patient.recoveryStart, today);
  const active = state.medications.filter((m) => m.status === "active").length;
  const filtered = todayDoses.filter(
    (d) =>
      filter === "all" ||
      (filter === "remaining"
        ? d.status !== "taken" && d.status !== "skipped"
        : d.status === "taken"),
  );
  return (
    <>
      <PageHeader
        title="Overview"
        description={`${state.patient.name} · ${state.patient.surgery}`}
        action={
          <>
            {state.user.role === "caregiver" && (
              <button className="button primary" onClick={openPrescription}>
                <Plus size={18} />
                Add prescription
              </button>
            )}
          </>
        }
      />
      <div className="stats-grid">
        {[
          {
            label: "Today's doses",
            value: `${taken}`,
            suffix: `/ ${todayDoses.length}`,
            detail: todayDoses.length
              ? `${Math.max(0, todayDoses.length - taken)} check-ins remaining`
              : "No doses scheduled today",
            icon: CheckCheck,
            color: "purple",
          },
          {
            label: "Medication adherence",
            value: rate === null ? "—" : `${rate}%`,
            suffix: "",
            detail: "Based on recorded dose history",
            icon: TrendingUp,
            color: "green",
          },
          {
            label: "Active medications",
            value: `${active}`,
            suffix: "",
            detail: "Reviewed and on your schedule",
            icon: Pill,
            color: "amber",
          },
          {
            label: "Recovery day",
            value: `${day} / ${state.patient.recoveryDays}`,
            suffix: "",
            detail: `${state.patient.surgery || "Recovery plan"}`,
            icon: Heart,
            color: "blue",
          },
        ].map((stat) => (
          <section className="stat-card" key={stat.label}>
            <div className="stat-top">
              <span className="stat-label">{stat.label}</span>
              <span className={`stat-icon ${stat.color}`}>
                <stat.icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {stat.value}
              <span>{stat.suffix}</span>
            </div>
            <p className="stat-detail">{stat.detail}</p>
          </section>
        ))}
      </div>
      <div className="content-grid">
        <div className="main-column">
          <section className="card">
            <CardHeader
              title="Today's medication schedule"
              subtitle={formatDate(today, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              action={
                <TextAction onClick={() => navigate("/schedule")}>
                  Full schedule
                </TextAction>
              }
            />
            <div className="section-tabs">
              <button
                className={`tab ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                All doses <span>{todayDoses.length}</span>
              </button>
              <button
                className={`tab ${filter === "remaining" ? "active" : ""}`}
                onClick={() => setFilter("remaining")}
              >
                Remaining
              </button>
              <button
                className={`tab ${filter === "taken" ? "active" : ""}`}
                onClick={() => setFilter("taken")}
              >
                Taken
              </button>
            </div>
            <DoseList doses={filtered} />
            <div className="schedule-card-footer">
              <span>{state.patient.timeZone.replaceAll("_", " ")}</span>
            </div>
          </section>
          <section className="card">
            <CardHeader
              title="Adherence this week"
              subtitle="Taken doses as a share of elapsed doses."
              action={
                <TextAction onClick={() => navigate("/insights")}>
                  View insights
                </TextAction>
              }
            />
            <AdherenceChart />
          </section>
          <DailyCheckIn />
        </div>
        <div className="side-column">
          <RiskCard />
          <NextDose />
        </div>
      </div>
      <section className="card activity-card">
        <CardHeader
          title="Recent activity"
          subtitle="Prescription reviews and dose check-ins."
        />
        {state.activity.length ? (
          <div className="timeline">
            {state.activity.slice(0, 4).map((activity) => (
              <div className="activity-row" key={activity.id}>
                <span
                  className={`activity-dot ${activity.type === "taken" ? "green" : "purple"}`}
                >
                  {activity.type === "taken" ? (
                    <Check size={13} />
                  ) : activity.type === "prescription" ? (
                    <Pill size={13} />
                  ) : (
                    <Heart size={13} />
                  )}
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  <p>{activity.description}</p>
                </div>
                <time>
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: state.patient.timeZone,
                    hour: "numeric",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                  }).format(new Date(activity.createdAt))}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="No activity yet"
            description="Prescription reviews and check-ins will appear here."
          />
        )}
      </section>
    </>
  );
}

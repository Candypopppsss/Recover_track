import { ArrowLeft, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useApp, todayInZone, dateInZone, formatDate } from "../context";
import { PageHeader, CardHeader } from "../components/ui";
import { DailyCheckIn, DoseList } from "../components/recovery";
export default function PatientView() {
  const { state } = useApp();
  const navigate = useNavigate();
  const today = todayInZone(state.patient.timeZone);
  const doses = state.doses.filter(
    (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === today,
  );
  const taken = doses.filter((dose) => dose.status === "taken").length;
  return (
    <div className="patient-view">
      <PageHeader
        title="Today"
        description={state.patient.name}
        action={
          state.user.role === "caregiver" && (
            <button className="button secondary" onClick={() => navigate("/")}>
              <ArrowLeft size={16} />
              Caregiver overview
            </button>
          )
        }
      />
      <section
        className="patient-day-summary"
        aria-label="Today's recovery plan"
      >
        <div>
          <span className="recovery-summary-label">
            {formatDate(today, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h2>Your plan for today</h2>
          <p>Follow your reviewed schedule and record how you feel.</p>
        </div>
        <div className="patient-day-count">
          <CheckCheck size={22} />
          <strong>
            {taken}
            <span> / {doses.length}</span>
          </strong>
          <span>Doses recorded as taken</span>
        </div>
      </section>
      <section className="card">
        <CardHeader
          title="Today's medications"
          subtitle="Record each dose after taking it."
        />
        <DoseList doses={doses} />
      </section>
      <DailyCheckIn />
    </div>
  );
}

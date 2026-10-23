import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useApp, todayInZone, dateInZone } from "../context";
import { PageHeader, CardHeader } from "../components/ui";
import { DailyCheckIn, DoseList } from "../components/recovery";
export default function PatientView() {
  const { state } = useApp();
  const navigate = useNavigate();
  const today = todayInZone(state.patient.timeZone);
  const doses = state.doses.filter(
    (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === today,
  );
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
      <p className="patient-today">
        {doses.filter((dose) => dose.status === "taken").length} of{" "}
        {doses.length} doses recorded as taken today.
      </p>
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

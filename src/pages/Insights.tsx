import {
  Download,
  TrendingUp,
  Heart,
  Footprints,
  CheckCheck,
} from "lucide-react";
import { useApp, adherence, formatDate } from "../context";
import { PageHeader, CardHeader, Empty } from "../components/ui";
import { AdherenceChart, PainChart, RiskCard } from "../components/recovery";
export default function Insights() {
  const { state } = useApp();
  const latest = [...state.checkIns].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];
  const rate = adherence(state.doses);
  return (
    <>
      <PageHeader
        title="Recovery insights"
        description="Dose adherence and self-reported pain and mobility."
        action={
          <a className="button secondary" href="/api/export" download>
            <Download size={16} />
            Export dose history
          </a>
        }
      />
      <div className="stats-grid">
        {[
          {
            label: "Recorded adherence",
            value: rate === null ? "—" : `${rate}%`,
            detail: "Taken / elapsed doses",
            icon: TrendingUp,
            color: "green",
          },
          {
            label: "Latest pain check-in",
            value: latest ? `${latest.pain} / 10` : "—",
            detail: latest ? formatDate(latest.date) : "No check-ins yet",
            icon: Heart,
            color: "purple",
          },
          {
            label: "Latest mobility",
            value: latest
              ? latest.mobility === "independent"
                ? "Independent"
                : latest.mobility === "assisted"
                  ? "With support"
                  : "Resting"
              : "—",
            detail: "Self-reported, not measured",
            icon: Footprints,
            color: "amber",
          },
          {
            label: "Daily check-ins",
            value: state.checkIns.length,
            detail: "Days with a recorded check-in",
            icon: CheckCheck,
            color: "blue",
          },
        ].map((item) => (
          <div className="stat-card" key={item.label}>
            <div className="stat-top">
              <span className="stat-label">{item.label}</span>
              <span className={`stat-icon ${item.color}`}>
                <item.icon size={18} />
              </span>
            </div>
            <div className="stat-value stat-value-adaptive">{item.value}</div>
            <p className="stat-detail">{item.detail}</p>
          </div>
        ))}
      </div>
      <div className="content-grid">
        <div className="main-column">
          <section className="card">
            <CardHeader
              title="Medication adherence"
              subtitle="Your last seven days of recorded dose check-ins."
            />
            <AdherenceChart large />
          </section>
          <section className="card">
            <CardHeader
              title="Pain history"
              subtitle="Self-reported pain from daily check-ins."
            />
            <PainChart />
          </section>
          <section className="card">
            <CardHeader
              title="Check-in history"
              subtitle="Pain, mobility and notes."
            />
            {state.checkIns.length ? (
              <div className="journal-list">
                {[...state.checkIns]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 10)
                  .map((checkin) => (
                    <div className="journal-row" key={checkin.id}>
                      <div className="journal-date">
                        <strong>
                          {formatDate(checkin.date, { day: "numeric" })}
                        </strong>
                        <span>
                          {formatDate(checkin.date, { month: "short" })}
                        </span>
                      </div>
                      <div>
                        <h3>
                          Pain {checkin.pain}/10 <span>·</span>{" "}
                          {checkin.mobility === "independent"
                            ? "Moving independently"
                            : checkin.mobility === "assisted"
                              ? "Moving with support"
                              : "Resting"}
                        </h3>
                        <p>{checkin.note || "No note."}</p>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <Empty
                title="No daily check-ins"
                description="Your daily check-ins will appear here."
              />
            )}
          </section>
        </div>
        <div className="side-column">
          <RiskCard detailed />
        </div>
      </div>
    </>
  );
}

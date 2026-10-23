import { useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ListFilter,
} from "lucide-react";
import {
  useApp,
  todayInZone,
  shiftDate,
  formatDate,
  dateInZone,
} from "../context";
import { PageHeader } from "../components/ui";
import { DoseList } from "../components/recovery";
export default function Schedule() {
  const { state } = useApp();
  const today = todayInZone(state.patient.timeZone);
  const [selected, setSelected] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const days = Array.from({ length: 7 }, (_, i) =>
    shiftDate(today, weekOffset * 7 + i - 3),
  );
  const dayDoses = state.doses.filter(
    (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === selected,
  );
  const filtered = dayDoses.filter(
    (d) =>
      (filter === "all" || d.status === filter) &&
      d.medicationName.toLowerCase().includes(search.toLowerCase()),
  );
  const totalTaken = dayDoses.filter((d) => d.status === "taken").length;
  return (
    <>
      <PageHeader
        title="Medication schedule"
        description="Reviewed dose times and check-in history."
        action={
          <a href="/api/export" className="button secondary" download>
            <Download size={16} />
            Export dose history
          </a>
        }
      />
      <section className="card schedule-main">
        <div className="schedule-header">
          <div>
            <span className="eyebrow">YOUR SCHEDULE</span>
            <h2>{formatDate(selected, { month: "long", year: "numeric" })}</h2>
          </div>
          <div className="schedule-navigation">
            <button
              className="button secondary small"
              onClick={() => {
                setSelected(today);
                setWeekOffset(0);
              }}
            >
              Today
            </button>
            <button
              className="icon-button"
              disabled={weekOffset <= -1}
              onClick={() => {
                setWeekOffset((v) => v - 1);
                setSelected(shiftDate(selected, -7));
              }}
              aria-label="Previous week"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="icon-button"
              disabled={weekOffset >= 1}
              onClick={() => {
                setWeekOffset((v) => v + 1);
                setSelected(shiftDate(selected, 7));
              }}
              aria-label="Next week"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <div className="date-strip">
          {days.map((date) => {
            const doses = state.doses.filter(
              (d) => dateInZone(d.scheduledAt, state.patient.timeZone) === date,
            );
            return (
              <button
                className={`date-cell ${date === selected ? "active" : ""} ${date === today ? "today" : ""}`}
                key={date}
                onClick={() => setSelected(date)}
                aria-label={formatDate(date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                aria-pressed={date === selected}
              >
                <span>{formatDate(date, { weekday: "short" })}</span>
                <strong>{formatDate(date, { day: "numeric" })}</strong>
                <i className={doses.length ? "has-doses" : ""} />
              </button>
            );
          })}
        </div>
        <div className="schedule-day-heading">
          <div>
            <h3>
              {selected === today
                ? "Today"
                : formatDate(selected, { weekday: "long" })}
              <span>
                {formatDate(selected, { month: "long", day: "numeric" })}
              </span>
            </h3>
            <p>
              {totalTaken} of {dayDoses.length} doses recorded as taken
            </p>
          </div>
          <span className="pill">
            <CalendarDays size={13} />
            {state.patient.timeZone.replaceAll("_", " ")}
          </span>
        </div>
        <div className="filter-row schedule-filters">
          <div className="section-tabs">
            {[
              ["all", "All doses"],
              ["taken", "Taken"],
              ["due", "Due now"],
              ["missed", "Missed"],
              ["upcoming", "Upcoming"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`tab ${filter === value ? "active" : ""}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search-field">
            <ListFilter size={15} />
            <input
              aria-label="Filter medications in schedule"
              placeholder="Filter medication…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <DoseList doses={filtered} />
        <div className="schedule-card-footer">
          <span>Check-ins record what you report, not proof of ingestion.</span>
          <span>Follow the prescribed instructions.</span>
        </div>
      </section>
    </>
  );
}

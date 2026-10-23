import { useEffect, useState } from "react";
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
import { Empty, PageHeader, Spinner } from "../components/ui";
import { DoseList } from "../components/recovery";
import { api } from "../api";
import type { Dose } from "../types";
interface WeekRange {
  from: string;
  to: string;
  patientId: string;
  timeZone: string;
}
export default function Schedule() {
  const { state } = useApp();
  const today = todayInZone(state.patient.timeZone);
  const [selected, setSelected] = useState(today);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [week, setWeek] = useState<(WeekRange & { doses: Dose[] }) | null>(
    null,
  );
  const [loadError, setLoadError] = useState<
    (WeekRange & { message: string }) | null
  >(null);
  const [fetching, setFetching] = useState(false);
  const [retry, setRetry] = useState(0);
  const courseDates = state.doses
    .map((dose) => dateInZone(dose.scheduledAt, state.patient.timeZone))
    .sort();
  const weekForDate = (date: string) =>
    Math.floor(((Date.parse(date) - Date.parse(today)) / 86400000 + 3) / 7);
  const firstWeek = Math.min(
    0,
    weekForDate(state.doseRange?.from ?? courseDates[0] ?? today),
  );
  const lastWeek = Math.max(
    0,
    weekForDate(state.doseRange?.to ?? courseDates.at(-1) ?? today),
  );
  useEffect(() => {
    const bounded = Math.max(firstWeek, Math.min(lastWeek, weekOffset));
    if (bounded !== weekOffset) {
      setWeekOffset(bounded);
      setSelected((date) => shiftDate(date, (bounded - weekOffset) * 7));
    }
  }, [firstWeek, lastWeek, weekOffset]);
  const days = Array.from({ length: 7 }, (_, i) =>
    shiftDate(today, weekOffset * 7 + i - 3),
  );
  const from = days[0];
  const to = days[6];
  const patientId = state.patient.id;
  const timeZone = state.patient.timeZone;
  const matchesRange = (range: WeekRange | null) =>
    range?.from === from &&
    range.to === to &&
    range.patientId === patientId &&
    range.timeZone === timeZone;
  const hasWeek = matchesRange(week);
  const error = matchesRange(loadError) ? loadError?.message : undefined;
  const weekDoses = hasWeek ? week!.doses : [];
  const loading = fetching || (!hasWeek && !error);
  useEffect(() => {
    const controller = new AbortController();
    const range = { from, to, patientId, timeZone };
    setFetching(true);
    setLoadError(null);
    api<{ doses: Dose[] }>(`/doses?from=${from}&to=${to}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setWeek({ ...range, doses: result.doses });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setLoadError({
            ...range,
            message:
              cause instanceof Error
                ? cause.message
                : "The schedule could not be loaded. Please try again.",
          });
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false);
      });
    return () => controller.abort();
  }, [from, to, patientId, timeZone, state.doses, retry]);
  const dayDoses = weekDoses.filter(
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
      <div className="context-strip">
        <span>
          <CalendarDays size={15} />
          {state.patient.name}'s dose plan
        </span>
        <span>
          Schedule time zone{" "}
          <strong>{state.patient.timeZone.replaceAll("_", " ")}</strong>
        </span>
      </div>
      <section className="card schedule-main" aria-busy={loading}>
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
              disabled={weekOffset <= firstWeek}
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
              disabled={weekOffset >= lastWeek}
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
            const doses = weekDoses.filter(
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
              {hasWeek
                ? `${totalTaken} of ${dayDoses.length} doses recorded as taken`
                : loading
                  ? "Loading dose records…"
                  : "Dose records could not be loaded."}
            </p>
          </div>
          <span className="pill">
            {fetching ? (
              <Spinner label="Refreshing medication schedule" />
            ) : (
              <CalendarDays size={13} />
            )}
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
        {error && (
          <div className="empty-state" role="alert">
            <h3>Schedule could not be loaded</h3>
            <p>{error}</p>
            {hasWeek && <p>Showing the last loaded schedule.</p>}
            <button
              className="button secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry schedule
            </button>
          </div>
        )}
        {!hasWeek && loading ? (
          <div className="empty-state" role="status">
            <Spinner label="Loading this week's schedule" />
            <p>Loading this week's schedule…</p>
          </div>
        ) : !hasWeek ? null : dayDoses.length > 0 && filtered.length === 0 ? (
          <Empty
            title="No doses match this view"
            description="Choose another status or clear the medication filter."
          />
        ) : (
          <DoseList doses={filtered} />
        )}
        <div className="schedule-card-footer">
          <span>Check-ins record what you report, not proof of ingestion.</span>
          <span>Follow the prescribed instructions.</span>
        </div>
      </section>
    </>
  );
}

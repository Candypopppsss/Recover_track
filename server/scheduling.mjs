import { createHash, randomUUID } from "node:crypto";

export const isoNow = () => new Date().toISOString();
export function dateInZone(date = new Date(), timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (n) => parts.find((p) => p.type === n).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
export function localDateTimeToUTC(date, time, timeZone) {
  const [y, mo, d] = date.split("-").map(Number),
    [h, mi] = time.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wanted;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      fmt
        .formatToParts(new Date(guess))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, x.value]),
    );
    const displayed = Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
    if (displayed === wanted) return new Date(guess).toISOString();
    guess += wanted - displayed;
  }
  throw Object.assign(
    new Error(
      `The time ${time} on ${date} does not exist in ${timeZone} because the clock changes. Choose another time.`,
    ),
    { status: 400 },
  );
}
export function doseId(medicationId, scheduledAt) {
  return createHash("sha256")
    .update(`${medicationId}:${scheduledAt}`)
    .digest("hex")
    .slice(0, 32);
}
export function projectedStatus(dose, graceMinutes = 60, now = Date.now()) {
  if (dose.status === "taken" || dose.status === "skipped") return dose.status;
  const diff = now - Date.parse(dose.scheduledAt);
  return diff < 0
    ? "upcoming"
    : diff <= graceMinutes * 60_000
      ? "due"
      : "missed";
}
export function generateDoses(medication, timeZone) {
  const doses = [];
  for (let day = 0; day < medication.durationDays; day++)
    for (const time of medication.times) {
      const scheduledAt = localDateTimeToUTC(
        addDays(medication.startDate, day),
        time,
        timeZone,
      );
      doses.push({
        id: doseId(medication.id, scheduledAt),
        householdId: medication.householdId,
        medicationId: medication.id,
        medicationName: medication.name,
        strength: medication.strength,
        dose: medication.dose,
        instructions: medication.instructions,
        color: medication.color,
        scheduledAt,
        status: "upcoming",
        createdAt: isoNow(),
      });
    }
  return doses;
}
export const newId = () => randomUUID();

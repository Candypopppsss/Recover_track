import { createContext, useContext } from "react";
import type { State } from "./types";
export interface AppContextValue {
  state: State;
  refresh: () => Promise<void>;
  notify: (message: string, type?: "success" | "error") => void;
  mutate: (
    action: () => Promise<unknown>,
    message?: string,
  ) => Promise<boolean>;
  openPrescription: () => void;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("App context unavailable");
  return value;
}
export function dateInZone(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function todayInZone(timeZone: string) {
  return dateInZone(new Date(), timeZone);
}
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
}
export function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
export function recoveryDay(start: string, today: string) {
  return Math.max(
    1,
    Math.floor((Date.parse(today) - Date.parse(start)) / 86400000) + 1,
  );
}
export function adherence(doses: State["doses"]) {
  const elapsed = doses.filter(
    (d) => d.status !== "upcoming" && d.status !== "due",
  );
  return elapsed.length
    ? Math.round(
        (elapsed.filter((d) => d.status === "taken").length / elapsed.length) *
          100,
      )
    : null;
}

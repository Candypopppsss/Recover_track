export type Role = "caregiver" | "patient" | "doctor";
export type Color = "purple" | "green" | "amber" | "blue";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Patient {
  id: string;
  name: string;
  initials: string;
  age: number;
  surgery: string;
  recoveryStart: string;
  recoveryDays: number;
  timeZone: string;
  caregiverName: string;
}
export interface Medication {
  id: string;
  name: string;
  strength: string;
  dose: string;
  instructions: string;
  times: string[];
  startDate: string;
  durationDays: number;
  color: Color;
  status: "active" | "paused" | "completed";
  source: string;
  createdAt: string;
  prescriptionId?: string;
}
export interface Dose {
  id: string;
  medicationId: string;
  medicationName: string;
  strength: string;
  dose: string;
  instructions: string;
  color: Color;
  scheduledAt: string;
  status: "upcoming" | "due" | "taken" | "missed" | "skipped";
  takenAt?: string;
  checkinBy?: string;
  note?: string;
}
export interface CheckIn {
  id: string;
  date: string;
  pain: number;
  mobility: "resting" | "assisted" | "independent";
  note: string;
  createdAt: string;
  recordedBy: string;
}
export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "reminder" | "missed" | "info";
  createdAt: string;
  read: boolean;
  doseId?: string;
}
export interface Activity {
  id: string;
  title: string;
  description: string;
  type: string;
  createdAt: string;
}
export interface Risk {
  score: number | null;
  level: "low" | "moderate" | "high" | "unavailable";
  explanation: string[];
  experimental: boolean;
  modelVersion: string;
  features?: Record<string, number>;
}
export interface Settings {
  remindersEnabled: boolean;
  missedAlertsEnabled: boolean;
  graceMinutes: number;
}
export interface CareMember {
  id: string;
  name: string;
  role: string;
  relationship: string;
  email?: string;
}
export interface Prescription {
  id: string;
  filename: string;
  engine: string;
  status: string;
  createdAt: string;
  confirmedAt?: string;
  version: number;
  criticalityFlag: boolean;
}
export interface Callback {
  id: string;
  patientId: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}
export interface Consent {
  app: boolean;
  caregiver: boolean;
  clinician: boolean;
  outreach: boolean;
}
export interface AuditEntry {
  id: string;
  actor?: string;
  actorName?: string;
  action: string;
  createdAt?: string;
  timestamp?: string;
  patientId?: string;
}
export interface State {
  user: User;
  demo: boolean;
  patient: Patient;
  medications: Medication[];
  doses: Dose[];
  notifications: Notification[];
  activity: Activity[];
  risk: Risk;
  settings: Settings;
  careTeam: CareMember[];
  checkIns: CheckIn[];
  prescriptions: Prescription[];
  consent?: Consent;
  callbacks?: Callback[];
  auditLog?: AuditEntry[];
}

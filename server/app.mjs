import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createStore } from "./store.mjs";
import {
  newId,
  isoNow,
  dateInZone,
  addDays,
  validDate,
  validTimeZone,
  generateDoses,
  projectedStatus,
} from "./scheduling.mjs";
const scrypt = promisify(scryptCallback);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const emailHash = (email) => hash(email.trim().toLowerCase());
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const str = (max = 120) => z.string().trim().min(1).max(max);
const dateSchema = z
  .string()
  .refine(validDate, "Enter a valid date (YYYY-MM-DD).");
const timesSchema = z
  .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time."))
  .min(1)
  .max(6)
  .refine((a) => new Set(a).size === a.length, "Dose times must be different.");
const medSchema = z.object({
  name: str(),
  strength: str(80),
  dose: str(80),
  instructions: z.string().trim().max(500).default(""),
  times: timesSchema,
  startDate: dateSchema,
  durationDays: z.number().int().min(1).max(90),
  color: z.enum(["purple", "green", "amber", "blue"]).default("purple"),
  reviewed: z.literal(true),
});
const settingsSchema = z
  .object({
    remindersEnabled: z.boolean().optional(),
    missedAlertsEnabled: z.boolean().optional(),
    graceMinutes: z.number().int().min(15).max(120).optional(),
  })
  .strict();
const consentSchema = z
  .object({
    app: z.boolean().optional(),
    caregiver: z.boolean().optional(),
    clinician: z.boolean().optional(),
    outreach: z.boolean().optional(),
  })
  .strict();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});
const cookieName = "recovertrack_session";
const unavailableRisk = {
  score: null,
  level: "unavailable",
  explanation: [
    "The attention score is temporarily unavailable. Your schedule and check-ins remain available.",
  ],
  experimental: true,
  modelVersion: "unavailable",
};

export async function createApp(options = {}) {
  const store = options.store || (await createStore(options));
  const app = express();
  const serviceUrl =
    options.serviceUrl ??
    process.env.INTELLIGENCE_URL ??
    "http://127.0.0.1:8001";
  const intelligenceRequest = options.intelligenceRequest || fetch;
  const locks = new Map();
  async function exclusive(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((r) => {
      release = r;
    });
    locks.set(key, next);
    await previous;
    try {
      return await (store.exclusive ? store.exclusive(key, fn) : fn());
    } finally {
      release();
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  async function exclusiveResponse(key, res, fn) {
    if (!store.exclusive) return exclusive(key, fn);
    const json = res.json;
    let response;
    // Release Mongo leases before ending HTTP responses: a serverless instance
    // can freeze as soon as the response ends, before an awaited finally runs.
    res.json = function (body) {
      response = body;
      return this;
    };
    try {
      await exclusive(key, fn);
    } finally {
      res.json = json;
    }
    return res.json(response);
  }
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  app.use(cookieParser());
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin) {
        let parsed;
        try {
          parsed = new URL(origin);
        } catch {
          return next(
            Object.assign(new Error("Invalid request origin."), {
              status: 403,
            }),
          );
        }
        const allowed = new Set([
          req.get("host"),
          ...(
            process.env.ALLOWED_ORIGINS ||
            "http://localhost:5173,http://127.0.0.1:5173"
          )
            .split(",")
            .map((s) => {
              try {
                return new URL(s).host;
              } catch {
                return "";
              }
            }),
        ]);
        if (!allowed.has(parsed.host))
          return next(
            Object.assign(new Error("This request origin is not allowed."), {
              status: 403,
            }),
          );
      }
      if (req.get("sec-fetch-site") === "cross-site")
        return next(
          Object.assign(new Error("Cross-site requests are not allowed."), {
            status: 403,
          }),
        );
    }
    next();
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: options.test ? 1000 : 35,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many sign-in attempts. Please try again in 15 minutes.",
    },
  });
  app.use("/api/auth", authLimiter);
  async function audit(household, actor, action, metadata = {}) {
    const record = {
      id: newId(),
      householdId: household,
      actorId: actor.id,
      actorName: actor.name,
      action,
      createdAt: isoNow(),
      ...metadata,
    };
    await store.put("audit", record.id, record, household);
  }
  async function activity(household, title, description, type = "info") {
    const record = {
      id: newId(),
      title,
      description,
      type,
      createdAt: isoNow(),
    };
    await store.put("activity", record.id, record, household);
    return record;
  }
  async function issueSession(req, res, user) {
    if (req.sessionId) await store.delete("session", req.sessionId);
    const token = randomBytes(32).toString("base64url");
    const session = {
      id: hash(token),
      userId: user.id,
      expiresAt: Date.now() + (user.demo ? 24 : 24 * 7) * 3600_000,
    };
    await store.put("session", session.id, session, user.householdId);
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true" || req.secure,
      maxAge: session.expiresAt - Date.now(),
      path: "/",
    });
  }
  async function assertSharing(user) {
    const [consent, patient] = await Promise.all([
      store.get("consent", user.householdId),
      store.get("patient", user.householdId),
    ]);
    if (user.role === "doctor" && (!consent?.app || !consent?.clinician))
      fail(403, "Clinician sharing consent is not enabled for this recovery.");
    if (
      user.role === "caregiver" &&
      patient?.ownerId !== user.id &&
      !user.demo &&
      !consent?.caregiver
    )
      fail(403, "Caregiver sharing consent is not enabled for this recovery.");
    return consent;
  }
  async function sessionView(user) {
    await assertSharing(user);
    return {
      user: safeUser(user),
      patient: await store.get("patient", user.householdId),
      demo: !!user.demo,
    };
  }
  app.use("/api", async (req, _res, next) => {
    try {
      const token = req.cookies[cookieName];
      if (token) {
        const session = await store.get("session", hash(token));
        if (session && session.expiresAt > Date.now()) {
          req.user = await store.get("user", session.userId);
          req.sessionId = session.id;
        } else if (session) await store.delete("session", session.id);
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  const authenticated = async (req, _res, next) => {
    try {
      if (!req.user) fail(401, "Please sign in to continue.");
      const consent = await assertSharing(req.user);
      if (
        !consent?.app &&
        !["GET", "HEAD"].includes(req.method) &&
        !["/api/consent", "/api/auth/logout"].includes(
          req.originalUrl.split("?")[0],
        )
      )
        fail(
          403,
          "App processing consent is paused. Re-enable it in privacy settings to record new information.",
        );
      next();
    } catch (error) {
      next(error);
    }
  };
  const caregiver = (req, _res, next) =>
    req.user?.role === "caregiver"
      ? next()
      : next(
          Object.assign(
            new Error("Only a caregiver can manage the recovery plan."),
            { status: 403 },
          ),
        );
  const writer = (req, _res, next) =>
    ["caregiver", "patient"].includes(req.user?.role)
      ? next()
      : next(
          Object.assign(
            new Error(
              "Clinician access is read-only for medication and symptom records.",
            ),
            { status: 403 },
          ),
        );
  async function owned(kind, id, user) {
    const record = await store.get(kind, id);
    if (!record || record.householdId !== user.householdId)
      fail(404, "This record was not found.");
    return record;
  }
  async function seedHousehold(
    user,
    { patientName, surgery, timeZone, demo = false } = {},
  ) {
    const today = dateInZone(new Date(), timeZone || "Asia/Kolkata");
    const patient = {
      id: user.householdId,
      ownerId: user.id,
      name: patientName || "Ananya Sharma",
      initials: (patientName || "Ananya Sharma")
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase(),
      age: demo ? 34 : 0,
      surgery: surgery || (demo ? "Knee replacement" : "Post-surgery recovery"),
      recoveryStart: demo ? addDays(today, -9) : today,
      recoveryDays: 28,
      timeZone: timeZone || "Asia/Kolkata",
      caregiverName: user.name,
    };
    await store.put("patient", user.householdId, patient, user.householdId);
    await store.put(
      "settings",
      user.householdId,
      { remindersEnabled: true, missedAlertsEnabled: true, graceMinutes: 60 },
      user.householdId,
    );
    await store.put(
      "consent",
      user.householdId,
      {
        app: true,
        caregiver: true,
        clinician: demo,
        outreach: false,
        updatedAt: isoNow(),
      },
      user.householdId,
    );
    if (!demo) return patient;
    const templates = [
      {
        name: "Amoxicillin",
        strength: "500 mg",
        dose: "1 capsule",
        times: ["08:00", "20:00"],
        instructions: "Demo prescription · with food",
        color: "purple",
        durationDays: 14,
      },
      {
        name: "Paracetamol",
        strength: "500 mg",
        dose: "1 tablet",
        times: ["09:00", "15:00", "21:00"],
        instructions: "Demo prescription · after food",
        color: "green",
        durationDays: 12,
      },
      {
        name: "Pantoprazole",
        strength: "40 mg",
        dose: "1 tablet",
        times: ["07:30"],
        instructions: "Demo prescription · before breakfast",
        color: "amber",
        durationDays: 14,
      },
      {
        name: "Vitamin C",
        strength: "500 mg",
        dose: "1 tablet",
        times: ["12:00"],
        instructions: "Demo prescription · after lunch",
        color: "blue",
        durationDays: 21,
      },
    ];
    let pastIndex = 0;
    for (const template of templates) {
      const med = {
        ...template,
        id: newId(),
        householdId: user.householdId,
        startDate: addDays(today, -7),
        status: "active",
        source: "demo",
        createdAt: new Date(Date.now() - 7 * 86400_000).toISOString(),
      };
      await store.put("medication", med.id, med, user.householdId);
      for (const dose of generateDoses(med, patient.timeZone)) {
        if (Date.parse(dose.scheduledAt) < Date.now() - 2 * 3600_000) {
          pastIndex++;
          if (pastIndex % 12 !== 0) {
            dose.status = "taken";
            dose.takenAt = new Date(
              Date.parse(dose.scheduledAt) + 8 * 60_000,
            ).toISOString();
            dose.checkinBy = "Ananya Sharma";
          }
        }
        await store.put("dose", dose.id, dose, user.householdId);
      }
    }
    for (let day = 6; day >= 1; day--) {
      const checkIn = {
        id: newId(),
        householdId: user.householdId,
        date: addDays(today, -day),
        pain: day >= 4 ? 5 : day >= 2 ? 3 : 2,
        mobility: day >= 4 ? "assisted" : "independent",
        note: day === 1 ? "Moving more comfortably today." : "",
        createdAt: new Date(`${addDays(today, -day)}T10:00:00Z`).toISOString(),
        recordedBy: patient.name,
      };
      await store.put("checkin", checkIn.id, checkIn, user.householdId);
    }
    await activity(
      user.householdId,
      "Recovery plan confirmed",
      "4 demo medications added to the shared recovery schedule.",
      "prescription",
    );
    const notice = {
      id: newId(),
      title: "Demo account created",
      message:
        "This account contains fictional records. Create a personal account to enter your own prescription.",
      type: "info",
      createdAt: isoNow(),
      read: false,
    };
    await store.put("notification", notice.id, notice, user.householdId);
    return patient;
  }
  app.get("/api/health", async (_req, res) => {
    let ocr = "unavailable";
    try {
      const r = await intelligenceRequest(`${serviceUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const health = await r.json();
        ocr = health.ocr || health.engine || "available";
      }
    } catch {
      /* reported as unavailable */
    }
    res.json({ status: "ok", database: store.kind, ocr });
  });
  app.get("/api/auth/me", (req, res) => {
    if (!req.user) fail(401, "Please sign in to continue.");
    return sessionView(req.user).then((v) => res.json(v));
  });
  app.post("/api/auth/demo", async (req, res) => {
    const { role = "caregiver" } = z
      .object({ role: z.enum(["caregiver", "patient", "doctor"]).optional() })
      .parse(req.body);
    const id = newId();
    const user = {
      id,
      name:
        role === "patient"
          ? "Ananya Sharma"
          : role === "doctor"
            ? "Dr. Meera Patel"
            : "Priya Sharma",
      email: `${id}@demo.recovertrack.local`,
      role,
      householdId: newId(),
      demo: true,
      createdAt: isoNow(),
    };
    await store.put("user", id, user, user.householdId);
    await seedHousehold(user, { demo: true });
    await audit(user.householdId, user, "demo.started");
    await issueSession(req, res, user);
    res.status(201).json(await sessionView(user));
  });
  app.post("/api/auth/register", async (req, res) => {
    const body = z
      .object({
        name: str(100),
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase().trim()),
        password: z.string().min(10, "Use at least 10 characters.").max(128),
        patientName: str(100),
        surgery: z.string().trim().max(120).optional(),
        timeZone: z
          .string()
          .refine(validTimeZone, "Choose a valid time zone.")
          .optional(),
      })
      .parse(req.body);
    await exclusiveResponse(`email:${emailHash(body.email)}`, res, async () => {
      if (await store.get("email", emailHash(body.email)))
        fail(409, "An account with this email already exists.");
      const salt = randomBytes(16).toString("hex");
      const derived = await scrypt(body.password, salt, 64);
      const user = {
        id: newId(),
        name: body.name,
        email: body.email,
        passwordHash: `${salt}:${derived.toString("hex")}`,
        role: "caregiver",
        householdId: newId(),
        demo: false,
        createdAt: isoNow(),
      };
      await store.put("user", user.id, user, user.householdId);
      await store.put("email", emailHash(user.email), { userId: user.id });
      await seedHousehold(user, body);
      await audit(user.householdId, user, "account.created");
      await issueSession(req, res, user);
      res.status(201).json(await sessionView(user));
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = z
      .object({ email: z.email().max(254), password: z.string().max(128) })
      .parse(req.body);
    const record = await store.get("email", emailHash(email));
    const user = record && (await store.get("user", record.userId));
    const [salt, saved] = (
      user?.passwordHash || `${"0".repeat(32)}:${"0".repeat(128)}`
    ).split(":");
    const candidate = await scrypt(password, salt, 64);
    if (!user || !timingSafeEqual(candidate, Buffer.from(saved, "hex")))
      fail(401, "Email or password is incorrect.");
    await assertSharing(user);
    await audit(user.householdId, user, "account.signed_in");
    await issueSession(req, res, user);
    res.json(await sessionView(user));
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.sessionId) await store.delete("session", req.sessionId);
    res.clearCookie(cookieName, { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", authenticated);
  async function getRisk(doses, checkIns, patient) {
    try {
      const result = await intelligenceRequest(`${serviceUrl}/risk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN || "",
        },
        body: JSON.stringify({
          doses: doses.map((d) => ({
            scheduledAt: d.scheduledAt,
            status: d.status,
          })),
          checkIns: checkIns.map((c) => ({
            date: c.date,
            pain: c.pain,
            mobility: c.mobility,
          })),
          timeZone: patient.timeZone,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!result.ok) return unavailableRisk;
      const risk = await result.json();
      return { ...risk, experimental: true };
    } catch {
      return unavailableRisk;
    }
  }
  async function notifyHousehold(household, doses, settings) {
    const now = Date.now();
    for (const d of doses) {
      const status = projectedStatus(d, settings.graceMinutes, now);
      const type =
        status === "due" ? "reminder" : status === "missed" ? "missed" : null;
      if (
        !type ||
        (type === "reminder" && !settings.remindersEnabled) ||
        (type === "missed" && !settings.missedAlertsEnabled) ||
        now - Date.parse(d.scheduledAt) > 48 * 3600_000
      )
        continue;
      const id = `${type}:${d.id}`;
      if (await store.get("notification", id)) continue;
      const notification = {
        id,
        title:
          type === "reminder"
            ? `Time for ${d.medicationName}`
            : `${d.medicationName} needs a check-in`,
        message:
          type === "reminder"
            ? `${d.dose} · ${d.strength}. Follow the reviewed prescription.`
            : "No check-in was recorded within the grace period. Check with the patient; follow the prescriber’s missed-dose instructions.",
        type,
        doseId: d.id,
        createdAt: isoNow(),
        read: false,
      };
      await store.put("notification", id, notification, household);
    }
  }
  app.get("/api/state", async (req, res) => {
    const household = req.user.householdId;
    const [
      patient,
      medications,
      rawDoses,
      settings,
      consent,
      checkIns,
      prescriptions,
      members,
    ] = await Promise.all(
      [
        "patient",
        "medication",
        "dose",
        "settings",
        "consent",
        "checkin",
        "prescription",
        "user",
      ].map((kind) =>
        ["patient", "settings", "consent"].includes(kind)
          ? store.get(kind, household)
          : store.list(kind, household),
      ),
    );
    const today = dateInZone(new Date(), patient.timeZone);
    const from = addDays(today, -14),
      to = addDays(today, 8);
    const doses = rawDoses
      .map((d) => ({ ...d, status: projectedStatus(d, settings.graceMinutes) }))
      .filter((d) => {
        const day = dateInZone(new Date(d.scheduledAt), patient.timeZone);
        return day >= from && day < to;
      })
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const risk = consent.app
      ? await getRisk(
          doses.filter((d) => d.scheduledAt <= isoNow()),
          checkIns,
          patient,
        )
      : {
          ...unavailableRisk,
          explanation: ["App processing is paused in privacy settings."],
        };
    await exclusive(household, async () => {
      if (consent.app) await notifyHousehold(household, doses, settings);
      const callbackId = hash(`callback:${household}:${today}`);
      if (
        consent.app &&
        risk.level === "high" &&
        consent.clinician &&
        !(await store.get("callback", callbackId))
      ) {
        const callback = {
          id: callbackId,
          patientId: household,
          householdId: household,
          reason: risk.explanation?.[0] || "Recovery records need review.",
          status: "open",
          createdAt: isoNow(),
          eventDate: today,
        };
        await store.put("callback", callback.id, callback, household);
      }
    });
    const currentCallbacks = await store.list("callback", household);
    await audit(household, req.user, "recovery.viewed");
    const [notifications, activities, auditLog] = await Promise.all([
      store.list("notification", household),
      store.list("activity", household),
      req.user.role === "patient" ? [] : store.list("audit", household),
    ]);
    res.json({
      user: safeUser(req.user),
      demo: !!req.user.demo,
      patient,
      medications: medications.filter((m) => !m.archived),
      doses,
      settings,
      consent,
      checkIns: checkIns.sort((a, b) => a.date.localeCompare(b.date)),
      prescriptions: prescriptions
        .map(({ text, medications: drafts, ...p }) => p)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      risk,
      notifications: notifications
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100),
      activity: activities
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50),
      careTeam: members.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        relationship:
          u.role === "doctor"
            ? "Clinician"
            : u.role === "patient"
              ? "Patient"
              : "Caregiver",
        email: u.email,
      })),
      callbacks: currentCallbacks.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      auditLog: auditLog
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100),
    });
  });
  function prepareMedication(
    user,
    body,
    patient,
    source = "manual",
    prescriptionId,
  ) {
    const fields = medSchema.parse(body);
    const today = dateInZone(new Date(), patient.timeZone);
    if (
      fields.startDate < addDays(today, -90) ||
      fields.startDate > addDays(today, 90)
    )
      fail(400, "Medication start dates must be within 90 days of today.");
    const { reviewed, ...editable } = fields;
    const med = {
      ...editable,
      id: newId(),
      householdId: user.householdId,
      status: "active",
      source,
      prescriptionId,
      createdAt: isoNow(),
    };
    return { med, doses: generateDoses(med, patient.timeZone) };
  }
  async function persistMedication(user, { med, doses }) {
    await store.put("medication", med.id, med, user.householdId);
    for (const d of doses) await store.put("dose", d.id, d, user.householdId);
    await audit(user.householdId, user, "medication.confirmed", {
      recordId: med.id,
    });
    await activity(
      user.householdId,
      `${med.name} added`,
      "Reviewed details confirmed and dose schedule created.",
      "prescription",
    );
    return med;
  }
  app.post("/api/medications", caregiver, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const patient = await store.get("patient", req.user.householdId);
      res
        .status(201)
        .json(
          await persistMedication(
            req.user,
            prepareMedication(req.user, req.body, patient),
          ),
        );
    }),
  );
  app.post("/api/medications/batch", caregiver, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const { medications } = z
        .object({ medications: z.array(medSchema).min(1).max(15) })
        .parse(req.body);
      const patient = await store.get("patient", req.user.householdId);
      const prepared = medications.map((med) =>
        prepareMedication(req.user, med, patient),
      );
      const created = [];
      for (const medication of prepared)
        created.push(await persistMedication(req.user, medication));
      res.status(201).json({ medications: created });
    }),
  );
  app.patch("/api/medications/:id", caregiver, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const original = await owned("medication", req.params.id, req.user);
      const changes = z
        .object({
          name: str().optional(),
          strength: str(80).optional(),
          dose: str(80).optional(),
          instructions: z.string().trim().max(500).optional(),
          times: timesSchema.optional(),
          startDate: dateSchema.optional(),
          durationDays: z.number().int().min(1).max(90).optional(),
          color: z.enum(["purple", "green", "amber", "blue"]).optional(),
        })
        .extend({
          status: z.enum(["active", "paused", "completed"]).optional(),
          reviewed: z.literal(true).optional(),
        })
        .strict()
        .parse(req.body);
      if (
        Object.keys(changes).some((k) => !["status", "reviewed"].includes(k)) &&
        changes.reviewed !== true
      )
        fail(400, "Review and confirm the updated medication details.");
      const { reviewed, ...data } = changes;
      const updated = { ...original, ...data, updatedAt: isoNow() };
      medSchema.parse({ ...updated, reviewed: true });
      const patient = await store.get("patient", req.user.householdId);
      const nextDoses =
        updated.status === "active"
          ? generateDoses(updated, patient.timeZone).filter(
              (d) => Date.parse(d.scheduledAt) > Date.now(),
            )
          : [];
      const existing = await store.list("dose", req.user.householdId);
      for (const d of existing.filter(
        (d) =>
          d.medicationId === original.id &&
          Date.parse(d.scheduledAt) > Date.now() &&
          !["taken", "skipped"].includes(d.status),
      ))
        await store.delete("dose", d.id);
      for (const d of nextDoses)
        if (
          !existing.some(
            (e) => e.id === d.id && ["taken", "skipped"].includes(e.status),
          )
        )
          await store.put("dose", d.id, d, req.user.householdId);
      await store.put("medication", updated.id, updated, req.user.householdId);
      await audit(req.user.householdId, req.user, "medication.updated", {
        recordId: updated.id,
      });
      res.json(updated);
    }),
  );
  app.delete("/api/medications/:id", caregiver, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const med = await owned("medication", req.params.id, req.user);
      med.archived = true;
      med.status = "completed";
      await store.put("medication", med.id, med, req.user.householdId);
      for (const d of await store.list("dose", req.user.householdId))
        if (
          d.medicationId === med.id &&
          Date.parse(d.scheduledAt) > Date.now() &&
          !["taken", "skipped"].includes(d.status)
        )
          await store.delete("dose", d.id);
      await audit(req.user.householdId, req.user, "medication.archived", {
        recordId: med.id,
      });
      res.json({ ok: true });
    }),
  );
  app.post("/api/doses/:id/check-in", writer, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const { status, note = "" } = z
        .object({
          status: z.enum(["taken", "skipped"]),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body);
      const dose = await owned("dose", req.params.id, req.user);
      if (["taken", "skipped"].includes(dose.status))
        fail(
          409,
          "This dose already has a check-in. Undo it first to make a correction.",
        );
      if (Date.parse(dose.scheduledAt) > Date.now() + 60 * 60_000)
        fail(400, "This dose is scheduled more than one hour from now.");
      dose.status = status;
      dose.takenAt = isoNow();
      dose.checkinBy = req.user.name;
      dose.note = note;
      await store.put("dose", dose.id, dose, req.user.householdId);
      await audit(req.user.householdId, req.user, `dose.${status}`, {
        recordId: dose.id,
      });
      await activity(
        req.user.householdId,
        `${dose.medicationName} ${status === "taken" ? "checked in" : "skipped"}`,
        `${dose.dose} · recorded by ${req.user.name}`,
        status,
      );
      res.json(dose);
    }),
  );
  app.post("/api/doses/:id/undo", writer, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const dose = await owned("dose", req.params.id, req.user);
      if (!["taken", "skipped"].includes(dose.status))
        fail(409, "This dose has no check-in to undo.");
      dose.status = "upcoming";
      delete dose.takenAt;
      delete dose.checkinBy;
      delete dose.note;
      await store.put("dose", dose.id, dose, req.user.householdId);
      await audit(req.user.householdId, req.user, "dose.checkin_corrected", {
        recordId: dose.id,
      });
      res.json({
        ...dose,
        status: projectedStatus(
          dose,
          (await store.get("settings", req.user.householdId)).graceMinutes,
        ),
      });
    }),
  );
  app.post("/api/checkins", writer, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const body = z
        .object({
          date: dateSchema.optional(),
          pain: z.number().int().min(0).max(10),
          mobility: z.enum(["resting", "assisted", "independent"]),
          note: z.string().trim().max(1000).default(""),
        })
        .parse(req.body);
      const patient = await store.get("patient", req.user.householdId);
      const today = dateInZone(new Date(), patient.timeZone);
      const date = body.date || today;
      if (date > today || date < addDays(today, -14))
        fail(400, "Check-ins must be for today or the previous 14 days.");
      const previous = (await store.list("checkin", req.user.householdId)).find(
        (c) => c.date === date,
      );
      const record = {
        ...body,
        date,
        id: previous?.id || newId(),
        householdId: req.user.householdId,
        createdAt: previous?.createdAt || isoNow(),
        updatedAt: isoNow(),
        recordedBy: req.user.name,
      };
      await store.put("checkin", record.id, record, req.user.householdId);
      await audit(
        req.user.householdId,
        req.user,
        previous ? "checkin.updated" : "checkin.recorded",
        { recordId: record.id },
      );
      await activity(
        req.user.householdId,
        "Daily check-in recorded",
        `Pain ${body.pain}/10 · mobility ${body.mobility}`,
        "info",
      );
      res.status(previous ? 200 : 201).json(record);
    }),
  );
  app.patch("/api/settings", caregiver, async (req, res) => {
    const current = await store.get("settings", req.user.householdId);
    const value = { ...current, ...settingsSchema.parse(req.body) };
    await store.put(
      "settings",
      req.user.householdId,
      value,
      req.user.householdId,
    );
    await audit(req.user.householdId, req.user, "settings.updated");
    res.json(value);
  });
  app.patch("/api/consent", caregiver, async (req, res) => {
    const current = await store.get("consent", req.user.householdId);
    const value = {
      ...current,
      ...consentSchema.parse(req.body),
      updatedAt: isoNow(),
    };
    await store.put(
      "consent",
      req.user.householdId,
      value,
      req.user.householdId,
    );
    await audit(req.user.householdId, req.user, "consent.updated");
    res.json(value);
  });
  app.patch("/api/patient", caregiver, async (req, res) => {
    const changes = z
      .object({
        name: str(100).optional(),
        age: z.number().int().min(0).max(120).optional(),
        surgery: str(120).optional(),
        recoveryStart: dateSchema.optional(),
        recoveryDays: z.number().int().min(1).max(90).optional(),
        timeZone: z.string().refine(validTimeZone).optional(),
      })
      .strict()
      .parse(req.body);
    const patient = await store.get("patient", req.user.householdId);
    if (
      changes.timeZone &&
      changes.timeZone !== patient.timeZone &&
      (await store.list("medication", req.user.householdId)).some(
        (m) => m.status === "active",
      )
    )
      fail(
        409,
        "Pause active medications before changing the patient time zone, then review and reactivate their schedules.",
      );
    const value = { ...patient, ...changes };
    value.initials = value.name
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
    await store.put(
      "patient",
      req.user.householdId,
      value,
      req.user.householdId,
    );
    await audit(req.user.householdId, req.user, "patient.updated");
    res.json(value);
  });
  app.post("/api/notifications/read", async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const { ids } = z
        .object({ ids: z.array(z.string()).max(100).optional() })
        .parse(req.body);
      for (const n of await store.list("notification", req.user.householdId))
        if (!ids || ids.includes(n.id))
          await store.put(
            "notification",
            n.id,
            { ...n, read: true },
            req.user.householdId,
          );
      await audit(req.user.householdId, req.user, "notifications.read");
      res.json({ ok: true });
    }),
  );
  app.post("/api/callbacks/:id/resolve", async (req, res) => {
    if (!["caregiver", "doctor"].includes(req.user.role))
      fail(403, "Only a caregiver or clinician can resolve a callback.");
    const callback = await owned("callback", req.params.id, req.user);
    const { note = "" } = z
      .object({ note: z.string().trim().max(1000).optional() })
      .parse(req.body);
    callback.status = "resolved";
    callback.resolvedAt = isoNow();
    callback.resolvedBy = req.user.name;
    callback.note = note;
    await store.put("callback", callback.id, callback, req.user.householdId);
    await audit(req.user.householdId, req.user, "callback.resolved", {
      recordId: callback.id,
    });
    res.json(callback);
  });
  app.get("/api/export", async (req, res) => {
    const doses = (await store.list("dose", req.user.householdId)).sort(
      (a, b) => a.scheduledAt.localeCompare(b.scheduledAt),
    );
    const settings = await store.get("settings", req.user.householdId);
    const cell = (v) => {
      let text = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        "Medication",
        "Strength",
        "Dose",
        "Scheduled at (UTC)",
        "Status",
        "Recorded at (UTC)",
        "Recorded by",
        "Note",
      ],
      ...doses.map((d) => [
        d.medicationName,
        d.strength,
        d.dose,
        d.scheduledAt,
        projectedStatus(d, settings.graceMinutes),
        d.takenAt,
        d.checkinBy,
        d.note,
      ]),
    ];
    await audit(req.user.householdId, req.user, "dose_history.exported");
    res
      .type("text/csv")
      .attachment("recovertrack-dose-history.csv")
      .send("\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"));
  });
  app.post(
    "/api/prescriptions/upload",
    caregiver,
    upload.single("file"),
    async (req, res) => {
      if (!req.file) fail(400, "Choose a prescription image to read.");
      const bytes = req.file.buffer;
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";
      if (!png && !jpeg && !webp)
        fail(
          400,
          "Upload a PNG, JPEG or WebP image. PDFs must be converted to a clear image first.",
        );
      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], {
          type: png ? "image/png" : jpeg ? "image/jpeg" : "image/webp",
        }),
        "prescription-image",
      );
      let output;
      try {
        const result = await intelligenceRequest(`${serviceUrl}/ocr`, {
          method: "POST",
          headers: {
            "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN || "",
          },
          body: form,
          signal: AbortSignal.timeout(90_000),
        });
        output = await result.json();
        if (!result.ok)
          fail(
            result.status === 422 ? 422 : 502,
            output.error ||
              output.detail ||
              "The image could not be read. Use a clearer photo or enter the medication manually.",
          );
      } catch (error) {
        if (error.status) throw error;
        fail(
          503,
          "Prescription reading is unavailable. You can still enter and review medications manually.",
        );
      }
      const patient = await store.get("patient", req.user.householdId);
      const colors = ["purple", "green", "amber", "blue"];
      const medications = (
        Array.isArray(output.medications) ? output.medications : []
      )
        .slice(0, 15)
        .map((m, i) => ({
          name: String(m.name || ""),
          strength: String(m.strength || ""),
          dose: String(m.dose || ""),
          frequency: String(m.frequency || ""),
          reviewRequired: true,
          instructions: String(m.instructions || ""),
          times: m.times || [],
          startDate: dateInZone(new Date(), patient.timeZone),
          durationDays: m.durationDays || 0,
          color: colors[i % colors.length],
        }));
      const draft = {
        id: newId(),
        householdId: req.user.householdId,
        filename: path.basename(req.file.originalname).slice(0, 150),
        text: String(output.text || "").slice(0, 30_000),
        engine: output.engine || "unknown",
        warning:
          output.warning ||
          "Review every field against the original prescription before confirming.",
        medications,
        status: "draft",
        version: 1,
        criticalityFlag: !!output.criticalityFlag,
        confidenceScore:
          typeof output.confidenceScore === "number"
            ? output.confidenceScore
            : null,
        createdAt: isoNow(),
      };
      await store.put("prescription", draft.id, draft, req.user.householdId);
      await audit(req.user.householdId, req.user, "prescription.extracted", {
        recordId: draft.id,
      });
      const { householdId, ...publicDraft } = draft;
      res.status(201).json(publicDraft);
    },
  );
  app.post("/api/prescriptions/:id/confirm", caregiver, async (req, res) =>
    exclusiveResponse(req.user.householdId, res, async () => {
      const draft = await owned("prescription", req.params.id, req.user);
      if (draft.status === "confirmed")
        fail(409, "This prescription was already confirmed.");
      const { medications, criticalityFlag = false } = z
        .object({
          medications: z.array(medSchema).min(1).max(15),
          criticalityFlag: z.boolean().optional(),
        })
        .parse(req.body);
      // Validate the entire prescription before saving any medication.
      const patient = await store.get("patient", req.user.householdId);
      const prepared = medications.map((med) =>
        prepareMedication(req.user, med, patient, "ocr", draft.id),
      );
      const created = [];
      for (const medication of prepared)
        created.push(await persistMedication(req.user, medication));
      draft.status = "confirmed";
      draft.confirmedAt = isoNow();
      draft.criticalityFlag = criticalityFlag;
      delete draft.text;
      delete draft.medications;
      await store.put("prescription", draft.id, draft, req.user.householdId);
      await audit(req.user.householdId, req.user, "prescription.confirmed", {
        recordId: draft.id,
      });
      res.status(201).json({ medications: created });
    }),
  );
  app.post("/api/care-team/invitations", caregiver, async (req, res) => {
    const { role, email } = z
      .object({
        role: z.enum(["caregiver", "patient", "doctor"]),
        email: z.email().max(254).optional(),
      })
      .parse(req.body);
    if (req.user.demo)
      fail(400, "Create a personal account to invite care team members.");
    const consent = await store.get("consent", req.user.householdId);
    if (role === "doctor" && !consent.clinician)
      fail(
        409,
        "Enable clinician sharing consent before inviting a clinician.",
      );
    if (role === "caregiver" && !consent.caregiver)
      fail(
        409,
        "Enable caregiver sharing consent before inviting another caregiver.",
      );
    const code = randomBytes(18).toString("base64url");
    const invitation = {
      id: hash(code),
      householdId: req.user.householdId,
      role,
      email: email?.toLowerCase(),
      createdBy: req.user.id,
      createdAt: isoNow(),
      expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      used: false,
    };
    await store.put(
      "invitation",
      invitation.id,
      invitation,
      req.user.householdId,
    );
    await audit(req.user.householdId, req.user, "care_team.invited");
    res.status(201).json({ code, expiresAt: invitation.expiresAt });
  });
  app.post("/api/care-team/join", async (req, res) => {
    if (req.user.demo)
      fail(400, "Create a personal account to join a household.");
    const { code } = z.object({ code: str(100) }).parse(req.body);
    await exclusiveResponse(`invitation:${hash(code)}`, res, async () => {
      const invitation = await store.get("invitation", hash(code));
      if (
        !invitation ||
        invitation.used ||
        Date.parse(invitation.expiresAt) < Date.now()
      )
        fail(400, "This invitation is invalid, expired, or already used.");
      if (invitation.email && invitation.email !== req.user.email.toLowerCase())
        fail(403, "This invitation is for a different email address.");
      const consent = await store.get("consent", invitation.householdId);
      if (invitation.role === "doctor" && !consent.clinician)
        fail(403, "Clinician sharing consent is no longer enabled.");
      if (invitation.role === "caregiver" && !consent.caregiver)
        fail(403, "Caregiver sharing consent is no longer enabled.");
      if (req.user.householdId === invitation.householdId)
        fail(409, "You already belong to this household.");
      const currentMedications = await store.list(
        "medication",
        req.user.householdId,
      );
      if (
        currentMedications.length ||
        (await store.list("checkin", req.user.householdId)).length ||
        (await store.list("prescription", req.user.householdId)).length
      )
        fail(
          409,
          "This account already contains recovery records. Use a separate account to accept this invitation.",
        );
      req.user.householdId = invitation.householdId;
      req.user.role = invitation.role;
      invitation.used = true;
      invitation.usedAt = isoNow();
      await store.put(
        "invitation",
        invitation.id,
        invitation,
        invitation.householdId,
      );
      await store.put("user", req.user.id, req.user, req.user.householdId);
      await audit(req.user.householdId, req.user, "care_team.joined");
      await issueSession(req, res, req.user);
      res.json(await sessionView(req.user));
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  const dist = path.resolve("dist");
  if (
    options.serveStatic !== false &&
    existsSync(path.join(dist, "index.html"))
  ) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(dist, "index.html")),
    );
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "The image is too large. Use an image under 4 MB."
            : "Upload one prescription image.",
      });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON request." });
    if (!error.status) console.error("RecoverTrack request failed. Check private service availability.");
    res.status(error.status || 500).json({
      error: error.status
        ? error.message
        : "Something went wrong. Please try again.",
    });
  });
  let timer;
  if (options.startWorker !== false) {
    timer = setInterval(async () => {
      try {
        for (const patient of await store.list("patient")) {
          const settings = await store.get("settings", patient.id);
          const consent = await store.get("consent", patient.id);
          if (consent?.app)
            await exclusive(patient.id, async () =>
              notifyHousehold(
                patient.id,
                await store.list("dose", patient.id),
                settings,
              ),
            );
        }
      } catch (error) {
        console.error("Reminder worker failed. Check private service availability.");
      }
    }, 30_000);
    timer.unref();
  }
  app.locals.store = store;
  app.locals.close = async () => {
    if (timer) clearInterval(timer);
    await store.close();
  };
  return app;
}

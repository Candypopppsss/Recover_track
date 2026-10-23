import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createWorker, OEM, PSM } from "tesseract.js";
import { z } from "zod";
import {
  addDays,
  dateInZone,
  validDate,
  validTimeZone,
} from "./scheduling.mjs";

const require = createRequire(import.meta.url);
const workerPath = require.resolve(
  "tesseract.js/src/worker-script/node/index.js",
);
const languagePath = require.resolve(
  "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const OCR_TIMEOUT_MS = 45_000;
const MODEL_VERSION = "attention-rules-v1";
const MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);
const MOBILITY_ORDER = { resting: 0, assisted: 1, independent: 2 };
const ELAPSED_STATUSES = new Set(["taken", "missed", "skipped"]);

const riskSchema = z.object({
  doses: z
    .array(
      z.object({
        scheduledAt: z
          .string()
          .refine(
            (value) =>
              /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
              Number.isFinite(Date.parse(value)),
            "scheduledAt must include a valid timezone",
          ),
        status: z.enum(["upcoming", "due", "taken", "missed", "skipped"]),
      }),
    )
    .max(5000)
    .default([]),
  checkIns: z
    .array(
      z.object({
        date: z.string().refine(validDate, "Enter a valid date"),
        pain: z.number().int().min(0).max(10),
        mobility: z.enum(["resting", "assisted", "independent"]),
      }),
    )
    .max(365)
    .default([]),
  timeZone: z
    .string()
    .max(100)
    .refine(validTimeZone, "Unknown IANA timezone")
    .default("Asia/Kolkata"),
});

// Match Python's nearest-even rounding at the score and percentage boundaries.
function roundEven(value, digits = 0) {
  const scale = 10 ** digits;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const rounded =
    scaled - floor === 0.5 ? floor + (floor % 2) : Math.round(scaled);
  return rounded / scale;
}

export function calculateRisk(input, now = new Date()) {
  const payload = riskSchema.parse(input);
  const timestamp = new Date(now).getTime();
  const today = dateInZone(new Date(timestamp), payload.timeZone);
  const doses = payload.doses
    .filter((dose) => {
      const time = Date.parse(dose.scheduledAt);
      return (
        time >= timestamp - 7 * 86400_000 &&
        time <= timestamp &&
        ELAPSED_STATUSES.has(dose.status)
      );
    })
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const daily = new Map();
  for (const checkIn of payload.checkIns) {
    if (checkIn.date >= addDays(today, -6) && checkIn.date <= today)
      daily.set(checkIn.date, checkIn);
  }
  const checkIns = [...daily.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const missed = doses.filter(
    (dose) => dose.status === "missed" || dose.status === "skipped",
  ).length;
  const rate = doses.length ? missed / doses.length : 0;
  let streak = 0;
  for (let index = doses.length - 1; index >= 0; index--) {
    if (doses[index].status === "taken") break;
    streak++;
  }
  const features = {
    observedDoses: doses.length,
    missedDoses: missed,
    missedRate: roundEven(rate, 4),
    currentMissedStreak: streak,
    recentCheckIns: checkIns.length,
  };
  const base = { experimental: true, modelVersion: MODEL_VERSION, features };
  if (doses.length < 3 && checkIns.length < 2) {
    return {
      ...base,
      score: null,
      level: "unavailable",
      explanation: [
        "Not enough recent records yet. At least 3 elapsed dose records or 2 daily check-ins are needed.",
        "This experimental attention indicator is not a diagnosis or a prediction of complications.",
      ],
    };
  }

  let score = rate * 50 + Math.min(streak, 3) * 5;
  const reasons = [];
  if (missed)
    reasons.push(
      `${missed} of ${doses.length} elapsed doses have no taken check-in in the last 7 days (${roundEven(rate * 100)}%).`,
    );
  else if (doses.length)
    reasons.push(
      `All ${doses.length} recorded elapsed doses were checked in as taken in the last 7 days.`,
    );
  if (streak >= 2)
    reasons.push(`The latest ${streak} elapsed doses are missed or skipped.`);
  if (checkIns.length) {
    const current = checkIns.at(-1);
    features.latestPain = current.pain;
    features.latestMobility = MOBILITY_ORDER[current.mobility];
    score += current.pain >= 7 ? 25 : current.pain >= 4 ? 10 : 0;
    reasons.push(`The latest self-reported pain score is ${current.pain}/10.`);
    score += { resting: 10, assisted: 5, independent: 0 }[current.mobility];
    if (checkIns.length >= 2) {
      const previous = checkIns.at(-2);
      const change = current.pain - previous.pain;
      features.painChange = change;
      if (change >= 2) {
        score += 15;
        reasons.push(
          `Reported pain rose by ${change} points since the previous daily check-in.`,
        );
      } else if (change <= -2)
        reasons.push(
          `Reported pain decreased by ${Math.abs(change)} points since the previous daily check-in.`,
        );
      if (
        MOBILITY_ORDER[current.mobility] < MOBILITY_ORDER[previous.mobility]
      ) {
        score += 10;
        reasons.push(
          `Reported mobility changed from ${previous.mobility} to ${current.mobility}.`,
        );
      }
    }
    if (current.mobility === "resting")
      reasons.push(
        "The latest check-in reports mostly resting. Expected mobility depends on the prescribed recovery plan.",
      );
    else if (current.mobility === "assisted")
      reasons.push("The latest check-in reports moving with assistance.");
    else reasons.push("The latest check-in reports moving independently.");
    if (current.date < addDays(today, -1))
      reasons.push(
        "The latest daily check-in is more than one day old; current symptoms are unknown.",
      );
  } else
    reasons.push(
      "No daily pain or mobility check-ins are available for the last 7 days.",
    );
  const rounded = Math.max(0, Math.min(100, roundEven(score)));
  reasons.push(
    "Experimental rule-based attention indicator; not a diagnosis, probability, or medication instruction.",
  );
  return {
    ...base,
    score: rounded,
    level: rounded >= 55 ? "high" : rounded >= 25 ? "moderate" : "low",
    explanation: reasons,
  };
}

const STRENGTH =
  /\b\d+(?:\.\d+)?\s*(?:mcg|μg|ug|mg|g|ml|iu|units?)(?:\s*\/\s*\d*\s*ml)?\b/i;
const DOSE =
  /\b\d+(?:\.\d+)?\s*(?:tablets?|tabs?|capsules?|caps?|puffs?|drops?|sachets?|spoonfuls?|tsp)\b/i;
const DURATION = /\b(?:for\s+|x\s*)?(\d{1,3})\s*(days?|weeks?)\b/i;
const FREQUENCY =
  /\b(?:once\s+daily|twice\s+daily|three\s+times\s+(?:daily|a\s+day)|four\s+times\s+(?:daily|a\s+day)|morning|afternoon|evening|at\s+night|night|daily|OD|BD|BID|TID|TDS|QID|every\s+\d+\s+hours?)\b/i;
const NAME_PREFIX =
  /^\s*(?:(?:\d+[.)]|[-•*])\s*)?(?:(?:tab(?:let)?|cap(?:sule)?|syrup|inj(?:ection)?)\.?\s+)?/i;
const NO_NAME =
  /^(?:patient|doctor|dr|date|address|hospital|clinic|age|name|prescription|rx|take|use|apply|continue|instructions|frequency|duration|morning|afternoon|evening|night|for|after|before|once|twice|three|every)\b/i;
const stripSeparators = (value) => value.replace(/^[ |,;:-]+|[ |,;:-]+$/g, "");

export function parsePrescription(text) {
  const candidates = [];
  const lines = text
    .split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const groups = [];
  for (const line of lines) {
    const startsMedicine =
      STRENGTH.test(line) && !NO_NAME.test(line.replace(NAME_PREFIX, ""));
    const startsNamed =
      /^(?:MED[- ]?[A-Z]\b|(?:tab(?:let)?|cap(?:sule)?|syrup)\.?\s+\S)/i.test(
        line,
      );
    const continuation =
      DOSE.test(line) ||
      DURATION.test(line) ||
      FREQUENCY.test(line) ||
      /^(?:after|before|with)\s+(?:food|meals?)/i.test(line);
    if (groups.length && continuation && !startsMedicine && !startsNamed)
      groups[groups.length - 1] += ` | ${line}`;
    else groups.push(line);
  }
  for (const line of groups) {
    if (candidates.length >= 30) break;
    const strength = STRENGTH.exec(line);
    if (!strength) continue;
    const prefix = stripSeparators(line.slice(0, strength.index));
    const name = stripSeparators(prefix.replace(NAME_PREFIX, ""));
    if (
      !name ||
      name.length > 120 ||
      NO_NAME.test(name) ||
      !/[A-Za-z]/.test(name)
    )
      continue;
    const dose = DOSE.exec(line);
    const duration = DURATION.exec(line);
    const frequency = FREQUENCY.exec(line);
    let days = duration
      ? Number(duration[1]) * (/^week/i.test(duration[2]) ? 7 : 1)
      : null;
    if (days !== null && (days < 1 || days > 180)) days = null;
    const instructions =
      /\b(?:after|before|with|without)\s+(?:food|meals?|breakfast|lunch|dinner|water)\b[^|;]*/i
        .exec(line)?.[0]
        .trim() || "";
    candidates.push({
      name,
      strength: strength[0].trim(),
      dose: dose?.[0].trim() || "",
      frequency: frequency?.[0].trim() || "",
      instructions,
      times: [
        ...new Set(line.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) || []),
      ].sort(),
      durationDays: days,
      reviewRequired: true,
    });
  }
  return candidates;
}

class IntelligenceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function prepareImage(data) {
  const image = sharp(data, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    failOn: "error",
  });
  try {
    const metadata = await image.metadata();
    if ((metadata.pages || 1) > 1)
      throw new IntelligenceError(
        415,
        "Upload a single-page image, not an animated or multipage file",
      );
    if (!["jpeg", "png", "webp", "tiff"].includes(metadata.format))
      throw new IntelligenceError(
        415,
        "Upload a JPG, PNG, WebP, or TIFF image",
      );
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    )
      throw new IntelligenceError(
        413,
        "Image exceeds 20 megapixels; resize it before uploading",
      );
    return await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .png()
      .toBuffer();
  } catch (error) {
    if (error instanceof IntelligenceError) throw error;
    if (/pixel limit/i.test(error.message))
      throw new IntelligenceError(
        413,
        "Image exceeds 20 megapixels; resize it before uploading",
      );
    throw new IntelligenceError(415, "The file is not a valid supported image");
  } finally {
    image.destroy();
  }
}

async function recognizeImage(data) {
  const image = await prepareImage(data);
  let worker;
  let timer;
  const pendingWorker = createWorker("eng", OEM.LSTM_ONLY, {
    workerPath,
    langPath: path.dirname(languagePath),
    gzip: true,
    cacheMethod: "none",
    errorHandler: () => {},
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new IntelligenceError(
            504,
            "OCR timed out; try a smaller, clearer photo or enter details manually",
          ),
        ),
      OCR_TIMEOUT_MS,
    );
    timer.unref();
  });
  try {
    const recognition = (async () => {
      worker = await pendingWorker;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const { data: result } = await worker.recognize(
        image,
        {},
        { text: true, tsv: true },
      );
      const confidences = (result.tsv || "")
        .split("\n")
        .slice(1)
        .flatMap((line) => {
          const columns = line.split("\t");
          const confidence = Number(columns[10]);
          return columns[11]?.trim() &&
            Number.isFinite(confidence) &&
            confidence >= 0
            ? [confidence]
            : [];
        });
      return {
        text: (result.text || "").slice(0, 50_000),
        confidence: confidences.length
          ? roundEven(
              confidences.reduce((sum, value) => sum + value, 0) /
                confidences.length /
                100,
              3,
            )
          : null,
      };
    })();
    return await Promise.race([recognition, timeout]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
    else
      pendingWorker.then(
        (created) => created.terminate(),
        () => {},
      );
  }
}

function authorized(request, expected) {
  if (!expected) return true;
  const actual = Buffer.from(request.headers.get("x-internal-token") || "");
  const saved = Buffer.from(expected);
  return actual.length === saved.length && timingSafeEqual(actual, saved);
}

export function createIntelligenceRequest({
  internalToken = process.env.INTERNAL_SERVICE_TOKEN || "",
  now = () => new Date(),
} = {}) {
  return async function intelligenceRequest(input, init) {
    const request = new Request(input, init);
    const route = new URL(request.url).pathname;
    if (request.method === "GET" && route === "/health") {
      return Response.json({
        status: "ok",
        ocr: "tesseract.js",
        ocrAvailable: existsSync(workerPath) && existsSync(languagePath),
        risk: MODEL_VERSION,
        experimental: true,
      });
    }
    if (!authorized(request, internalToken))
      return Response.json(
        { detail: "Internal authentication required" },
        { status: 401 },
      );
    try {
      if (request.method === "POST" && route === "/risk")
        return Response.json(calculateRisk(await request.json(), now()));
      if (request.method === "POST" && route === "/ocr") {
        const file = (await request.formData()).get("file");
        if (!file || typeof file.arrayBuffer !== "function")
          throw new IntelligenceError(422, "Choose a prescription image");
        if (!MIME_TYPES.has(file.type))
          throw new IntelligenceError(
            415,
            "Upload a JPG, PNG, WebP, or TIFF image",
          );
        if (file.size === 0)
          throw new IntelligenceError(400, "The uploaded file is empty");
        if (file.size > MAX_UPLOAD_BYTES)
          throw new IntelligenceError(413, "Image must be 4 MB or smaller");
        const { text, confidence } = await recognizeImage(
          Buffer.from(await file.arrayBuffer()),
        );
        return Response.json({
          text,
          engine: "tesseract.js",
          confidenceScore: confidence,
          confidenceMeaning:
            confidence === null
              ? null
              : "Mean OCR word confidence; not medication-field accuracy",
          criticalityFlag: true,
          warning: text.trim()
            ? "Draft only. Review every medication, strength, dose, exact time, and duration against the original prescription before confirming. OCR confidence is not clinical accuracy."
            : "No readable text was found. Retake a clearer photo or enter the medication details manually.",
          medications: parsePrescription(text),
        });
      }
      return Response.json(
        { detail: "Intelligence endpoint not found" },
        { status: 404 },
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        return Response.json(
          {
            detail: error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; "),
          },
          { status: 422 },
        );
      if (error instanceof SyntaxError || error instanceof TypeError)
        return Response.json(
          { detail: "Invalid intelligence request" },
          { status: 400 },
        );
      if (error instanceof IntelligenceError)
        return Response.json(
          { detail: error.message },
          { status: error.status },
        );
      console.error("Local OCR failed:", error.name);
      return Response.json(
        {
          detail:
            "Prescription reading is unavailable. Enter the medication manually.",
        },
        { status: 503 },
      );
    }
  };
}

export const intelligenceRequest = createIntelligenceRequest();

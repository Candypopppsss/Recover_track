import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  FileImage,
  ImageUp,
  Info,
  Plus,
  ScanLine,
  Trash2,
  Upload,
  X,
  PencilLine,
} from "lucide-react";
import { api, post, patch } from "../api";
import { todayInZone, useApp } from "../context";
import type { Color, Medication } from "../types";
import { Modal, Spinner } from "./ui";
interface Draft {
  name: string;
  strength: string;
  dose: string;
  instructions: string;
  times: string[];
  startDate: string;
  durationDays: number | string;
  color: Color;
  reviewed: boolean;
  frequency?: string;
}
interface UploadResult {
  id: string;
  filename: string;
  text: string;
  engine: string;
  warning: string;
  medications: Partial<Draft>[];
  criticalityFlag?: boolean;
  confidenceScore?: number | null;
}
export default function PrescriptionModal({
  onClose,
  medication,
}: {
  onClose: () => void;
  medication?: Medication;
}) {
  const { state, refresh, notify } = useApp();
  const today = todayInZone(state.patient.timeZone);
  const blank = (): Draft => ({
    name: "",
    strength: "",
    dose: "",
    instructions: "",
    times: [""],
    startDate: today,
    durationDays: "",
    color: "purple",
    reviewed: false,
  });
  const [mode, setMode] = useState<"upload" | "manual">(
    medication ? "manual" : "upload",
  );
  const [drafts, setDrafts] = useState<Draft[]>(
    medication ? [{ ...medication, reviewed: false }] : [blank()],
  );
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  function update(
    index: number,
    field: keyof Draft,
    value: Draft[keyof Draft],
  ) {
    setDrafts((items) =>
      items.map((item, i) =>
        i === index
          ? {
              ...item,
              [field]: value,
              ...(field !== "reviewed" ? { reviewed: false } : {}),
            }
          : item,
      ),
    );
  }
  async function readFile(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError(
        "Please choose a JPG, PNG, or WebP image. PDF and HEIC are not supported.",
      );
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Upload an image of 4 MB or less.");
      return;
    }
    setBusy(true);
    const data = new FormData();
    data.append("file", file);
    try {
      const result = await api<UploadResult>("/prescriptions/upload", {
        method: "POST",
        body: data,
      });
      setUpload(result);
      setDrafts(
        result.medications.length
          ? result.medications.map((m) => ({
              ...blank(),
              ...m,
              startDate: m.startDate || today,
              times: m.times?.length ? m.times : [""],
              durationDays: m.durationDays || "",
              reviewed: false,
            }))
          : [blank()],
      );
      setMode("manual");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!drafts.every((d) => d.reviewed)) {
      setError(
        "Review and confirm every medication against the original prescription.",
      );
      return;
    }
    setError("");
    setBusy(true);
    const payload = drafts.map((d) => ({
      name: d.name,
      strength: d.strength,
      dose: d.dose,
      instructions: d.instructions,
      startDate: d.startDate,
      durationDays: Number(d.durationDays),
      color: d.color,
      times: [...new Set(d.times)].sort(),
      reviewed: true,
    }));
    try {
      if (medication) await patch(`/medications/${medication.id}`, payload[0]);
      else if (upload)
        await post(`/prescriptions/${upload.id}/confirm`, {
          medications: payload,
        });
      else await post("/medications/batch", { medications: payload });
      await refresh();
      notify(
        medication
          ? "Medication details updated."
          : "Prescription confirmed and schedule created.",
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        medication
          ? "Review medication details"
          : upload
            ? "Review extracted details"
            : "Add a prescription"
      }
      subtitle={
        medication
          ? "Use the prescribed instructions to check every field."
          : upload
            ? "OCR creates a draft. You confirm the details before a schedule starts."
            : "Upload a prescription image or enter the prescribed details."
      }
      onClose={onClose}
      wide
      footer={
        <>
          <span className="modal-footer-note">
            <Info size={14} />
            Schedules start only after your review.
          </span>
          <button
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {mode === "manual" && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => form.current?.requestSubmit()}
            >
              {busy ? <Spinner /> : <Check size={16} />}Confirm &{" "}
              {medication ? "save" : "create schedule"}
            </button>
          )}
        </>
      }
    >
      {!medication && !upload && (
        <div className="prescription-tabs">
          <button
            className={mode === "upload" ? "active" : ""}
            onClick={() => setMode("upload")}
          >
            <ScanLine size={17} />
            Scan a prescription
          </button>
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            <PencilLine size={17} />
            Enter details manually
          </button>
        </div>
      )}
      {mode === "upload" ? (
        <>
          <div
            className={`upload-zone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              readFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-zone-icon">
              {busy ? (
                <Spinner label="Reading prescription" />
              ) : (
                <ImageUp size={30} />
              )}
            </span>
            <h3>
              {busy
                ? "Reading your prescription…"
                : "Upload a prescription image"}
            </h3>
            <p>
              {busy
                ? "Reading the image. Review the extracted fields before confirming."
                : "Drag an image here or choose a file."}
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload size={16} />
              Choose prescription image
            </button>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => readFile(e.target.files?.[0])}
              aria-label="Prescription image"
            />
            <small>JPG, PNG or WebP · Up to 4 MB</small>
          </div>
          <p className="subtle-note">
            <Info size={13} />
            Images are deleted after extraction. Enter unclear or handwritten
            details manually.
          </p>
        </>
      ) : (
        <form onSubmit={submit} ref={form} className="form-stack">
          {upload && (
            <>
              <div className="upload-state">
                <FileImage size={22} />
                <div>
                  <strong>{upload.filename}</strong>
                  <span>Read with {upload.engine} · Draft only</span>
                </div>
                <span className="badge purple">Ready for review</span>
              </div>
              {upload.criticalityFlag && (
                <p className="review-warning">
                  <Info size={16} />
                  Verify the highlighted prescription fields against the
                  original. OCR confidence does not establish that they are
                  correct.
                </p>
              )}
              {upload.warning && (
                <p className="review-warning">
                  <Info size={16} />
                  {upload.warning}
                </p>
              )}
              <details className="raw-text">
                <summary>See extracted prescription text</summary>
                <pre>
                  {upload.text ||
                    "No readable text found. Enter the details from the original prescription below."}
                </pre>
              </details>
            </>
          )}
          {drafts.map((draft, index) => (
            <section className="review-medication" key={index}>
              <div className="review-medication-heading">
                <h3>
                  <span className={`dose-icon ${draft.color}`}>
                    <PencilLine size={17} />
                  </span>
                  {drafts.length > 1
                    ? `Medication ${index + 1}`
                    : "Medication details"}
                </h3>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() =>
                      setDrafts((items) => items.filter((_, i) => i !== index))
                    }
                    aria-label={`Remove medication ${index + 1}`}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
              <div className="field-row">
                <label className="field">
                  Medication name
                  <input
                    required
                    value={draft.name}
                    onChange={(e) => update(index, "name", e.target.value)}
                    placeholder="Exactly as prescribed"
                    maxLength={120}
                  />
                </label>
                <label className="field">
                  Strength
                  <input
                    required
                    value={draft.strength}
                    onChange={(e) => update(index, "strength", e.target.value)}
                    placeholder="e.g. 10 mg"
                    maxLength={60}
                  />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  Amount per dose
                  <input
                    required
                    value={draft.dose}
                    onChange={(e) => update(index, "dose", e.target.value)}
                    placeholder="e.g. 1 tablet"
                    maxLength={80}
                  />
                </label>
                <label className="field">
                  Instructions
                  <input
                    value={draft.instructions}
                    onChange={(e) =>
                      update(index, "instructions", e.target.value)
                    }
                    placeholder="e.g. After food, as prescribed"
                    maxLength={500}
                  />
                </label>
              </div>
              <div className="field-row">
                <label className="field">
                  Start date
                  <input
                    type="date"
                    required
                    value={draft.startDate}
                    onChange={(e) => update(index, "startDate", e.target.value)}
                  />
                </label>
                <label className="field">
                  Duration in days
                  <input
                    type="number"
                    min={1}
                    max={90}
                    required
                    value={draft.durationDays}
                    onChange={(e) =>
                      update(index, "durationDays", e.target.value)
                    }
                    placeholder="As prescribed"
                  />
                </label>
              </div>
              <label className="field">
                Daily dose times <span>({state.patient.timeZone})</span>
              </label>
              {draft.frequency && (
                <p className="subtle-note">
                  Read as: {draft.frequency}. Choose exact times from the
                  prescribed plan.
                </p>
              )}
              <div className="time-inputs">
                {draft.times.map((time, t) => (
                  <div className="time-input" key={t}>
                    <input
                      type="time"
                      required
                      value={time}
                      onChange={(e) =>
                        update(
                          index,
                          "times",
                          draft.times.map((v, i) =>
                            i === t ? e.target.value : v,
                          ),
                        )
                      }
                      aria-label={`Dose time ${t + 1} for medication ${index + 1}`}
                    />
                    {draft.times.length > 1 && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() =>
                          update(
                            index,
                            "times",
                            draft.times.filter((_, i) => i !== t),
                          )
                        }
                        aria-label={`Remove dose time ${t + 1}`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {draft.times.length < 6 && (
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => update(index, "times", [...draft.times, ""])}
                  >
                    <Plus size={14} />
                    Add time
                  </button>
                )}
              </div>
              <div className="color-field">
                <span>Schedule color</span>
                {(["purple", "green", "amber", "blue"] as Color[]).map(
                  (color) => (
                    <button
                      type="button"
                      aria-label={`Use ${color} color`}
                      aria-pressed={draft.color === color}
                      className={`color-option ${color} ${draft.color === color ? "selected" : ""}`}
                      key={color}
                      onClick={() => update(index, "color", color)}
                    >
                      {draft.color === color && <Check size={13} />}
                    </button>
                  ),
                )}
              </div>
              <label className="check-row review-confirmation">
                <input
                  type="checkbox"
                  checked={draft.reviewed}
                  onChange={(e) => update(index, "reviewed", e.target.checked)}
                  required
                />
                <span>
                  I checked the name, strength, dose, times and duration against
                  the original prescription.
                </span>
              </label>
            </section>
          ))}
          {!medication && (
            <button
              type="button"
              className="button ghost add-medication"
              onClick={() => setDrafts((items) => [...items, blank()])}
            >
              <Plus size={16} />
              Add another medication
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

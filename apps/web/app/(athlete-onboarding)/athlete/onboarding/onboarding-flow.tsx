"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import type { BackfillStatusColumn } from "@da2/shared";

// ────────────────────────────────────────────────────────────────────────
// Types & constants

type SportId = "tri" | "run" | "bike" | "swim";
type StepId = "welcome" | "name" | "hours" | "event" | "strava" | "profile";

export interface InitialState {
  email: string;
  nickname: string;
  primarySport: SportId;
  weeklyHours: number;
  trainingPattern: string;
  eventType: string;
  eventDate: string | null; // YYYY-MM-DD
  stravaConnected: boolean;
  backfillStatus: BackfillStatusColumn;
  initialStep?: string;
  stravaJustConnected: boolean;
  stravaError?: string;
}

const STEPS: { id: StepId; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "name", label: "Profile" },
  { id: "hours", label: "Hours" },
  { id: "event", label: "Event" },
  { id: "strava", label: "Strava" },
  { id: "profile", label: "Done" },
];

const PROGRESS_STEPS: StepId[] = ["name", "hours", "event", "strava"];
const PROGRESS_LABEL: Record<StepId, string> = {
  welcome: "Welcome",
  name: "Profile",
  hours: "Hours",
  event: "Event",
  strava: "Strava",
  profile: "Done",
};

const SPORTS: { id: SportId; name: string; meta: string }[] = [
  { id: "tri", name: "Triathlon", meta: "Multi-sport · brick days" },
  { id: "run", name: "Run", meta: "5K → marathon" },
  { id: "bike", name: "Bike", meta: "Road / gravel / track" },
  { id: "swim", name: "Swim", meta: "Pool & open water" },
];

const EVENT_TYPES = [
  "5K",
  "10K",
  "Half marathon",
  "Marathon",
  "Sprint Tri",
  "Olympic Tri",
  "70.3",
  "Ironman",
];

const PATTERNS = ["Even split", "Mostly weekends", "Mornings only", "Evenings"];

// ────────────────────────────────────────────────────────────────────────
// Tiny SVG helpers

function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11 18 5 12 11 6" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const SportGlyphs: Record<SportId, JSX.Element> = {
  tri: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 13c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M3 19c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
    </svg>
  ),
  run: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="13" cy="4.5" r="1.6" />
      <path d="M8 21l3-5 3 2 2 3" />
      <path d="M11 9l3-2 3 3-2 3-3-1-2 4" />
    </svg>
  ),
  bike: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M5.5 17.5L11 8h5l-2 4 4.5 5.5" />
      <circle cx="14" cy="5" r="1.2" />
    </svg>
  ),
  swim: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="17" cy="6.5" r="1.6" />
      <path d="M3 18c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
      <path d="M5 13l4-2 5 1 5-3" />
    </svg>
  ),
};

// ────────────────────────────────────────────────────────────────────────
// Helpers

function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  // Local-time midnight on that calendar day — avoids timezone slippage
  // that would make "today" render as yesterday in negative-UTC zones.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function clampStep(raw: string | undefined): StepId {
  if (!raw) return "welcome";
  return STEPS.some((s) => s.id === raw) ? (raw as StepId) : "welcome";
}

// ────────────────────────────────────────────────────────────────────────
// Save helper — fire-and-forget POST to /api/onboarding/save.

interface SavePayload {
  nickname?: string;
  primary_sport?: SportId;
  weekly_hours_avail?: number;
  training_pattern?: string;
  target_event?: { type: string; date: string } | null;
  completed?: boolean;
}

async function saveOnboarding(payload: SavePayload): Promise<void> {
  try {
    await fetch("/api/onboarding/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network failures during onboarding shouldn't block the user from
    // continuing — we'll write again at "Open dashboard".
  }
}

// ────────────────────────────────────────────────────────────────────────
// Top-level flow

export function OnboardingFlow({ initial }: { initial: InitialState }) {
  // ── State ──
  const [stepId, setStepId] = useState<StepId>(() => clampStep(initial.initialStep));
  const [name, setName] = useState(initial.nickname);
  const [sport, setSport] = useState<SportId>(initial.primarySport);
  const [hours, setHours] = useState(initial.weeklyHours);
  const [pattern, setPattern] = useState(initial.trainingPattern);
  const [eventType, setEventType] = useState(initial.eventType);
  const [eventDate, setEventDate] = useState<Date | null>(
    parseLocalDate(initial.eventDate)
  );

  // Strava live state — `stravaConnected` reflects the actual strava_tokens
  // row (real OAuth state). `backfillStatus` is fed by polling
  // /api/onboarding/strava-status once OAuth completes in this flow.
  const [stravaConnected, setStravaConnected] = useState(initial.stravaConnected);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatusColumn>(
    initial.backfillStatus ?? {}
  );

  // "Did the user complete OAuth in THIS onboarding session?"
  // Flipped on ONLY when /api/integrations/strava/callback redirects back
  // with ?strava_connected=1 (server re-renders with initial.stravaJustConnected = true).
  // A pre-existing strava_tokens row (from a prior session or the dashboard
  // toggle) does NOT unlock the import UI — we require explicit consent in
  // this flow so the user knows they're handing us a Strava authorization
  // right now. No setter — the only transition path is a server re-render
  // after OAuth callback.
  const connectedInFlow = initial.stravaJustConnected;

  const stepIndex = STEPS.findIndex((s) => s.id === stepId);

  // ── Strava status polling: runs only after explicit in-flow OAuth. ──
  useEffect(() => {
    if (stepId !== "strava") return;
    if (!connectedInFlow) return;
    if (backfillStatus.state === "complete") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/onboarding/strava-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          connected: boolean;
          backfill_status: BackfillStatusColumn;
        };
        if (cancelled) return;
        setStravaConnected(body.connected);
        setBackfillStatus(body.backfill_status ?? {});
      } catch {
        // ignore — try again next tick
      }
    };
    void poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [stepId, connectedInFlow, backfillStatus.state]);

  // ── Navigation ──
  const goto = useCallback((id: StepId) => {
    setStepId(id);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const next = useCallback(() => {
    const i = STEPS.findIndex((s) => s.id === stepId);
    if (i < STEPS.length - 1) goto(STEPS[i + 1].id);
  }, [stepId, goto]);

  const back = useCallback(() => {
    const i = STEPS.findIndex((s) => s.id === stepId);
    if (i > 0) goto(STEPS[i - 1].id);
  }, [stepId, goto]);

  // ── Per-step persistence ──
  const onContinueName = useCallback(() => {
    void saveOnboarding({ nickname: name.trim(), primary_sport: sport });
    next();
  }, [name, sport, next]);

  const onContinueHours = useCallback(() => {
    void saveOnboarding({
      weekly_hours_avail: hours,
      training_pattern: pattern,
    });
    next();
  }, [hours, pattern, next]);

  const onContinueEvent = useCallback(() => {
    if (eventType && eventDate) {
      void saveOnboarding({
        target_event: { type: eventType, date: toIsoDate(eventDate) },
      });
    }
    next();
  }, [eventType, eventDate, next]);

  const onNoEvent = useCallback(() => {
    setEventType("");
    setEventDate(null);
    void saveOnboarding({ target_event: null });
    goto("strava");
  }, [goto]);

  const onConnectStrava = useCallback(() => {
    window.location.href =
      "/api/integrations/strava/authorize?next=" +
      encodeURIComponent("/athlete/onboarding?step=strava");
  }, []);

  const onSkipStrava = useCallback(() => {
    goto("profile");
  }, [goto]);

  const onOpenDashboard = useCallback(() => {
    void saveOnboarding({ completed: true }).then(() => {
      window.location.href = "/athlete";
    });
  }, []);

  // ── Render the active screen ──
  let screen: JSX.Element;
  switch (stepId) {
    case "welcome":
      screen = <WelcomeScreen onStart={() => goto("name")} />;
      break;
    case "name":
      screen = (
        <NameScreen
          name={name}
          sport={sport}
          onName={setName}
          onSport={setSport}
          onNext={onContinueName}
          onBack={() => goto("welcome")}
        />
      );
      break;
    case "hours":
      screen = (
        <HoursScreen
          hours={hours}
          pattern={pattern}
          onHours={setHours}
          onPattern={setPattern}
          onNext={onContinueHours}
          onBack={back}
        />
      );
      break;
    case "event":
      screen = (
        <EventScreen
          eventType={eventType}
          eventDate={eventDate}
          onType={setEventType}
          onDate={setEventDate}
          onNoEvent={onNoEvent}
          onNext={onContinueEvent}
          onBack={back}
        />
      );
      break;
    case "strava":
      screen = (
        <StravaScreen
          email={initial.email}
          connectedInFlow={connectedInFlow}
          alreadyConnected={stravaConnected}
          backfill={backfillStatus}
          error={initial.stravaError}
          onConnect={onConnectStrava}
          onSkip={onSkipStrava}
          onNext={() => goto("profile")}
          onBack={back}
        />
      );
      break;
    case "profile":
    default:
      screen = (
        <ProfileScreen
          state={{
            name,
            sport,
            hours,
            pattern,
            eventType,
            eventDate,
            stravaConnected,
            backfill: backfillStatus,
          }}
          onOpenDashboard={onOpenDashboard}
        />
      );
      break;
  }

  const showProgress = PROGRESS_STEPS.includes(stepId) || stepId === "profile";

  return (
    <div className="onboarding-root">
      <OnboardingStyles />
      <div className="page">
        <header className="site-header">
          <div className="site-header-inner">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true" />
              <span className="brand-name">DA2</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="header-meta">
                {stepIndex < 5 ? "Setup" : "Welcome aboard"}
              </span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => { window.location.href = "/athlete"; }}
              >
                Exit
              </button>
            </div>
          </div>
        </header>

        {showProgress && <ProgressStrip stepId={stepId} />}

        <div className="flow" key={stepId}>
          {screen}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Progress strip

function ProgressStrip({ stepId }: { stepId: StepId }) {
  const progressIdx = PROGRESS_STEPS.indexOf(stepId);
  const inProgress = progressIdx >= 0;
  const completed = stepId === "profile";
  const pct = completed
    ? 100
    : inProgress
      ? ((progressIdx + 1) / PROGRESS_STEPS.length) * 100
      : 0;

  return (
    <div className="progress-strip">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <div className="crumbs">
          {PROGRESS_STEPS.map((s, i) => {
            const cls =
              completed || i < progressIdx
                ? "done"
                : i === progressIdx
                  ? "now"
                  : "";
            return (
              <span key={s} className="crumb-wrap">
                <span className={cls}>{PROGRESS_LABEL[s]}</span>
                {i < PROGRESS_STEPS.length - 1 && (
                  <span className="sep" aria-hidden="true">
                    ·
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <span>
          {completed
            ? "Complete"
            : inProgress
              ? `Step ${progressIdx + 1} of ${PROGRESS_STEPS.length}`
              : ""}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Footer actions row

function FooterActions({
  onNext,
  onBack,
  disabled,
  primaryLabel = "Continue",
}: {
  onNext: () => void;
  onBack: () => void;
  disabled?: boolean;
  primaryLabel?: string;
}) {
  return (
    <div className="actions">
      <div className="actions-row">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNext}
          disabled={disabled}
        >
          {primaryLabel}
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Welcome

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="panel">
      <span className="eyebrow">DA2 · Endurance training</span>
      <h1 className="display">Let&apos;s build your training profile.</h1>
      <p className="lead">
        Four quick questions, then we&apos;ll pull your last 200 workouts from
        Strava and set realistic paces. Takes about a minute.
      </p>

      <div className="hero-rings">
        <span className="dot" aria-hidden="true" />
      </div>

      <ul className="welcome-bullets">
        <li>
          <span className="num">01</span>
          <span>Who you are &amp; primary sport</span>
        </li>
        <li>
          <span className="num">02</span>
          <span>How many hours you can train each week</span>
        </li>
        <li>
          <span className="num">03</span>
          <span>The race you&apos;re pointing at (or no race — that&apos;s fine)</span>
        </li>
        <li>
          <span className="num">04</span>
          <span>Connect Strava so your plan adapts to what you actually do</span>
        </li>
      </ul>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onStart}>
          Start setup
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Name + Sport

function NameScreen({
  name,
  sport,
  onName,
  onSport,
  onNext,
  onBack,
}: {
  name: string;
  sport: SportId;
  onName: (v: string) => void;
  onSport: (v: SportId) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const ready = name.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="panel">
      <span className="eyebrow">01 · Tell us about you</span>
      <h1 className="display">What should we call you?</h1>
      <p className="lead">
        Just a first name or nickname is fine. We&apos;ll use it on your
        dashboard and any plans you share.
      </p>

      <div className="group">
        <label className="label" htmlFor="nickname-input">
          Nickname
        </label>
        <input
          ref={inputRef}
          id="nickname-input"
          className="input"
          placeholder="e.g. Sam"
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) onNext();
          }}
        />
      </div>

      <div className="group">
        <span className="label">Primary sport</span>
        <div className="sport-grid">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sport-tile ${sport === s.id ? "selected" : ""}`}
              onClick={() => onSport(s.id)}
            >
              <span className="sport-glyph">{SportGlyphs[s.id]}</span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="sport-name">{s.name}</span>
                <span className="sport-meta">{s.meta}</span>
              </span>
            </button>
          ))}
        </div>
        <span className="hint">
          You can add other sports later. We&apos;ll bias the plan toward this
          one.
        </span>
      </div>

      <FooterActions onNext={onNext} onBack={onBack} disabled={!ready} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Hours

function HoursScreen({
  hours,
  pattern,
  onHours,
  onPattern,
  onNext,
  onBack,
}: {
  hours: number;
  pattern: string;
  onHours: (v: number) => void;
  onPattern: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="panel">
      <span className="eyebrow">02 · Weekly availability</span>
      <h1 className="display">How many hours per week can you train?</h1>
      <p className="lead">
        Honesty beats ambition. We&apos;ll start where you are and ramp up
        gradually. You can edit this anytime.
      </p>

      <div className="hours-card">
        <div className="hours-value">
          <span className="n">{hours}</span>
          <span className="u">hrs / week</span>
        </div>
        <input
          className="slider"
          type="range"
          min={2}
          max={20}
          step={1}
          value={hours}
          onChange={(e) => onHours(parseInt(e.target.value, 10))}
        />
        <div className="slider-ticks">
          {[2, 5, 8, 12, 15, 20].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="label">When do you usually train?</span>
        <div className="pattern-row">
          {PATTERNS.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${pattern === p ? "selected" : ""}`}
              onClick={() => onPattern(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <FooterActions onNext={onNext} onBack={onBack} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Event

function EventScreen({
  eventType,
  eventDate,
  onType,
  onDate,
  onNoEvent,
  onNext,
  onBack,
}: {
  eventType: string;
  eventDate: Date | null;
  onType: (v: string) => void;
  onDate: (v: Date) => void;
  onNoEvent: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const ready = Boolean(eventType && eventDate);
  return (
    <div className="panel is-event">
      <span className="eyebrow">03 · Target event</span>
      <h1 className="display">Got a race on the calendar?</h1>
      <p className="lead">
        Pick your event and date — we&apos;ll back-plan from race day. No event?
        We&apos;ll build a base-fitness plan instead.
      </p>

      <div className="group">
        <span className="label">Event type</span>
        <div className="chips">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`chip ${eventType === t ? "selected" : ""}`}
              onClick={() => onType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <span className="label">Event date</span>
        <DatePicker selected={eventDate} onSelect={onDate} />
      </div>

      <button type="button" className="skip-card" onClick={onNoEvent}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="k">No event yet</span>
          <span className="s">
            Build a base-fitness plan I can convert when I pick a race.
          </span>
        </span>
        <span style={{ color: "var(--color-ink-muted)" }}>
          <ArrowRight />
        </span>
      </button>

      <FooterActions onNext={onNext} onBack={onBack} disabled={!ready} />
    </div>
  );
}

function DatePicker({
  selected,
  onSelect,
}: {
  selected: Date | null;
  onSelect: (d: Date) => void;
}) {
  const today = useMemo(() => startOfToday(), []);
  const [month, setMonth] = useState(() => {
    const base = selected ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = month.getFullYear();
  const m = month.getMonth();
  const monthName = month.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Monday-first DOW index.
  const firstDow = (new Date(year, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const prevMonthDays = new Date(year, m, 0).getDate();

  type Cell = { n: number; dim: true } | { n: number; dim: false; date: Date };
  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ n: prevMonthDays - firstDow + 1 + i, dim: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ n: d, dim: false, date: new Date(year, m, d) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ n: cells.length - daysInMonth - firstDow + 1, dim: true });
  }

  const isSelected = (d: Date) =>
    selected !== null &&
    d.getFullYear() === selected.getFullYear() &&
    d.getMonth() === selected.getMonth() &&
    d.getDate() === selected.getDate();

  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <div className="date-card">
      <div className="date-head">
        <span className="date-month">{monthName}</span>
        <div className="date-nav">
          <button
            type="button"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
            aria-label="Previous month"
          >
            <ArrowLeft />
          </button>
          <button
            type="button"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
            aria-label="Next month"
          >
            <ArrowRight />
          </button>
        </div>
      </div>
      <div className="date-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="dn">
            {d}
          </span>
        ))}
        {cells.map((c, i) => {
          if (c.dim) {
            return (
              <span key={i} className="dc dim">
                {c.n}
              </span>
            );
          }
          const cls = [
            "dc",
            isSelected(c.date) ? "sel" : "",
            isToday(c.date) ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              type="button"
              key={i}
              className={cls}
              onClick={() => onSelect(c.date)}
            >
              {c.n}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="strava-meta">
          <i style={{ background: "var(--color-clay)" }} />
          <span>
            Selected ·{" "}
            {selected.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Strava

function stravaErrorMessage(code: string): string {
  switch (code) {
    case "cancelled":
      return "Strava connection cancelled. You can try again or connect later.";
    case "session_expired":
      return "Your session expired before connecting. Please try again.";
    case "strava_account_already_linked":
      return "This Strava account is linked to another user.";
    case "config_error":
      return "Strava is not configured. Contact support.";
    default:
      return "Something went wrong connecting Strava. Try again.";
  }
}

// Build the failure message for the import step from the REAL backfill
// status — the closed `error_code` selects the framing, and `error_detail`
// (the actual error the worker caught) is surfaced verbatim where we have
// it, rather than a one-size-fits-all "Import failed" template.
function backfillFailureMessage(backfill: BackfillStatusColumn): string {
  const detail = backfill.error_detail?.trim();
  switch (backfill.error_code) {
    case "needs_reauth":
      return "Strava asked us to reconnect. Reconnect to finish importing your history.";
    case "key_rotation":
      return "We couldn’t decrypt your stored Strava token. Please reconnect Strava.";
    case "rate_limited":
      return (
        detail ??
        "Strava’s rate limit was hit. It resets within ~15 minutes — tap Try again after that."
      );
    case "timed_out":
      return (
        detail ??
        "The import ran out of time before finishing. Tap Try again to pull the rest."
      );
    case "network":
      return detail ?? "We couldn’t reach Strava. Check your connection and try again.";
    case "watchdog_demoted":
      return "The import stalled and was stopped. Tap Try again to restart it.";
    default:
      // Surface the genuine underlying message when we have one.
      return detail
        ? `Import failed: ${detail}`
        : "Import failed. You can continue and we’ll retry in the background.";
  }
}

// Import-progress screen shown after in-flow OAuth. Split out from
// StravaScreen so it can own the staleness timer (hooks) cleanly.
// Exported for render tests (see onboarding-strava-import.test.tsx).
export function StravaImportScreen({
  email,
  backfill,
  onRetry,
  onContinue,
}: {
  email: string;
  backfill: BackfillStatusColumn;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const total = backfill.estimated_total ?? 200;
  const done = backfill.completed ?? 0;
  const isFailed =
    backfill.state === "failed" || backfill.state === "needs_reauth";
  const pct =
    backfill.state === "complete"
      ? 100
      : total > 0
        ? Math.min(100, Math.round((done / total) * 100))
        : 0;
  const isDone = backfill.state === "complete" || pct >= 100;
  const needsReconnect =
    backfill.error_code === "needs_reauth" ||
    backfill.error_code === "key_rotation";

  // Staleness guard: if the bar hasn't advanced and no terminal state has
  // arrived within 30s, tell the user it's taking longer than usual and let
  // them continue — so the screen is never an indefinite silent spinner.
  // The timer resets whenever `completed` advances or the state changes.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (isDone || isFailed) {
      setStale(false);
      return;
    }
    setStale(false);
    const t = window.setTimeout(() => setStale(true), 30_000);
    return () => window.clearTimeout(t);
  }, [isDone, isFailed, done, backfill.state]);

  return (
    <div className="panel">
      <span className="strava-brand-pill">
        <i aria-hidden="true" />
        Connected{email ? ` · ${email}` : ""}
      </span>
      <h1 className="display">
        {isDone
          ? "Workouts imported."
          : isFailed
            ? "We hit a snag importing."
            : "Pulling your recent workouts."}
      </h1>
      <p className="lead">
        {isDone
          ? "We've read your training history so your starting paces aren't guesses."
          : isFailed
            ? "Your Strava account is connected — we just couldn't finish reading your history this time."
            : "We're reading your training history so your starting paces aren't guesses."}
      </p>

      <div className="strava-import">
        <div className="lbl">
          <span className="n">{done}</span>
          <span className="total">of {total}</span>
        </div>
        <div className="progress-thin">
          <i style={{ width: `${pct}%` }} />
        </div>
        {isFailed ? (
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>
            {backfillFailureMessage(backfill)}
          </p>
        ) : stale ? (
          <p style={{ fontSize: 13, color: "var(--color-ink-muted)", margin: 0 }}>
            This is taking longer than usual. It&apos;s still running in the
            background — you can keep waiting or continue and we&apos;ll finish
            the import for you.
          </p>
        ) : null}
      </div>

      <div className="actions">
        {isFailed ? (
          <div className="actions-row">
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              {needsReconnect ? "Reconnect Strava" : "Try again"}
            </button>
            <button type="button" className="btn btn-primary" onClick={onContinue}>
              Continue anyway
              <ArrowRight />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!isDone && !stale}
            onClick={onContinue}
          >
            {isDone ? "See my profile" : stale ? "Continue anyway" : "Working…"}
            {(isDone || stale) && <ArrowRight />}
          </button>
        )}
      </div>
    </div>
  );
}

function StravaScreen({
  email,
  connectedInFlow,
  alreadyConnected,
  backfill,
  error,
  onConnect,
  onSkip,
  onNext,
  onBack,
}: {
  email: string;
  // True ONLY if the user completed Strava OAuth during this onboarding
  // session (callback redirected back with ?strava_connected=1). Drives
  // the "Pulling your recent workouts" progress UI.
  connectedInFlow: boolean;
  // True if a strava_tokens row exists for this user (possibly from a
  // prior session). Surfaced as a "Already connected" hint on the CTA
  // view, but does NOT auto-skip the explicit consent gesture.
  alreadyConnected: boolean;
  backfill: BackfillStatusColumn;
  error?: string;
  onConnect: () => void;
  onSkip: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  // Show the import progress UI only after the user explicitly connected
  // in this onboarding flow. A pre-existing token row is not enough —
  // we want the user to actively confirm Strava access here.
  if (connectedInFlow) {
    return (
      <StravaImportScreen
        email={email}
        backfill={backfill}
        onRetry={onConnect}
        onContinue={onNext}
      />
    );
  }

  return (
    <div className="panel">
      <span className="eyebrow">04 · Connect</span>
      <h1 className="display">
        {alreadyConnected
          ? "Re-authorize Strava to refresh your data."
          : "Connect Strava so your plan can adapt."}
      </h1>
      <p className="lead">
        {alreadyConnected
          ? "You're already linked from a previous session. Re-authorize to pull a fresh copy of your last 200 workouts and confirm we still have access — or skip to keep what we have."
          : "We'll import your last 200 workouts to set realistic zones, then auto-sync new sessions as you complete them."}
      </p>

      <div className="strava-card">
        <div className="strava-bullet">
          <span className="strava-tick">
            <Check />
          </span>
          <span>Auto-detect your training volume and weekly pattern.</span>
        </div>
        <div className="strava-bullet">
          <span className="strava-tick">
            <Check />
          </span>
          <span>Mark workouts complete automatically — no double entry.</span>
        </div>
        <div className="strava-bullet">
          <span className="strava-tick">
            <Check />
          </span>
          <span>Read-only by default. Revoke from Settings anytime.</span>
        </div>
        <div className="strava-divider" />
        <div className="strava-meta">
          <i aria-hidden="true" />
          <span>≈60% of athletes connect at this step</span>
        </div>
      </div>

      {error && (
        <p
          style={{
            fontSize: 13.5,
            color: "var(--color-danger)",
            margin: 0,
          }}
        >
          {stravaErrorMessage(error)}
        </p>
      )}

      <div className="actions">
        <div className="actions-row">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft /> Back
          </button>
          <button type="button" className="btn btn-strava" onClick={onConnect}>
            {alreadyConnected ? "Re-authorize Strava" : "Connect with Strava"}
            <ArrowRight />
          </button>
        </div>
        <button type="button" className="text-link" onClick={onSkip}>
          {alreadyConnected
            ? "Keep my existing connection and continue"
            : "Connect later — I'll log workouts manually"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Step: Profile (final)

function ProfileScreen({
  state,
  onOpenDashboard,
}: {
  state: {
    name: string;
    sport: SportId;
    hours: number;
    pattern: string;
    eventType: string;
    eventDate: Date | null;
    stravaConnected: boolean;
    backfill: BackfillStatusColumn;
  };
  onOpenDashboard: () => void;
}) {
  const sportName = SPORTS.find((s) => s.id === state.sport)?.name ?? "—";
  const displayName = state.name || "Athlete";
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const dateLabel = state.eventDate
    ? state.eventDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No event set";
  const weeks =
    state.eventDate !== null
      ? Math.max(
          0,
          Math.round(
            (state.eventDate.getTime() - startOfToday().getTime()) /
              (7 * 86400000)
          )
        )
      : null;

  const importedCount =
    state.backfill.state === "complete" || state.backfill.state === "in_progress"
      ? (state.backfill.completed ?? 0)
      : 0;

  return (
    <div className="panel">
      <span className="complete-eyebrow">
        <i aria-hidden="true" />
        Profile ready
      </span>
      <h1 className="display">You&apos;re set, {displayName}.</h1>
      <p className="lead">
        We&apos;ve built your starting profile from{" "}
        {state.stravaConnected ? "your Strava history" : "your inputs"}. Open
        your dashboard to see what&apos;s next.
      </p>

      <div className="profile-grid">
        <div className="profile-head">
          <div className="avatar">{initials || "AS"}</div>
          <div className="profile-meta">
            <h3>{displayName}</h3>
            <span className="eyebrow">
              {sportName}
              {state.eventType ? ` · ${state.eventType}` : " · Base plan"}
              {weeks !== null ? ` · ${weeks}w to race` : ""}
            </span>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="n">{state.hours}h</span>
            <span className="l">Weekly target</span>
          </div>
          <div className="stat">
            <span className="n">
              {state.stravaConnected ? importedCount : "—"}
            </span>
            <span className="l">Workouts synced</span>
          </div>
          <div className="stat">
            <span className="n">{weeks !== null ? `${weeks}w` : "—"}</span>
            <span className="l">To race day</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-row">
            <span className="k">Sport</span>
            <span className="v">{sportName}</span>
          </div>
          <div className="summary-row">
            <span className="k">Event</span>
            <span className="v">
              {state.eventType || (
                <span className="v muted">No event yet</span>
              )}
            </span>
          </div>
          <div className="summary-row">
            <span className="k">Date</span>
            <span className="v">
              {state.eventType ? dateLabel : <span className="v muted">—</span>}
            </span>
          </div>
          <div className="summary-row">
            <span className="k">Pattern</span>
            <span className="v">{state.pattern}</span>
          </div>
          <div className="summary-row">
            <span className="k">Strava</span>
            <span className="v">
              {state.stravaConnected ? (
                "Connected · auto-sync on"
              ) : (
                <span className="v muted">Not connected</span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onOpenDashboard}>
          Open dashboard
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Scoped styles — kept out of globals.css to avoid leaking into the rest
// of the dashboard. Mirrors the design's prototype CSS, tightened for
// the production sidebar-free layout.

function OnboardingStyles() {
  return (
    <style>{`
      .onboarding-root {
        min-height: 100vh;
        background: var(--color-canvas);
        color: var(--color-ink);
        font-family: var(--font-sans);
        font-feature-settings: "ss01", "cv11";
        -webkit-font-smoothing: antialiased;
        font-size: 16px;
        line-height: 1.55;
      }
      .onboarding-root .page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }
      .onboarding-root .site-header {
        position: sticky;
        top: 0;
        z-index: 10;
        backdrop-filter: blur(8px);
        background: color-mix(in srgb, var(--color-canvas) 84%, transparent);
        border-bottom: 1px solid var(--color-border);
      }
      .onboarding-root .site-header-inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 14px 32px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
      }
      .onboarding-root .brand { display: flex; align-items: center; gap: 10px; }
      .onboarding-root .brand-mark {
        width: 26px; height: 26px; border-radius: 999px;
        background: conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg);
      }
      .onboarding-root .brand-name {
        font-weight: 500; font-size: 15px; letter-spacing: -0.01em;
      }
      .onboarding-root .header-meta {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--color-ink-subtle);
      }
      .onboarding-root .ghost-btn {
        font-size: 13px; color: var(--color-ink-muted);
        padding: 8px 14px; border-radius: 999px;
        background: transparent; border: 0; cursor: pointer;
        font-family: inherit;
      }
      .onboarding-root .ghost-btn:hover {
        background: var(--color-canvas-soft); color: var(--color-ink);
      }

      .onboarding-root .progress-strip {
        max-width: 1180px; margin: 0 auto; width: 100%;
        padding: 22px 32px 0;
        display: flex; flex-direction: column; gap: 10px;
      }
      .onboarding-root .progress-track {
        height: 3px; background: var(--color-canvas-soft);
        border-radius: 999px; overflow: hidden;
      }
      .onboarding-root .progress-fill {
        height: 100%; background: var(--color-clay);
        border-radius: 999px;
        transition: width 320ms cubic-bezier(.2,.7,.2,1);
      }
      .onboarding-root .progress-meta {
        display: flex; justify-content: space-between; align-items: center;
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--color-ink-subtle);
      }
      .onboarding-root .progress-meta .crumbs { display: flex; gap: 14px; }
      .onboarding-root .crumb-wrap { display: inline-flex; gap: 14px; }
      .onboarding-root .progress-meta .crumbs span.done { color: var(--color-ink-muted); }
      .onboarding-root .progress-meta .crumbs span.now { color: var(--color-ink); }
      .onboarding-root .progress-meta .crumbs .sep { opacity: 0.5; }

      .onboarding-root .flow {
        flex: 1;
        display: flex; align-items: center; justify-content: center;
        padding: 56px 32px 64px;
      }
      .onboarding-root .panel {
        width: 100%;
        max-width: 560px;
        display: flex; flex-direction: column; gap: 28px;
        animation: ob-fade 320ms ease both;
      }
      @keyframes ob-fade {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: none; }
      }

      .onboarding-root .eyebrow {
        font-family: var(--font-mono);
        font-size: 11px; font-weight: 500;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: var(--color-ink-muted);
      }
      .onboarding-root .display {
        font-size: clamp(34px, 4.5vw, 48px);
        line-height: 1.04; letter-spacing: -0.025em;
        font-weight: 600; margin: 0; text-wrap: balance;
      }
      .onboarding-root .lead {
        font-size: 17px; line-height: 1.55;
        color: var(--color-ink-muted);
        margin: 0; max-width: 480px;
      }

      .onboarding-root .group { display: flex; flex-direction: column; gap: 14px; }
      .onboarding-root .label {
        font-family: var(--font-mono);
        font-size: 11px; font-weight: 500;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: var(--color-ink-muted);
      }
      .onboarding-root .hint { font-size: 13px; color: var(--color-ink-subtle); }

      .onboarding-root .input {
        width: 100%;
        padding: 16px 18px;
        border-radius: 14px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-paper);
        font-family: inherit; font-size: 17px; color: var(--color-ink);
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      .onboarding-root .input::placeholder { color: var(--color-ink-subtle); }
      .onboarding-root .input:focus {
        outline: none;
        border-color: var(--color-ink);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-clay) 18%, transparent);
      }

      .onboarding-root .sport-grid {
        display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
      }
      .onboarding-root .sport-tile {
        appearance: none; font: inherit; cursor: pointer; text-align: left;
        padding: 16px 18px; border-radius: 14px;
        border: 1px solid var(--color-border);
        background: var(--color-paper);
        display: flex; align-items: center; gap: 14px;
        transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
        color: var(--color-ink);
      }
      .onboarding-root .sport-tile:hover { border-color: var(--color-border-strong); }
      .onboarding-root .sport-tile.selected {
        border-color: var(--color-ink);
        background: color-mix(in srgb, var(--color-clay) 6%, var(--color-paper));
      }
      .onboarding-root .sport-glyph {
        width: 38px; height: 38px; border-radius: 10px;
        background: var(--color-canvas-soft);
        display: flex; align-items: center; justify-content: center;
        color: var(--color-ink-muted); flex: none;
        transition: background 140ms ease, color 140ms ease;
      }
      .onboarding-root .sport-tile.selected .sport-glyph {
        background: color-mix(in srgb, var(--color-clay) 16%, var(--color-canvas-soft));
        color: var(--color-clay-deep);
      }
      .onboarding-root .sport-name {
        font-size: 15.5px; font-weight: 500; letter-spacing: -0.005em;
      }
      .onboarding-root .sport-meta {
        margin-top: 2px;
        font-family: var(--font-mono);
        font-size: 10.5px; letter-spacing: 0.14em;
        text-transform: uppercase; color: var(--color-ink-subtle);
      }

      .onboarding-root .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .onboarding-root .chip {
        appearance: none; font: inherit; cursor: pointer;
        padding: 10px 16px; border-radius: 999px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-paper);
        color: var(--color-ink-muted);
        font-size: 14px;
        transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
      }
      .onboarding-root .chip:hover { color: var(--color-ink); border-color: var(--color-ink); }
      .onboarding-root .chip.selected {
        border-color: var(--color-ink);
        background: var(--color-ink);
        color: var(--color-canvas);
      }

      .onboarding-root .hours-card {
        padding: 28px 24px 22px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 18px;
        display: flex; flex-direction: column; gap: 18px;
      }
      .onboarding-root .hours-value {
        display: flex; align-items: baseline; gap: 8px;
        justify-content: center; font-feature-settings: "tnum";
      }
      .onboarding-root .hours-value .n {
        font-size: 72px; font-weight: 600; letter-spacing: -0.035em;
        line-height: 1; color: var(--color-ink);
      }
      .onboarding-root .hours-value .u {
        font-family: var(--font-mono); font-size: 12px;
        letter-spacing: 0.16em; text-transform: uppercase;
        color: var(--color-ink-subtle);
      }
      .onboarding-root .slider {
        -webkit-appearance: none; appearance: none;
        width: 100%; height: 6px;
        background: var(--color-canvas-soft);
        border-radius: 999px; outline: none; cursor: pointer;
      }
      .onboarding-root .slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--color-paper);
        border: 2px solid var(--color-clay);
        cursor: grab;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .onboarding-root .slider::-moz-range-thumb {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--color-paper);
        border: 2px solid var(--color-clay);
        cursor: grab;
      }
      .onboarding-root .slider-ticks {
        display: flex; justify-content: space-between;
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.08em;
        color: var(--color-ink-subtle); padding: 0 2px;
      }
      .onboarding-root .pattern-row { display: flex; flex-wrap: wrap; gap: 8px; }

      .onboarding-root .date-card {
        padding: 14px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .onboarding-root .date-head {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 14px;
      }
      .onboarding-root .date-month { font-weight: 500; letter-spacing: -0.01em; }
      .onboarding-root .date-nav { display: flex; gap: 6px; }
      .onboarding-root .date-nav button {
        width: 28px; height: 28px; border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-paper);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: var(--color-ink-muted);
      }
      .onboarding-root .date-nav button:hover {
        color: var(--color-ink); border-color: var(--color-border-strong);
      }
      .onboarding-root .date-grid {
        display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
      }
      .onboarding-root .date-grid .dn {
        font-family: var(--font-mono);
        font-size: 10px; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--color-ink-subtle);
        text-align: center; padding-bottom: 6px;
      }
      .onboarding-root .date-grid .dc {
        appearance: none; border: 0; background: transparent;
        font: inherit; cursor: pointer;
        aspect-ratio: 1;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; color: var(--color-ink);
        border-radius: 7px;
        transition: background 120ms ease, color 120ms ease;
      }
      .onboarding-root .date-grid .dc:hover:not(.dim) {
        background: var(--color-canvas-soft);
      }
      .onboarding-root .date-grid .dc.dim {
        color: color-mix(in srgb, var(--color-ink-subtle) 70%, transparent);
        cursor: default;
      }
      .onboarding-root .date-grid .dc.today { font-weight: 600; }
      .onboarding-root .date-grid .dc.sel {
        background: var(--color-ink); color: var(--color-canvas); font-weight: 500;
      }

      .onboarding-root .strava-card {
        padding: 22px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 18px;
        display: flex; flex-direction: column; gap: 14px;
      }
      .onboarding-root .strava-bullet {
        display: flex; align-items: flex-start; gap: 12px;
        font-size: 14.5px; line-height: 1.5; color: var(--color-ink);
      }
      .onboarding-root .strava-tick {
        width: 22px; height: 22px; border-radius: 999px;
        background: var(--color-pine-soft, color-mix(in srgb, var(--color-pine) 18%, var(--color-canvas)));
        color: var(--color-pine);
        display: flex; align-items: center; justify-content: center;
        flex: none; margin-top: 1px;
      }
      .onboarding-root .strava-tick svg { width: 12px; height: 12px; }
      .onboarding-root .strava-divider {
        height: 1px; background: var(--color-border); margin: 4px -22px 0;
      }
      .onboarding-root .strava-meta {
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.14em;
        text-transform: uppercase; color: var(--color-ink-subtle);
        display: flex; align-items: center; gap: 8px;
      }
      .onboarding-root .strava-meta i {
        width: 6px; height: 6px; border-radius: 999px;
        background: var(--color-pine); display: inline-block;
      }

      .onboarding-root .strava-import {
        display: flex; flex-direction: column; gap: 14px;
        padding: 28px 24px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 18px;
      }
      .onboarding-root .strava-import .lbl {
        display: flex; justify-content: space-between; align-items: baseline;
      }
      .onboarding-root .strava-import .n {
        font-size: 32px; font-weight: 600; letter-spacing: -0.02em;
      }
      .onboarding-root .strava-import .total {
        font-family: var(--font-mono);
        font-size: 12px; color: var(--color-ink-subtle);
        letter-spacing: 0.12em; text-transform: uppercase;
      }
      .onboarding-root .progress-thin {
        height: 4px; background: var(--color-canvas-soft);
        border-radius: 999px; overflow: hidden;
      }
      .onboarding-root .progress-thin i {
        display: block; height: 100%;
        background: var(--color-pine);
        border-radius: 999px;
        transition: width 320ms cubic-bezier(.2,.7,.2,1);
      }

      .onboarding-root .actions {
        display: flex; flex-direction: column; gap: 12px;
        align-items: stretch; margin-top: 4px;
      }
      .onboarding-root .actions-row {
        display: flex; gap: 12px; align-items: center;
      }
      .onboarding-root .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 10px;
        padding: 14px 22px;
        border-radius: 999px;
        font-weight: 500; font-size: 15px;
        font-family: inherit;
        transition: transform 120ms ease, background-color 160ms ease, color 160ms ease, border-color 160ms ease, opacity 140ms ease;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .onboarding-root .btn:active { transform: translateY(1px); }
      .onboarding-root .btn-primary {
        background: var(--color-ink);
        color: var(--color-canvas);
        flex: 1;
      }
      .onboarding-root .btn-primary:hover { background: var(--color-clay-deep); }
      .onboarding-root .btn-primary:disabled {
        opacity: 0.4; cursor: not-allowed; background: var(--color-ink);
      }
      .onboarding-root .btn-secondary {
        background: transparent; color: var(--color-ink);
        border: 1px solid var(--color-border-strong);
      }
      .onboarding-root .btn-secondary:hover {
        background: var(--color-canvas-soft); border-color: var(--color-ink);
      }
      .onboarding-root .btn-strava {
        background: #fc4c02; color: white; flex: 1;
      }
      .onboarding-root .btn-strava:hover { background: #e34400; }
      .onboarding-root .text-link {
        align-self: center;
        font-size: 13.5px; color: var(--color-ink-muted);
        text-decoration: underline;
        text-underline-offset: 4px;
        text-decoration-color: var(--color-border-strong);
        cursor: pointer;
        background: transparent; border: 0;
        font-family: inherit;
        padding: 6px 10px;
      }
      .onboarding-root .text-link:hover {
        color: var(--color-ink); text-decoration-color: var(--color-ink);
      }

      .onboarding-root .profile-grid {
        display: grid; grid-template-columns: 1fr; gap: 18px;
      }
      .onboarding-root .profile-head {
        display: flex; align-items: center; gap: 16px;
        padding: 22px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 18px;
      }
      .onboarding-root .avatar {
        width: 64px; height: 64px; border-radius: 999px;
        background: var(--color-canvas-soft);
        border: 1px solid var(--color-border-strong);
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; font-weight: 600;
        color: var(--color-ink-muted);
        letter-spacing: -0.02em;
      }
      .onboarding-root .profile-meta {
        display: flex; flex-direction: column; gap: 4px;
      }
      .onboarding-root .profile-meta h3 {
        margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.015em;
      }
      .onboarding-root .stat-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
      }
      .onboarding-root .stat {
        padding: 16px 18px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .onboarding-root .stat .n {
        font-size: 22px; font-weight: 600; letter-spacing: -0.02em;
        font-feature-settings: "tnum";
      }
      .onboarding-root .stat .l {
        font-family: var(--font-mono);
        font-size: 10px; letter-spacing: 0.14em;
        text-transform: uppercase; color: var(--color-ink-subtle);
      }

      .onboarding-root .summary-card {
        padding: 18px 22px;
        background: var(--color-paper);
        border: 1px solid var(--color-border);
        border-radius: 18px;
        display: flex; flex-direction: column;
      }
      .onboarding-root .summary-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid var(--color-border);
        font-size: 14px;
      }
      .onboarding-root .summary-row:last-child { border-bottom: 0; }
      .onboarding-root .summary-row .k {
        color: var(--color-ink-subtle);
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      }
      .onboarding-root .summary-row .v { color: var(--color-ink); font-weight: 500; }
      .onboarding-root .summary-row .v.muted {
        color: var(--color-ink-muted); font-weight: 400;
      }

      .onboarding-root .panel.is-event { gap: 18px; max-width: 520px; }
      .onboarding-root .panel.is-event .display {
        font-size: clamp(28px, 3.2vw, 34px);
      }
      .onboarding-root .panel.is-event .lead { font-size: 15px; max-width: 460px; }
      .onboarding-root .panel.is-event .group { gap: 10px; }
      .onboarding-root .panel.is-event .chip { padding: 7px 13px; font-size: 13px; }
      .onboarding-root .panel.is-event .skip-card { padding: 11px 14px; }
      .onboarding-root .panel.is-event .skip-card .k { font-size: 13.5px; }
      .onboarding-root .panel.is-event .skip-card .s { font-size: 12px; }

      .onboarding-root .skip-card {
        background: transparent;
        border: 1px dashed var(--color-border-strong);
        border-radius: 14px;
        padding: 14px 16px;
        display: flex; justify-content: space-between; align-items: center;
        gap: 16px;
        cursor: pointer;
        transition: border-color 140ms ease, background 140ms ease;
        font: inherit; color: inherit;
        text-align: left;
        width: 100%;
      }
      .onboarding-root .skip-card:hover {
        border-color: var(--color-ink);
        background: var(--color-canvas-soft);
      }
      .onboarding-root .skip-card .k {
        font-size: 14px; color: var(--color-ink); font-weight: 500;
      }
      .onboarding-root .skip-card .s {
        font-size: 12.5px; color: var(--color-ink-subtle);
      }

      .onboarding-root .hero-rings {
        width: 130px; height: 130px;
        border-radius: 999px;
        border: 1.5px solid var(--color-border-strong);
        position: relative;
        display: flex; align-items: center; justify-content: center;
        align-self: center;
        margin: 8px 0 4px;
      }
      .onboarding-root .hero-rings::before,
      .onboarding-root .hero-rings::after {
        content: ""; position: absolute; border-radius: 999px;
        border: 1.5px dashed var(--color-border);
      }
      .onboarding-root .hero-rings::before { inset: -22px; }
      .onboarding-root .hero-rings::after { inset: -44px; }
      .onboarding-root .hero-rings .dot {
        width: 20px; height: 20px; border-radius: 999px;
        background: var(--color-clay);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-clay) 18%, transparent);
      }

      .onboarding-root .welcome-bullets {
        display: flex; flex-direction: column; gap: 10px;
        margin-top: 4px; padding: 0; list-style: none;
      }
      .onboarding-root .welcome-bullets li {
        display: flex; align-items: flex-start; gap: 12px;
        font-size: 15px;
        color: var(--color-ink-muted);
        line-height: 1.5;
      }
      .onboarding-root .welcome-bullets .num {
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.14em;
        color: var(--color-ink-subtle);
        width: 28px; flex: none; padding-top: 3px;
      }

      .onboarding-root .strava-brand-pill {
        display: inline-flex; align-items: center; gap: 8px;
        font-family: var(--font-mono); font-size: 11px;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: var(--color-ink-muted);
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--color-canvas-soft);
        border: 1px solid var(--color-border);
        align-self: flex-start;
      }
      .onboarding-root .strava-brand-pill i {
        width: 8px; height: 8px; border-radius: 999px; background: #fc4c02;
      }

      .onboarding-root .complete-eyebrow {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 12px;
        background: var(--color-pine-soft, color-mix(in srgb, var(--color-pine) 18%, var(--color-canvas)));
        color: var(--color-pine);
        border-radius: 999px;
        align-self: flex-start;
        font-family: var(--font-mono);
        font-size: 11px; letter-spacing: 0.16em;
        text-transform: uppercase; font-weight: 500;
      }
      .onboarding-root .complete-eyebrow i {
        width: 6px; height: 6px; border-radius: 999px; background: var(--color-pine);
      }

      @media (max-width: 640px) {
        .onboarding-root .site-header-inner { padding: 14px 20px; }
        .onboarding-root .progress-strip { padding: 18px 20px 0; }
        .onboarding-root .flow { padding: 40px 20px 56px; }
        .onboarding-root .sport-grid { grid-template-columns: 1fr; }
        .onboarding-root .stat-grid { grid-template-columns: 1fr; }
        .onboarding-root .actions-row { flex-direction: column-reverse; align-items: stretch; }
        .onboarding-root .btn-primary, .onboarding-root .btn-strava { width: 100%; }
        .onboarding-root .btn-secondary { width: 100%; }
      }
    `}</style>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { getUserWithRoles, landingPathForRoles } from "@/auth/roles";

export default async function LandingPage() {
  const session = await getUserWithRoles();
  if (session) redirect(landingPathForRoles(session.roles));

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-canvas)", color: "var(--color-ink)" }}>
      <SiteNav />
      <Hero />
      <StatStrip />
      <FeaturesSection />
      <CoachBand />
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

const WRAP: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "0 32px",
};

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
        flexShrink: 0,
      }}
    />
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */

function SiteNav() {
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "color-mix(in oklab, var(--color-canvas) 85%, transparent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          ...WRAP,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
        }}
      >
        {/* Brand */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
          <BrandMark />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--color-ink)" }}>
            The Daily Athlete
          </span>
        </Link>

        {/* Links — hidden on small screens via CSS */}
        <div
          className="landing-site-links"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#coaches">For coaches</NavLink>
          <NavLink href="/sign-in">Sign in ↗</NavLink>
        </div>

        {/* CTA group */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
          <Link href="/sign-in" style={ghostBtnSm}>Sign in</Link>
          <Link href="/sign-up" style={clayBtnSm}>Start free</Link>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 14,
        color: "var(--color-ink-muted)",
        textDecoration: "none",
        transition: "background 140ms, color 140ms",
      }}
      className="landing-navlink"
    >
      {children}
    </a>
  );
}

const ghostBtnSm: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 500,
  background: "transparent",
  color: "var(--color-ink-muted)",
  border: "none",
  textDecoration: "none",
  transition: "background 140ms, color 140ms",
  cursor: "pointer",
};

const clayBtnSm: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 500,
  background: "var(--color-clay)",
  color: "#fff",
  border: "1px solid var(--color-clay-deep)",
  textDecoration: "none",
  transition: "background 140ms",
  cursor: "pointer",
};

const clayBtnLg: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "14px 24px",
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 500,
  background: "var(--color-clay)",
  color: "#fff",
  border: "1px solid var(--color-clay-deep)",
  textDecoration: "none",
  cursor: "pointer",
};

const outlineBtnLg: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "14px 24px",
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 500,
  background: "var(--color-paper)",
  color: "var(--color-ink)",
  border: "1px solid var(--color-border)",
  textDecoration: "none",
  cursor: "pointer",
};

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <header id="top" style={{ padding: "84px 0 56px" }}>
      <div
        style={{
          ...WRAP,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 56,
          alignItems: "center",
        }}
        className="hero-grid"
      >
        {/* Copy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <span className="eyebrow">Endurance training</span>
          <h1
            style={{
              fontSize: "clamp(40px, 5.4vw, 66px)",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              fontWeight: 600,
              margin: "10px 0 0",
              textWrap: "balance" as React.CSSProperties["textWrap"],
            }}
          >
            Every session,{" "}
            <em style={{ fontStyle: "normal", color: "var(--color-clay)" }}>read</em>
            {" "}the way you&apos;d read it yourself.
          </h1>
          <p
            style={{
              fontSize: 18,
              color: "var(--color-ink-muted)",
              maxWidth: "42ch",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            The Daily Athlete turns each run and ride into a clear story — planned vs actual,
            intervals matched, the one takeaway that matters. No noise, no 40-metric dashboards.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/sign-up" style={clayBtnLg}>Start free for 14 days</Link>
            <Link href="/sign-in" style={outlineBtnLg}>Sign in ↗</Link>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.04em",
              color: "var(--color-ink-subtle)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-success)",
                flexShrink: 0,
              }}
            />
            Syncs with Garmin, Wahoo &amp; Strava · No card required
          </div>
        </div>

        {/* Device art */}
        <div style={{ position: "relative" }} className="hero-art-col">
          <DeviceMockup />
          {/* Badge */}
          <div
            style={{
              position: "absolute",
              bottom: -18,
              left: -18,
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "12px 16px",
              boxShadow: "0 20px 40px -24px color-mix(in oklab, var(--color-ink) 30%, transparent)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--color-ink-subtle)",
              }}
            >
              Interval match
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              98<span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>%</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function DeviceMockup() {
  const intervals = [
    { label: "Int. 1", target: 258, actual: 261, pct: 100 },
    { label: "Int. 2", target: 258, actual: 264, pct: 100 },
    { label: "Int. 3", target: 258, actual: 251, pct: 96 },
    { label: "Int. 4", target: 258, actual: 262, pct: 100 },
  ];

  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "1px solid var(--color-border)",
        borderRadius: 22,
        padding: 12,
        boxShadow:
          "0 1px 0 var(--color-border), 0 40px 70px -40px color-mix(in oklab, var(--color-ink) 32%, transparent)",
      }}
    >
      {/* Browser chrome */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 12px" }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--color-border-strong)", flexShrink: 0 }}
          />
        ))}
        <span
          style={{
            marginLeft: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-ink-subtle)",
            letterSpacing: "0.06em",
          }}
        >
          workout · threshold 4×8
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          background: "var(--color-canvas)",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Top stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { k: "Distance", v: "28.4", u: "km" },
            { k: "Duration", v: "1:12:08", u: "" },
            { k: "Avg Power", v: "261", u: "W" },
          ].map(({ k, v, u }) => (
            <div
              key={k}
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ink-subtle)" }}>{k}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
                {v}<span style={{ fontSize: 11, color: "var(--color-ink-muted)", marginLeft: 2 }}>{u}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Intervals */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ink-subtle)" }}>
            4×8 min · threshold
          </span>
          {intervals.map((iv) => (
            <div key={iv.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-ink-subtle)", width: 36, flexShrink: 0 }}>{iv.label}</span>
              <div style={{ flex: 1, height: 8, background: "var(--color-border)", borderRadius: 4, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${iv.pct}%`,
                    height: "100%",
                    background: iv.pct >= 100 ? "var(--color-pine)" : "var(--color-clay)",
                    borderRadius: 4,
                  }}
                />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-muted)", width: 38, textAlign: "right", flexShrink: 0 }}>{iv.actual}W</span>
              <span style={{ fontSize: 12, flexShrink: 0 }}>{iv.pct >= 100 ? "✓" : "↓"}</span>
            </div>
          ))}
        </div>

        {/* AI takeaway */}
        <div
          style={{
            background: "var(--color-pine-soft)",
            borderRadius: 10,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-pine)" }}>
            AI takeaway
          </span>
          <p style={{ fontSize: 12.5, color: "var(--color-ink)", margin: 0, lineHeight: 1.5 }}>
            Strong session — 3 of 4 reps hit target power. Slight dip on rep 3
            is normal mid-workout. Next: raise target 3% Tuesday.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Stat Strip ──────────────────────────────────────────────────────────── */

function StatStrip() {
  const stats = [
    { v: "1,284", k: "Athletes training daily" },
    { v: "3.4M",  k: "Sessions analyzed" },
    { v: "12s",   k: "Avg. sync-to-insight" },
    { v: "4.9★",  k: "App Store rating" },
  ];

  return (
    <section
      style={{
        borderTop: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        background: "color-mix(in oklab, var(--color-canvas-soft) 50%, var(--color-canvas))",
      }}
    >
      <div
        style={{
          ...WRAP,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          padding: "28px 32px",
        }}
        className="stat-strip-grid"
      >
        {stats.map((s, i) => (
          <div
            key={s.k}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "0 24px",
              borderRight: i < stats.length - 1 ? "1px solid var(--color-border)" : "none",
              paddingLeft: i === 0 ? 0 : undefined,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.025em",
                lineHeight: 1,
              }}
            >
              {s.v}
            </span>
            <span style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>{s.k}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Features ────────────────────────────────────────────────────────────── */

function FeaturesSection() {
  return (
    <section id="features" style={{ padding: "88px 0" }}>
      <div style={WRAP}>
        <div style={{ maxWidth: "60ch", marginBottom: 44, display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="eyebrow">What you get</span>
          <h2
            style={{
              fontSize: "clamp(28px, 3.4vw, 42px)",
              letterSpacing: "-0.025em",
              fontWeight: 600,
              lineHeight: 1.08,
              margin: 0,
            }}
          >
            The analysis you&apos;d do by hand — done the moment you upload.
          </h2>
          <p style={{ fontSize: 17, color: "var(--color-ink-muted)", margin: 0 }}>
            Three things matter after a session: did you hit the workout, how hard was it really,
            and what to do next. DA2 answers all three before you&apos;ve taken your shoes off.
          </p>
        </div>

        {/* Feature row 1 */}
        <FeatureRow
          eyebrow="Interval intelligence"
          title="Planned vs actual, rep by rep."
          body="We line up your prescribed workout against what you actually did and score the match — so you know if that ‘4×8 at threshold’ really happened."
          bullets={[
            "Per-rep power, pace & HR against target bands",
            "Automatic warm-up / work / recovery detection",
            "A single match score you can trust at a glance",
          ]}
          art={<IntervalArt />}
          flip={false}
        />

        {/* Feature row 2 */}
        <FeatureRow
          eyebrow="AI takeaway"
          title="One paragraph that actually helps."
          body="Not a wall of charts — a short, plain-language read on the session and a concrete suggestion for the next one, grounded in your own history."
          bullets={[
            "Context from your last 8 weeks, not generic advice",
            "Flags overreaching before it becomes a setback",
            "Ask follow-ups in your own words",
          ]}
          art={<TakeawayArt />}
          flip
        />

        {/* 3-up cards */}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginTop: 40 }}
          className="feature-cards-grid"
        >
          {[
            { ico: "↑", title: "Route & elevation", body: "Every climb and surface read off the GPS track, with grade-adjusted pace baked in." },
            { ico: "♥", title: "Zones & load", body: "Time-in-zone for HR and power, plus a running training load you can actually plan around." },
            { ico: "↻", title: "Auto-sync", body: "Garmin, Wahoo, COROS and Strava land in seconds — no manual files, ever." },
          ].map((c) => (
            <div
              key={c.title}
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                padding: "24px 22px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 15,
                  background: "var(--color-clay-soft)",
                  color: "var(--color-clay-deep)",
                }}
              >
                {c.ico}
              </span>
              <h4 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", margin: "6px 0 0" }}>{c.title}</h4>
              <p style={{ fontSize: 14.5, color: "var(--color-ink-muted)", margin: 0 }}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureRow({
  eyebrow, title, body, bullets, art, flip,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  art: React.ReactNode;
  flip: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 56,
        alignItems: "center",
        padding: "36px 0",
      }}
      className="feature-row"
    >
      <div style={{ order: flip ? 1 : 0 }}>
        <span className="eyebrow">{eyebrow}</span>
        <h3
          style={{
            fontSize: 26,
            letterSpacing: "-0.02em",
            fontWeight: 600,
            margin: "6px 0 14px",
          }}
        >
          {title}
        </h3>
        <p style={{ color: "var(--color-ink-muted)", fontSize: 16, margin: 0, maxWidth: "46ch" }}>
          {body}
        </p>
        <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0 0", padding: 0, listStyle: "none" }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15 }}>
              <span
                style={{
                  flexShrink: 0,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "var(--color-pine-soft)",
                  color: "var(--color-pine)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                ✓
              </span>
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ order: flip ? 0 : 1 }}>
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 18,
            padding: 10,
            boxShadow: "0 30px 60px -44px color-mix(in oklab, var(--color-ink) 30%, transparent)",
          }}
        >
          {art}
        </div>
      </div>
    </div>
  );
}

function IntervalArt() {
  return (
    <div style={{ background: "var(--color-canvas)", borderRadius: 12, padding: 20, minHeight: 280 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-ink-subtle)" }}>
          Threshold · 4×8 min
        </span>
        {[
          { label: "Interval 1", target: 258, actual: 261, match: 100 },
          { label: "Interval 2", target: 258, actual: 264, match: 100 },
          { label: "Interval 3", target: 258, actual: 251, match: 96 },
          { label: "Interval 4", target: 258, actual: 262, match: 100 },
        ].map((iv) => (
          <div key={iv.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{iv.label}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-ink-muted)" }}>target {iv.target}W</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: iv.match >= 100 ? "var(--color-pine)" : "var(--color-clay)",
                  }}
                >
                  {iv.actual}W
                </span>
              </div>
            </div>
            <div style={{ height: 10, background: "var(--color-border)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
              {/* Target zone */}
              <div style={{ position: "absolute", left: "85%", right: "5%", top: 0, bottom: 0, background: "var(--color-pine-soft)" }} />
              {/* Actual */}
              <div style={{ width: `${iv.match}%`, height: "100%", background: iv.match >= 100 ? "var(--color-pine)" : "var(--color-clay)", borderRadius: 5 }} />
            </div>
          </div>
        ))}
        <div
          style={{
            marginTop: 8,
            padding: "10px 14px",
            background: "var(--color-pine-soft)",
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-pine)", fontWeight: 500 }}>Overall match score</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "var(--color-pine)" }}>98%</span>
        </div>
      </div>
    </div>
  );
}

function TakeawayArt() {
  return (
    <div style={{ background: "var(--color-canvas)", borderRadius: 12, padding: 20, minHeight: 280 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--color-clay-soft)",
              color: "var(--color-clay-deep)",
              fontSize: 16,
            }}
          >
            ✦
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ink-subtle)" }}>
            AI takeaway
          </span>
        </div>
        <p style={{ fontSize: 15, color: "var(--color-ink)", margin: 0, lineHeight: 1.6 }}>
          Strong session — all four threshold reps were held within 3W of target.
          Slight fade on rep 3 is normal; HR recovered cleanly. Based on your last
          8 weeks, you&apos;re trending ahead of plan. Next Tuesday, lift the target band by 3%.
        </p>
        <div style={{ height: 1, background: "var(--color-border)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ink-subtle)" }}>
            Follow-up questions
          </span>
          {[
            "How does this compare to last month?",
            "When should I do my next VO2 session?",
          ].map((q) => (
            <div
              key={q}
              style={{
                padding: "9px 12px",
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 13.5,
                color: "var(--color-ink-muted)",
                cursor: "pointer",
              }}
            >
              {q}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Coach Band ──────────────────────────────────────────────────────────── */

function CoachBand() {
  return (
    <section id="coaches" style={{ background: "var(--color-pine)", color: "var(--color-canvas)" }}>
      <div
        style={{
          ...WRAP,
          padding: "72px 32px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 48,
          alignItems: "center",
        }}
        className="coach-band-grid"
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "color-mix(in oklab, var(--color-clay) 60%, #fff)",
            }}
          >
            For coaches
          </span>
          <h2
            style={{
              fontSize: "clamp(28px, 3.2vw, 40px)",
              letterSpacing: "-0.025em",
              fontWeight: 600,
              margin: "14px 0 0",
              lineHeight: 1.1,
            }}
          >
            Coach the whole roster from one calm screen.
          </h2>
          <p
            style={{
              color: "color-mix(in oklab, var(--color-canvas) 78%, var(--color-pine))",
              fontSize: 17,
              maxWidth: "44ch",
              margin: "16px 0 0",
            }}
          >
            See who&apos;s on track, who needs a nudge, and each athlete&apos;s activity
            at a glance — without opening twelve tabs.
          </p>
          <Link
            href="/sign-in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              marginTop: 24,
              padding: "12px 20px",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 500,
              background: "var(--color-clay)",
              color: "#fff",
              border: "1px solid var(--color-clay-deep)",
              textDecoration: "none",
            }}
          >
            Sign in as a coach ↗
          </Link>
        </div>

        {/* Coach art */}
        <CoachArt />
      </div>
    </section>
  );
}

function CoachArt() {
  const athletes = [
    { name: "Aiden Park",    sport: "run",  status: "done",     adherence: 96, last: "Today 06:12" },
    { name: "Carlos Mendez", sport: "run",  status: "progress", adherence: 92, last: "In progress" },
    { name: "Hana Müller",   sport: "run",  status: "done",     adherence: 78, last: "Today 07:02" },
    { name: "Quinn Walsh",   sport: "run",  status: "missed",   adherence: 41, last: "Thu 19:44" },
  ];

  function statusColor(s: string) {
    if (s === "done") return "var(--color-success)";
    if (s === "progress") return "var(--color-clay)";
    if (s === "missed") return "var(--color-danger)";
    return "var(--color-border-strong)";
  }

  function statusLabel(s: string) {
    const map: Record<string, string> = { done: "Done", progress: "In progress", missed: "Missed" };
    return map[s] ?? s;
  }

  return (
    <div
      style={{
        background: "color-mix(in oklab, #fff 8%, transparent)",
        border: "1px solid color-mix(in oklab, #fff 14%, transparent)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid color-mix(in oklab, #fff 12%, transparent)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "color-mix(in oklab, var(--color-canvas) 60%, transparent)" }}>Week 23 · Build 2</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>Today</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>9</span>
          <span style={{ fontSize: 13, color: "color-mix(in oklab, var(--color-canvas) 70%, transparent)", alignSelf: "flex-end", marginBottom: 2 }}>/14 done</span>
        </div>
      </div>
      {/* Roster rows */}
      {athletes.map((a) => (
        <div
          key={a.name}
          style={{
            padding: "11px 18px",
            borderBottom: "1px solid color-mix(in oklab, #fff 8%, transparent)",
            display: "grid",
            gridTemplateColumns: "28px 1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: a.sport === "run" ? "var(--color-clay)" : "var(--color-pine)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {a.name.split(" ").map(w => w[0]).join("")}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: statusColor(a.status),
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor(a.status), flexShrink: 0 }} />
            {statusLabel(a.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */

function FinalCTA() {
  return (
    <section id="get-started" style={{ textAlign: "center", padding: "96px 0" }}>
      <div style={WRAP}>
        <h2
          style={{
            fontSize: "clamp(32px, 4.4vw, 54px)",
            letterSpacing: "-0.03em",
            fontWeight: 600,
            margin: "0 0 16px",
          }}
        >
          Upload your last session. See the difference.
        </h2>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-ink-muted)",
            margin: "0 auto 28px",
            maxWidth: "46ch",
          }}
        >
          Two weeks free, your full history analyzed, nothing to lose. It takes about
          a minute to connect.
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/sign-up" style={clayBtnLg}>Start free for 14 days</Link>
          <Link href="/sign-in" style={outlineBtnLg}>Sign in ↗</Link>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-paper)",
      }}
    >
      <div
        style={{
          ...WRAP,
          padding: "40px 32px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 40,
          flexWrap: "wrap",
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "30ch" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none" }}>
            <BrandMark />
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
              The Daily Athlete
            </span>
          </Link>
          <p style={{ fontSize: 13, color: "var(--color-ink-subtle)", margin: 0 }}>
            Training analytics for runners and cyclists who&apos;d rather train than wrangle data.
          </p>
        </div>

        {/* Link columns */}
        <div style={{ display: "flex", gap: 56, flexWrap: "wrap" }}>
          <FootCol
            heading="Product"
            links={[
              { label: "Features", href: "#features" },
              { label: "For coaches", href: "#coaches" },
            ]}
          />
          <FootCol
            heading="Account"
            links={[
              { label: "Sign in", href: "/sign-in" },
              { label: "Start free", href: "/sign-up" },
            ]}
          />
          <FootCol
            heading="Legal"
            links={[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ]}
          />
        </div>
      </div>

      {/* Legal strip */}
      <div style={{ borderTop: "1px solid var(--color-border)" }}>
        <div
          style={{
            ...WRAP,
            padding: "18px 32px",
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: "var(--color-ink-subtle)",
          }}
        >
          <span>© 2026 The Daily Athlete</span>
          <span>Privacy · Terms</span>
        </div>
      </div>
    </footer>
  );
}

function FootCol({ heading, links }: { heading: string; links: { label: string; href: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-ink-subtle)",
        }}
      >
        {heading}
      </span>
      {links.map(({ label, href }) => (
        <a key={label} href={href} style={{ fontSize: 14, color: "var(--color-ink-muted)", textDecoration: "none" }}>
          {label}
        </a>
      ))}
    </div>
  );
}

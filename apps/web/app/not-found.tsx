"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-canvas)",
        color: "var(--color-ink)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Animated lost runner */}
      <div
        style={{
          position: "relative",
          width: 120,
          height: 120,
          marginBottom: 48,
        }}
      >
        {/* Course marker */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: "50%",
            background: "conic-gradient(from 220deg, var(--color-clay) 0deg, var(--color-pine) 180deg, var(--color-clay) 360deg)",
            opacity: 0.15,
            animation: "spin 8s linear infinite",
          }}
        />
        {/* Wobble emoji */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
            animation: "wobble 2s ease-in-out infinite",
          }}
        >
          🏃
        </div>
      </div>

      {/* Main heading */}
      <h1
        style={{
          fontSize: "clamp(48px, 8vw, 80px)",
          fontWeight: 700,
          letterSpacing: "-0.03em",
          margin: "0 0 16px",
          textAlign: "center",
          lineHeight: 1,
        }}
      >
        404
      </h1>

      {/* Subheading */}
      <p
        style={{
          fontSize: "clamp(18px, 4vw, 24px)",
          fontWeight: 600,
          color: "var(--color-ink)",
          textAlign: "center",
          margin: "0 0 12px",
          maxWidth: "44ch",
        }}
      >
        Off the course
      </p>

      {/* Description */}
      <p
        style={{
          fontSize: 16,
          color: "var(--color-ink-muted)",
          textAlign: "center",
          maxWidth: "48ch",
          margin: "0 0 48px",
          lineHeight: 1.6,
        }}
      >
        Looks like you&apos;ve wandered off the workout. This page doesn&apos;t exist — but your training plan does.
      </p>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "14px 24px",
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 500,
            background: "var(--color-clay)",
            color: "#fff",
            border: "1px solid var(--color-clay-deep)",
            textDecoration: "none",
            transition: "background 140ms",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-clay-deep)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-clay)")}
        >
          Back to home
        </Link>
        <Link
          href="/sign-in"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "14px 24px",
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 500,
            background: "var(--color-paper)",
            color: "var(--color-ink)",
            border: "1px solid var(--color-border)",
            textDecoration: "none",
            transition: "background 140ms",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-paper)")}
        >
          Go to workouts
        </Link>
      </div>

      {/* Decorative elements */}
      <div
        style={{
          position: "fixed",
          top: "10%",
          right: "5%",
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "var(--color-clay-soft)",
          opacity: 0.3,
          pointerEvents: "none",
          animation: "float 6s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "fixed",
          bottom: "15%",
          left: "8%",
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "var(--color-pine-soft)",
          opacity: 0.3,
          pointerEvents: "none",
          animation: "float 8s ease-in-out infinite",
          animationDelay: "-2s",
        }}
      />

      {/* Animations */}
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes wobble {
          0%, 100% {
            transform: translateX(0) rotate(0deg);
          }
          25% {
            transform: translateX(-8px) rotate(-3deg);
          }
          75% {
            transform: translateX(8px) rotate(3deg);
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }
      `}</style>
    </div>
  );
}

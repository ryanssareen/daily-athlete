"use client";

import dynamic from "next/dynamic";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 280,
        borderRadius: 12,
        background: "var(--color-canvas-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: "var(--color-ink-muted)",
      }}
    >
      Loading map…
    </div>
  ),
});

export default function MapSection({ polyline }: { polyline: string }) {
  return <RouteMap polyline={polyline} />;
}

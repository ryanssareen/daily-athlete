"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

// Decode Google Encoded Polyline format (used by Strava summary_polyline)
function decodePolyline(encoded: string): [number, number][] {
  const result: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let val = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      val |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += val & 1 ? ~(val >> 1) : val >> 1;

    shift = 0;
    val = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      val |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += val & 1 ? ~(val >> 1) : val >> 1;

    result.push([lat / 1e5, lng / 1e5]);
  }
  return result;
}

export default function RouteMap({ polyline }: { polyline: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const coords = decodePolyline(polyline);
    if (coords.length === 0) return;

    import("leaflet").then((L) => {
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
        maxZoom: 18,
      }).addTo(map);

      const route = L.polyline(coords, {
        color: "#c45a30",
        weight: 3.5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // Start marker
      L.circleMarker(coords[0], {
        radius: 6,
        fillColor: "#2d4a3e",
        color: "#fff",
        weight: 2,
        fillOpacity: 1,
      }).addTo(map);

      // End marker
      L.circleMarker(coords[coords.length - 1], {
        radius: 6,
        fillColor: "#c45a30",
        color: "#fff",
        weight: 2,
        fillOpacity: 1,
      }).addTo(map);

      map.fitBounds(route.getBounds(), { padding: [24, 24] });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [polyline]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 280,
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--color-canvas-soft)",
      }}
    />
  );
}

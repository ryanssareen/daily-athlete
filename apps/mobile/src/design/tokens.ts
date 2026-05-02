// Sport-aware color tokens; expanded as features land.

export const colors = {
  bg: "#FAFAF7",
  surface: "#FFFFFF",
  ink: "#0E0E10",
  inkSubtle: "#5A5A63",
  border: "#E5E5E0",
  brand: "#1F6FEB",
  danger: "#E5484D",
  success: "#2EA043",
  sport: {
    swim: "#1F6FEB",
    bike: "#F39C12",
    run: "#E5484D",
    strength: "#7C3AED",
    mobility: "#16A34A",
    other: "#6B7280",
  },
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: "600" as const, lineHeight: 28 },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

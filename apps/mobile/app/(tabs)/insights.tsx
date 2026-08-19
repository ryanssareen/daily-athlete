// Insights tab (Unit U8) -- replaces the "Per-workout AI insights show here
// once you start logging workouts" stub with the real thing: recent
// completed workouts with their verdict, routing into /workouts/[id] for the
// full report.
//
// List logic (fetch + bounded verdict fan-out) lives in
// src/reports/useWorkoutReport.ts's useRecentWorkoutReports, built on the
// pure helpers in src/reports/report-view.ts (selectRecentWorkoutIds caps
// the request fan-out so an athlete with many completed workouts can never
// trigger an unbounded burst of report GETs, and zero workouts issues zero
// requests -- see useWorkoutReport.test.ts).

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/design/tokens";
import { formatDurationS } from "@/reports/report-view";
import { supabase } from "@/auth/supabase";
import { type RecentWorkoutItem, useRecentWorkoutReports } from "@/reports/useWorkoutReport";

export default function InsightsScreen() {
  const [athleteId, setAthleteId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setAthleteId(data.user?.id ?? null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const { phase, items } = useRecentWorkoutReports(athleteId);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Insights</Text>
      </View>

      {athleteId === null || phase === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading insights" />
        </View>
      ) : phase === "error" ? (
        <View style={styles.center}>
          <Text style={styles.body}>We couldn&apos;t load your insights right now.</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center} accessibilityLabel="No completed workouts yet">
          <Text style={styles.h2}>No insights yet</Text>
          <Text style={styles.body}>
            Per-workout AI insights show here once you start logging workouts.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((item) => (
            <WorkoutRow key={item.id} item={item} onPress={() => router.push(`/workouts/${item.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function WorkoutRow({ item, onPress }: { item: RecentWorkoutItem; onPress: () => void }) {
  const dateLabel = item.startedAt.slice(0, 10);
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.sport} on ${dateLabel}`}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowSport}>{sportLabel(item.sport)}</Text>
        <Text style={styles.caption}>
          {dateLabel}
          {item.durationS != null ? ` · ${formatDurationS(item.durationS)}` : ""}
        </Text>
      </View>
      {item.verdict ? (
        <Text style={styles.rowVerdict} numberOfLines={1}>
          {item.verdict.headline}
        </Text>
      ) : (
        <Text style={styles.caption}>View report →</Text>
      )}
    </Pressable>
  );
}

function sportLabel(sport: string): string {
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  h1: { ...typography.h1, color: colors.ink },
  h2: { ...typography.h2, color: colors.ink },
  body: { ...typography.body, color: colors.inkSubtle, textAlign: "center" },
  caption: { ...typography.caption, color: colors.inkSubtle },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  rowMain: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  rowSport: { ...typography.body, color: colors.ink, fontWeight: "600" },
  rowVerdict: { ...typography.caption, color: colors.ink, fontWeight: "600" },
});

// One period review on mobile (U11).
//
// Mirrors the web detail page's contract: the facts render as soon as the GET
// resolves and stay on screen for the whole lifetime of a generate, because
// `generate_start` never clears the response (see review-view.ts). No
// full-screen spinner ever hides numbers that are already correct.

import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PeriodKind, PeriodMetric } from "@da2/shared";

import { colors, spacing, typography } from "@/design/tokens";
import { usePeriodReview } from "@/reviews/usePeriodReviews";
import { formatDistanceM, formatDurationS, periodTitle } from "@/reviews/review-view";

export default function PeriodReviewScreen() {
  const params = useLocalSearchParams<{ kind: string; periodKey: string }>();
  const router = useRouter();

  const kind = (params.kind === "monthly" ? "monthly" : "weekly") as PeriodKind;
  const periodKey = String(params.periodKey ?? "");

  const { phase, view, generating, generate } = usePeriodReview(kind, periodKey);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.caption}>← Back</Text>
        </Pressable>
      </View>

      {phase === "loading" && !view ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading review" />
        </View>
      ) : phase === "unentitled" ? (
        <View style={styles.center}>
          <Text style={styles.h2}>Reviews are a paid feature</Text>
          <Text style={styles.body}>
            Upgrade to see how each week and month went against your plan.
          </Text>
        </View>
      ) : phase === "not_found" ? (
        <View style={styles.center}>
          <Text style={styles.h2}>Review unavailable</Text>
          <Text style={styles.body}>That period isn&apos;t ready to review yet.</Text>
        </View>
      ) : phase === "error" && !view ? (
        <View style={styles.center}>
          <Text style={styles.body}>We couldn&apos;t load this review right now.</Text>
        </View>
      ) : view ? (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.h1}>{periodTitle(kind, view.facts.bounds)}</Text>
          <Text style={styles.caption}>
            {view.facts.bounds.start} to {view.facts.bounds.end}
          </Text>

          <View style={styles.card}>
            <Stat label="Sessions" value={String(view.facts.totals.sessions)} />
            <Stat label="Time" value={formatDurationS(view.facts.totals.durationS)} />
            <Stat label="Distance" value={formatDistanceM(view.facts.totals.distanceM)} />
            <Stat label="Load" value={String(Math.round(view.facts.totals.load))} />
            {view.facts.totals.loadConfidence !== "power" &&
              view.facts.totals.loadConfidence !== "none" && (
                <Text style={styles.caption}>Load is partly estimated.</Text>
              )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Against your plan</Text>
            <Stat
              label="Prescribed done"
              value={`${view.facts.compliance.completed} of ${view.facts.compliance.prescribed}`}
            />
            <MetricRow label="Time" metric={view.facts.duration} format={formatDurationS} />
            <MetricRow
              label="Load"
              metric={view.facts.load}
              format={(n) => String(Math.round(n))}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coach&apos;s note</Text>

            {view.stale && (
              <Text style={styles.caption}>
                This note predates some of the numbers above. Regenerate for an up-to-date read.
              </Text>
            )}

            {view.narration ? (
              <>
                <Text style={styles.body}>{view.narration.note}</Text>
                <Text style={styles.takeaway}>{view.narration.takeaway}</Text>
              </>
            ) : (
              <Text style={styles.body}>
                Your numbers are ready. Generate a note to go with them.
              </Text>
            )}

            {view.notice && <Text style={styles.caption}>{view.notice}</Text>}

            <Pressable
              style={[styles.button, generating && styles.buttonBusy]}
              onPress={() => void generate()}
              disabled={generating}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>
                {generating
                  ? "Writing…"
                  : view.narration
                    ? view.stale
                      ? "Regenerate note"
                      : "Rewrite note"
                    : "Generate note"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function MetricRow({
  label,
  metric,
  format,
}: {
  label: string;
  metric: PeriodMetric;
  format: (n: number) => string;
}) {
  // Unknown is stated, never rendered as a zero prescription.
  if (metric.status === "unavailable") {
    return (
      <View style={styles.statRow}>
        <Text style={styles.caption}>{label}</Text>
        <Text style={styles.caption}>not comparable</Text>
      </View>
    );
  }
  const sign = metric.deltaPct > 0 ? "+" : "";
  return (
    <View style={styles.statRow}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.statValue}>
        {format(metric.actual)} of {format(metric.prescribed)} ({sign}
        {Math.round(metric.deltaPct)}%)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  h1: { ...typography.h1, color: colors.ink },
  h2: { ...typography.h2, color: colors.ink },
  body: { ...typography.body, color: colors.ink },
  caption: { ...typography.caption, color: colors.inkSubtle },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.body, color: colors.ink, fontWeight: "600" },
  statRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  statValue: { ...typography.body, color: colors.ink, fontWeight: "600" },
  takeaway: { ...typography.body, color: colors.inkSubtle, fontStyle: "italic" },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { ...typography.body, color: colors.bg, fontWeight: "600" },
});

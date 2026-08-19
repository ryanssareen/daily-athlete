// Workout report detail route (Unit U8) -- the mobile counterpart of the web
// per-workout report (U7). KTD2's defining property: the verdict + comparison
// render the instant the GET resolves and stay on screen for the entire
// lifetime of a narrative generate()/regenerate() POST -- there is no
// full-screen spinner gating them (see useWorkoutReport.ts / report-view.ts
// for where that invariant actually lives; this file is a thin RN shell).
//
// Not a modal (unlike (modals)/weekly-review) -- a plain stacked route so it
// can be pushed from the Insights tab list and from anywhere else a workout
// id is known later.

import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/design/tokens";
import { formatDimensionValue, type ComparisonView, type NarrativeView } from "@/reports/report-view";
import { useWorkoutReport } from "@/reports/useWorkoutReport";

export default function WorkoutReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { phase, view, generating, generate, refetch } = useWorkoutReport(id);

  return (
    <SafeAreaView style={styles.container}>
      <Header onBack={() => router.back()} />

      {phase === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} accessibilityLabel="Loading report" />
        </View>
      ) : phase === "not_found" ? (
        <View style={styles.center}>
          <Text style={styles.body}>We couldn&apos;t find this workout.</Text>
        </View>
      ) : phase === "error" ? (
        <View style={styles.center}>
          <Text style={styles.body}>We couldn&apos;t load this report.</Text>
          <Pressable style={styles.primaryButton} onPress={() => void refetch()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : view ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Verdict: painted immediately from the GET, never gated on narration. */}
          <View style={styles.verdictCard}>
            <Text style={styles.eyebrow}>How you did</Text>
            <Text style={styles.h1}>{view.verdict.headline}</Text>
          </View>

          <ComparisonSection comparison={view.comparison} />

          <NarrativeSection
            narrative={view.narrative}
            canRequestNarrative={view.canRequestNarrative}
            generating={generating}
            attemptFailed={view.attemptFailed}
            attemptRetryable={view.attemptRetryable}
            onGenerate={() => void generate()}
          />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function ComparisonSection({ comparison }: { comparison: ComparisonView }) {
  if (!comparison.matched) {
    return (
      <View style={styles.section}>
        <Text style={styles.h2}>Effort</Text>
        <Text style={styles.caption}>
          This wasn&apos;t matched to a planned workout -- it&apos;s read on its own terms.
        </Text>
      </View>
    );
  }

  if (comparison.rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.h2}>Prescribed vs. actual</Text>
      <View style={styles.rowList}>
        {comparison.rows.map((row) => (
          <View key={row.key} style={styles.dimensionRow}>
            <View style={styles.dimensionHeaderRow}>
              <Text style={styles.dimensionLabel}>{row.label}</Text>
              <View style={[styles.statusBadge, statusBadgeStyle(row.status)]}>
                <Text style={styles.statusBadgeText}>{statusLabel(row.status)}</Text>
              </View>
            </View>
            <Text style={styles.dimensionValues}>
              {formatDimensionValue(row, row.prescribed)} planned → {formatDimensionValue(row, row.actual)} actual
            </Text>
            {row.targetLabel ? <Text style={styles.caption}>Target: {row.targetLabel}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function narrativeActionLabel(narrative: NarrativeView, attemptFailed: boolean): string {
  if (narrative.status === "stale" || narrative.status === "superseded") return "Regenerate";
  if (narrative.status === "retryable" || attemptFailed) return "Retry";
  return "Generate report";
}

/**
 * Show the action button unless there is nothing left to ask for: a fresh
 * note with no failed attempt behind it. Note the `attemptFailed` term --
 * when a REgeneration fails over a healthy note, the route hands the old
 * note back (it wrote no row), so `status` is still "present" and without
 * this the athlete would be left with no way to try again.
 */
function showNarrativeAction(narrative: NarrativeView, attemptFailed: boolean, retryable: boolean): boolean {
  if (narrative.status === "failed") return false;
  if (attemptFailed && !retryable) return false;
  return narrative.status !== "present" || attemptFailed;
}

function NarrativeSection({
  narrative,
  canRequestNarrative,
  generating,
  attemptFailed,
  attemptRetryable,
  onGenerate,
}: {
  narrative: NarrativeView;
  canRequestNarrative: boolean;
  generating: boolean;
  attemptFailed: boolean;
  attemptRetryable: boolean;
  onGenerate: () => void;
}) {
  const hasNote = narrative.status === "present" || narrative.status === "stale";

  return (
    <View style={styles.section}>
      <Text style={styles.h2}>Coach&apos;s note</Text>

      {hasNote ? (
        <>
          {narrative.status === "stale" ? (
            <View style={styles.noticeNeutral}>
              <Text style={styles.noticeNeutralText}>This note may be out of date.</Text>
            </View>
          ) : null}
          {/* Untrusted LLM string -> plain Text only. */}
          <Text style={styles.narrative}>{narrative.note}</Text>
          <Text style={styles.takeaway}>{narrative.takeaway}</Text>
        </>
      ) : narrative.status === "superseded" ? (
        <Text style={styles.caption}>
          This workout&apos;s data changed and the verdict along with it -- the previous note no longer
          describes it.
        </Text>
      ) : narrative.status === "retryable" ? (
        <Text style={styles.caption}>We couldn&apos;t generate a note right now -- try again.</Text>
      ) : narrative.status === "failed" ? (
        <Text style={styles.caption}>We couldn&apos;t generate a note for this workout.</Text>
      ) : (
        <Text style={styles.caption}>Get an AI coach&apos;s note on this session.</Text>
      )}

      {/* A failed refresh that left the old note standing still needs to say
          so -- the note above is unchanged, and silence would read as
          success. */}
      {hasNote && attemptFailed ? (
        <Text style={styles.caption}>
          {attemptRetryable
            ? "We couldn't refresh this note right now -- try again."
            : "We couldn't refresh this note for this workout."}
        </Text>
      ) : null}

      {canRequestNarrative && showNarrativeAction(narrative, attemptFailed, attemptRetryable) ? (
        <Pressable
          style={[styles.primaryButton, generating && styles.btnDisabled]}
          disabled={generating}
          onPress={onGenerate}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {generating ? "Generating…" : narrativeActionLabel(narrative, attemptFailed)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function statusLabel(status: "on_target" | "under" | "over"): string {
  if (status === "on_target") return "On target";
  if (status === "under") return "Under";
  return "Over";
}

function statusBadgeStyle(status: "on_target" | "under" | "over") {
  if (status === "on_target") return { backgroundColor: colors.success };
  if (status === "under") return { backgroundColor: colors.brand };
  return { backgroundColor: colors.danger };
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Text style={styles.headerClose}>Back</Text>
      </Pressable>
      <Text style={styles.headerTitle}>Report</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.h2, color: colors.ink },
  headerClose: { ...typography.body, color: colors.brand, fontWeight: "600" },
  headerSpacer: { width: 44 },
  eyebrow: { ...typography.caption, color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 1 },
  h1: { ...typography.h1, color: colors.ink, marginTop: spacing.xs },
  h2: { ...typography.h2, color: colors.ink, marginBottom: spacing.sm },
  body: { ...typography.body, color: colors.ink, textAlign: "center" },
  caption: { ...typography.caption, color: colors.inkSubtle },
  verdictCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
  },
  rowList: { gap: spacing.md },
  dimensionRow: { gap: 2 },
  dimensionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dimensionLabel: { ...typography.body, color: colors.ink, fontWeight: "600" },
  dimensionValues: { ...typography.body, color: colors.inkSubtle },
  statusBadge: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusBadgeText: { ...typography.caption, color: "#FFFFFF", fontWeight: "700", fontSize: 11 },
  narrative: { ...typography.body, color: colors.ink, marginTop: spacing.sm },
  takeaway: { ...typography.body, color: colors.inkSubtle, fontStyle: "italic", marginTop: spacing.sm },
  noticeNeutral: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
  },
  noticeNeutralText: { ...typography.caption, color: colors.inkSubtle },
  primaryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonText: { ...typography.body, color: "#FFFFFF", fontWeight: "600" },
  btnDisabled: { opacity: 0.5 },
});

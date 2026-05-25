// AI adaptive proposal modal (Unit 11, mobile). The propose-then-confirm
// surface: a before→after diff of the proposed ops with per-op reason +
// preserved-invariant callouts, cherry-pick (modify) selection, and
// accept / reject. Single-column stacked layout (the before→after pair renders
// as sequential rows); the action bar is pinned to the bottom.
//
// Required states (all handled here): loading skeleton, error (CTA re-enables +
// inline "your plan is unchanged"), stale-skip inline (struck through), no_changes
// "on track" empty state, lapsed entitlement (read-only diff + "Renew to apply").
//
// Logic lives in src/adaptive/useProposal.ts + proposal-view.ts (unit-tested);
// this file is the React Native shell.

import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EditOpResult } from "@da2/shared";

import { api, ApiError } from "@/api/client";
import { supabase } from "@/auth/supabase";
import { colors, spacing, typography } from "@/design/tokens";
import {
  appliedOutcomes,
  preservedInvariants,
  selectionSummary,
  terminalStatusLabel,
  toOpRows,
  triggerLabel,
  useProposal,
  viewKindForStatus,
  wasSuperseded,
  type AppliedOutcome,
} from "@/adaptive/useProposal";

interface AcceptResponse {
  status: string;
  superseded: boolean;
  results: EditOpResult[];
}

export default function WeeklyReviewModal() {
  const router = useRouter();
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

  if (!athleteId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return <ProposalBody athleteId={athleteId} onClose={() => router.back()} />;
}

function ProposalBody({ athleteId, onClose }: { athleteId: string; onClose: () => void }) {
  const { phase, proposal, loadError, refetch } = useProposal(athleteId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seededId, setSeededId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const [outcomes, setOutcomes] = useState<AppliedOutcome[] | null>(null);
  const [supersededNotice, setSupersededNotice] = useState(false);

  // Seed selection to all ops when a fresh proposed proposal loads.
  useEffect(() => {
    if (proposal && proposal.status === "proposed" && seededId !== proposal.id) {
      setSelected(new Set(proposal.proposed_changes.map((e) => e.op.op_id)));
      setSeededId(proposal.id);
    }
  }, [proposal, seededId]);

  const rows = useMemo(() => (proposal ? toOpRows(proposal, "UTC") : []), [proposal]);
  const allOpIds = useMemo(() => rows.map((r) => r.opId), [rows]);
  const summary = useMemo(() => selectionSummary(allOpIds, selected), [allOpIds, selected]);
  const outcomeByOp = useMemo(() => {
    const m = new Map<string, AppliedOutcome>();
    for (const o of outcomes ?? []) m.set(o.opId, o);
    return m;
  }, [outcomes]);

  function toggleOp(opId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  }

  async function onAccept() {
    if (!proposal || summary.selectedCount === 0) return;
    setSubmitting(true);
    setActionError(false);
    try {
      const res = await api<AcceptResponse>(`/api/weekly-review/${proposal.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ op_ids: summary.selectedIds }),
      });
      setOutcomes(appliedOutcomes(res.results));
      if (wasSuperseded(res.status)) setSupersededNotice(true);
      await refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setLapsed(true);
      } else {
        setActionError(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onReject() {
    if (!proposal) return;
    setSubmitting(true);
    setActionError(false);
    try {
      await api(`/api/weekly-review/${proposal.id}/reject`, { method: "POST" });
      await refetch();
    } catch {
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  }

  // ----- States --------------------------------------------------------------

  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review" onClose={onClose} />
        <View style={styles.skeletonList} accessibilityLabel="Loading your review">
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <View style={[styles.skeletonBar, { width: "40%" }]} />
              <View style={[styles.skeletonBar, { width: "75%" }]} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "error" && loadError) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review" onClose={onClose} />
        <View style={styles.center}>
          <Text style={styles.body}>We couldn&apos;t load your review.</Text>
          <Text style={styles.caption}>Your plan is unchanged.</Text>
          <Pressable style={styles.primaryButton} onPress={() => void refetch()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!proposal) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review" onClose={onClose} />
        <View style={styles.center}>
          <Text style={styles.body}>No reviews yet.</Text>
          <Text style={styles.caption}>We&apos;ll let you know when your plan is reviewed.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const view = viewKindForStatus(proposal.status);

  if (view === "no_changes") {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Review" onClose={onClose} />
        <View style={styles.center} accessibilityLabel="On track">
          <Text style={styles.bigCheck}>✓</Text>
          <Text style={styles.h2}>Reviewed — you&apos;re on track</Text>
          <Text style={styles.caption}>
            {triggerLabel(proposal.trigger_kind)} · {proposal.generated_at.slice(0, 10)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActionable = view === "proposed" && !lapsed;
  const invariants = preservedInvariants(proposal);

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Review" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Page hierarchy: trigger label -> title -> narrative -> callouts */}
        <Text style={styles.eyebrow}>{triggerLabel(proposal.trigger_kind)}</Text>
        <Text style={styles.h1}>
          {view === "terminal" ? terminalStatusLabel(proposal.status) : "Your plan was reviewed"}
        </Text>
        {proposal.narrative ? (
          // Untrusted LLM string -> plain Text only.
          <Text style={styles.narrative}>{proposal.narrative}</Text>
        ) : null}

        <View style={styles.calloutRow}>
          {invariants.map((c) => (
            <View key={c} style={styles.callout}>
              <Text style={styles.calloutText}>✓ {c}</Text>
            </View>
          ))}
        </View>

        {/* Op rows */}
        <View style={styles.opList}>
          {rows.map((r) => {
            const outcome = outcomeByOp.get(r.opId);
            const struck = outcome?.skipped ?? false;
            const checked = selected.has(r.opId);
            return (
              <Pressable
                key={r.opId}
                disabled={!isActionable}
                onPress={() => toggleOp(r.opId)}
                style={[styles.opRow, struck && styles.opRowStruck]}
                accessibilityRole={isActionable ? "checkbox" : undefined}
                accessibilityState={isActionable ? { checked } : undefined}
                accessibilityLabel={`${r.verb} change`}
              >
                {isActionable ? (
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                ) : null}
                <View style={styles.opMain}>
                  <View style={styles.opHeaderRow}>
                    <View style={styles.verbBadge}>
                      <Text style={styles.verbBadgeText}>{r.verb}</Text>
                    </View>
                    {r.targetDate ? <Text style={styles.opDate}>{r.targetDate}</Text> : null}
                  </View>
                  {/* before -> after as sequential lines (single-column) */}
                  {r.before ? (
                    <Text style={[styles.opBefore, struck && styles.struckText]}>{r.before}</Text>
                  ) : null}
                  <Text style={[styles.opAfter, struck && styles.struckText]}>
                    {r.before ? "→ " : ""}
                    {r.after}
                  </Text>
                  <Text style={styles.opReason}>{r.reason}</Text>
                  {struck && outcome?.message ? (
                    <Text style={styles.opSkip}>{outcome.message}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {supersededNotice ? (
          <View style={styles.noticeNeutral}>
            <Text style={styles.noticeNeutralText}>
              Some of your plan changed while we were applying this — a fresh review is on its way.
            </Text>
          </View>
        ) : null}

        {actionError ? (
          <View style={styles.noticeError} accessibilityLiveRegion="polite">
            <Text style={styles.noticeErrorText}>
              Something went wrong — your plan is unchanged, try again.
            </Text>
          </View>
        ) : null}

        {/* Lapsed entitlement: full diff visible, upsell instead of actions. */}
        {lapsed ? (
          <View style={styles.lapsedBox}>
            <Text style={styles.lapsedTitle}>Renew to apply these changes</Text>
            <Text style={styles.caption}>
              Your AI plans subscription has lapsed. You can still see what was proposed, but applying
              changes needs an active plan.
            </Text>
            <Pressable style={styles.primaryButton} onPress={onClose} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>Renew to apply</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* Action bar (pinned bottom) */}
      {isActionable ? (
        <View style={styles.actionBar}>
          <Text style={styles.selectionSummary}>
            {summary.selectedCount} of {summary.totalCount} changes selected
          </Text>
          <View style={styles.actionButtons}>
            <Pressable
              style={[styles.secondaryButton, submitting && styles.btnDisabled]}
              disabled={submitting}
              onPress={() => void onReject()}
              accessibilityRole="button"
              accessibilityLabel="Reject"
            >
              <Text style={styles.secondaryButtonText}>Reject</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, (submitting || !summary.ctaEnabled) && styles.btnDisabled]}
              disabled={submitting || !summary.ctaEnabled}
              onPress={() => void onAccept()}
              accessibilityRole="button"
              accessibilityLabel={summary.ctaLabel}
            >
              <Text style={styles.primaryButtonText}>{submitting ? "Applying…" : summary.ctaLabel}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
        <Text style={styles.headerClose}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
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
  eyebrow: { ...typography.caption, color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 1 },
  h1: { ...typography.h1, color: colors.ink, marginTop: spacing.xs },
  h2: { ...typography.h2, color: colors.ink, textAlign: "center" },
  narrative: { ...typography.body, color: colors.inkSubtle, marginTop: spacing.sm },
  bigCheck: { fontSize: 40, color: colors.success },
  calloutRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  callout: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  calloutText: { ...typography.caption, color: colors.inkSubtle, fontWeight: "600" },
  opList: { marginTop: spacing.lg, gap: spacing.sm },
  opRow: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  opRowStruck: { opacity: 0.6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxMark: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  opMain: { flex: 1, gap: 2 },
  opHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  verbBadge: {
    backgroundColor: "#EFE7DD",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  verbBadgeText: { ...typography.caption, color: colors.ink, fontWeight: "700", fontSize: 11 },
  opDate: { ...typography.caption, color: colors.inkSubtle, fontSize: 12 },
  opBefore: { ...typography.caption, color: colors.inkSubtle },
  opAfter: { ...typography.body, color: colors.ink, fontWeight: "600" },
  opReason: { ...typography.caption, color: colors.inkSubtle, marginTop: spacing.xs },
  opSkip: { ...typography.caption, color: colors.danger, fontWeight: "600", marginTop: spacing.xs },
  struckText: { textDecorationLine: "line-through" },
  noticeError: {
    marginTop: spacing.md,
    backgroundColor: "#FDEDEE",
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
  },
  noticeErrorText: { ...typography.caption, color: colors.danger },
  noticeNeutral: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
  },
  noticeNeutralText: { ...typography.caption, color: colors.inkSubtle },
  lapsedBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  lapsedTitle: { ...typography.body, color: colors.ink, fontWeight: "700" },
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  selectionSummary: { ...typography.caption, color: colors.inkSubtle },
  actionButtons: { flexDirection: "row", gap: spacing.sm },
  body: { ...typography.body, color: colors.ink, textAlign: "center" },
  caption: { ...typography.caption, color: colors.inkSubtle, textAlign: "center" },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonText: { ...typography.body, color: "#FFFFFF", fontWeight: "600" },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryButtonText: { ...typography.body, color: colors.ink, fontWeight: "500" },
  btnDisabled: { opacity: 0.5 },
  skeletonList: { padding: spacing.lg, gap: spacing.md },
  skeletonRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonBar: { height: 12, borderRadius: 6, backgroundColor: colors.border },
});

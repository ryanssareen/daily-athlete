// "Review ready" banner (Unit 11, mobile home). Surfaces the most relevant
// pending proposal — "Your plan was reviewed — N changes proposed" + the
// human-readable trigger label — and opens the weekly-review modal. Persists
// until the proposal is terminal (the underlying useProposal refetches on
// Realtime + foreground, so it appears/disappears live). Renders nothing when
// no proposal is pending.

import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/design/tokens";

import { bannerFor, useProposal } from "./useProposal";

export default function ReviewBanner({ athleteId }: { athleteId: string }) {
  const router = useRouter();
  const { proposal } = useProposal(athleteId);

  // useProposal returns a single proposal; reuse bannerFor for consistent copy.
  const banner = proposal ? bannerFor([proposal]) : null;
  if (!banner) return null;

  return (
    <Pressable
      style={styles.banner}
      onPress={() => router.push("/(modals)/weekly-review")}
      accessibilityRole="button"
      accessibilityLabel={`${banner.headline}. ${banner.triggerLabel}. Open review.`}
    >
      <View style={styles.icon}>
        <Text style={styles.iconText}>✦</Text>
      </View>
      <View style={styles.textCol}>
        <Text style={styles.headline}>{banner.headline}</Text>
        <Text style={styles.subline}>{banner.triggerLabel}</Text>
      </View>
      <Text style={styles.cta}>Review →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#F3ECE3",
    borderColor: "#E2D2BE",
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.lg,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "#E2D2BE",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: 16, color: colors.ink },
  textCol: { flex: 1, gap: 2 },
  headline: { ...typography.body, color: colors.ink, fontWeight: "600" },
  subline: { ...typography.caption, color: colors.inkSubtle },
  cta: { ...typography.caption, color: colors.ink, fontWeight: "700" },
});

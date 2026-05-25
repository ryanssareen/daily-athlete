import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/auth/supabase";
import ReviewBanner from "@/adaptive/ReviewBanner";
import { colors, spacing, typography } from "@/design/tokens";

export default function TodayScreen() {
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {athleteId ? <ReviewBanner athleteId={athleteId} /> : null}
        <Text style={styles.h1}>Today</Text>
        <Text style={styles.body}>
          Your next workout will appear here once you have a plan. Connect Strava in
          Profile to import your training history.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.xl, gap: spacing.md },
  h1: { ...typography.h1, color: colors.ink },
  body: { ...typography.body, color: colors.inkSubtle },
});

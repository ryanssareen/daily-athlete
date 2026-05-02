import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/design/tokens";

export default function InsightsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.h1}>Insights</Text>
        <Text style={styles.body}>
          Per-workout AI insights show here once you start logging workouts.
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

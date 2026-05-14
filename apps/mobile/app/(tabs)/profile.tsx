import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, ApiError } from "@/api/client";
import { supabase } from "@/auth/supabase";
import { colors, spacing, typography } from "@/design/tokens";
import { StravaConnectSection } from "@/integrations/strava";

type Me = {
  id: string;
  email: string | null;
  display_name: string | null;
  timezone: string;
};

export default function ProfileScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/me")
      .then(setMe)
      .catch((err: ApiError) => setError(err.message));
  }, []);

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out failed", error.message);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.h1}>Profile</Text>
        {error && <Text style={styles.error}>API error: {error}</Text>}
        {me ? (
          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{me.email ?? "—"}</Text>
            <Text style={styles.label}>Timezone</Text>
            <Text style={styles.value}>{me.timezone}</Text>
          </View>
        ) : (
          <Text style={styles.body}>Loading...</Text>
        )}
        <StravaConnectSection />
        <Pressable style={styles.button} onPress={handleSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.xl, gap: spacing.lg },
  h1: { ...typography.h1, color: colors.ink },
  body: { ...typography.body, color: colors.inkSubtle },
  error: { ...typography.body, color: colors.danger },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  label: { ...typography.caption, color: colors.inkSubtle },
  value: { ...typography.body, color: colors.ink, marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: "center",
  },
  buttonText: { ...typography.body, color: colors.danger, fontWeight: "600" },
});

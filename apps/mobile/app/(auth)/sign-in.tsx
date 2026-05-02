import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/auth/supabase";
import { colors, spacing, typography } from "@/design/tokens";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleMagicLink = async () => {
    if (!email) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setSending(false);
    if (error) {
      Alert.alert("Sign-in failed", error.message);
    } else {
      Alert.alert("Check your email", "We sent you a sign-in link.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>DA2</Text>
        <Text style={styles.subtitle}>AI-paced training for endurance athletes.</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Pressable
          style={[styles.button, (sending || !email) && styles.buttonDisabled]}
          onPress={handleMagicLink}
          disabled={sending || !email}
        >
          <Text style={styles.buttonText}>{sending ? "Sending..." : "Email me a link"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: spacing.xl, justifyContent: "center", gap: spacing.lg },
  title: { ...typography.h1, color: colors.ink },
  subtitle: { ...typography.body, color: colors.inkSubtle, marginBottom: spacing.lg },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...typography.body, color: colors.surface, fontWeight: "600" },
});

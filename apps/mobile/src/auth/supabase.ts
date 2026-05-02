import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import "react-native-url-polyfill/auto";

const supabaseUrl = (Constants.expoConfig?.extra?.supabaseUrl as string) ?? "";
const supabaseAnonKey = (Constants.expoConfig?.extra?.supabaseAnonKey as string) ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase] SUPABASE_URL or SUPABASE_ANON_KEY not set in app.json extra. " +
      "The app will boot but auth and realtime will not work until these are configured."
  );
}

export const supabase = createClient(supabaseUrl || "https://placeholder", supabaseAnonKey || "placeholder", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

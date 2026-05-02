import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/auth/supabase";

export function subscribeToPlan(
  planId: string,
  onChange: (payload: unknown) => void
): RealtimeChannel {
  return supabase
    .channel(`plan:${planId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "planned_workouts", filter: `plan_id=eq.${planId}` },
      onChange
    )
    .subscribe();
}

import { AgentsDashboard } from "@/components/agents/agents-dashboard";
import { isSupabaseConfigured } from "@/lib/auth/env";
import {
  buildAllAgentMemories,
  fetchAgentFeedback,
} from "@/lib/ajax/agent-memory";
import { createClient } from "@/lib/supabase/server";

export default async function AgentsPage() {
  const ready = isSupabaseConfigured();
  let isAuthenticated = false;
  let initialAgents = buildAllAgentMemories([]);

  if (ready) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        isAuthenticated = true;
        const feedback = await fetchAgentFeedback(supabase, user.id);
        initialAgents = buildAllAgentMemories(feedback);
      }
    } catch (err) {
      console.error("[agents page] failed to load memory", err);
    }
  }

  return (
    <AgentsDashboard
      initialAgents={initialAgents}
      isAuthenticated={isAuthenticated}
      configReady={ready}
    />
  );
}

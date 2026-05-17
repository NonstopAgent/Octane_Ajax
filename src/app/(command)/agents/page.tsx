import { AgentsDashboard } from "@/components/agents/agents-dashboard";
import {
  buildAllAgentMemories,
  fetchAgentFeedback,
} from "@/lib/ajax/agent-memory";
import { createClient } from "@/lib/supabase/server";

function configReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export default async function AgentsPage() {
  const ready = configReady();
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

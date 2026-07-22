import { MissionControlDashboard } from "@/components/mission-control/mission-control-dashboard";

/** Live ops view — data loads client-side from /api/ajax/mission-control. */
export default function MissionControlPage() {
  return <MissionControlDashboard />;
}

export const AGENTS = [
  {
    id: "nova",
    name: "Nova",
    role: "Research Agent",
    description:
      "Scans trends, demand signals, and niche opportunities. Pushes structured product ideas into the pipeline.",
    accent: "blue" as const,
    station: "Research Lab",
  },
  {
    id: "forge",
    name: "Forge",
    role: "Creation Agent",
    description:
      "Turns ideas into listings, mockups, and assets. Simulated in MVP; real Printify/Etsy adapters later.",
    accent: "orange" as const,
    station: "Design Press",
  },
  {
    id: "pixel",
    name: "Pixel",
    role: "Marketing Agent",
    description:
      "Creates and schedules short-form content when products are approved. Simulated in MVP.",
    accent: "blue" as const,
    station: "Media Studio",
  },
] as const;

export const FACTORY_STATIONS = [
  { id: "research", name: "Research Lab", agent: "Nova" },
  { id: "design", name: "Design Press", agent: "Forge" },
  { id: "review", name: "Review Gate", agent: "Human" },
  { id: "media", name: "Media Studio", agent: "Pixel" },
  { id: "storefront", name: "Storefront", agent: "—" },
] as const;

// Operator-focused navigation (Manus Part 2 cleanup). /store and /operator-store
// routes stay alive but are off the sidebar — Etsy is where products actually sell,
// and approved listings are visible via the Dashboard funnel.
export const NAV_ITEMS = [
  { href: "/factory", label: "Factory", description: "Live AI agent ecosystem" },
  { href: "/dashboard", label: "Dashboard", description: "Command center" },
  { href: "/review", label: "Review", description: "Approve or reject" },
  { href: "/store-qa", label: "Store QA", description: "Whole-shop quality sweep" },
  {
    href: "/marketing",
    label: "Content",
    description: "Social copy & TikTok",
  },
  { href: "/agents", label: "Agents", description: "Memory & learning" },
  {
    href: "/war-room",
    label: "War Room",
    description: "Strategy intelligence",
  },
  {
    href: "/businesses",
    label: "Businesses",
    description: "Ecosystem of shops",
  },
  { href: "/settings", label: "Settings", description: "Connections & config" },
] as const;

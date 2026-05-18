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

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", description: "Factory overview" },
  { href: "/factory", label: "Factory", description: "Live floor map" },
  { href: "/review", label: "Review", description: "Human-in-the-loop" },
  { href: "/store", label: "Store", description: "Internal storefront" },
  { href: "/agents", label: "Agents", description: "Memory & learning" },
  { href: "/settings", label: "Settings", description: "Demo & config" },
] as const;

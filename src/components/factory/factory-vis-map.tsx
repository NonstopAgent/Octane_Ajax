"use client";

/**
 * Factory Floor Visualization — isometric-style SVG map with animated agents,
 * glowing rooms, conveyor belt connections, and live product particles.
 */

import { useEffect, useRef, useState } from "react";
import type { AgentSlug } from "@/lib/ajax/types";
import type { AgentStatus } from "@/lib/ajax/status";
import { ROOM_SLUGS } from "@/lib/ajax/constants";

export type VisAgent = {
  slug: AgentSlug;
  status: AgentStatus;
  currentRoom: string | null;
};

export type VisMetrics = {
  productIdeas: number;
  pendingReviews: number;
  scheduledContent: number;
  publishedListings: number;
};

type FactoryVisMapProps = {
  agents: VisAgent[];
  metrics: VisMetrics;
  running: boolean;
  cyclePhase: "nova" | "forge" | null;
  runningPixel: boolean;
  resetting: boolean;
  lastEventMessage?: string;
  onRunCycle: () => void;
  onRunPixel: () => void;
  onResetFactory: () => void;
};

// Room definitions: position, size, agent, color accent
const ROOMS = [
  {
    id: "research",
    slug: ROOM_SLUGS.RESEARCH_LAB,
    label: "Research Lab",
    sublabel: "Nova",
    agentSlug: "nova" as AgentSlug,
    x: 24, y: 70, w: 210, h: 140,
    color: "#00d4ff",
    glow: "rgba(0,212,255,0.4)",
    gradFrom: "rgba(0,212,255,0.08)",
  },
  {
    id: "forge",
    slug: ROOM_SLUGS.DESIGN_PRESS,
    label: "Design Press",
    sublabel: "Forge",
    agentSlug: "forge" as AgentSlug,
    x: 300, y: 70, w: 210, h: 140,
    color: "#ff6b2c",
    glow: "rgba(255,107,44,0.4)",
    gradFrom: "rgba(255,107,44,0.08)",
  },
  {
    id: "review",
    slug: ROOM_SLUGS.REVIEW_GATE,
    label: "Review Gate",
    sublabel: "Human",
    agentSlug: null,
    x: 576, y: 70, w: 210, h: 140,
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.4)",
    gradFrom: "rgba(245,158,11,0.08)",
  },
  {
    id: "pixel",
    slug: ROOM_SLUGS.MEDIA_STUDIO,
    label: "Media Studio",
    sublabel: "Pixel",
    agentSlug: "pixel" as AgentSlug,
    x: 300, y: 280, w: 210, h: 140,
    color: "#22d3ee",
    glow: "rgba(34,211,238,0.4)",
    gradFrom: "rgba(34,211,238,0.08)",
  },
  {
    id: "storefront",
    slug: ROOM_SLUGS.STOREFRONT,
    label: "Storefront",
    sublabel: "Live",
    agentSlug: null,
    x: 576, y: 280, w: 210, h: 140,
    color: "#4ade80",
    glow: "rgba(74,222,128,0.4)",
    gradFrom: "rgba(74,222,128,0.08)",
  },
] as const;

// Conveyor connections between rooms
const CONVEYORS = [
  { id: "nova-forge",    from: "research", to: "forge",      path: "M234,140 L300,140" },
  { id: "forge-review",  from: "forge",    to: "review",     path: "M510,140 L576,140" },
  { id: "review-pixel",  from: "review",   to: "pixel",      path: "M681,210 L681,280 L510,280" },
  { id: "pixel-store",   from: "pixel",    to: "storefront", path: "M510,350 L576,350" },
] as const;

// Agent color map
const AGENT_COLORS: Record<AgentSlug, { body: string; glow: string }> = {
  nova:  { body: "#00d4ff", glow: "rgba(0,212,255,0.6)" },
  forge: { body: "#ff6b2c", glow: "rgba(255,107,44,0.6)" },
  pixel: { body: "#22d3ee", glow: "rgba(34,211,238,0.6)" },
};

function getRoomCenter(room: typeof ROOMS[number]) {
  return { cx: room.x + room.w / 2, cy: room.y + room.h / 2 };
}

function agentInRoom(agents: VisAgent[], roomSlug: string) {
  return agents.find((a) => a.currentRoom === roomSlug);
}

function isRoomActive(agents: VisAgent[], roomSlug: string) {
  const a = agentInRoom(agents, roomSlug);
  return a && (a.status === "working" || a.status === "thinking");
}

function isConveyorActive(
  agents: VisAgent[],
  conveyorId: string,
  running: boolean,
  cyclePhase: string | null,
) {
  if (conveyorId === "nova-forge" && running && cyclePhase === "nova") return true;
  if (conveyorId === "forge-review" && running && cyclePhase === "forge") return true;
  return false;
}

// Simple pixel-art agent character in SVG
function AgentWorkerSvg({
  cx, cy, slug, status,
}: {
  cx: number; cy: number; slug: AgentSlug; status: AgentStatus;
}) {
  const c = AGENT_COLORS[slug];
  const working = status === "working" || status === "thinking";
  const waiting = status === "waiting_review";
  const glowId = `glow-${slug}`;

  return (
    <g
      className={working ? "agent-worker-bounce" : waiting ? "agent-worker-pulse" : "agent-worker-idle"}
      transform={`translate(${cx}, ${cy})`}
    >
      {/* Glow halo */}
      <circle
        cx={0} cy={4}
        r={working ? 22 : 16}
        fill={c.glow}
        opacity={working ? 0.5 : waiting ? 0.4 : 0.25}
        className={working ? "agent-halo-working" : "agent-halo-idle"}
      />
      {/* Body */}
      <rect x={-8} y={0} width={16} height={18} rx={3}
        fill={c.body} opacity={0.9}
      />
      {/* Head */}
      <rect x={-6} y={-14} width={12} height={12} rx={2}
        fill={c.body}
      />
      {/* Eyes */}
      <rect x={-4} y={-11} width={3} height={3} rx={1} fill="#0b0e14" />
      <rect x={1} y={-11} width={3} height={3} rx={1} fill="#0b0e14" />
      {/* Working indicator */}
      {working && (
        <g>
          <circle cx={0} cy={-22} r={4} fill={c.body} opacity={0.9}
            className="agent-work-dot"
          />
          <circle cx={8} cy={-26} r={3} fill={c.body} opacity={0.7}
            className="agent-work-dot-2"
          />
        </g>
      )}
      {/* Waiting indicator */}
      {waiting && (
        <rect x={-2} y={-22} width={4} height={4} rx={1}
          fill="#f59e0b" className="agent-wait-dot"
        />
      )}
    </g>
  );
}

// Animated conveyor connection
function ConveyorLine({
  d, active, color,
}: {
  d: string; active: boolean; color: string;
}) {
  return (
    <g>
      {/* Base track */}
      <path
        d={d}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
      />
      {/* Active flow */}
      <path
        d={d}
        stroke={active ? color : "rgba(255,255,255,0.1)"}
        strokeWidth={active ? 3 : 2}
        fill="none"
        strokeDasharray={active ? "8 6" : "4 8"}
        strokeLinecap="round"
        className={active ? "conveyor-flow-active" : "conveyor-flow-idle"}
        style={{ filter: active ? `drop-shadow(0 0 6px ${color})` : "none" }}
      />
      {/* Animated particle */}
      {active && (
        <circle r={4} fill={color} opacity={0.9}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        >
          <animateMotion
            path={d}
            dur="1.2s"
            repeatCount="indefinite"
            calcMode="linear"
          />
        </circle>
      )}
    </g>
  );
}

// Individual room tile
function RoomTile({
  room,
  agent,
  active,
  alerting,
}: {
  room: typeof ROOMS[number];
  agent: VisAgent | undefined;
  active: boolean;
  alerting: boolean;
}) {
  const { cx, cy } = getRoomCenter(room);
  const filterId = `room-filter-${room.id}`;

  return (
    <g>
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={active || alerting ? 8 : 4} result="blur" />
          <feColorMatrix in="blur" type="saturate" values="3" result="saturated" />
          <feMerge>
            <feMergeNode in="saturated" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Room background */}
      <rect
        x={room.x} y={room.y} width={room.w} height={room.h}
        rx={10}
        fill="url(#room-grad)"
        className={active ? "room-active-fill" : alerting ? "room-alert-fill" : "room-idle-fill"}
        style={{
          fill: `linear-gradient(145deg, #141b26 0%, #0f141c 100%)`,
        }}
      />

      {/* Gradient overlay for active state */}
      {(active || alerting) && (
        <rect
          x={room.x} y={room.y} width={room.w} height={room.h}
          rx={10}
          fill={room.gradFrom}
          opacity={0.8}
        />
      )}

      {/* Neon border */}
      <rect
        x={room.x} y={room.y} width={room.w} height={room.h}
        rx={10}
        fill="none"
        stroke={active || alerting ? room.color : "rgba(255,255,255,0.08)"}
        strokeWidth={active ? 1.5 : 1}
        style={{
          filter: active ? `drop-shadow(0 0 8px ${room.glow})` : "none",
        }}
        className={active ? "room-border-active" : ""}
      />

      {/* Corner bracket decorations */}
      <path d={`M${room.x+4},${room.y+18} L${room.x+4},${room.y+4} L${room.x+18},${room.y+4}`}
        stroke={room.color} strokeWidth={1.5} fill="none" opacity={0.6} strokeLinecap="round"
      />
      <path d={`M${room.x+room.w-18},${room.y+4} L${room.x+room.w-4},${room.y+4} L${room.x+room.w-4},${room.y+18}`}
        stroke={room.color} strokeWidth={1.5} fill="none" opacity={0.6} strokeLinecap="round"
      />
      <path d={`M${room.x+4},${room.y+room.h-18} L${room.x+4},${room.y+room.h-4} L${room.x+18},${room.y+room.h-4}`}
        stroke={room.color} strokeWidth={1.5} fill="none" opacity={0.6} strokeLinecap="round"
      />
      <path d={`M${room.x+room.w-18},${room.y+room.h-4} L${room.x+room.w-4},${room.y+room.h-4} L${room.x+room.w-4},${room.y+room.h-18}`}
        stroke={room.color} strokeWidth={1.5} fill="none" opacity={0.6} strokeLinecap="round"
      />

      {/* Status LED */}
      <circle
        cx={room.x + 16} cy={room.y + 16}
        r={4}
        fill={active ? room.color : alerting ? "#f59e0b" : "rgba(255,255,255,0.2)"}
        style={{ filter: active ? `drop-shadow(0 0 6px ${room.glow})` : "none" }}
        className={active ? "led-pulse" : alerting ? "led-alert" : ""}
      />

      {/* Room labels */}
      <text
        x={room.x + 28} y={room.y + 20}
        fill={room.color} fontSize={9}
        fontFamily="monospace" fontWeight="600"
        letterSpacing="0.12em"
        opacity={0.9}
        style={{ textTransform: "uppercase" }}
      >
        {room.sublabel}
      </text>

      <text
        x={room.x + room.w / 2} y={room.y + 44}
        fill="rgba(255,255,255,0.85)" fontSize={13}
        fontFamily="monospace" fontWeight="700"
        textAnchor="middle"
        letterSpacing="0.05em"
      >
        {room.label.split(" ")[0]}
      </text>
      <text
        x={room.x + room.w / 2} y={room.y + 60}
        fill="rgba(255,255,255,0.85)" fontSize={13}
        fontFamily="monospace" fontWeight="700"
        textAnchor="middle"
        letterSpacing="0.05em"
      >
        {room.label.split(" ")[1] ?? ""}
      </text>

      {/* Scan line (active rooms) */}
      {active && (
        <rect
          x={room.x} y={room.y + room.h - 2}
          width={room.w} height={2}
          rx={1}
          fill={room.color}
          opacity={0.7}
          className="room-scan-line"
        />
      )}

      {/* Agent worker */}
      {agent && room.agentSlug && (
        <AgentWorkerSvg
          cx={cx}
          cy={cy + 10}
          slug={room.agentSlug}
          status={agent.status}
        />
      )}

      {/* Review gate: human icon */}
      {room.id === "review" && (
        <g transform={`translate(${cx}, ${cy + 10})`} opacity={alerting ? 1 : 0.5}>
          <circle cx={0} cy={-12} r={8} fill="rgba(245,158,11,0.3)"
            stroke="#f59e0b" strokeWidth={1.5}
            className={alerting ? "led-alert" : ""}
          />
          <text x={0} y={-8} textAnchor="middle" fontSize={10} fill="#f59e0b">
            ⚡
          </text>
          <rect x={-10} y={0} width={20} height={14} rx={3}
            fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth={1}
          />
        </g>
      )}

      {/* Storefront: checkmark icon */}
      {room.id === "storefront" && (
        <g transform={`translate(${cx}, ${cy + 10})`}>
          <circle cx={0} cy={-8} r={12} fill="rgba(74,222,128,0.15)"
            stroke="#4ade80" strokeWidth={1}
          />
          <text x={0} y={-3} textAnchor="middle" fontSize={14} fill="#4ade80">
            ✓
          </text>
        </g>
      )}
    </g>
  );
}

// Bottom ticker showing last event
function EventTicker({ message }: { message?: string }) {
  return (
    <div className="vis-ticker">
      <span className="vis-ticker-label">SYS.LOG</span>
      <span className="vis-ticker-text">{message ?? "Factory idle — awaiting cycle start"}</span>
    </div>
  );
}

export function FactoryVisMap({
  agents,
  metrics,
  running,
  cyclePhase,
  runningPixel,
  resetting,
  lastEventMessage,
  onRunCycle,
  onRunPixel,
  onResetFactory,
}: FactoryVisMapProps) {
  const [tick, setTick] = useState(0);
  const [elapsed, setElapsed] = useState("00:00");
  const startRef = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      const secs = Math.floor((Date.now() - startRef.current) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, "0");
      const s = String(secs % 60).padStart(2, "0");
      setElapsed(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const busy = running || runningPixel || resetting;
  const activeAgents = agents.filter(
    (a) => a.status === "working" || a.status === "thinking",
  ).length;

  return (
    <div className="vis-wrapper">
      {/* Top status bar */}
      <div className="vis-topbar">
        <div className="vis-topbar-left">
          <span className="vis-logo">OCTANE AJAX</span>
          <span className="vis-divider">|</span>
          <span className="vis-session">SESSION {elapsed}</span>
        </div>
        <div className="vis-topbar-center">
          <div className="vis-status-lights">
            {agents.map((a) => (
              <span
                key={a.slug}
                className={`vis-agent-light vis-agent-light--${a.status === "working" || a.status === "thinking" ? "active" : a.status === "waiting_review" ? "waiting" : "idle"}`}
                title={`${a.slug}: ${a.status}`}
              />
            ))}
          </div>
          {running && (
            <span className="vis-phase-badge">
              {cyclePhase === "nova" ? "▶ NOVA SCANNING" : "▶ FORGE BUILDING"}
            </span>
          )}
        </div>
        <div className="vis-topbar-right">
          <span className="vis-stat">ACTIVE <strong>{activeAgents}</strong></span>
          <span className="vis-stat">QUEUE <strong>{metrics.pendingReviews}</strong></span>
          <span className="vis-stat">LIVE <strong>{metrics.publishedListings}</strong></span>
        </div>
      </div>

      {/* Main SVG factory map */}
      <div className="vis-map-container">
        <svg
          viewBox="0 0 810 450"
          xmlns="http://www.w3.org/2000/svg"
          className="vis-svg"
          aria-label="Factory floor map"
        >
          {/* Grid background pattern */}
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M28 0 L0 0 0 28" fill="none" stroke="rgba(0,212,255,0.04)" strokeWidth="0.5"/>
            </pattern>
            <radialGradient id="center-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,212,255,0.06)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <rect width="810" height="450" fill="url(#grid)" />
          <rect width="810" height="450" fill="url(#center-glow)" />

          {/* Conveyor connections */}
          {CONVEYORS.map((conv) => {
            const fromRoom = ROOMS.find((r) => r.id === conv.from)!;
            const active = isConveyorActive(agents, conv.id, running, cyclePhase);
            return (
              <ConveyorLine
                key={conv.id}
                d={conv.path}
                active={active}
                color={fromRoom.color}
              />
            );
          })}

          {/* Review→Pixel special connector label */}
          <text x="700" y="255" fill="rgba(245,158,11,0.5)" fontSize={8}
            fontFamily="monospace" textAnchor="middle">
            ON APPROVE
          </text>

          {/* Rooms */}
          {ROOMS.map((room) => {
            const agent = room.agentSlug
              ? agentInRoom(agents, room.slug)
              : undefined;
            const active = isRoomActive(agents, room.slug) ?? false;
            const alerting =
              room.id === "review" && metrics.pendingReviews > 0;

            return (
              <RoomTile
                key={room.id}
                room={room}
                agent={agent}
                active={active}
                alerting={alerting}
              />
            );
          })}

          {/* Metrics overlay (bottom-right corner) */}
          <g transform="translate(0, 420)">
            <text x="24" y="18" fill="rgba(0,212,255,0.6)" fontSize={9}
              fontFamily="monospace" letterSpacing="0.08em">
              IDEAS:{" "}
              <tspan fill="rgba(0,212,255,1)" fontWeight="700">
                {metrics.productIdeas}
              </tspan>
              {"  "}CONTENT:{" "}
              <tspan fill="rgba(0,212,255,1)" fontWeight="700">
                {metrics.scheduledContent}
              </tspan>
              {"  "}REVIEW:{" "}
              <tspan fill={metrics.pendingReviews > 0 ? "#f59e0b" : "rgba(0,212,255,1)"} fontWeight="700">
                {metrics.pendingReviews}
              </tspan>
              {"  "}PUBLISHED:{" "}
              <tspan fill="#4ade80" fontWeight="700">
                {metrics.publishedListings}
              </tspan>
            </text>
          </g>
        </svg>
      </div>

      {/* Controls bar */}
      <div className="vis-controls">
        <button
          type="button"
          onClick={onRunCycle}
          disabled={busy}
          className="vis-btn vis-btn--primary"
        >
          {running ? (
            <span className="vis-btn-inner">
              <span className="vis-spinner" />
              {cyclePhase === "nova" ? "NOVA SCANNING…" : "FORGE BUILDING…"}
            </span>
          ) : (
            "▶ RUN CYCLE"
          )}
        </button>

        <button
          type="button"
          onClick={onRunPixel}
          disabled={busy}
          className="vis-btn vis-btn--secondary"
        >
          {runningPixel ? (
            <span className="vis-btn-inner"><span className="vis-spinner" /> PIXEL…</span>
          ) : "▶ RUN PIXEL"}
        </button>

        <button
          type="button"
          onClick={onResetFactory}
          disabled={busy}
          className="vis-btn vis-btn--ghost"
        >
          {resetting ? "RESETTING…" : "⟳ RESET"}
        </button>
      </div>

      {/* Event ticker */}
      <EventTicker message={lastEventMessage} />
    </div>
  );
}

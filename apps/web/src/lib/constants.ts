import type { LucideIcon } from "lucide-react";
import { TINYBAR_PER_HBAR } from "@proofwork/shared/browser";
import {
  Activity,
  Bot,
  Briefcase,
  LayoutDashboard,
  ListTodo,
  MapPin,
  MessageSquare,
  Wallet,
} from "lucide-react";

/** Mumbai map pin — Colaba / Gateway corridor. */
export const MUMBAI_PIN = { lat: 19.076, lng: 72.877 } as const;

/** @deprecated Use TINYBAR_PER_HBAR — canonical unit is tinybar (8 decimals). */
export const WEI_PER_UNIT = TINYBAR_PER_HBAR;

/** Bottom-tab fallback + legacy links still use this. */
export const NAV = [
  { href: "/owner/pot", label: "Owner", hint: "Pot" },
  { href: "/worker/tasks", label: "Work", hint: "Tasks" },
  { href: "/feed/nearby", label: "Nearby", hint: "Map" },
] as const;

export type DeskNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const OWNER_NAV: DeskNavItem[] = [
  { href: "/owner", label: "Overview", icon: LayoutDashboard },
  { href: "/owner/pot", label: "Pot & Funding", icon: Wallet },
  { href: "/owner/gigs", label: "Gigs", icon: Briefcase },
  { href: "/owner/messages", label: "Messages", icon: MessageSquare },
  { href: "/owner/agents", label: "Agents", icon: Bot },
  { href: "/owner/activity", label: "Activity", icon: Activity },
];

export const WORKER_NAV: DeskNavItem[] = [
  { href: "/worker/tasks", label: "Gig board", icon: ListTodo },
  { href: "/worker/claims", label: "My claims", icon: Briefcase },
  { href: "/worker/messages", label: "Messages", icon: MessageSquare },
  { href: "/feed/nearby", label: "Nearby", icon: MapPin },
];

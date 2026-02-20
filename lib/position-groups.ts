import { PlayerTab } from "@/types/player";

export const POSITION_GROUPS: Record<PlayerTab, string[]> = {
  attacker: ["ST", "CF", "LW", "RW", "LF", "RF"],
  midfielder: ["CAM", "CM", "CDM", "LM", "RM"],
  defender: ["CB", "LB", "RB", "LWB", "RWB"],
  goalkeeper: ["GK"],
};

export const TAB_LABELS: Record<PlayerTab, string> = {
  attacker: "Attacker",
  midfielder: "Midfielder",
  defender: "Defender",
  goalkeeper: "Goalkeeper",
};

export function parseTab(input: string | null): PlayerTab {
  const key = String(input ?? "").toLowerCase();
  if (key === "midfielder") return "midfielder";
  if (key === "defender") return "defender";
  if (key === "goalkeeper") return "goalkeeper";
  return "attacker";
}

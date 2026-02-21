export type ReviewRoleGroup =
  | "attacker"
  | "midfielder"
  | "defender"
  | "goalkeeper";

const POSITIONS_BY_GROUP: Record<ReviewRoleGroup, readonly string[]> = {
  attacker: ["ST", "CF", "LW", "RW", "LF", "RF"],
  midfielder: ["CAM", "CM", "CDM", "LM", "RM"],
  defender: ["CB", "LB", "RB", "LWB", "RWB"],
  goalkeeper: ["GK"],
};

export const REVIEW_TAGS_BY_GROUP: Record<ReviewRoleGroup, readonly string[]> = {
  attacker: [
    "Pace",
    "Finishing",
    "Dribbling",
    "Positioning",
    "Weak Foot",
    "Skill Moves",
    "Long Shots",
    "Heading",
  ],
  midfielder: [
    "Passing",
    "Vision",
    "Ball Control",
    "Dribbling",
    "Stamina",
    "Defensive Work",
    "Long Shots",
    "Physical",
  ],
  defender: [
    "Tackling",
    "Marking",
    "Pace Recovery",
    "Strength",
    "Aerial Duels",
    "Positioning",
    "Aggression",
    "Passing Out",
  ],
  goalkeeper: [
    "Shot Stopping",
    "Reflexes",
    "Positioning",
    "Diving",
    "Handling",
    "1v1 Saves",
    "Distribution",
    "Reactions",
  ],
};

const ALL_REVIEW_TAGS = Array.from(
  new Set(Object.values(REVIEW_TAGS_BY_GROUP).flat())
);

function normalizePosition(position: string | null | undefined) {
  return String(position ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .trim();
}

export function getReviewGroupFromPosition(
  position: string | null | undefined
): ReviewRoleGroup | null {
  const normalized = normalizePosition(position);
  if (!normalized) return null;

  for (const [group, positions] of Object.entries(POSITIONS_BY_GROUP) as Array<
    [ReviewRoleGroup, readonly string[]]
  >) {
    if (positions.includes(normalized)) {
      return group;
    }
  }

  return null;
}

export function getReviewTagsForPosition(
  position: string | null | undefined
): readonly string[] {
  const group = getReviewGroupFromPosition(position);
  return group ? REVIEW_TAGS_BY_GROUP[group] : ALL_REVIEW_TAGS;
}

export function sanitizeReviewTagArray(args: {
  tags: unknown;
  position: string | null | undefined;
  max: number;
}): string[] {
  if (!Array.isArray(args.tags) || args.max <= 0) return [];

  const allowed = getReviewTagsForPosition(args.position);
  const canonical = new Map(allowed.map((tag) => [tag.toLowerCase(), tag]));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of args.tags) {
    const cleaned = String(item ?? "").trim();
    const key = cleaned.toLowerCase();
    const normalized = canonical.get(key);
    if (!normalized || seen.has(key)) continue;

    seen.add(key);
    out.push(normalized);
    if (out.length >= args.max) break;
  }

  return out;
}

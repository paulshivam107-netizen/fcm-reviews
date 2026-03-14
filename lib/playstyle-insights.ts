import { PlayerInsightTerm } from "@/types/player";

type PlaystyleRule = {
  compareLabel: string;
  descriptions: string[];
  keywords: string[];
};

export type PlaystyleInsightItem = {
  label: string;
  compareLabel: string;
  count: number;
  sourceTags: string[];
};

export type PlaystyleComparisonRow = {
  label: string;
  leftScore: number;
  rightScore: number;
};

export type PlaystyleComparisonWinner = "left" | "right" | "tie";

const PLAYSTYLE_RULES: PlaystyleRule[] = [
  {
    compareLabel: "Dribbling",
    descriptions: ["Dribbling playstyles"],
    keywords: ["dribbling", "agility", "ball control", "joystick", "smooth", "lane change"],
  },
  {
    compareLabel: "Skill Moves",
    descriptions: ["Skill move attackers"],
    keywords: ["skill moves", "skill move", "elastico", "roulette", "rainbow flick"],
  },
  {
    compareLabel: "Pace",
    descriptions: ["Fast counter attacks"],
    keywords: ["pace", "acceleration", "sprint speed", "speed", "rapid", "quick"],
  },
  {
    compareLabel: "Finishing",
    descriptions: ["Clinical finishing"],
    keywords: ["finishing", "finesse", "long shots", "curve", "shot power", "shooting"],
  },
  {
    compareLabel: "Passing",
    descriptions: ["Chance creation", "Playmaking buildup"],
    keywords: ["passing", "through ball", "crossing", "playmaking", "vision", "distribution"],
  },
  {
    compareLabel: "Positioning",
    descriptions: ["Off-ball positioning"],
    keywords: ["positioning", "movement", "run", "attacking ai", "pocket"],
  },
  {
    compareLabel: "Physicality",
    descriptions: ["Physical duels"],
    keywords: ["physical", "strength", "tank", "duel", "strong"],
  },
  {
    compareLabel: "Aerial Play",
    descriptions: ["Aerial play"],
    keywords: ["heading", "header", "aerial"],
  },
  {
    compareLabel: "Defending",
    descriptions: ["Defensive work"],
    keywords: ["defending", "interception", "marking", "tackling", "shot stopping"],
  },
  {
    compareLabel: "Stamina",
    descriptions: ["End-to-end matches"],
    keywords: ["stamina", "tired", "yellow bar"],
  },
];

function normalizeLookup(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function findPlaystyleRule(tag: string) {
  const normalizedTag = normalizeLookup(tag);
  return (
    PLAYSTYLE_RULES.find((rule) =>
      rule.keywords.some((keyword) => normalizedTag.includes(normalizeLookup(keyword)))
    ) ?? null
  );
}

function buildFallbackInsightLabel(tag: string) {
  const formatted = titleCase(normalizeLookup(tag));
  return formatted || "General play";
}

export function buildPlaystyleInsights(
  terms: PlayerInsightTerm[] | undefined,
  maxItems = 4
): PlaystyleInsightItem[] {
  if (!Array.isArray(terms) || terms.length === 0) return [];

  const grouped = new Map<string, PlaystyleInsightItem>();

  for (const term of terms) {
    if (!term?.text?.trim() || !Number.isFinite(term.count)) continue;
    const rule = findPlaystyleRule(term.text);
    const label = rule?.descriptions[0] ?? buildFallbackInsightLabel(term.text);
    const compareLabel = rule?.compareLabel ?? label;
    const existing = grouped.get(label);

    if (existing) {
      existing.count += term.count;
      existing.sourceTags.push(term.text);
      continue;
    }

    grouped.set(label, {
      label,
      compareLabel,
      count: term.count,
      sourceTags: [term.text],
    });
  }

  return [...grouped.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, maxItems);
}

export function buildPlaystyleComparisonRows(args: {
  leftPros: PlayerInsightTerm[] | undefined;
  leftCons: PlayerInsightTerm[] | undefined;
  rightPros: PlayerInsightTerm[] | undefined;
  rightCons: PlayerInsightTerm[] | undefined;
}): PlaystyleComparisonRow[] {
  return PLAYSTYLE_RULES.map((rule) => {
    const scoreTerms = (
      terms: PlayerInsightTerm[] | undefined,
      multiplier: number
    ) =>
      (terms ?? []).reduce((total, term) => {
        const normalized = normalizeLookup(term.text);
        const matches = rule.keywords.some((keyword) =>
          normalized.includes(normalizeLookup(keyword))
        );
        if (!matches) return total;
        return total + term.count * multiplier;
      }, 0);

    const leftScore = scoreTerms(args.leftPros, 1) + scoreTerms(args.leftCons, -0.75);
    const rightScore = scoreTerms(args.rightPros, 1) + scoreTerms(args.rightCons, -0.75);

    return {
      label: rule.compareLabel,
      leftScore,
      rightScore,
    };
  }).filter((row) => row.leftScore !== 0 || row.rightScore !== 0);
}

export function getPlaystyleComparisonWinner(
  row: PlaystyleComparisonRow,
  epsilon = 0.25
): PlaystyleComparisonWinner {
  if (Math.abs(row.leftScore - row.rightScore) <= epsilon) return "tie";
  return row.leftScore > row.rightScore ? "left" : "right";
}

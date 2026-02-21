import { ParsedSearch } from "@/lib/search";
import { PlayerRow, PlayerTab } from "@/types/player";

export type LocalMockReviewSeed = {
  id: string;
  player_id: string;
  player_name: string;
  sentiment_score: number;
  played_position: string;
  mentioned_rank_text: string | null;
  pros: string[];
  cons: string[];
  note: string;
  submitted_username: string | null;
  submitted_username_type: "reddit" | "game" | null;
  submitted_at: string;
  status: "pending" | "approved";
};

export const LOCAL_MOCK_PLAYERS: PlayerRow[] = [
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a001",
    player_name: "Harry Kewell",
    base_ovr: 113,
    base_position: "LW",
    program_promo: "Glorious Era",
    mention_count: 14,
    avg_sentiment_score: 8.9,
    top_pros: [
      { text: "pace", count: 9 },
      { text: "dribbling", count: 7 },
      { text: "finesse shots", count: 6 },
    ],
    top_cons: [
      { text: "weak foot", count: 8 },
      { text: "stamina", count: 6 },
    ],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a002",
    player_name: "Lionel Messi",
    base_ovr: 117,
    base_position: "RW",
    program_promo: "TOTY",
    mention_count: 52,
    avg_sentiment_score: 9.35,
    top_pros: [
      { text: "dribbling", count: 35 },
      { text: "finesse shots", count: 31 },
      { text: "passing", count: 29 },
    ],
    top_cons: [{ text: "physical", count: 8 }],
    last_processed_at: "2026-02-21T01:40:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a006",
    player_name: "Michael Essien",
    base_ovr: 116,
    base_position: "CDM",
    program_promo: "Icon",
    mention_count: 12,
    avg_sentiment_score: 3.6,
    top_pros: [{ text: "icon links", count: 3 }],
    top_cons: [
      { text: "high high workrate", count: 9 },
      { text: "underwhelming stats", count: 8 },
      { text: "3 star skill move", count: 7 },
    ],
    last_processed_at: "2026-02-21T01:10:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a005",
    player_name: "Gianluigi Donnarumma",
    base_ovr: 116,
    base_position: "GK",
    program_promo: "TOTY",
    mention_count: 24,
    avg_sentiment_score: 8.5,
    top_pros: [{ text: "shot stopping", count: 16 }],
    top_cons: [{ text: "distribution", count: 8 }],
    last_processed_at: "2026-02-20T19:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a007",
    player_name: "John Barnes",
    base_ovr: 115,
    base_position: "LW",
    program_promo: "Icon",
    mention_count: 16,
    avg_sentiment_score: 2.9,
    top_pros: [{ text: "theme squad fit", count: 2 }],
    top_cons: [
      { text: "misses easy chances", count: 12 },
      { text: "pace feels fake", count: 11 },
      { text: "terrible handling", count: 10 },
      { text: "outside foot shot poor", count: 7 },
    ],
    last_processed_at: "2026-02-21T01:20:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a008",
    player_name: "Andrea Pirlo",
    base_ovr: 120,
    base_position: "CM",
    program_promo: "Icon",
    mention_count: 11,
    avg_sentiment_score: 8.6,
    top_pros: [
      { text: "passing", count: 10 },
      { text: "through balls", count: 8 },
      { text: "crossing", count: 7 },
      { text: "power shots", count: 6 },
    ],
    top_cons: [
      { text: "dribbling feels average", count: 6 },
      { text: "struggles vs very pacey fullbacks", count: 5 },
      { text: "weak foot liability", count: 4 },
    ],
    last_processed_at: "2026-02-21T01:30:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a009",
    player_name: "Ruud Gullit",
    base_ovr: 117,
    base_position: "CM",
    program_promo: "Icon",
    mention_count: 19,
    avg_sentiment_score: 9.2,
    top_pros: [
      { text: "defending", count: 13 },
      { text: "physical", count: 12 },
      { text: "positioning", count: 11 },
      { text: "passing", count: 10 },
    ],
    top_cons: [{ text: "not ideal at striker", count: 6 }],
    last_processed_at: "2026-02-21T01:50:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a010",
    player_name: "Cristiano Ronaldo",
    base_ovr: 117,
    base_position: "ST",
    program_promo: "TOTY",
    mention_count: 21,
    avg_sentiment_score: 9.5,
    top_pros: [
      { text: "positioning", count: 14 },
      { text: "finishing", count: 13 },
      { text: "pace", count: 12 },
      { text: "physical", count: 12 },
    ],
    top_cons: [],
    last_processed_at: "2026-02-21T01:50:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a011",
    player_name: "Gabriel",
    base_ovr: 115,
    base_position: "CB",
    program_promo: "UTOTY",
    mention_count: 9,
    avg_sentiment_score: 8.7,
    top_pros: [
      { text: "defending", count: 7 },
      { text: "corner goals", count: 6 },
      { text: "aerial threat", count: 5 },
    ],
    top_cons: [],
    last_processed_at: "2026-02-21T02:00:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a012",
    player_name: "Raul",
    base_ovr: 120,
    base_position: "ST",
    program_promo: "Signature",
    mention_count: 17,
    avg_sentiment_score: 9.7,
    top_pros: [
      { text: "acceleration", count: 14 },
      { text: "agility", count: 13 },
      { text: "long shots", count: 12 },
      { text: "curve shots", count: 11 },
      { text: "attack versatility", count: 10 },
    ],
    top_cons: [],
    last_processed_at: "2026-02-21T02:10:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a013",
    player_name: "Yaya Toure",
    base_ovr: 120,
    base_position: "CM",
    program_promo: "Its In The Game",
    mention_count: 13,
    avg_sentiment_score: 9.5,
    top_pros: [
      { text: "ball recovery", count: 10 },
      { text: "stamina", count: 10 },
      { text: "physical", count: 9 },
      { text: "shooting", count: 9 },
    ],
    top_cons: [{ text: "dribbling", count: 8 }],
    last_processed_at: "2026-02-21T02:20:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a014",
    player_name: "Gianluca Zambrotta",
    base_ovr: 115,
    base_position: "RB",
    program_promo: "Icon",
    mention_count: 14,
    avg_sentiment_score: 9.8,
    top_pros: [
      { text: "defending", count: 12 },
      { text: "lb rb versatility", count: 11 },
      { text: "1v1 wing defending", count: 10 },
    ],
    top_cons: [{ text: "high high workrate positioning", count: 6 }],
    last_processed_at: "2026-02-21T02:30:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a015",
    player_name: "Patrick Vieira",
    base_ovr: 115,
    base_position: "CDM",
    program_promo: "Anniversary",
    mention_count: 18,
    avg_sentiment_score: 9.9,
    top_pros: [
      { text: "ball recovery", count: 14 },
      { text: "physical", count: 14 },
      { text: "dribbling for cdm", count: 10 },
      { text: "corner threat", count: 9 },
    ],
    top_cons: [{ text: "aggressive forward runs", count: 7 }],
    last_processed_at: "2026-02-21T02:40:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a016",
    player_name: "Lilian Thuram",
    base_ovr: 113,
    base_position: "RB",
    program_promo: "Icon",
    mention_count: 15,
    avg_sentiment_score: 9.9,
    top_pros: [
      { text: "pace recovery", count: 12 },
      { text: "1v1 wing defending", count: 11 },
      { text: "track back speed", count: 11 },
    ],
    top_cons: [],
    last_processed_at: "2026-02-21T02:45:00.000Z",
  },
  {
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a017",
    player_name: "Ruud Gullit",
    base_ovr: 113,
    base_position: "CM",
    program_promo: "Icon",
    mention_count: 17,
    avg_sentiment_score: 9.8,
    top_pros: [
      { text: "all-round impact", count: 13 },
      { text: "defending", count: 12 },
      { text: "heading", count: 11 },
      { text: "shooting", count: 11 },
    ],
    top_cons: [],
    last_processed_at: "2026-02-21T02:45:00.000Z",
  },
];

export const LOCAL_MOCK_REVIEW_SEEDS: LocalMockReviewSeed[] = [
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1010",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a001",
    player_name: "Harry Kewell",
    sentiment_score: 9,
    played_position: "LW",
    mentioned_rank_text: "gold",
    pros: ["Pace", "Dribbling", "Finishing"],
    cons: ["Weak Foot", "Physical"],
    note:
      "Demo seed review: 113+5 with training 30. Recommended as super-sub cutting in from RW/RM. Very high pace and dribbling, strong right-foot finesse, weak 3* WF, and stamina drops around 70-80'.",
    submitted_username: "demo_reddit_user",
    submitted_username_type: "reddit",
    submitted_at: "2026-02-20T19:00:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1011",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a006",
    player_name: "Michael Essien",
    sentiment_score: 3.2,
    played_position: "CDM",
    mentioned_rank_text: null,
    pros: [],
    cons: ["Workrate", "Physical", "Dribbling"],
    note:
      "From Reddit screenshot: CDM with high-high workrate tends to be out of position in key defensive moments, overall stats felt underwhelming, and 3* skill moves are not useful if used as CM. Conclusion: among the weakest 116 Icon options.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:10:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1012",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a007",
    player_name: "John Barnes",
    sentiment_score: 2.6,
    played_position: "LW",
    mentioned_rank_text: null,
    pros: [],
    cons: ["Finishing", "Pace", "Dribbling"],
    note:
      "From Reddit screenshot: user said Barnes missed too many easy chances, pace did not match the listed 200, and they replaced him with better options like Hazard/Ribery.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:20:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1013",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a007",
    player_name: "John Barnes",
    sentiment_score: 2.9,
    played_position: "LW",
    mentioned_rank_text: null,
    pros: [],
    cons: ["Dribbling", "Passing", "Finishing"],
    note:
      "From Reddit screenshot (SelhurstShark): described the card as a major disappointment with poor handling, pass receiving, weak shooting (including outside-foot attempts), and pace not matching stats.",
    submitted_username: "SelhurstShark",
    submitted_username_type: "reddit",
    submitted_at: "2026-02-21T01:20:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1014",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a008",
    player_name: "Andrea Pirlo",
    sentiment_score: 8.6,
    played_position: "CM",
    mentioned_rank_text: null,
    pros: ["Passing", "Long Shots", "Positioning"],
    cons: ["Dribbling", "Weak Foot", "Pace"],
    note:
      "From Reddit screenshot: reviewer packed Pirlo early and rated him highly for passing (10/10), defense (9/10), shooting (9/10), and overall control as a deep playmaker. Weak points called out were average dribbling (7/10), some pace issues versus very speedy full-backs, and weak foot as a liability.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:30:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1015",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a002",
    player_name: "Lionel Messi",
    sentiment_score: 9.7,
    played_position: "CAM",
    mentioned_rank_text: null,
    pros: ["Dribbling", "Passing", "Finishing"],
    cons: [],
    note:
      "From screenshot: reviewer said 117 Messi feels incredible, very smooth on joystick, elite dribbling, strong passing/progression, dependable finishing, and performs very well in both CAM and RW roles. Strong recommendation.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:40:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1016",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a010",
    player_name: "Cristiano Ronaldo",
    sentiment_score: 9.6,
    played_position: "RW",
    mentioned_rank_text: null,
    pros: ["Positioning", "Pace", "Physical"],
    cons: [],
    note:
      "From Reddit screenshot: user packed 117 Ronaldo and used him as winger; called him fantastic with elite positioning, almost non-existent weak-foot issues, monster-level pace, and strong physicality.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:50:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1017",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a009",
    player_name: "Ruud Gullit",
    sentiment_score: 9.3,
    played_position: "CM",
    mentioned_rank_text: null,
    pros: ["Physical", "Positioning", "Passing"],
    cons: [],
    note:
      "From Reddit screenshot (PotentialBee5701): reviewer said Gullit is everywhere, extremely hard to dribble past, behaves like a moving wall, and makes smart transition runs to score. Called him an excellent card.",
    submitted_username: "PotentialBee5701",
    submitted_username_type: "reddit",
    submitted_at: "2026-02-21T01:50:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1018",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a010",
    player_name: "Cristiano Ronaldo",
    sentiment_score: 9.7,
    played_position: "ST",
    mentioned_rank_text: null,
    pros: ["Finishing", "Pace", "Physical"],
    cons: [],
    note:
      "From Reddit screenshot (PotentialBee5701): described CR7 as having lethal elastico, scoring from nearly anywhere, and being insanely fast and strong.",
    submitted_username: "PotentialBee5701",
    submitted_username_type: "reddit",
    submitted_at: "2026-02-21T01:50:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1019",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a009",
    player_name: "Ruud Gullit",
    sentiment_score: 8.8,
    played_position: "CDM",
    mentioned_rank_text: null,
    pros: ["Defending", "Passing", "Positioning"],
    cons: ["Finishing"],
    note:
      "From second Gullit screenshot: user advised not to play him at striker, but rated him highly in midfield/CDM for defending and crucial passes to attackers.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T01:50:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1020",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a011",
    player_name: "Gabriel",
    sentiment_score: 8.8,
    played_position: "CB",
    mentioned_rank_text: null,
    pros: ["Positioning", "Physical", "Finishing"],
    cons: [],
    note:
      "From Reddit screenshot: user said 115 Gabriel is great for them, consistently scores from corners, and defends solidly.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:00:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1021",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a012",
    player_name: "Raul",
    sentiment_score: 9.8,
    played_position: "ST",
    mentioned_rank_text: null,
    pros: ["Pace", "Dribbling", "Finishing"],
    cons: [],
    note:
      "From screenshot text: Signature Raul is described as one of the most OP strikers, effective across ST/LW/RW/CAM, extremely quick and agile, very sticky close control, and elite finishing. Reviewer highlighted overpowered long shots and unmatched curve shots with very high dependability.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:10:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1022",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a013",
    player_name: "Yaya Toure",
    sentiment_score: 9.5,
    played_position: "CDM",
    mentioned_rank_text: null,
    pros: ["Physical", "Passing", "Long Shots"],
    cons: ["Dribbling"],
    note:
      "From user text: Yaya is a midfield tank and has been dominant alongside Gullit/Vieira. Outstanding at quickly engaging opponents and winning the ball, can run full 90 minutes, and has ST-like shooting. Reviewer plays him at CDM and rates him 9.5/10, with dribbling as the clear weakness.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:20:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1023",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a014",
    player_name: "Gianluca Zambrotta",
    sentiment_score: 9.8,
    played_position: "RB",
    mentioned_rank_text: null,
    pros: ["Positioning", "Physical", "Pace"],
    cons: ["Workrate"],
    note:
      "From user text: 115 Zambrotta is described as top-tier defensively, strong at both LB and RB, and reliable in stopping wingers. Main drawback mentioned is occasional forward rushing/position loss due to high-high work rate. Overall rated 9.8/10.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:30:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1024",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a015",
    player_name: "Patrick Vieira",
    sentiment_score: 10,
    played_position: "CDM",
    mentioned_rank_text: null,
    pros: ["Physical", "Dribbling", "Finishing"],
    cons: ["Workrate"],
    note:
      "From user text: 115 Vieira is the reviewer's all-time favorite and still irreplaceable in H2H. Described as everything strong about Yaya with added quality, including usable dribbling for a midfielder, elite CDM presence, fast forward surges, and strong heading/corner finishing. Rated 11/10 by reviewer.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:40:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1025",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a016",
    player_name: "Lilian Thuram",
    sentiment_score: 9.9,
    played_position: "RB",
    mentioned_rank_text: null,
    pros: ["Pace", "Positioning", "Physical"],
    cons: [],
    note:
      "From user text: 113 Thuram is called the best RB for the reviewer, similar impact to Zambrotta with superior recovery runs back to RB even after moving high. Very quick, matches pace of top attackers like Vini/Mbappe, and rarely gets beaten unless facing an elite dribbler. Rated 9.9/10.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:45:00.000Z",
    status: "approved",
  },
  {
    id: "8ef1a4f4-91f8-4b62-a8ab-f4be0f3f1026",
    player_id: "0f6c7ec2-9fe0-43bd-9bf7-7419ebf7a017",
    player_name: "Ruud Gullit",
    sentiment_score: 9.8,
    played_position: "CM",
    mentioned_rank_text: null,
    pros: ["Finishing", "Defending", "Dribbling"],
    cons: [],
    note:
      "From user text: 113 Gullit described as naturally overpowered regardless of stats, elite at shooting, heading, defending, and dribbling, with constant all-pitch presence around the ball.",
    submitted_username: null,
    submitted_username_type: null,
    submitted_at: "2026-02-21T02:45:00.000Z",
    status: "approved",
  },
];

function isPlaceholderValue(value: string | undefined) {
  if (!value) return true;
  const normalized = value.trim();
  if (!normalized) return true;
  return (
    normalized.includes("YOUR_PROJECT") ||
    normalized.includes("YOUR_SUPABASE") ||
    normalized.includes("YOUR_")
  );
}

export function shouldUseLocalMockData(
  supabaseUrl: string | undefined,
  supabaseKey: string | undefined
) {
  const forceMock =
    String(process.env.USE_LOCAL_MOCK_DATA ?? "").toLowerCase() === "true";
  return forceMock || isPlaceholderValue(supabaseUrl) || isPlaceholderValue(supabaseKey);
}

export function queryLocalMockPlayers(args: {
  tab: PlayerTab;
  parsed: ParsedSearch;
  limit: number;
  positionGroups: Record<PlayerTab, string[]>;
}): PlayerRow[] {
  const { tab, parsed, limit, positionGroups } = args;
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const allowedPositions = new Set(positionGroups[tab]);
  const query = parsed.nameQuery.trim().toLowerCase();

  let rows = LOCAL_MOCK_PLAYERS;

  if (!isOvrOnlyQuery) {
    rows = rows.filter((row) => allowedPositions.has(row.base_position));
  }

  if (parsed.requestedOvr !== null) {
    rows = rows.filter((row) => row.base_ovr === parsed.requestedOvr);
  }

  if (query) {
    rows = rows.filter((row) => row.player_name.toLowerCase().includes(query));
  }

  rows.sort((a, b) => {
    const scoreA = a.avg_sentiment_score ?? -1;
    const scoreB = b.avg_sentiment_score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;
    return b.base_ovr - a.base_ovr;
  });

  return rows.slice(0, limit);
}

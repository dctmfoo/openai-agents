type Role = 'parent' | 'child';
type AgeGroup = 'child' | 'teen' | 'young_adult';

type FilteredResponse = {
  safe: boolean;
  filtered: string;
};

export const CHILD_SAFE_DEFLECTION =
  "I can't help with that, but I can help with kid-friendly topics like stories, science facts, or games. What would you like to talk about?";

type FilterCategory =
  | 'violence'
  | 'explicit_violence'
  | 'adult'
  | 'profanity'
  | 'financial'
  | 'medical'
  | 'political'
  | 'self_harm'
  | 'dangerous';

const CATEGORY_PATTERNS: Record<FilterCategory, RegExp[]> = {
  violence: [/\b(kill|murder|hurt|harm|fight|attack)\b/i],
  explicit_violence: [/\b(shoot|stab|weapon|gun|blood|gore|explosive)\b/i],
  adult: [/\b(sex|sexual|porn|nude|naked|xxx|adult|erotic)\b/i],
  profanity: [/\b(fuck|shit|bitch|asshole|bastard|damn|bullshit)\b/i],
  financial: [
    /\b(invest|investment|stocks?|crypto|trading|portfolio|dividend|401k|retirement|loan|credit|mortgage|tax)\b/i,
    /\bfinancial advice\b/i,
  ],
  medical: [
    /\b(medical advice|diagnos|treatment|medicine|medication|prescription|dose|symptom|illness|disease|doctor|therapy)\b/i,
  ],
  political: [
    /\b(politic|election|vote|campaign|party|president|prime minister|congress|parliament)\b/i,
  ],
  self_harm: [/\b(self[- ]?harm|suicide|kill myself)\b/i],
  dangerous: [/\b(bomb|explosive|poison|weapon|make a gun|how to build)\b/i],
};

const TIER_BLOCKLIST: Record<AgeGroup, FilterCategory[]> = {
  child: ['violence', 'explicit_violence', 'adult', 'profanity', 'financial', 'medical', 'political'],
  teen: ['explicit_violence', 'adult', 'financial'],
  young_adult: ['adult', 'self_harm', 'dangerous'],
};

const isUnsafeForTier = (text: string, ageGroup: AgeGroup): boolean => {
  const blocked = TIER_BLOCKLIST[ageGroup];
  return blocked.some((category) =>
    CATEGORY_PATTERNS[category].some((pattern) => pattern.test(text)),
  );
};

export function filterResponse(
  text: string,
  role: Role,
  ageGroup: AgeGroup = 'child',
): FilteredResponse {
  if (role !== 'child') {
    return { safe: true, filtered: text };
  }

  if (!text.trim()) {
    return { safe: true, filtered: text };
  }

  if (isUnsafeForTier(text, ageGroup)) {
    return { safe: false, filtered: CHILD_SAFE_DEFLECTION };
  }

  return { safe: true, filtered: text };
}

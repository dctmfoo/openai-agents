export type Role = 'parent' | 'child';

export type FilteredResponse = {
  safe: boolean;
  filtered: string;
};

export const CHILD_SAFE_DEFLECTION =
  "I can't help with that, but I can help with kid-friendly topics like stories, science facts, or games. What would you like to talk about?";

type FilterCategory = 'violence' | 'adult' | 'profanity' | 'financial' | 'medical';

const CATEGORY_PATTERNS: Record<FilterCategory, RegExp[]> = {
  violence: [
    /\b(kill|murder|hurt|harm|shoot|stab|weapon|gun|blood|gore)\b/i,
  ],
  adult: [
    /\b(sex|sexual|porn|nude|naked|xxx|adult|erotic)\b/i,
  ],
  profanity: [
    /\b(fuck|shit|bitch|asshole|bastard|damn|bullshit)\b/i,
  ],
  financial: [
    /\b(invest|investment|stocks?|crypto|trading|portfolio|dividend|401k|retirement|loan|credit|mortgage|tax)\b/i,
    /\bfinancial advice\b/i,
  ],
  medical: [
    /\b(medical advice|diagnos|treatment|medicine|medication|prescription|dose|symptom|illness|disease|doctor|therapy)\b/i,
  ],
};

const isUnsafeForChild = (text: string): boolean => {
  for (const patterns of Object.values(CATEGORY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) {
      return true;
    }
  }
  return false;
};

export function filterResponse(text: string, role: Role): FilteredResponse {
  if (role !== 'child') {
    return { safe: true, filtered: text };
  }

  if (!text.trim()) {
    return { safe: true, filtered: text };
  }

  if (isUnsafeForChild(text)) {
    return { safe: false, filtered: CHILD_SAFE_DEFLECTION };
  }

  return { safe: true, filtered: text };
}

export const TASMANIA_STATUS_PATH = "/state-nomination/tasmania";
export const TASMANIA_REVIEW_PATH = "/preview/state-nomination/tasmania/review";
export const TASMANIA_STATUS_API = "/api/site/tasmania-nomination";
export const TASMANIA_REVIEW_API = "/api/admin/tasmania-nomination/review";

export const TASMANIA_ROUNDS_URL = "https://www.migration.tas.gov.au/news/processing_times_and_allocation_usage";
export const TASMANIA_ROI_URL = "https://www.migration.tas.gov.au/news/important-update-roi-system-currently-offline";
export const TASMANIA_ONSHORE_URL = "https://www.migration.tas.gov.au/skilled_migration/skilled-workers-and-graduates-living-in-Tasmania";
export const TASMANIA_OFFSHORE_491_URL = "https://www.migration.tas.gov.au/skilled_migration/skilled-workers-living-overseas/overseas-skilled-occupation-profiles-osop-invitation-only-pathway";

export const TASMANIA_SUBCLASSES = ["190", "491"] as const;

type Subclass = typeof TASMANIA_SUBCLASSES[number];

export interface TasmaniaRoundFigures {
  invitations: number;
  lowestScore: number;
  placesAvailable: number;
  roisOnHand: number;
}

export interface TasmaniaRound {
  date: string;
  figures: Record<Subclass, TasmaniaRoundFigures>;
}

export interface TasmaniaReview {
  round: TasmaniaRound;
  previous: TasmaniaRound | null;
  roiReopenedOn: string;
  verifiedAt: string | null;
  evidence: {
    roundMaterialId: string;
    roundRevision: number;
    firstObservedAt: string;
    previousRevision: number | null;
    roiMaterialId: string;
    roiRevision: number;
  };
}

export interface TasmaniaStatus {
  articleId: string;
  round: TasmaniaRound;
  previous: TasmaniaRound | null;
  roiReopenedOn: string;
  verifiedAt: string;
  newerCapture: boolean;
}

const numberIn = (section: string, subclass: Subclass, unit: string) => {
  const value = section.match(new RegExp(`Subclass ${subclass}\\s*[-–—]\\s*([0-9,]+)\\s+${unit}(?=Subclass|[^a-z]|$)`, "i"))?.[1];
  return value === undefined ? NaN : Number(value.replaceAll(",", ""));
};

/** Read the named sections of the official round. The rolling-average scores are in a different section. */
export function parseTasmaniaRound(body: string): TasmaniaRound | null {
  const text = body.replace(/\s+/g, " ");
  const match = text.match(/ROIs invited to apply for nomination on (\d{2})\/(\d{2})\/(\d{4}):(.+?)The lowest scores invited:(.+?)Number of ROIs on hand.*?:(.+?)Nomination places available:(.+?)Nomination applications lodged/i);
  if (!match) return null;
  const [, day, month, year, invitations, scores, rois, places] = match;
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) return null;
  const figuresFor = (subclass: Subclass) => ({
    invitations: numberIn(invitations!, subclass, "invitations?"),
    lowestScore: numberIn(scores!, subclass, "points?"),
    roisOnHand: numberIn(rois!, subclass, "ROIs?"),
    placesAvailable: numberIn(places!, subclass, "places?"),
  });
  const figures = { "190": figuresFor("190"), "491": figuresFor("491") };
  if (Object.values(figures).some(row => Object.values(row).some(value => !Number.isSafeInteger(value) || value < 0))) return null;
  return { date, figures };
}

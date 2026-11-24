import { sql } from "@aihot/backend/db";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import type { TasmaniaReview, TasmaniaStatus } from "./tasmania.ts";

export async function readTasmaniaReview() {
  const [row] = await sql<{ articleId: string; review: TasmaniaReview }[]>`
    SELECT a.id AS "articleId", a.raw->'tasmaniaReview' AS review
    FROM articles a
    WHERE a.source_id='au-tas-rounds' AND a.identity_key LIKE 'official-update:au-tas-rounds:%'
      AND jsonb_typeof(a.raw->'tasmaniaReview')='object'
    ORDER BY a.raw->'tasmaniaReview'->'round'->>'date' DESC
    LIMIT 1`;
  return row ?? null;
}

export async function readTasmaniaStatus(): Promise<TasmaniaStatus | null> {
  const candidates = await sql<{ id: string; review: TasmaniaReview }[]>`
    SELECT a.id, a.raw->'tasmaniaReview' AS review
    FROM publications p JOIN articles a ON a.id=p.article_id
    WHERE p.source_id='au-tas-rounds' AND p.selected AND p.eligible AND p.visibility='public'
      AND a.identity_key LIKE 'official-update:au-tas-rounds:%'
      AND a.raw->'tasmaniaReview'->>'verifiedAt' IS NOT NULL
    ORDER BY a.raw->'tasmaniaReview'->'round'->>'date' DESC`;
  for (const candidate of candidates) {
    const item = await loadItemDetail(candidate.id);
    const { round, previous, roiReopenedOn, verifiedAt, evidence } = candidate.review;
    if (!verifiedAt || item.kind !== "found" || !item.item.selected) continue;
    const [check] = await sql<{ newer: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM articles
        WHERE (id=${evidence.roundMaterialId} AND revision>${evidence.roundRevision})
           OR (id=${evidence.roiMaterialId} AND revision>${evidence.roiRevision})) AS newer`;
    return { articleId: candidate.id, round, previous, roiReopenedOn, verifiedAt, newerCapture: check?.newer ?? false };
  }
  return null;
}

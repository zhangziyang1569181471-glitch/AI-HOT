import { Link, useLoaderData } from "react-router";
import { grayGet, GRAY_HEADERS } from "@aihot/web/lib/admin.server";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { TASMANIA_REVIEW_API, TASMANIA_ROUNDS_URL, TASMANIA_STATUS_PATH, type TasmaniaReview } from "../tasmania.ts";
import { reviewTime, RoundTable } from "./round-table.tsx";

export const headers = () => GRAY_HEADERS;
export const meta = () => [{ title: "塔州邀请复核卡" }, { name: "robots", content: "noindex,nofollow" }];

export async function loader({ request }: { request: Request }) {
  return grayGet<{ card: { articleId: string; review: TasmaniaReview } | null }>(request, TASMANIA_REVIEW_API);
}

export default function TasmaniaReviewPage() {
  const { card } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-12 lg:pt-3">
      <PhoneBar title="塔州邀请复核卡" back={{ to: TASMANIA_STATUS_PATH, label: "塔州州担保" }} />
      <h1 data-page-title className="mb-4 text-3xl font-bold tracking-tight">塔州邀请复核卡</h1>
      {card ? (
        <>
          <p className="mb-4 text-sm text-ink-3">{card.review.verifiedAt ? `已复核 · ${reviewTime(card.review.verifiedAt)}（北京时间）` : "待复核"}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {card.review.previous && (
              <section className="rounded-card border border-line px-4 py-4">
                <h2 className="font-bold">上轮 {card.review.previous.date}</h2>
                <RoundTable round={card.review.previous} />
              </section>
            )}
            <section className="rounded-card border border-line bg-surface px-4 py-4">
              <h2 className="font-bold">本轮 {card.review.round.date}</h2>
              <RoundTable round={card.review.round} />
            </section>
          </div>
          <p className="mt-4 text-sm text-ink-3">官网快照第 {card.review.evidence.roundRevision} 版 · 首次收录 {reviewTime(card.review.evidence.firstObservedAt)}（北京时间）</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium text-accent">
            <a href={TASMANIA_ROUNDS_URL} className="hover:underline">核对官方原文</a>
            <Link to={`/admin/content/${card.articleId}`} className="hover:underline">查看发布与审计记录</Link>
          </div>
        </>
      ) : <p role="status" className="text-ink-3">暂无复核卡。</p>}
    </div>
  );
}

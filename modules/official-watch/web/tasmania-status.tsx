import { Link, useLoaderData } from "react-router";
import { apiGet, cachedPage } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import {
  TASMANIA_OFFSHORE_491_URL, TASMANIA_ONSHORE_URL, TASMANIA_ROI_URL, TASMANIA_ROUNDS_URL,
  TASMANIA_STATUS_API, TASMANIA_STATUS_PATH, type TasmaniaStatus,
} from "../tasmania.ts";
import { reviewTime, RoundTable } from "./round-table.tsx";

export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const handle = { home: "me", name: "塔州州担保" } as const;

export async function loader({ request }: { request: Request }) {
  return cachedPage(0, await apiGet<{ status: TasmaniaStatus | null }>(TASMANIA_STATUS_API, { signal: request.signal }));
}

export function meta() {
  return pageMeta({ title: "塔州州担保状态", path: TASMANIA_STATUS_PATH,
    description: "查看塔州 190 和 491 的 ROI 状态、邀请轮次、获邀分和剩余名额。" });
}

const offshore190 = "https://www.migration.tas.gov.au/skilled_migration/skilled-workers-living-overseas/subclass-190-overseas-applicant-health-or-education-sector-job-offer-pathway";

export default function TasmaniaStatusPage() {
  const { status } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-12 lg:pt-3">
      <PhoneBar title="塔州州担保" back={{ to: "/", label: "精选" }} />
      <h1 data-page-title className="mb-2 text-3xl font-bold tracking-tight lg:text-4xl">塔州州担保状态</h1>
      {status ? (
        <>
          <p className="mb-6 text-sm text-ink-3">核验于 <time dateTime={status.verifiedAt}>{reviewTime(status.verifiedAt)}</time>（北京时间）</p>
          {status.newerCapture && <p role="status" className="mb-5 rounded-card border border-line bg-surface p-4 text-sm">监测到新版官网内容，等待复核。以下为最近一次已核实的数据。</p>}
          <section className="mb-5 rounded-card border border-line bg-surface px-4 py-5 lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">ROI 状态</h2>
              <span className="rounded-full border border-line px-3 py-1 text-sm font-semibold text-accent">可提交</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              官网 <time dateTime={status.roiReopenedOn}>{status.roiReopenedOn}</time> 确认系统恢复。指定时段内成功提交和截至指定时点的草稿已重新计分，Red Pass 需重新提交。
            </p>
            <a href={TASMANIA_ROI_URL} className="mt-3 inline-flex text-sm font-medium text-accent hover:underline">查看官网恢复通知</a>
          </section>
          <section className="rounded-card border border-line bg-surface px-4 py-5 lg:px-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">最近已核实轮次</h2>
              <time dateTime={status.round.date} className="num text-sm text-ink-3">{status.round.date}</time>
            </div>
            <RoundTable round={status.round} />
            <p className="mt-3 text-sm leading-relaxed text-ink-3">分数采用塔州 ROI 优先属性口径。表中邀请是申请州提名的邀请，名额与在手 ROI 均为官网本轮快照。</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-accent">
              <Link className="hover:underline" to={`/items/${status.articleId}`}>阅读本轮报道</Link>
              <a className="hover:underline" href={TASMANIA_ROUNDS_URL}>查看塔州官网数据</a>
            </div>
          </section>
          {status.previous && (
            <details className="mt-5 rounded-card border border-line px-4 py-4 lg:px-6">
              <summary className="cursor-pointer font-semibold">上轮记录 <time dateTime={status.previous.date} className="num ml-2 text-sm font-normal text-ink-3">{status.previous.date}</time></summary>
              <RoundTable round={status.previous} />
            </details>
          )}
          <section className="mt-7">
            <h2 className="text-lg font-bold">官方申请路径</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-2">
              <li><a className="font-medium text-accent hover:underline" href={TASMANIA_ONSHORE_URL}>塔州境内技术工作者和毕业生</a> · 查看各路径的 190 和 491 要求。</li>
              <li><a className="font-medium text-accent hover:underline" href={offshore190}>境外医疗或教育岗位邀约路径</a> · 查看 190 的工作与职业评估条件。</li>
              <li><a className="font-medium text-accent hover:underline" href={TASMANIA_OFFSHORE_491_URL}>境外 491 OSOP 路径</a> · 官网列为 2026–27 项目年度暂停邀请。</li>
            </ul>
          </section>
        </>
      ) : (
        <p role="status" className="mt-5 rounded-card border border-line p-4 text-ink-2">等待首轮数据核验。</p>
      )}
    </div>
  );
}

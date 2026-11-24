import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { TASMANIA_SUBCLASSES, type TasmaniaRound } from "../tasmania.ts";

export const reviewTime = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

const fields = [
  ["invitations", "本轮邀请"],
  ["lowestScore", "本轮最低获邀分"],
  ["placesAvailable", "剩余提名名额"],
  ["roisOnHand", "在手 ROI"],
] as const;

export function RoundTable({ round }: { round: TasmaniaRound }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{round.date} 塔州州提名轮次</caption>
      <thead className="border-b border-line text-ink-3">
        <tr>
          <th className="w-[48%] py-3 text-left font-medium" scope="col">指标</th>
          {TASMANIA_SUBCLASSES.map(subclass => (
            <th key={subclass} className="py-3 text-right font-semibold text-ink" scope="col">{subclass}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {fields.map(([key, label]) => (
          <tr key={key}>
            <th scope="row" className="py-3 pr-2 text-left font-medium text-ink-2">{label}</th>
            {TASMANIA_SUBCLASSES.map(subclass => (
              <td key={subclass} className="num py-3 text-right text-base font-semibold">{round.figures[subclass][key].toLocaleString("zh-CN")}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import type { LeanContentType } from "./config.ts";

/** Team accounts. Their race reporting stays news; everyday and behind-the-scenes posts do not. */
const TEAM_SOURCE_IDS = new Set([
  "x-mclarenf1", "x-scuderiaferrari", "x-mercedesamgf1", "x-redbullracing", "x-williamsracing",
  "x-alpinef1team", "x-astonmartinf1", "x-haasf1team", "x-audif1-", "x-visacashapprb"
]);

const RACE_SIGNAL = /\b(fp[123]|qualifying|free practice|sprint|podium|safety car|red flag|grid|pit stop|tyres?|tires?)\b|排位|练习赛|正赛|冲刺赛|杆位|积分|退赛|红旗|进站|发车|赛道|轮胎|罚时|事故|撞车|安全车|圈速|领跑|维修|策略/i;

/** Team X posts that are not race reporting are paddock features. Everyone else keeps the source category. */
export function contentTypeForTeamPost(sourceId: string, fallback: LeanContentType, title: string, text: string): LeanContentType {
  if (!TEAM_SOURCE_IDS.has(sourceId)) return fallback;
  return RACE_SIGNAL.test(`${title}\n${text}`) ? "race_news" : "paddock_fun";
}

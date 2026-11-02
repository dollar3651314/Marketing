/**
 * 公司平台的对照表（agents 公司平台/技术方案-公司平台-PR与数据.md 第七节"对照表放 src/projects.ts"）：服务端校验和页面共用这一份。
 * 页面（src/admin-page.ts）把 PLATFORM_CONFIG 原样插进脚本；填数字的校验规则（全角转半角、去空格、非负整数、上限）前后端各写一份同样的实现，
 * 改这里的上限要同时看 admin-page.ts 里的 normReport（C108：同一个字段同一套规则）。
 */
/** 填数字能填的名称和上限（没写 max 的是非负整数，最多 9 位） */
export const REPORT_FIELDS: Record<string, { max?: number }> = {
  'X 关注': {},
  'Threads 关注': {},
  '名单人数': {},
  'Claude 用量': { max: 100 },
};

/** 待办里"去填数字"出哪几格：回报类待办的文字里提到 Claude → 用量；提到关注、名单 → 三格 */
export const REPORT_FORMS: { match: string; fields: string[] }[] = [
  { match: 'Claude', fields: ['Claude 用量'] },
  { match: '关注|名单', fields: ['X 关注', 'Threads 关注', '名单人数'] },
];

/** 状态卡数字表里写"见公司平台"的那一格，换成平台里哪几个名称的值（多个就加起来） */
export const METRIC_FROM_REPORT: Record<string, string[]> = {
  'X + Threads 关注合计': ['X 关注', 'Threads 关注'],
  '等候名单确认订阅': ['名单人数'],
};

/** 状态卡里写这几个字时，页面换成平台里的最新值 */
export const SEE_PLATFORM = '见公司平台';

/** 有状态卡但不是项目（工具层，项目概况、一级菜单都不列；v0.34 起状态卡 key 是"公司平台"） */
export const NOT_PROJECTS = ['公司平台', 'Marketing'];

/** 推 PR / CI 的仓库属于哪个项目；没写的算"公司" */
export const REPO_PROJECT: Record<string, string> = { 'new-forecast': 'forecast' };

/** 每天回帖上限等工具页的项目名（批 1 只有 forecast 一个项目页） */
export const PROJECT_PAGES = ['forecast'];

export const PLATFORM_CONFIG = { REPORT_FIELDS, REPORT_FORMS, METRIC_FROM_REPORT, SEE_PLATFORM, NOT_PROJECTS, REPO_PROJECT, PROJECT_PAGES };

/** 填数字的一格：全角数字转半角、去掉所有空白；要非负整数（最多 9 位），有上限的不超过上限。返回规范化后的值或错在哪 */
export function normReport(name: string, raw: unknown): { value: string } | { why: string } {
  const f = REPORT_FIELDS[name];
  if (!f) return { why: '不认识这一格' };
  if (typeof raw !== 'string') return { why: '要填数字' };
  const s = raw.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[\s　]+/g, '');
  if (!s) return { why: '还没填（不知道就填 0）' };
  if (!/^\d{1,9}$/.test(s)) return { why: '要填 0 或正整数，不带小数点和负号' };
  const n = Number(s);
  if (f.max !== undefined && n > f.max) return { why: `要在 0～${f.max} 之间` };
  return { value: String(n) };
}

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

/** 状态卡数字表里写"见工作平台"的那一格，换成平台里哪几个名称的值（多个就加起来） */
export const METRIC_FROM_REPORT: Record<string, string[]> = {
  'X + Threads 关注合计': ['X 关注', 'Threads 关注'],
  '等候名单确认订阅': ['名单人数'],
};

/**
 * 状态卡里写这几个字时，页面换成平台里的最新值。改名过渡期（Marketing 先上、agents 改名后合）新旧两种写法都认：
 * 新的"见工作平台"、旧的"见公司平台"；agents 改完、旧写法不再出现以后可以删掉旧的。
 */
export const SEE_PLATFORM = ['见工作平台', '见公司平台'];
/** 这一格是不是"见工作平台"（新旧写法都认） */
export const seesPlatform = (v: unknown): boolean => typeof v === 'string' && SEE_PLATFORM.some((k) => v.includes(k));

/** 有状态卡但不是项目（工具层，项目概况、一级菜单都不列）。改名过渡期新旧 key 都认："工作平台"、"公司平台" */
export const NOT_PROJECTS = ['工作平台', '公司平台', 'Marketing'];
/** 这张状态卡是不是工具层的（新旧 key 都认） */
export const isToolCard = (key: string): boolean => NOT_PROJECTS.includes(key);

/** 推 PR / CI 的仓库属于哪个项目；没写的算"公司" */
export const REPO_PROJECT: Record<string, string> = { 'new-forecast': 'forecast' };

/**
 * 有项目页的项目：**不再写死**（2026-11-02，Amos"项目也只有 forecast 一个，新项目哪儿去了"）。
 * 真正的来源是 agents 推来的 projects 块（项目版图"产品"表，C146 只放在跑的项目）：服务端 src/company.ts projectPages(env) 读 D1、
 * 页面读 GET /api/company 的 projects 块；两边都用下面的 projectPagesFrom() 算，规则只有一份。
 * 下面这个只是**兜底**：块还没推上来（新装、清库、agents 上报坏了）时用，免得页面白屏、校验变成什么项目名都收。
 */
export const PROJECT_PAGES_FALLBACK = ['forecast'];
/** 最多认几个项目页（挡住推来的块异常变大） */
export const MAX_PROJECT_PAGES = 20;

/** projects 块的 payload → 有项目页的项目名：去掉工具层（工作平台 / Marketing）、去空、去重、限条数；算不出就用兜底 */
export function projectPagesFrom(payload: unknown): string[] {
  const items = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as { items?: unknown }).items : undefined;
  const names = Array.isArray(items)
    ? items.map((x) => (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' ? ((x as { name: string }).name).trim() : '')).filter((n) => n && !isToolCard(n))
    : [];
  const out = [...new Set(names)].slice(0, MAX_PROJECT_PAGES);
  return out.length ? out : [...PROJECT_PAGES_FALLBACK];
}

/** 项目页标题旁边的那一行小字（有官网的项目才有）；没写的项目不显示 */
export const PROJECT_SITE: Record<string, { text: string; url: string }> = {
  forecast: { text: 'Quick Come 官网', url: 'https://www.quickcome.online' },
};

export const PLATFORM_CONFIG = { REPORT_FIELDS, REPORT_FORMS, METRIC_FROM_REPORT, SEE_PLATFORM, NOT_PROJECTS, REPO_PROJECT, PROJECT_PAGES_FALLBACK };

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

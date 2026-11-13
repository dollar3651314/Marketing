/**
 * 每个模型每天的用量和我们设的上限（副驾驶 0.3，Amos 2026-10-30；D-3：Gemini 按次数设上限，token 也记下来给 Amos 看）。
 * - Gemini 的真实免费额度 Google 不提供查询接口：这里只数我们自己发了几次、用了多少 token；Google 回 429 时记下来，后台标"Google 说额度用完"。
 * - 一天怎么算跟着各家的重置时间：Gemini 按美国太平洋时间半夜，Workers AI 按 UTC 0 点（台湾早上 8 点）。
 * - 上限存在 settings 表（后台"用量和限额"页改）；Gemini 默认每个模型每天 200 次，Workers AI 默认 8000 neurons、最多 9500（免费额度 10000，C117）。
 *
 * 用量监控（Amos 2026-11-03："最好提炼出一个 token 监控的模块，可以看到剩余和分别用到了哪里"）也在这个文件里，**没有另开一个页**：
 *   ① 还剩多少 → usageLeft()，直接从 usageReport 的行算（两本账分开：Workers AI 按 neurons、Gemini 按次数，不加在一起）；
 *   ② 分别用到了哪里 → usageByPurpose()，读迁移 0010 建的 usage_by_purpose（按用途记，和按项目记的 usage_by_project 并存）；
 *   ③ 什么时候清零 → 还是 dayFor() / nextReset() 这两个函数，没有第二套口径。
 * 都挂在后台"公共工具 → 用量和限额"（#/tools/usage）下面，接口是 GET /api/usage 的 left / byPurpose 两个字段。
 */
import type { Env } from './env';

export const WAI_KEY = 'workers-ai';
export const GEMINI_DEFAULT_CAP = 200;
export const GEMINI_MAX_CAP = 10_000;
export const WAI_DEFAULT_CAP = 8_000;
export const WAI_MAX_CAP = 9_500;

/** 美国太平洋时间的年月日时分秒 → 当地时间当成 UTC 的毫秒数 */
function laLocal(now: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export const pacificDay = (now: number) => new Date(laLocal(now)).toISOString().slice(0, 10);
export const dayFor = (model: string, now: number) => (model === WAI_KEY ? utcDay(now) : pacificDay(now));

/** 下一次重置的时间（毫秒） */
export function nextReset(model: string, now: number): number {
  if (model === WAI_KEY) return Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  const local = laLocal(now);
  const offset = local - Math.floor(now / 1000) * 1000; // 太平洋时间比 UTC 慢多少（负数）
  const d = new Date(local);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - offset;
}

export async function getCap(env: Env, model: string): Promise<number> {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind('cap:' + model).first<{ value: string }>();
  const v = Number(r?.value);
  if (model === WAI_KEY) {
    const fallback = Number(env.WORKERS_AI_DAILY_NEURONS);
    const n = Number.isFinite(v) && v > 0 ? v : Number.isFinite(fallback) && fallback > 0 ? fallback : WAI_DEFAULT_CAP;
    return Math.min(n, WAI_MAX_CAP);
  }
  return Number.isFinite(v) && v > 0 ? Math.min(v, GEMINI_MAX_CAP) : GEMINI_DEFAULT_CAP;
}

export async function usedReq(env: Env, model: string, now: number): Promise<number> {
  const r = await env.DB.prepare('SELECT req FROM model_usage WHERE day = ?1 AND model = ?2').bind(dayFor(model, now), model).first<{ req: number }>();
  return r?.req ?? 0;
}

/** "测试 AI"这类平台自己的调用记到这个项目名下（D-3，公司平台批 2） */
export const PLATFORM_PROJECT = '_platform';

// ======================================================================
// Cloudflare 自己说"账号额度用完了"（2026-11-03，Amos 被后台那个数误导了两次之后加的）。
//
// 为什么非加不可：`wrangler.toml` 里 `marketing` 和 `marketing-staging` 是**两个不同的 D1**，各记各的账；
// 而 Cloudflare 的免费额度 **10,000 neurons/天是按整个账号算的**，两个环境共用。
// 所以后台写"今天已用 115、还剩 9,385"的时候，账号那边其实已经被测试版花光了——那个数只是**我们这个环境自己**记下的下限。
// **唯一可靠的信号是 Cloudflare 自己报的那句话**：报了就记一行（表 account_limit，迁移 0011），后台"还剩多少"置顶一句红字。
// 真实剩余要查只能走 Cloudflare 的 GraphQL 分析接口（要 Amos 的 API 令牌），**这一版没做**，所以不假装算得出（底线 3）。
// ======================================================================

/** Workers AI 的免费额度：整个账号每天 10,000 neurons，00:00 UTC 清零（Cloudflare 价格页，2026-11-03 查：证实） */
export const CF_ACCOUNT_FREE_NEURONS = 10_000;

/** 台湾时间（UTC+8，没有夏令时）的 `YYYY-MM-DD HH:MM`；时间点都从 nextReset / 时间戳算，不写死字符串 */
export function twText(ms: number): string {
  const s = new Date(ms + 8 * 3600_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

/**
 * 这一次出错是不是"**整个 Cloudflare 账号**今天的免费额度用完了"。
 * **按文案判，不只认错误码**：Amos 2026-11-03 看到的是 `4006: you have used up your daily free allocation of 10,000 neurons…`，
 * 而官方错误表里登记的账号级那条是 **3036 Account limited**——码对不上、文案是同一条。只认码会漏，所以：
 *   ① 先认文案（daily free allocation / account limited / 又说 neurons 又让 upgrade）；
 *   ② 码只当补充，认 3036 和 429（官方表里的码会变，文案不会）。
 * 我们自己设的上限（WorkersAiCap、/api/assets 和 /api/tts 的 429）走的是另一条路，不经过这里。
 */
export function isAccountLimited(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('daily free allocation') || s.includes('account limited')) return true;
  if (s.includes('neuron') && s.includes('upgrade')) return true;
  return /(^|\D)(3036|429)(\D|$)/.test(s);
}

/**
 * 把 Cloudflare 那句英文翻成人话（素材生成器、语音生成、备用 AI 的"出错"字段都用这一句）。说清三件事：
 *   ① 是**整个 Cloudflare 账号**今天的免费额度用完了，不是这个工具坏了；
 *   ② 台湾时间明早 8 点清零（从 nextReset 算，不写死），到点再点同一个按钮会接着没生成的跑；
 *   ③ 想现在就继续得升级 Cloudflare 的 Workers Paid 付费计划，**那要花钱，由 Amos 自己决定**（C117 / 底线 8）。
 * **不给升级链接、不建议他升级**；英文原话附在后面括号里，方便和 Cloudflare 的账单对账。
 */
export function accountLimitedMessage(raw: string, now: number): string {
  const one = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return (
    `整个 Cloudflare 账号今天的免费额度（每天 ${CF_ACCOUNT_FREE_NEURONS.toLocaleString('en-US')} neurons）用完了，不是这个工具坏了——` +
    `测试版、正式版和这个账号上别的东西，花的都是同一份额度。` +
    `台湾时间 ${twText(nextReset(WAI_KEY, now))} 清零，到点再点同一个按钮，没生成完的会接着跑。` +
    `想现在就继续，只能升级 Cloudflare 的 Workers Paid 付费计划——那要花钱，得 Amos 自己决定。` +
    (one ? `（Cloudflare 原话：${one}）` : '')
  );
}

/** Cloudflare 说额度用完了：按 UTC 日期记一行（到下一个 UTC 日自然失效）。写失败只打日志，不影响调用方。 */
export async function noteAccountLimit(env: Env, now: number, raw: string): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO account_limit (day, model, first_at, at, hits, last_error) VALUES (?1, ?2, ?3, ?3, 1, ?4) ' +
        'ON CONFLICT (day, model) DO UPDATE SET at = ?3, hits = hits + 1, last_error = ?4',
    )
      .bind(utcDay(now), WAI_KEY, now, String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300))
      .run();
  } catch (e) {
    console.log(JSON.stringify({ event: 'copilot.account_limit_write_failed', detail: String((e as Error)?.message ?? e).slice(0, 200) }));
  }
}

export interface AccountLimit {
  /** 最近一次被拒的毫秒时间戳 */
  at: number;
  firstAt: number;
  hits: number;
  /** 下一个 UTC 0 点（＝台湾早上 8 点），和 nextReset 同一个函数算的 */
  resetAt: number;
  /** 后台"还剩多少"置顶那句红字 */
  text: string;
  /** Cloudflare 的英文原话（对账用） */
  raw: string;
}

/**
 * 今天 Cloudflare 有没有说过"额度用完了"。
 * **只查今天这一行**（day = 今天的 UTC 日期），所以到了下一个 UTC 日（台湾早上 8 点）这条提示自动不再显示，
 * 不会一直挂着吓人，也不用定时任务去清（全账号只有 5 个定时任务，C120）。表还没建时返回 null，页面照常显示。
 */
export async function accountLimit(env: Env, now: number): Promise<AccountLimit | null> {
  try {
    const r = await env.DB.prepare('SELECT first_at, at, hits, last_error FROM account_limit WHERE day = ?1 AND model = ?2')
      .bind(utcDay(now), WAI_KEY)
      .first<{ first_at: number; at: number; hits: number; last_error: string }>();
    if (!r) return null;
    const resetAt = nextReset(WAI_KEY, now);
    return {
      at: r.at,
      firstAt: r.first_at,
      hits: r.hits,
      resetAt,
      raw: r.last_error ?? '',
      text:
        `Cloudflare 在台湾时间 ${twText(r.at)} 说账号今天的 ${CF_ACCOUNT_FREE_NEURONS.toLocaleString('en-US')} neurons 已经用完，` +
        `台湾时间 ${twText(resetAt)} 清零。`,
    };
  } catch {
    return null;
  }
}

/** 文案里要指名道姓说是"哪个环境自己记的账"（正式版和测试版各记各的，这正是那个数会骗人的原因） */
export const envName = (env: Env): string => (env.ENVIRONMENT === 'production' ? '正式版' : '测试版');

// ======================================================================
// 用量监控：按**用途**记一本（Amos 2026-11-03"可以看到剩余和分别用到了哪里"）。
// 和"按项目记"（usage_by_project）的区别：素材生成器的图片和音频都算 practical-assets，
// 按项目看分不出哪一笔是出图、哪一笔是配音；按用途就分得出。只记、不当限额。
// ======================================================================

/** 用途的全集（页面按这个顺序排）。新增用途要同时在这里和 PURPOSE_LABEL 里加一项。 */
export const PURPOSES = ['assets-image', 'assets-audio', 'tts', 'pron-tts', 'pron-asr', 'drill-tts', 'voice', 'draft', 'score', 'platform', 'other'] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = {
  'assets-image': '素材生成器 · 图片',
  'assets-audio': '素材生成器 · 音频',
  tts: '语音生成',
  // 2026-11-13 起发音改成**预先生成**（微软 Edge 的神经网络语音，写进 en_audio），运行时一次 Workers AI 都不调；
  // 这一行**留着**：库里还有 aura-2-en 时代记的账，去掉这一行那些行就只剩一个看不懂的代号（底线 3）
  'pron-tts': '发音训练 · 发音（已改成预先生成，历史数据）',
  'pron-asr': '发音训练 · 纠说（听你念）',
  // 「带练」2026-11-11 下线了，这一行**留着**：库里还有它当时记的账，去掉这一行那些行就只剩一个看不懂的代号（底线 3）
  'drill-tts': '带练 · 发音（已下线，历史数据）',
  voice: '语音对话实测',
  draft: '跟帖草稿',
  score: '跟帖评分',
  platform: '平台自己（"测试 AI"）',
  other: '其他',
};
/** 这一版上线以前记下的用量没有用途：单独一行，不摊到任何一项头上（不编数字，底线 3） */
export const UNLABELED = '_unlabeled';
export const purposeLabel = (p: string): string => (p === UNLABELED ? '没按用途记下来的' : (PURPOSE_LABEL[p as Purpose] ?? p));
const purposeOrder = (p: string): number => {
  const i = (PURPOSES as readonly string[]).indexOf(p);
  return i < 0 ? PURPOSES.length : i;
};

/**
 * 记一次请求（不管成功与否都算一次，Google 也是这样算的）。
 * 带 project 时再按项目记一行到 usage_by_project（公司平台批 2，D-3：只记、不当限额）；那一行写失败（例如表还没建）只打日志，不影响调用方。
 */
export async function recordUse(env: Env, model: string, now: number, u: { status: number; tokIn?: number; tokOut?: number; project?: string; neurons?: number; purpose?: string }) {
  await env.DB.prepare(
    'INSERT INTO model_usage (day, model, req, tok_in, tok_out, last_status, last_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6) ' +
      'ON CONFLICT (day, model) DO UPDATE SET req = req + 1, tok_in = tok_in + ?3, tok_out = tok_out + ?4, last_status = ?5, last_at = ?6',
  )
    .bind(dayFor(model, now), model, Math.max(0, Math.round(u.tokIn ?? 0)), Math.max(0, Math.round(u.tokOut ?? 0)), u.status, now)
    .run();
  if (u.project) await recordByProject(env, model, now, u.project, u);
  if (u.purpose) await recordByPurpose(env, model, now, u.purpose, u);
}

/** 按用途记一行（和 recordByProject 一样：写失败只打日志，不影响调用方） */
async function recordByPurpose(env: Env, model: string, now: number, purpose: string, u: { tokIn?: number; tokOut?: number; neurons?: number }) {
  try {
    await env.DB.prepare(
      'INSERT INTO usage_by_purpose (day, purpose, model, req, tok_in, tok_out, neurons) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6) ' +
        'ON CONFLICT (day, purpose, model) DO UPDATE SET req = req + 1, tok_in = tok_in + ?4, tok_out = tok_out + ?5, neurons = neurons + ?6',
    )
      .bind(dayFor(model, now), purpose.slice(0, 32), model, Math.max(0, Math.round(u.tokIn ?? 0)), Math.max(0, Math.round(u.tokOut ?? 0)), Math.max(0, u.neurons ?? 0))
      .run();
  } catch (e) {
    console.log(JSON.stringify({ event: 'copilot.usage_by_purpose_failed', detail: String((e as Error)?.message ?? e).slice(0, 200) }));
  }
}

async function recordByProject(env: Env, model: string, now: number, project: string, u: { tokIn?: number; tokOut?: number; neurons?: number }) {
  try {
    await env.DB.prepare(
      'INSERT INTO usage_by_project (day, project, model, req, tok_in, tok_out, neurons) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6) ' +
        'ON CONFLICT (day, project, model) DO UPDATE SET req = req + 1, tok_in = tok_in + ?4, tok_out = tok_out + ?5, neurons = neurons + ?6',
    )
      .bind(dayFor(model, now), project.slice(0, 32), model, Math.max(0, Math.round(u.tokIn ?? 0)), Math.max(0, Math.round(u.tokOut ?? 0)), Math.max(0, u.neurons ?? 0))
      .run();
  } catch (e) {
    console.log(JSON.stringify({ event: 'copilot.usage_by_project_failed', detail: String((e as Error)?.message ?? e).slice(0, 200) }));
  }
}

export interface ProjectUsage { project: string; gemini: number; workersAi: number }

/** 后台用量页"按项目看"：今天（各家的重置时间）每个项目的 Gemini 次数（几个模型加起来）和 Workers AI neurons；表还没建时返回 [] */
export async function usageByProject(env: Env, now: number): Promise<ProjectUsage[]> {
  try {
    const r = await env.DB.prepare(
      "SELECT project, SUM(CASE WHEN model != ?1 AND day = ?2 THEN req ELSE 0 END) AS gemini, SUM(CASE WHEN model = ?1 AND day = ?3 THEN neurons ELSE 0 END) AS wai " +
        'FROM usage_by_project WHERE day IN (?2, ?3) GROUP BY project ORDER BY project',
    ).bind(WAI_KEY, pacificDay(now), utcDay(now)).all<{ project: string; gemini: number; wai: number }>();
    return (r.results ?? []).filter((x) => x.gemini > 0 || x.wai > 0).map((x) => ({ project: x.project, gemini: x.gemini, workersAi: x.wai }));
  } catch {
    return [];
  }
}

export interface PurposeUsage {
  purpose: string;
  label: string;
  /** Workers AI 今天的 neurons（估算，和 ai_usage 同一种算法） */
  neurons: number;
  /** Workers AI 今天调了几次；没记下来的那一行是 null（页面写"没记录"，不补 0，底线 3） */
  waiReq: number | null;
  /** Gemini 今天的请求次数（几个模型加起来） */
  geminiReq: number;
}

/**
 * "分别用到了哪里"：今天（各家的重置时间）每个用途的 Workers AI neurons / 次数和 Gemini 次数。
 * 表还没建（迁移没跑）时返回 []，页面照样能显示"还剩多少"。
 */
export async function usageByPurpose(env: Env, now: number): Promise<PurposeUsage[]> {
  try {
    const r = await env.DB.prepare(
      'SELECT purpose, SUM(CASE WHEN model = ?1 AND day = ?3 THEN neurons ELSE 0 END) AS wn, ' +
        'SUM(CASE WHEN model = ?1 AND day = ?3 THEN req ELSE 0 END) AS wreq, ' +
        'SUM(CASE WHEN model != ?1 AND day = ?2 THEN req ELSE 0 END) AS greq ' +
        'FROM usage_by_purpose WHERE day IN (?2, ?3) GROUP BY purpose',
    )
      .bind(WAI_KEY, pacificDay(now), utcDay(now))
      .all<{ purpose: string; wn: number; wreq: number; greq: number }>();
    return (r.results ?? [])
      .filter((x) => x.wreq > 0 || x.greq > 0)
      .map((x) => ({ purpose: x.purpose, label: purposeLabel(x.purpose), neurons: x.wn, waiReq: x.wreq, geminiReq: x.greq }))
      .sort((a, b) => purposeOrder(a.purpose) - purposeOrder(b.purpose) || a.purpose.localeCompare(b.purpose));
  } catch {
    return [];
  }
}

export interface UsageLeft {
  /** workers-ai / gemini：两本账分开，**不加在一起**（单位都不一样） */
  key: string;
  label: string;
  unit: '次' | 'neurons';
  used: number;
  cap: number;
  left: number;
  resetAt: number;
  /** 这一本的"一天"按哪个时区算、几点清零（从 dayFor / nextReset 来的，不是凭印象写的）；长一点的说明在页面的 hint 里 */
  resetText: string;
  /** Gemini 的上限是每个模型一个数，这里是几个模型加起来；Workers AI 只有一本，这个是 1 */
  models: number;
  /** 这个数靠不靠得住，一句话版（显示在"还剩"那一格里，看数字的时候就看得见）；靠得住的那一本没有这一项 */
  caveatShort?: string;
  /** 同一件事的说清楚版（显示在表格下面）：这个数是怎么来的、漏了什么、为什么只能当下限看 */
  caveat?: string;
}

/**
 * Workers AI 那一行为什么不能当真实剩余看（2026-11-03 Amos 被这个数误导了两次）：
 * 两个环境两个 D1、各记各的账，而 Cloudflare 的 10,000 neurons 是按整个账号算的。
 * **不把两个环境的数硬加起来假装是真实值**——加起来还是漏了这一版上线以前的用量和账号上别的东西，
 * 一样是假的；做不到就说做不到（底线 3）。
 */
export const waiCaveatShort = '不是 Cloudflare 的真实剩余';
export function waiCaveat(where: string): string {
  return (
    `这个数是${where}自己记下来的账，不是 Cloudflare 的真实剩余。` +
    `Cloudflare 的免费额度（每天 ${CF_ACCOUNT_FREE_NEURONS.toLocaleString('en-US')} neurons）是按「整个账号」算的，正式版和测试版共用一份；` +
    `而正式版和测试版各有各的数据库、各记各的账。所以：测试版花掉的、这一版上线以前花掉的、这个账号上别的东西花掉的，` +
    `都不在这个数里，但都在花同一份额度。` +
    `也就是说「今天已用」只是个下限（真实只会更多），「还剩」是「最多还能有这么多」（真实只会更少，甚至可能已经是 0）。` +
    `我们查不到真实剩余，也不会把两个环境的数加起来冒充真实值（加起来一样是假的）。` +
    `唯一说得准的是 Cloudflare 自己的那句话：它说额度用完了，上面就会出现一条红字；没有红字也不代表一定还有。`
  );
}

/**
 * 顶上那块"还剩多少"：直接从 usageReport 的行算，不另外查库。
 * `where` 是这个环境的名字（正式版 / 测试版），写进 Workers AI 那一行的说明里。
 */
export function usageLeft(rows: UsageRow[], where = '这个环境'): UsageLeft[] {
  const out: UsageLeft[] = [];
  const wai = rows.find((r) => r.model === WAI_KEY);
  if (wai) {
    out.push({
      key: WAI_KEY, label: 'Workers AI（备用 AI + 素材生成器 + 语音生成）', unit: 'neurons',
      used: wai.used, cap: wai.cap, left: Math.max(0, wai.cap - wai.used), resetAt: wai.resetAt,
      resetText: 'UTC 0 点（台湾早上 8 点）', models: 1,
      caveatShort: waiCaveatShort, caveat: waiCaveat(where),
    });
  }
  const gem = rows.filter((r) => r.model !== WAI_KEY);
  if (gem.length) {
    const used = gem.reduce((n, r) => n + r.used, 0);
    const cap = gem.reduce((n, r) => n + r.cap, 0);
    out.push({
      key: 'gemini', label: `Gemini（${gem.length} 个模型的上限加起来）`, unit: '次',
      used, cap, left: Math.max(0, cap - used), resetAt: Math.min(...gem.map((r) => r.resetAt)),
      resetText: '美国太平洋时间半夜（台湾下午 3～4 点）', models: gem.length,
    });
  }
  return out;
}

/**
 * 今天的总量减掉已经按用途记下的，补成最后一行。
 * 这一版上线以前的用量没有用途，**不回填、不摊进任何一项**；Workers AI 那边记不出次数就写 null（页面显示"没记录"）。
 * 差额小于一次调用的量（neurons < 0.5、Gemini < 1 次）就不显示，免得只因为四舍五入多出一行。
 */
export function unlabeledUsage(byPurpose: PurposeUsage[], left: UsageLeft[]): PurposeUsage | null {
  const wai = left.find((x) => x.key === WAI_KEY);
  const gem = left.find((x) => x.key === 'gemini');
  const n = Math.max(0, (wai?.used ?? 0) - byPurpose.reduce((a, x) => a + x.neurons, 0));
  const g = Math.max(0, (gem?.used ?? 0) - byPurpose.reduce((a, x) => a + x.geminiReq, 0));
  if (n < 0.5 && g < 1) return null;
  return { purpose: UNLABELED, label: purposeLabel(UNLABELED), neurons: n, waiReq: null, geminiReq: g };
}

export interface UsageRow { model: string; label: string; unit: '次' | 'neurons'; req: number; tokIn: number; tokOut: number; used: number; cap: number; max: number; state: 'ok' | 'google_429' | 'our_cap' | 'error'; stateText: string; resetAt: number }

export async function usageReport(env: Env, now: number, geminiModels: string[], waiUsed: number, waiBound: boolean): Promise<UsageRow[]> {
  const rows: UsageRow[] = [];
  const models = [...geminiModels, ...(waiBound ? [WAI_KEY] : [])];
  for (const model of models) {
    const r = await env.DB.prepare('SELECT req, tok_in, tok_out, last_status FROM model_usage WHERE day = ?1 AND model = ?2').bind(dayFor(model, now), model).first<{ req: number; tok_in: number; tok_out: number; last_status: number | null }>();
    const cap = await getCap(env, model);
    const wai = model === WAI_KEY;
    const used = wai ? Math.round(waiUsed) : (r?.req ?? 0);
    let state: UsageRow['state'] = 'ok';
    let stateText = '正常';
    if (used >= cap) { state = 'our_cap'; stateText = '到了我们设的上限，今天先跳过'; }
    else if (r?.last_status === 429) { state = 'google_429'; stateText = 'Google 说额度用完（429）'; }
    else if (r?.last_status != null && r.last_status !== 200) { state = 'error'; stateText = r.last_status === 0 ? '最近一次超时或连不上' : `最近一次出错（${r.last_status}）`; }
    rows.push({
      model, label: wai ? '备用 AI · Workers AI（qwen3-30b）' : model, unit: wai ? 'neurons' : '次',
      req: r?.req ?? 0, tokIn: r?.tok_in ?? 0, tokOut: r?.tok_out ?? 0, used, cap, max: wai ? WAI_MAX_CAP : GEMINI_MAX_CAP, state, stateText, resetAt: nextReset(model, now),
    });
  }
  return rows;
}

/** 后台保存上限：全部合法才保存，返回不合法的原因 */
export async function saveCaps(env: Env, now: number, caps: Record<string, unknown>, allowed: string[]): Promise<string[]> {
  const bad: string[] = [];
  const ok: [string, number][] = [];
  for (const [model, v] of Object.entries(caps)) {
    if (!allowed.includes(model)) { bad.push(`不认识的模型：${model.slice(0, 40)}`); continue; }
    const max = model === WAI_KEY ? WAI_MAX_CAP : GEMINI_MAX_CAP;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > max) bad.push(`${model === WAI_KEY ? 'Workers AI' : model} 要在 1～${max.toLocaleString('en-US')} 之间${model === WAI_KEY ? '（超过 9,500 可能产生费用）' : ''}`);
    else ok.push([model, n]);
  }
  if (bad.length) return bad;
  if (ok.length) await env.DB.batch(ok.map(([m, n]) => env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3').bind('cap:' + m, String(n), now)));
  return [];
}

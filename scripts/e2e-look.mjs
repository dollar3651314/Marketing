/**
 * 改版批 B（2026-11-04，测试会话写，研发不改这里的判定）：e2e-platform.mjs、e2e-tools.mjs 共用的"看起来对不对"的量法。
 * 只量页面、不改页面；口径和 e2e-platform.mjs 第 10 段「改版批 A」一致（字号阶梯、例外、底部空白、菜单顺序），批 A 那段自己的那份不动。
 *   fontOutliers  看得见的文字字号不在阶梯里的
 *   lowContrast   文字和它实际背景的对比度不够的（WCAG：一般文字 ≥ 4.5，大字 ≥ 3）
 *   tailOf        最后一个模块底边到页面底的距离
 *   orderOf       子菜单顺序 vs 模块在页面上的顺序
 *   modShape      模块固定结构：卡片 → 标题行 → 一句话结论 → 主内容 → 底部折叠说明
 *   reveal        要点的控件在收起的 <details> 里时，先点开（用户也是这样点）；不在折叠里什么都不做
 */
// 字号阶梯（设计规范）：页面标题 24 / 手机 22，模块标题 18 / 手机 17，正文 15，辅助 13，大数字 30 / 手机 26，12 只给角标；±0.5
export const FS = [12, 13, 15, 17, 18, 22, 24, 26, 30];
// 按钮、输入框、菜单链接、chip、summary 可以是 14（原型 .btn、.nav1 a、.sub a 都是 14）
export const FS_CTL = 14;
// 只限特定元素的例外（主会话 2026-11-04 定）：品牌名 16、"最该做的事"大标题 28
export const FS_ONLY = [['.brand', 16], ['#hero h2', 28]];
export const TAIL_MAX = 160;
export const CONTRAST_MIN = 4.5;

export const fontOutliers = (page, roots) => page.evaluate(({ roots, FS, FS_CTL, FS_ONLY }) => {
  const out = [];
  for (const root of roots.map((s) => document.querySelector(s)).filter(Boolean)) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!e.getClientRects().length) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity === 0) continue;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!own) continue;
      const fs = parseFloat(st.fontSize);
      if (FS.some((v) => Math.abs(v - fs) <= 0.5)) continue;
      if (Math.abs(fs - FS_CTL) <= 0.5 && e.closest('button, input, select, textarea, .btn, .chip, nav a, summary')) continue;
      if (FS_ONLY.some(([sel, v]) => Math.abs(fs - v) <= 0.5 && e.closest(sel))) continue;
      const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '';
      out.push(`${fs}px ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls}「${own.slice(0, 12)}」`);
    }
  }
  return [...new Set(out)].slice(0, 20);
}, { roots, FS, FS_CTL, FS_ONLY });

/**
 * 文字对比度：每个看得见、有自己文字的元素，文字色（含透明度、祖先 opacity）叠到它实际的背景上（往上找第一层不透明的底色，半透明的逐层叠），
 * 和背景算 WCAG 对比度。大字（≥24px，或 ≥18.66px 且加粗）≥ 3，其余 ≥ min。
 * 不算：文字色全透明的、禁用的控件（:disabled、aria-disabled="true"，它们本来就该淡）、骨架 .skel、圆点 .dot、背景是渐变 / 图片的（量不准，单列 unsure）。
 */
export const lowContrast = (page, roots, min = CONTRAST_MIN) => page.evaluate(({ roots, min }) => {
  const parse = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return { r: m[0] ?? 0, g: m[1] ?? 0, b: m[2] ?? 0, a: m.length > 3 ? m[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bodyBg = (() => { const b = parse(getComputedStyle(document.body).backgroundColor); const h = parse(getComputedStyle(document.documentElement).backgroundColor); return b.a > 0 ? over(b, h.a > 0 ? h : { r: 255, g: 255, b: 255, a: 1 }) : (h.a > 0 ? h : { r: 255, g: 255, b: 255, a: 1 }); })();
  const bgOf = (e) => {
    const layers = [];
    for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parse(s.backgroundColor);
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = layers.length && layers.at(-1).a >= 1 ? layers.pop() : bodyBg;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const out = [], unsure = [];
  for (const root of roots.map((s) => document.querySelector(s)).filter(Boolean)) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (!e.getClientRects().length) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (!own) continue;
      if (e.closest(':disabled, [aria-disabled="true"], .skel, .dot')) continue;
      let op = 1;
      for (let x = e; x; x = x.parentElement) op *= +getComputedStyle(x).opacity;
      if (op === 0) continue;
      const bg = bgOf(e);
      const tag = `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : ''}「${own.slice(0, 10)}」`;
      if (!bg) { unsure.push(tag); continue; }
      const fg = parse(st.color);
      if (fg.a === 0) continue; // 文字本身全透明（例如打勾按钮平时不显示 ✓）不算文字
      fg.a *= op;
      const c = ratio(over(fg, bg), bg);
      const fs = parseFloat(st.fontSize), bold = (+st.fontWeight || 400) >= 700;
      const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : min;
      if (c < need) out.push(`${tag} ${c.toFixed(2)} < ${need}（字 ${st.color} 底 rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})）`);
    }
  }
  return { bad: [...new Set(out)].slice(0, 20), unsure: [...new Set(unsure)].slice(0, 10) };
}, { roots, min });

export const tailOf = (page, pageSel) => page.evaluate((ps) => {
  const v = document.querySelector(ps);
  const mods = [...v.querySelectorAll('.mod')].filter((e) => !e.closest('[hidden]') && e.getClientRects().length && !e.parentElement.closest('.mod'));
  const bottom = Math.max(...mods.map((e) => e.getBoundingClientRect().bottom + scrollY));
  const sh = document.documentElement.scrollHeight;
  return { tail: Math.round(sh - bottom), sh, ih: innerHeight, last: mods.at(-1)?.id };
}, pageSel);

export const orderOf = (page, sub) => page.evaluate((s) => {
  const menu = [...document.querySelectorAll(s + ' a[data-s]')].map((a) => a.dataset.s);
  const mods = menu.map((id) => document.getElementById(id)).filter((e) => e && !e.closest('[hidden]') && e.getClientRects().length)
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, top: Math.round(r.top + scrollY), left: Math.round(r.left) }; })
    .sort((a, b) => (Math.abs(a.top - b.top) <= 4 ? a.left - b.left : a.top - b.top));
  return { menu, page: mods.map((m) => m.id) };
}, sub);

/**
 * 模块固定结构（批 A 工作台的写法，批 B 照用）：模块本身是 .card.mod；看得见的子元素依次是
 *   ① 标题行 .mh（本身是 h2，或里面有 h2）② 一句话结论 .lead（里面一个 .dot.red / .amber / .ok / .gray）③ 至少一块主内容 ④ 有说明的，最后一块是 details.more。
 * 另外量：details.more 有没有 open、结论文字、折叠外面看得见的长说明（p / .hint 超过 60 字，不算 .lead、表格、列表、#list、details 里面的）。
 */
export const modShape = (page, ids) => page.evaluate((ids) => ids.map((id) => {
  const m = document.getElementById(id);
  if (!m) return { id, why: '没有这个模块' };
  const kids = [...m.children].filter((c) => c.getClientRects().length && getComputedStyle(c).visibility !== 'hidden');
  const head = kids[0], lead = kids[1];
  const headOk = !!head && head.matches('.mh') && (head.matches('h2') || !!head.querySelector('h2'));
  const leadOk = !!lead && lead.matches('.lead');
  const dot = leadOk ? lead.querySelector('.dot') : null;
  const dotCls = dot ? ['red', 'amber', 'ok', 'gray'].find((c) => dot.classList.contains(c)) || '' : '';
  const lastIsMore = !!kids.at(-1) && kids.at(-1).matches('details.more');
  const mains = kids.slice(2, lastIsMore ? -1 : undefined).length;
  const mores = [...m.querySelectorAll('details.more')].filter((d) => d.closest('.mod') === m);
  const long = [...m.querySelectorAll('p, .hint')].filter((e) => e.getClientRects().length && !e.closest('details, .lead, table, ol, ul, #list') && e.innerText.replace(/\s+/g, '').length > 60)
    .map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 30));
  return {
    id, card: m.matches('.card.mod'), headOk, leadOk, dotCls, mains, lastIsMore,
    moreOpen: mores.filter((d) => d.open).length, mores: mores.length,
    lead: leadOk ? lead.innerText.replace(/\s+/g, ' ').trim() : (lead ? '（第二块不是 .lead：' + (lead.className || lead.tagName) + '）' : ''),
    long,
  };
}), ids);
/** 一句话结论是不是"结论"：带数字，或明说没事 / 没有 / 不用 / 还没 / 都…了 / 开着 / 关着 / 读不到；不是"正在读取"；6～80 字 */
export const isConclusion = (t) => /\d|没事|没有|不用|还没|都已|都做完|都回完|开着|关着|读不到|正常|宽裕|到上限/.test(t) && !/正在读取|读取中/.test(t) && t.length >= 6 && t.length <= 80;

/** 要操作的控件在收起的 <details> 里：从外到里点开每一层的 summary（最多 3 层）；本来就看得见、或页面还没有折叠时什么都不做 */
export async function reveal(page, sel) {
  for (let i = 0; i < 3; i++) {
    const marked = await page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return false;
      let outer = null;
      for (let d = e.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) if (!d.open && !(d === e)) outer = d;
      if (!outer) return false;
      outer.setAttribute('data-e2e-reveal', '1');
      return true;
    }, sel);
    if (!marked) return;
    await page.click('[data-e2e-reveal] > summary', { timeout: 4000 });
    await page.evaluate(() => document.querySelectorAll('[data-e2e-reveal]').forEach((d) => d.removeAttribute('data-e2e-reveal')));
  }
}

/*
 * 点开工作台"全部待办"里收起的组（2026-11-04 测试会话修偶发失败，C57；只是辅助步骤，判定不变）。
 * 根因：切到工作台时 platformOpen() 会重读 /api/company，读回来就把 #w-todos 整个重画（新的 <details> 按 PL.noneOpen 决定开没开）。
 *   原来的写法在旧数据画的待办一看得见就去点"没定截止时间"的标题；如果重画正好落在这一下的 mousedown 和 mouseup 之间，
 *   按下和松开不在同一个元素上，浏览器不发 click，toggle 也不发，PL.noneOpen 还是 false，新画的组一直收着，
 *   末尾"所有 details 都 open"的等待就等满 4 秒报 Timeout（e2e-tools A 段 375 宽，staging a2d4cb3 跑 3 遍撞 1 次）。
 *   确定性复现：扣住切页那次 /api/company，mouse.down → 放行、等 #w-todos 重画 → mouse.up，组一直收着、同一句 Timeout。
 * 现在：① 先等这一页发出去的 /api/company 都回来了（trackApi 记的在途数 = 0），再让页面跑完手上的任务，才去点；
 *   ② 点完等一个确定的结果：要么所有组都 open，要么刚点的那个元素已经不在页面上（被重画换掉了）——后一种就对新画的再点一次，最多 3 轮；
 *   3 轮都被换掉就报错（不放宽超时、不吞错误）。
 */
const INFLIGHT = new WeakMap();
/** 记这一页在途的 /api/company 请求数（open() 里调一次） */
export function trackApi(page) {
  let n = 0;
  INFLIGHT.set(page, () => n);
  const mine = (r) => /\/api\/company(\?|$)/.test(r.url());
  page.on('request', (r) => { if (mine(r)) n++; });
  const done = (r) => { if (mine(r)) n = Math.max(0, n - 1); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}
/** 等到这一页没有在途的 /api/company，再让页面跑完已排队的任务（重画就在读回来之后的任务里） */
export async function apiSettled(page, wait = 4000) {
  const get = INFLIGHT.get(page);
  if (get) {
    const t0 = Date.now();
    while (get() > 0) {
      if (Date.now() - t0 > wait) throw new Error(`等 /api/company 读回来等了 ${wait}ms（还有 ${get()} 个在途）`);
      await new Promise((ok) => setTimeout(ok, 20));
    }
  }
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 0)));
  await page.evaluate(() => 0);
}
export async function openGroups(page, wait = 4000) {
  for (let round = 1; round <= 3; round++) {
    await apiSettled(page, wait);
    const n = await page.evaluate(() => { window.__e2eOg = [...document.querySelectorAll('#w-todos details:not([open])')]; window.__e2eOg.forEach((d, i) => { d.dataset.e2eOg = String(i); }); return window.__e2eOg.length; });
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const sum = page.locator(`#w-todos details[data-e2e-og="${i}"] > summary`);
      if (!(await sum.count())) break;
      await sum.click({ timeout: wait }).catch(async (e) => { if (await page.evaluate(() => window.__e2eOg.every((d) => d.isConnected))) throw e; });
    }
    const r = await page.waitForFunction(() => {
      if (window.__e2eOg.some((d) => !d.isConnected)) return 'redrawn';
      return [...document.querySelectorAll('#w-todos details')].every((d) => d.open) ? 'open' : false;
    }, null, { timeout: wait }).then((h) => h.jsonValue());
    if (r === 'open') { await apiSettled(page, wait); if (await page.evaluate(() => [...document.querySelectorAll('#w-todos details')].every((d) => d.open))) return; }
  }
  throw new Error('点开"没定截止时间"：连续 3 轮刚点完就被重画换掉，或点开后又被收起');
}

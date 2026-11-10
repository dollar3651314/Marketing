/**
 * 「基金观察」的页面片段（一级菜单「公共工具」右边的「基金观察」，地址 `#/funds`，整页 `#v-funds`；服务端 src/funds-api.ts、计算 src/funds.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 照 Amos 看过的高保真原型（agents 研发 2026-11-10「基金观察原型.html」）做，套工作台的设计变量：
 *   标题 + 数据时间 + 「刷新数据」（分批进度"正在取 美国 · 29 / 45"）→ 一句话总结 + 单日涨跌 ≥ ±3% 的标签 →
 *   时间段（近 1 周 / 近 1 月 / 今年以来 / 近 1 年，默认近 1 年）+ 市场（全部 / 新加坡 / 美国 / 中国）→ 三张市场卡片 →
 *   收益-回撤散点图 → 逐只对比（收益条 + 回撤条 + 一年走势小图，点一行展开价格曲线 + 水下回撤曲线 + 各期表）→ 底部折叠说明。
 * 涨绿跌红：用全站的 --ok / --err（和工作台现有的成功 / 出错颜色一致）；回撤用 --amber。
 * **为什么不进「公共工具」的二级菜单**：那个菜单上限 8 项已满（agents 工作平台/工具台账 T-4，`test/tts.test.ts` 守着），
 * 原型上它就是一级菜单里紧挨着「公共工具」的一项，所以单独一页。
 * 字号只用全站那几级（26 / 24 / 18 / 15 / 13 / 12，控件 14）。
 */
export const FUNDS_CSS = `
#v-funds{--fu-broad:#2563EB;--fu-bond:#0D9488;--fu-div:#C2410C;--fu-grid:#E9EDF3}
@media (prefers-color-scheme: dark){#v-funds{--fu-broad:#60A5FA;--fu-bond:#2DD4BF;--fu-div:#FB923C;--fu-grid:#1C2740}}
#v-funds .num{font-variant-numeric:tabular-nums}
#v-funds .fu-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:var(--s3)}
#v-funds .fu-head h1{margin:0;font-size:var(--fs-page);line-height:1.3}
#v-funds .fu-meta{color:var(--muted);font-size:var(--fs-aux)}
#v-funds .fu-refresh{display:flex;align-items:center;flex:0 0 auto}
#v-funds .fu-prog{font-size:var(--fs-aux);color:var(--muted);min-width:0;margin-top:calc(var(--s3) * -1);line-height:1.6;overflow-wrap:anywhere}
#v-funds .fu-prog:empty{display:none}
#v-funds .fu-prog b{color:var(--teal-ink)}
#v-funds .fu-prog.err{color:var(--err)}
#v-funds .btn{display:inline-flex;align-items:center;gap:6px;min-height:38px;padding:0 16px;font-size:14px;border-radius:var(--r-btn);white-space:nowrap}
#v-funds .btn:disabled{opacity:.6;cursor:progress;pointer-events:none}
#v-funds .fu-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow);padding:var(--s5);min-width:0}
#v-funds .fu-errbar{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;padding:var(--s3) var(--s4);border-radius:12px;background:var(--err-soft);color:var(--err);font-weight:600}
#v-funds .fu-errbar .sp{flex:1}
#v-funds .fu-lede{font-size:var(--fs-mod);line-height:1.7;margin:0;overflow-wrap:anywhere}
#v-funds .fu-lede b{font-variant-numeric:tabular-nums}
#v-funds .fu-alerts{display:flex;flex-wrap:wrap;gap:var(--s2);margin-top:var(--s3)}
#v-funds .fu-alert{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:3px 12px;font-size:var(--fs-aux);background:var(--err-soft);color:var(--err);font-weight:700}
#v-funds .fu-alert.up{background:var(--ok-soft);color:var(--ok)}
#v-funds .fu-alert.calm{background:var(--gray-soft);color:var(--ink-2);font-weight:400}
#v-funds .fu-alert small{font-weight:400;font-size:12px}
#v-funds .fu-controls{display:flex;flex-wrap:wrap;gap:var(--s3);justify-content:space-between;align-items:center}
#v-funds .fu-seg{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:3px;max-width:100%;overflow-x:auto;scrollbar-width:none}
#v-funds .fu-seg::-webkit-scrollbar{display:none}
#v-funds .fu-chip{font:inherit;font-size:14px;border:0;background:none;color:var(--muted);border-radius:99px;padding:5px 14px;cursor:pointer;white-space:nowrap;flex:0 0 auto}
#v-funds .fu-chip[aria-pressed="true"],#v-funds .fu-chip[aria-selected="true"]{background:var(--navy);color:#fff;font-weight:700}
@media (prefers-color-scheme: dark){#v-funds .fu-chip[aria-pressed="true"],#v-funds .fu-chip[aria-selected="true"]{background:var(--teal);color:#08101F}}
#v-funds .fu-chip:focus-visible,#v-funds .fu-row:focus-visible,#v-funds circle:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
#v-funds .fu-mkwrap{display:grid;gap:var(--s5);min-width:0}
#v-funds .fu-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4)}
@media (max-width:760px){#v-funds .fu-grid3{grid-template-columns:1fr}}
#v-funds .fu-mk h3{margin:0 0 var(--s2);font-size:var(--fs-mod)}
#v-funds .fu-big{display:flex;gap:var(--s4);align-items:baseline;flex-wrap:wrap}
#v-funds .fu-big div{display:flex;flex-direction:column}
#v-funds .fu-big strong{font-size:26px;line-height:1.2;font-variant-numeric:tabular-nums}
#v-funds .fu-big span{font-size:12px;color:var(--muted)}
#v-funds .fu-note{margin-top:var(--s2);font-size:var(--fs-aux);color:var(--ink-2)}
#v-funds .fu-updown{display:flex;height:8px;border-radius:99px;overflow:hidden;margin-top:var(--s3);background:var(--fu-grid)}
#v-funds .fu-updown i{display:block;height:100%}
#v-funds h2{margin:0;font-size:var(--fs-mod)}
#v-funds .fu-sec-h{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--s2);margin-bottom:var(--s3)}
#v-funds .fu-sec-h p{margin:0;color:var(--muted);font-size:var(--fs-aux)}
#v-funds .fu-legend{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);font-size:var(--fs-aux);color:var(--ink-2)}
#v-funds .fu-legend span{display:inline-flex;align-items:center;gap:6px}
#v-funds .fu-legend i{width:10px;height:10px;border-radius:50%;display:inline-block}
#v-funds .fu-legend i.bar{border-radius:2px;width:14px;height:6px}
#v-funds .fu-scbox{position:relative;margin-top:var(--s2)}
#v-funds .fu-scbox svg{display:block;width:100%;height:auto}
#v-funds .fu-tip{position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line);box-shadow:0 8px 24px rgba(0,0,0,.14);border-radius:10px;padding:8px 12px;font-size:var(--fs-aux);white-space:nowrap;z-index:5}
/* 触屏：浮框改成贴在屏幕上方或下方的抽屉（position:fixed），放在点击那一团点的另一侧，不盖住它们；高度最多半屏（top / bottom / max-height 由脚本按那一团点的位置算） */
#v-funds .fu-tip.touch{position:fixed;left:8px;right:8px;max-width:560px;margin:0 auto;pointer-events:auto;white-space:normal;padding:0 10px 6px;overflow-y:auto;overscroll-behavior:contain;z-index:40;border-radius:14px;box-shadow:0 6px 28px rgba(0,0,0,.22)}
#v-funds .fu-tip .hd{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;background:var(--surface);border-bottom:1px solid var(--line)}
#v-funds .fu-tip .x{flex:0 0 auto;width:44px;height:44px;margin-right:-8px;border:0;border-radius:99px;background:none;color:var(--ink-2);font:inherit;font-size:22px;line-height:1;cursor:pointer}
#v-funds .fu-tip .it{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:0 8px;padding:3px 6px;margin:0 -6px;border-radius:8px;cursor:pointer}#v-funds .fu-tip .it+.it{border-top:1px solid var(--line)}
#v-funds .fu-tip .it.on{background:var(--teal-soft)}
#v-funds .fu-tip .it b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35}
#v-funds .fu-tip .it .num{grid-column:1;font-size:12px;color:var(--ink-2);line-height:1.35}
#v-funds .fu-tip .go{grid-column:2;grid-row:1 / span 2;display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:99px;background:var(--surface-2);color:var(--teal-ink);font:inherit;font-size:var(--fs-aux);font-weight:700;cursor:pointer;white-space:nowrap}
#v-funds .fu-tip .more{flex:1;color:var(--muted);font-size:12px;padding:6px 0;line-height:1.5}
#v-funds .fu-tip .x:focus-visible,#v-funds .fu-tip .go:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
#v-funds .fu-empty{padding:var(--s5) 0;text-align:center;color:var(--muted)}
#v-funds .fu-group{display:flex;align-items:center;gap:var(--s2);font-size:var(--fs-aux);color:var(--muted);font-weight:700;padding:var(--s4) 0 var(--s2);border-bottom:1px solid var(--line)}
#v-funds .fu-group i{width:10px;height:10px;border-radius:50%}
#v-funds .fu-colh,#v-funds .fu-row{display:grid;grid-template-columns:minmax(0,2.2fr) 92px 70px minmax(0,2.4fr) 120px;gap:var(--s3)}
#v-funds .fu-colh{font-size:12px;color:var(--muted);padding:var(--s2) var(--s2) 0}
#v-funds .fu-colh span:nth-child(n+2){text-align:right}#v-funds .fu-colh span:nth-child(4){text-align:center}
#v-funds .fu-row{align-items:center;padding:var(--s3) var(--s2);border-bottom:1px solid var(--line);cursor:pointer;border-radius:8px}
#v-funds .fu-row:hover{background:var(--surface-2)}
#v-funds .fu-row[aria-expanded="true"]{background:var(--surface-2);border-bottom-color:transparent}
#v-funds .fu-row.flash{box-shadow:inset 0 0 0 2px var(--teal)}
#v-funds .fu-nm{min-width:0}#v-funds .fu-nm b{font-weight:600;display:block;line-height:1.35;overflow-wrap:anywhere}
#v-funds .fu-code{font-size:12px;color:var(--muted);margin-right:6px;font-family:var(--mono)}
#v-funds .fu-tag{display:inline-block;font-size:12px;color:var(--amber);background:var(--amber-soft);border-radius:4px;padding:0 6px;margin-right:4px;line-height:18px}
#v-funds .fu-stale{display:block;font-size:12px;color:var(--err);margin-top:2px}
#v-funds .fu-old{display:inline-block;font-size:12px;color:var(--ink-2);background:var(--gray-soft);border-radius:4px;padding:0 6px;line-height:18px}
#v-funds .fu-px{text-align:right;font-variant-numeric:tabular-nums}#v-funds .fu-px small{display:block;color:var(--muted);font-size:12px}
#v-funds .fu-d1{text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-aux)}
#v-funds .fu-d1.hot{font-weight:700}#v-funds .fu-d1.hot::before{content:"⚑ ";font-size:12px}
#v-funds .fu-d1 .k{display:none;color:var(--muted);font-weight:400;font-size:12px;margin-right:4px}
#v-funds .pos{color:var(--ok)}#v-funds .neg{color:var(--err)}#v-funds .na{color:var(--muted)}
#v-funds .fu-bars{display:flex;flex-direction:column;gap:5px;min-width:0}
#v-funds .fu-bl{display:grid;grid-template-columns:52px minmax(0,1fr) 62px;align-items:center;gap:6px;font-size:12px}
#v-funds .fu-bl .k{color:var(--muted)}
#v-funds .fu-bl .v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
#v-funds .fu-track{position:relative;height:10px;background:var(--fu-grid);border-radius:3px}
#v-funds .fu-track .zero{position:absolute;top:-3px;bottom:-3px;width:1px;background:var(--muted);opacity:.6}
#v-funds .fu-track i{position:absolute;top:0;bottom:0;border-radius:3px}
#v-funds .fu-spark svg{display:block;width:100%;height:36px}
#v-funds .fu-detail{padding:var(--s3) var(--s2) var(--s4);border-bottom:1px solid var(--line);background:var(--surface-2);border-radius:0 0 8px 8px;display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:var(--s5)}
#v-funds .fu-detail svg{display:block;width:100%;height:auto}
#v-funds .fu-ptab{width:100%;border-collapse:collapse;font-size:var(--fs-aux);font-variant-numeric:tabular-nums}
#v-funds .fu-ptab th,#v-funds .fu-ptab td{padding:6px 4px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
#v-funds .fu-ptab th:first-child,#v-funds .fu-ptab td:first-child{text-align:left}
#v-funds .fu-ptab th{color:var(--muted);font-weight:400;font-size:12px}
#v-funds .fu-dnote{font-size:12px;color:var(--muted);margin-top:var(--s2)}
#v-funds .fu-foot{font-size:var(--fs-aux);color:var(--muted)}
#v-funds .fu-foot summary{cursor:pointer;color:var(--ink-2)}
#v-funds .fu-foot ul{padding-left:1.2em;margin:var(--s2) 0 0}
/* 第二版 ① 未来 1 个月的可能区间（横条：浅色 95%、深色 2/3、竖线中心） */
#v-funds .fu-rg-row,#v-funds .fu-rg-scale{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,3fr) 132px;gap:var(--s3);align-items:center}
#v-funds .fu-rg-row{padding:6px var(--s2);border-bottom:1px solid var(--line)}
#v-funds .fu-rg-row .nm{min-width:0;font-size:14px;overflow-wrap:anywhere;line-height:1.4}
#v-funds .fu-rg-row .nm small{color:var(--muted);font-size:12px;margin-left:6px;font-family:var(--mono)}
#v-funds .fu-rg-track{position:relative;height:18px}
#v-funds .fu-rg-track .axis{position:absolute;left:0;right:0;top:8px;height:2px;background:var(--fu-grid)}
#v-funds .fu-rg-track .zero{position:absolute;top:0;bottom:0;width:1px;background:var(--muted);opacity:.7}
#v-funds .fu-rg-track .b95{position:absolute;top:5px;height:8px;border-radius:4px;opacity:.3}
#v-funds .fu-rg-track .b68{position:absolute;top:3px;height:12px;border-radius:4px;opacity:.8}
#v-funds .fu-rg-track .mid{position:absolute;top:1px;width:2px;height:16px;background:var(--ink)}
#v-funds .fu-rg-v{text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-aux);color:var(--ink-2);white-space:nowrap}
#v-funds .fu-rg-scale{font-size:12px;color:var(--muted);padding:0 var(--s2)}
#v-funds .fu-rg-scale div{position:relative;height:16px}#v-funds .fu-rg-scale span{position:absolute;transform:translateX(-50%);white-space:nowrap}
#v-funds .fu-disc{font-size:12px;color:var(--muted);margin:var(--s3) 0 0;line-height:1.6}
#v-funds .fu-miss{font-size:12px;color:var(--muted);padding:var(--s2) var(--s2) 0}
/* 第二版 ③ 债券类预期年化（近似的条用斜纹） */
#v-funds .fu-yb{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,2fr) 76px minmax(0,1.8fr);gap:var(--s3);align-items:center;padding:8px var(--s2);border-bottom:1px solid var(--line)}
#v-funds .fu-yb .nm{min-width:0}#v-funds .fu-yb .nm b{font-weight:600;display:block;line-height:1.35;overflow-wrap:anywhere}
#v-funds .fu-yb .bar{height:12px;border-radius:3px;background:var(--fu-bond);min-width:2px}
#v-funds .fu-yb .bar.approx{background:repeating-linear-gradient(45deg,var(--fu-bond) 0 6px,transparent 6px 10px);border:1px solid var(--fu-bond)}
#v-funds .fu-yb .bar.stale{opacity:.45}
#v-funds .fu-yb .v{text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
#v-funds .fu-yb .v.na{font-weight:400}
#v-funds .fu-yb .src{font-size:12px;color:var(--muted);line-height:1.5;min-width:0;overflow-wrap:anywhere}
#v-funds .fu-q{display:inline-block;font-size:12px;border-radius:4px;padding:0 6px;margin-right:6px;line-height:18px;white-space:nowrap}
#v-funds .fu-q.auto{background:var(--teal-soft);color:var(--teal-ink)}#v-funds .fu-q.approx{background:var(--amber-soft);color:var(--ink)}#v-funds .fu-q.stale{background:var(--err-soft);color:var(--err)}
#v-funds .fu-ybmsg{font-size:var(--fs-aux);color:var(--err);margin:var(--s2) 0 0}#v-funds .fu-ybmsg:empty{display:none}
@media (max-width:760px){
  #v-funds .fu-rg-row,#v-funds .fu-rg-scale{grid-template-columns:minmax(0,1fr) auto}
  #v-funds .fu-rg-row .fu-rg-track{grid-column:1 / -1;grid-row:2}
  #v-funds .fu-rg-scale{grid-template-columns:1fr}#v-funds .fu-rg-scale div:first-child,#v-funds .fu-rg-scale div:last-child{display:none}
  #v-funds .fu-yb{grid-template-columns:minmax(0,1fr) auto}#v-funds .fu-yb .bar-w{grid-column:1 / -1;grid-row:2}#v-funds .fu-yb .src{grid-column:1 / -1}
}
@media (max-width:760px){
  #v-funds .fu-card{padding:var(--s4)}
  #v-funds .fu-colh{display:none}
  #v-funds .fu-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"nm px" "bars bars" "spark d1"}
  #v-funds .fu-row .fu-nm{grid-area:nm}#v-funds .fu-row .fu-px{grid-area:px}#v-funds .fu-row .fu-d1{grid-area:d1;align-self:end}#v-funds .fu-row .fu-bars{grid-area:bars}#v-funds .fu-row .fu-spark{grid-area:spark}
  #v-funds .fu-detail{grid-template-columns:minmax(0,1fr)}
  #v-funds .fu-d1 .k{display:inline}
}
@media (prefers-reduced-motion:no-preference){#v-funds .fu-track i{transition:width .35s ease,left .35s ease}}
`;

/** 整页 #v-funds（放在 #app 里，和 #v-tools 平级） */
export const FUNDS_MOD = `<section class="page plat" id="v-funds" hidden>
  <div class="fu-head">
    <div><h1>基金观察</h1><div class="fu-meta num" id="fu-meta">读取中…</div></div>
    <div class="fu-refresh"><button class="btn primary" id="fu-refresh" type="button">↻ 刷新数据</button></div>
  </div>
  <div class="fu-prog" id="fu-prog" aria-live="polite"></div>
  <div class="fu-errbar" id="fu-err" role="alert" hidden><span id="fu-err-t"></span><span class="sp"></span><button class="btn small" type="button" id="fu-retry">再读一次</button></div>
  <section class="fu-card mod" id="fu-sum" aria-label="总结">
    <p class="fu-lede" id="fu-lede">读取中…</p>
    <div class="fu-alerts" id="fu-alerts"></div>
  </section>
  <div class="mod fu-mkwrap" id="fu-mk">
  <div class="fu-controls">
    <div class="fu-seg" role="group" aria-label="时间段" id="fu-periods">
      <button class="fu-chip" type="button" data-p="w1" aria-pressed="false">近 1 周</button><button class="fu-chip" type="button" data-p="m1" aria-pressed="false">近 1 月</button><button class="fu-chip" type="button" data-p="ytd" aria-pressed="false">今年以来</button><button class="fu-chip" type="button" data-p="y1" aria-pressed="true">近 1 年</button>
    </div>
    <div class="fu-seg" role="tablist" aria-label="市场" id="fu-markets">
      <button class="fu-chip" role="tab" type="button" data-m="" aria-selected="true">全部</button><button class="fu-chip" role="tab" type="button" data-m="新加坡" aria-selected="false">新加坡</button><button class="fu-chip" role="tab" type="button" data-m="美国" aria-selected="false">美国</button><button class="fu-chip" role="tab" type="button" data-m="中国" aria-selected="false">中国</button>
    </div>
  </div>
  <div class="fu-grid3" id="fu-mkcards"></div>
  </div>
  <section class="fu-card mod" id="fu-sc" aria-labelledby="fu-sc-h">
    <div class="fu-sec-h"><h2 id="fu-sc-h">赚了多少，中途最多亏过多少</h2><p id="fu-sc-sub"></p></div>
    <div class="fu-legend"><span><i style="background:var(--fu-broad)"></i>宽基</span><span><i style="background:var(--fu-bond)"></i>债券</span><span><i style="background:var(--fu-div)"></i>红利</span><span>越靠左上越好：收益高、回撤小</span></div>
    <div class="fu-scbox" id="fu-scbox"><svg id="fu-scatter" role="img"></svg><div class="fu-tip" id="fu-tip" hidden></div></div>
  </section>
  <section class="fu-card mod" id="fu-rg" aria-labelledby="fu-rg-h">
    <div class="fu-sec-h"><h2 id="fu-rg-h">未来 1 个月的可能区间</h2><p id="fu-rg-sub">按过去一年的波动推算，不是预测涨跌</p></div>
    <div class="fu-legend"><span><i class="bar" style="background:var(--fu-broad);opacity:.8"></i>大约 2/3 的可能落在这段</span><span><i class="bar" style="background:var(--fu-broad);opacity:.3"></i>大约 95% 的可能落在这段</span><span>竖线：区间中心（股票类为 0；债券类按下面的预期年化折成 1 个月）</span></div>
    <div class="fu-rg-scale" id="fu-rg-scale" aria-hidden="true"><div></div><div></div><div></div></div>
    <div id="fu-rg-list"></div>
    <p class="fu-disc" id="fu-rg-disc"></p>
  </section>
  <section class="fu-card mod" id="fu-yb" aria-labelledby="fu-yb-h">
    <div class="fu-sec-h"><h2 id="fu-yb-h">债券类：未来 1～3 年预期年化</h2><p>依据到期收益率（YTM）；持有接近久期时最接近实际</p></div>
    <div class="fu-legend"><span><span class="fu-q auto">每天自动</span>基金公司 / 交易所每天公布</span><span><span class="fu-q approx">近似</span>查不到本身的，用同期限国债 + 利差估</span><span><span class="fu-q stale">过期</span>最近一次取不到，显示的是上次的值</span></div>
    <div id="fu-yb-list"></div>
    <p class="fu-ybmsg" id="fu-yb-msg" role="status"></p>
    <p class="fu-disc">到期收益率是"现在买入、持有到债券到期、不违约"时的年化，扣费前。利率再变动时短期净值会波动（久期越长波动越大）。货币基金用 7 日年化。不是投资建议。</p>
  </section>
  <section class="fu-card mod" id="fu-ls" aria-labelledby="fu-ls-h">
    <div class="fu-sec-h"><h2 id="fu-ls-h">逐只对比</h2><p>点一行看一年走势和回撤过程</p></div>
    <div class="fu-legend"><span><i class="bar" style="background:var(--ok)"></i>收益（涨）</span><span><i class="bar" style="background:var(--err)"></i>收益（跌）</span><span><i class="bar" style="background:var(--amber)"></i>期间最大回撤</span><span>⚑ 单日涨跌超过 ±3%</span></div>
    <div class="fu-colh"><span>产品</span><span>最新价</span><span>1 日</span><span id="fu-colp">近 1 年</span><span>一年走势</span></div>
    <div id="fu-list"></div>
  </section>
  <details class="fu-foot fu-card mod" id="fu-note">
    <summary>数据从哪来、什么叫最大回撤、哪些格子是空的</summary>
    <ul>
      <li><b>最大回撤</b>：所选时间段里，从最高点跌到之后最低点的最大跌幅。比如"近 1 年 −10.9%"表示这一年里最多从高点回落过 10.9%。</li>
      <li>收益和回撤都按含分红的复权价算。场内 ETF 和新加坡场外基金来自 Yahoo Finance；000171、217003 和 Yahoo 缺历史的上交所 ETF（例如 511880）来自东方财富累计净值。</li>
      <li>"刷新数据"由服务器分几批去取（每批最多 45 个请求），全部取完大约半分钟；某只没取到时保留上次的数据，并在那一行标出"没取到，显示的是哪天的数据"。</li>
      <li>上市不满某段时间的，那一段写"上市不足"；展开那一行看"上市以来"（最多一年）。</li>
      <li>0P00006FY6 是按名称推断的代码，净值比场内产品晚几天。511990、511880 是货币 ETF，几乎不动。</li>
      <li><b>未来 1 个月的可能区间</b>：用过去一年每天的涨跌算出日波动 σ，一个月（21 个交易日）的波动 h = σ × √21；深色段 = 中心 ± h（大约 2/3 的可能），浅色段 = 中心 ± 1.96h（大约 95%）。中心：股票类为 0，债券类 = 预期年化折成 1 个月。上市不满两个月（不到 40 个交易日）的算不出。只说明波动有多大，不代表会涨或会跌；不是投资建议。</li>
      <li><b>债券类预期年化</b>：iShares（AGG、TLT、LQD）、Vanguard（BND、BSV）、BlackRock 新加坡（O9P）的产品页每天公布到期收益率；511990 用东方财富的 7 日年化，511880 用净值自己算 7 日年化。其余 7 只查不到本身的，用同期限国债（新加坡 MAS、中债）加一个固定利差估，标"近似"；利差每季度人工校准一次。iShares / Vanguard / BlackRock 页面取不到时，退回"美国同期限国债 + 利差"并标"近似"；都取不到就显示上次的值并标"过期"。</li>
    </ul>
  </details>
</section>`;

export const FUNDS_JS = `
(function(){
var $=function(id){return document.getElementById(id)};
if(!$('v-funds'))return;
var BASE=window.__fundsBase||'/api/funds',TH=3,NS='http://www.w3.org/2000/svg';
var PL={w1:'近 1 周',m1:'近 1 月',ytd:'今年以来',y1:'近 1 年'};
var CAT={'宽基':'var(--fu-broad)','债券':'var(--fu-bond)','红利':'var(--fu-div)'};
var MKS=['新加坡','美国','中国'],CATS=['宽基','债券','红利'];
var D=null,ITEMS=[],st={p:'y1',m:'',open:null},busy=false,loading=false;
/** 散点图触屏抽屉的关闭函数（scatter() 每次重画时换成新的） */
var tipOff=null;
function pct(v,dig){if(v==null)return'—';dig=dig==null?2:dig;var s=Math.abs(v).toFixed(dig);if(+s===0)return(0).toFixed(dig)+'%';return(v>0?'+':'−')+s+'%'}
function cls(v){return v==null?'na':v>0?'pos':v<0?'neg':''}
function el(tag,attrs,text){var e=document.createElement(tag);if(attrs)for(var k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e}
function sv(tag,attrs){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);return e}
function has(f){return f&&f.last!=null&&Array.isArray(f.series)&&f.series.length>0}
function ret(f,p){return has(f)?(f[p]==null?null:f[p]):null}
function dd(f,p){return has(f)?(f['dd_'+p]==null?null:f['dd_'+p]):null}
function shown(){return ITEMS.filter(function(f){return!st.m||f.market===st.m})}
function fmtPx(v){return v==null?'—':v.toFixed(v<10?3:2)}
/** ISO → UTC+8 的 "2026-11-10 17:43"（新加坡时间） */
function tw(iso){if(!iso)return'';var d=new Date(Date.parse(iso)+8*3600e3).toISOString();return d.slice(0,10)+' '+d.slice(11,16)}
function cnt(m){return ITEMS.filter(function(f){return!m||f.market===m}).length}
var TZ='（新加坡时间）';
/** "旧"的门槛：ok_at 比标题的数据时间早 5 分钟以上（一次全量最坏约 2 分钟，同一次刷新里的不会被误标） */
var OLD_MS=5*60e3;
/** 刷新中途断了时，没轮到的那几只（code → 刷新前的数据时间）。**以服务器为准**：只给服务器没带 ok_at 的那几只兜底；
 *  每次读到 GET /api/funds 都对一遍（pruneStale）——服务器带了 ok_at（别的设备 / 别的窗口刷过）的就从这里去掉，交给下面的 ok_at 判断 */
var STALE=null;
function pruneStale(){if(!STALE)return;var left=0;ITEMS.forEach(function(f){if(!STALE.codes[f.code])return;if(f.ok_at)delete STALE.codes[f.code];else left++});if(!left)STALE=null}
/** 显示的是上次数据的那几只：服务器记的 ok_at 比标题的数据时间早 5 分钟以上；服务器没给 ok_at 时才看本窗口记的 STALE → 那几行标"上次数据"，标题也写明 */
function oldAt(f){if(!has(f))return null;if(f.ok_at){return D&&D.fetched_at&&Date.parse(D.fetched_at)-Date.parse(f.ok_at)>OLD_MS?f.ok_at:null}if(STALE&&STALE.codes[f.code])return STALE.at||null;return null}
function isOld(f){return!!(has(f)&&(oldAt(f)||(!f.ok_at&&STALE&&STALE.codes[f.code])))}
function oldest(list){var t=null;list.forEach(function(f){var a=oldAt(f);if(a&&(!t||a<t))t=a});return t}

/** 标题里"旧"的那几只写取数时间（和行上的价格日期区分）：和标题同一天只写 HH:MM，否则 MM-DD HH:MM */
function sameDay(iso){var t=tw(iso);return t.slice(0,10)===tw(D.fetched_at).slice(0,10)?t.slice(11):t.slice(5)}
function meta(){var ok=ITEMS.filter(has).length,old=ITEMS.filter(isOld);
  $('fu-meta').textContent=D&&D.fetched_at?('数据时间 '+tw(D.fetched_at)+TZ+(old.length?'，其中 '+old.length+' 只'+(oldest(old)?'的取数时间还是上次的 '+sameDay(oldest(old)):'还是上次的数据'):'')+' · '+ITEMS.length+' 只 · 新加坡、美国、中国'+(ok<ITEMS.length?' · '+(ITEMS.length-ok)+' 只还没有数据':'')):'还没取过数据，点「刷新数据」去取（大约半分钟）';
  document.querySelectorAll('#fu-markets .fu-chip').forEach(function(b){var m=b.dataset.m;b.textContent=(m||'全部')+' '+cnt(m)});}

function lede(){var p=st.p,L=$('fu-lede'),A=$('fu-alerts');L.replaceChildren();A.replaceChildren();
  var list=shown().filter(function(f){return ret(f,p)!=null});
  if(!list.length){L.textContent=ITEMS.some(has)?(PL[p]+'：'+(st.m||'这几个市场')+'没有上市满这段时间的产品。'):'还没有数据。点「刷新数据」，服务器会分几批去取 45 只的价格。';return}
  var up=0,down=0;list.forEach(function(f){if(ret(f,p)>0)up++;else if(ret(f,p)<0)down++});
  var best=list.slice().sort(function(a,b){return ret(b,p)-ret(a,p)})[0];
  var wl=list.filter(function(f){return dd(f,p)!=null}),worst=wl.slice().sort(function(a,b){return dd(a,p)-dd(b,p)})[0];
  var parts=[[PL[p]+'，'+(st.m||'三地')+' '+list.length+' 只里 '],[up+' 只','pos'],[' 赚钱、'],[down+' 只','neg'],[' 亏钱。收益最高的是 '+best.name+'（'],[pct(ret(best,p)),cls(ret(best,p))],['）']];
  if(worst)parts=parts.concat([['，中途跌得最深的是 '+worst.name+'（最大回撤 '],[pct(dd(worst,p)),'neg'],['）。']]);else parts.push(['。']);
  parts.forEach(function(x){L.appendChild(x[1]?el('b',{'class':x[1]},x[0]):document.createTextNode(x[0]))});
  var hot=shown().filter(function(f){return ret(f,'d1')!=null&&Math.abs(f.d1)>=TH});
  if(!hot.length)A.appendChild(el('span',{'class':'fu-alert calm'},'最近一个交易日没有单日涨跌超过 ±3% 的'));
  hot.forEach(function(f){var a=el('span',{'class':'fu-alert'+(f.d1>0?' up':'')},'⚑ '+f.name+' '+pct(f.d1));a.appendChild(el('small',null,f.date.slice(5)));A.appendChild(a)});}

function med(a){a=a.slice().sort(function(x,y){return x-y});return a.length?a[Math.floor((a.length-1)/2)]:null}
function mkcards(){var C=$('fu-mkcards'),p=st.p;C.replaceChildren();
  MKS.forEach(function(m){var all=ITEMS.filter(function(f){return f.market===m}),list=all.filter(function(f){return ret(f,p)!=null});
    var up=list.filter(function(f){return ret(f,p)>0}).length,down=list.filter(function(f){return ret(f,p)<0}).length;
    var mr=med(list.map(function(f){return ret(f,p)})),md=med(list.filter(function(f){return dd(f,p)!=null}).map(function(f){return dd(f,p)}));
    var c=el('div',{'class':'fu-card fu-mk','data-mk':m});c.appendChild(el('h3',null,m));
    var b=el('div',{'class':'fu-big'});
    var b1=el('div');b1.appendChild(el('strong',{'class':cls(mr)},pct(mr,1)));b1.appendChild(el('span',null,'收益中位数'));
    var b2=el('div');b2.appendChild(el('strong',{'class':md?'neg':'na'},pct(md,1)));b2.appendChild(el('span',null,'最大回撤中位数'));
    b.appendChild(b1);b.appendChild(b2);c.appendChild(b);
    var bar=el('div',{'class':'fu-updown',role:'img','aria-label':up+' 只涨，'+down+' 只跌'}),n=list.length||1;
    bar.appendChild(el('i',{style:'width:'+up/n*100+'%;background:var(--ok)'}));bar.appendChild(el('i',{style:'width:'+(list.length?(n-up-down)/n*100:0)+'%;background:var(--muted);opacity:.4'}));bar.appendChild(el('i',{style:'width:'+down/n*100+'%;background:var(--err)'}));
    c.appendChild(bar);
    var young=all.filter(function(f){return has(f)&&ret(f,p)==null}).length,none=all.filter(function(f){return!has(f)}).length;
    c.appendChild(el('div',{'class':'fu-note num'},up+' 只涨 · '+down+' 只跌'+(young?' · '+young+' 只上市不满这段时间':'')+(none?' · '+none+' 只没有数据':'')));
    C.appendChild(c);});}

function ticks(a,b,n){var step=Math.pow(10,Math.floor(Math.log10((b-a)/n)));var e=(b-a)/n/step;step*=e>5?10:e>2?5:e>1?2:1;var t=[];for(var v=Math.ceil(a/step)*step;v<=b+1e-9;v+=step)t.push(+v.toFixed(6));return t}
function scatter(){var p=st.p,list=shown().filter(function(f){return ret(f,p)!=null&&dd(f,p)!=null});
  var svg=$('fu-scatter'),box=$('fu-scbox'),tip=$('fu-tip');tip.hidden=true;tip.className='fu-tip';
  // 手机上画高一点（点分得更开，左下那一团也点得开）
  var W=Math.max(300,box.clientWidth||600),H=Math.round(Math.min(420,Math.max(W<600?360:240,W*.5)));
  svg.replaceChildren();svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('aria-label',PL[p]+'各产品收益与最大回撤散点图，共 '+list.length+' 只');
  var young=shown().filter(function(f){return has(f)&&ret(f,p)==null}).length;
  $('fu-sc-sub').textContent='横轴：'+PL[p]+'最大回撤（越往右跌得越深）；纵轴：'+PL[p]+'收益'+(young?'；'+young+' 只上市不满这段时间':'');
  if(!list.length){var t0=sv('text',{x:W/2,y:H/2,'text-anchor':'middle','font-size':13,fill:'var(--muted)'});t0.textContent='还没有数据';svg.appendChild(t0);return}
  var xs=list.map(function(f){return-dd(f,p)}),ys=list.map(function(f){return ret(f,p)});
  var xmax=Math.max(1,Math.max.apply(null,xs))*1.08,ymin=Math.min(0,Math.min.apply(null,ys)),ymax=Math.max(0,Math.max.apply(null,ys));var pad=(ymax-ymin)*.08||1;ymin-=pad;ymax+=pad;
  var m={l:52,r:16,t:12,b:34};
  var X=function(v){return m.l+v/xmax*(W-m.l-m.r)},Y=function(v){return m.t+(ymax-v)/(ymax-ymin)*(H-m.t-m.b)};
  var g=sv('g',{});svg.appendChild(g);
  ticks(ymin,ymax,5).forEach(function(v){g.appendChild(sv('line',{x1:m.l,x2:W-m.r,y1:Y(v),y2:Y(v),stroke:v===0?'var(--muted)':'var(--fu-grid)'}));var t=sv('text',{x:m.l-8,y:Y(v)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t.textContent=(v>0?'+':v<0?'−':'')+Math.abs(v)+'%';g.appendChild(t)});
  ticks(0,xmax,5).forEach(function(v){g.appendChild(sv('line',{x1:X(v),x2:X(v),y1:m.t,y2:H-m.b,stroke:'var(--fu-grid)'}));var t=sv('text',{x:X(v),y:H-m.b+16,'text-anchor':'middle','font-size':12,fill:'var(--muted)'});t.textContent=v===0?'0':'−'+v+'%';g.appendChild(t)});
  var lab=sv('text',{x:W-m.r,y:H-2,'text-anchor':'end','font-size':12,fill:'var(--muted)'});lab.textContent='最大回撤 →';g.appendChild(lab);
  var dots=[];
  function go(f){hide();st.open=f.code;list_();var r=document.querySelector('#fu-list [data-code="'+f.code+'"]');if(r){r.scrollIntoView({block:'center'});r.classList.add('flash');setTimeout(function(){r.classList.remove('flash')},1200);r.focus({preventScroll:true})}}
  function line(f){return f.market+' · '+f.category+' · 收益 '+pct(ret(f,p))+' · 最大回撤 '+pct(dd(f,p))}
  function place(c){var bx=box.getBoundingClientRect(),r=c.getBoundingClientRect();var x=r.left-bx.left+12,y=r.top-bx.top-tip.offsetHeight-8;tip.style.left=Math.max(0,Math.min(x,bx.width-tip.offsetWidth-4))+'px';tip.style.top=(y<0?r.bottom-bx.top+8:y)+'px'}
  /** 高亮图上一个点（放大、加深色描边、挪到最上层），浮框里对应那一行也标出来；code 为 null 时全部还原 */
  function hl(code){dots.forEach(function(d){var on=d.f.code===code;d.c.setAttribute('r',on?10:6);d.c.setAttribute('stroke',on?'var(--ink)':'var(--surface)');d.c.setAttribute('stroke-width',on?3:1.5);if(on)svg.appendChild(d.c)});
    tip.querySelectorAll('.it').forEach(function(it){it.classList.toggle('on',it.getAttribute('data-pick')===code)})}
  function hide(){tip.hidden=true;tip.className='fu-tip';tip.removeAttribute('style');tip.onscroll=null;hl(null)}
  tipOff=hide;
  /** 鼠标悬停 / 键盘聚焦：只显示一只 */
  function show(d){hide();tip.replaceChildren();tip.appendChild(el('b',null,d.f.name));tip.appendChild(el('div',{'class':'num'},line(d.f)));tip.hidden=false;place(d.c);d.c.setAttribute('r',8)}
  /** 触屏点一下：先出抽屉（离手指最近的一只 + 附近挤在一起的几只，按远近排），整行或「看这一只 →」才跳到那一行。
   *  抽屉贴在屏幕上方或下方——哪边离这一团点远放哪边，最高半屏，不盖住这一团点；按住 / 滑到某一行，图上对应的点放大高亮。
   *  关掉：右上 ×、点抽屉和图以外的地方、滚动页面、Esc */
  function showTouch(near){hide();tip.replaceChildren();tip.className='fu-tip touch';
    var hd=el('div',{'class':'hd'});
    hd.appendChild(el('div',{'class':'more'},near.length>1?'这里挤了 '+near.length+' 只，按远近排'+(near.length>4?'，往下滑看全部（也可以切到单个市场）':''):'点这一行看一年走势和回撤'));
    var x=el('button',{type:'button','class':'x','aria-label':'关闭'},'×');x.addEventListener('click',function(e){e.stopPropagation();hide()});hd.appendChild(x);tip.appendChild(hd);
    near.forEach(function(d){var it=el('div',{'class':'it','data-pick':d.f.code});it.appendChild(el('b',null,d.f.name));it.appendChild(el('div',{'class':'num'},'收益 '+pct(ret(d.f,p))+' · 回撤 '+pct(dd(d.f,p))));
      var b=el('button',{type:'button','class':'go','data-go':d.f.code},'看这一只 →');b.addEventListener('click',function(e){e.stopPropagation();go(d.f)});it.appendChild(b);
      it.addEventListener('click',function(){go(d.f)});
      ['pointerdown','focusin'].forEach(function(ev){it.addEventListener(ev,function(){hl(d.f.code)})});
      tip.appendChild(it)});
    // 这一团点在屏幕上的上下边（含点的半径），抽屉放在空间大的那一侧
    var top=Infinity,bot=-Infinity;near.forEach(function(d){var r=d.c.getBoundingClientRect();top=Math.min(top,r.top);bot=Math.max(bot,r.bottom)});
    var bar=document.querySelector('.bars'),t0=bar?Math.max(0,bar.getBoundingClientRect().bottom):0,vh=window.innerHeight,cap=Math.round(vh*.5),gap=10;
    var below=vh-bot-gap-8,above=top-gap-t0-8;
    tip.hidden=false;tip.scrollTop=0;
    if(below>=above){tip.style.bottom='8px';tip.style.top='auto';tip.style.maxHeight=Math.max(160,Math.min(cap,below))+'px'}
    else{tip.style.top=(t0+8)+'px';tip.style.bottom='auto';tip.style.maxHeight=Math.max(160,Math.min(cap,above))+'px'}
    hl(near[0].f.code);
    // 抽屉里往下滑时，顶上第一整行对应的点跟着高亮
    tip.onscroll=function(){var h=hd.getBoundingClientRect().bottom,its=tip.querySelectorAll('.it');for(var i=0;i<its.length;i++){if(its[i].getBoundingClientRect().top>=h-2){hl(its[i].getAttribute('data-pick'));break}}}}
  list.forEach(function(f){
    var c=sv('circle',{cx:X(-dd(f,p)),cy:Y(ret(f,p)),r:6,fill:CAT[f.category],'fill-opacity':.8,stroke:'var(--surface)','stroke-width':1.5,tabindex:0,'data-code':f.code,'aria-label':f.name+' 收益 '+pct(ret(f,p))+' 最大回撤 '+pct(dd(f,p))});
    c.style.cursor='pointer';var d={f:f,c:c};dots.push(d);
    c.addEventListener('mouseenter',function(){if(!tip.classList.contains('touch'))show(d)});c.addEventListener('focus',function(){if(!tip.classList.contains('touch'))show(d)});
    c.addEventListener('mouseleave',function(){if(!tip.classList.contains('touch'))hide()});c.addEventListener('blur',function(){if(!tip.classList.contains('touch'))hide()});
    c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go(f)}});
    svg.appendChild(c);});
  // 点击统一在整张图上判断：取离点击处最近的点（触屏 22px 内，鼠标 10px 内）；触屏时抽屉按远近列出这一圈里的所有点，挤在一起的也点得开
  var ptr='mouse';svg.onpointerdown=function(e){ptr=e.pointerType||'mouse'};
  svg.onclick=function(e){var R0=ptr==='mouse'?10:22,near=[];
    dots.forEach(function(d){var r=d.c.getBoundingClientRect(),dx=r.left+r.width/2-e.clientX,dy=r.top+r.height/2-e.clientY,dist=Math.sqrt(dx*dx+dy*dy);if(dist<=R0)near.push({f:d.f,c:d.c,dist:dist})});
    near.sort(function(a,b){return a.dist-b.dist});
    if(!near.length){hide();return}
    if(ptr==='mouse')go(near[0].f);else showTouch(near)};}

function sliceFrom(f,p){var s=f.series,last=Date.parse(s[s.length-1][0]+'T00:00:00Z'),start;
  if(p==='ytd')start=Date.UTC(new Date(last).getUTCFullYear()-1,11,31);else start=last-({w1:7,m1:30,y1:365}[p])*864e5;
  var iso=new Date(start).toISOString().slice(0,10),b=-1;for(var i=0;i<s.length;i++)if(s[i][0]<=iso)b=i;return b<0?null:b}

function spark(f){var s=f.series,W=120,H=36,vals=s.map(function(x){return x[1]}),mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);if(mx===mn){mx+=1;mn-=1}
  var n=Math.max(1,s.length-1),X=function(i){return 1+i/n*(W-4)},Y=function(v){return 2+(mx-v)/(mx-mn)*(H-4)};
  var svg=sv('svg',{viewBox:'0 0 '+W+' '+H,preserveAspectRatio:'none',role:'img','aria-label':f.name+' 一年走势'});
  var b=sliceFrom(f,st.p);if(b!=null&&b>0)svg.appendChild(sv('rect',{x:X(b),y:0,width:W-X(b),height:H,fill:'var(--teal-soft)'}));
  var d=s.map(function(x,i){return(i?'L':'M')+X(i).toFixed(1)+' '+Y(x[1]).toFixed(1)}).join('');
  var col=(f.ret_all||0)>=0?'var(--ok)':'var(--err)';
  svg.appendChild(sv('path',{d:d+'L'+X(s.length-1)+' '+H+'L'+X(0)+' '+H+'Z',fill:col,'fill-opacity':.08}));
  svg.appendChild(sv('path',{d:d,fill:'none',stroke:col,'stroke-width':1.4,'vector-effect':'non-scaling-stroke'}));
  return svg;}

function srcName(f){return f.source==='eastmoney'?'东方财富累计净值':'Yahoo 复权价'}
// 画布宽度按实际可用宽度算（不靠 viewBox 缩放），手机上字也是 12px，不会缩成看不清
function detailW(){var lw=$('fu-list').clientWidth||700,narrow=matchMedia('(max-width:760px)').matches;return Math.round(Math.max(280,Math.min(760,narrow?lw-16:lw-16-260-24)))}
function band(f){return Array.isArray(f.band)&&f.band.length===5?f.band:null}
/** 估文字宽度（12px 字：中文和全角 12px，其余 7px；宁大勿小），给"最深 …"标注让开右边的喇叭 */
function textW(t){var w=0;for(var i=0;i<t.length;i++)w+=t.charCodeAt(i)>255?12:7;return w}
function detail(f){var box=el('div',{'class':'fu-detail','data-detail':f.code}),s=f.series,W=detailW(),H1=W<480?150:170,H2=W<480?70:80,g=10,B=band(f);
  var vals=s.map(function(x){return x[1]});if(B){var lv0=vals[vals.length-1];vals=vals.concat([lv0*(1+B[0]/100),lv0*(1+B[4]/100)])}
  var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);if(mx===mn){mx+=1;mn-=1}
  var peak=-Infinity,uw=s.map(function(x){peak=Math.max(peak,x[1]);return(x[1]/peak-1)*100});
  var umin=Math.min(-1,Math.min.apply(null,uw)),n=Math.max(1,s.length-1);
  // 第二版 C：价格图右侧留一段画"未来 1 个月"的喇叭（68%、95% 两层）
  var ml=52,mr=8,cw=B?(W<480?44:64):0,X=function(i){return ml+i/n*(W-ml-mr-cw)},Y1=function(v){return 8+(mx-v)/(mx-mn)*(H1-16)},Y2=function(v){return H1+g+(-v)/(-umin)*(H2-4)};
  var svg=sv('svg',{viewBox:'0 0 '+W+' '+(H1+g+H2+20),role:'img','aria-label':f.name+' 一年复权价走势和回撤过程'});
  [mn,(mn+mx)/2,mx].forEach(function(v){svg.appendChild(sv('line',{x1:ml,x2:W-mr,y1:Y1(v),y2:Y1(v),stroke:'var(--fu-grid)'}));var t=sv('text',{x:ml-6,y:Y1(v)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t.textContent=v>=100?v.toFixed(0):v.toPrecision(4);svg.appendChild(t)});
  var d=s.map(function(x,i){return(i?'L':'M')+X(i).toFixed(1)+' '+Y1(x[1]).toFixed(1)}).join('');
  svg.appendChild(sv('path',{d:d+'L'+X(s.length-1)+' '+(H1-8)+'L'+X(0)+' '+(H1-8)+'Z',fill:'var(--fu-broad)','fill-opacity':.08}));
  svg.appendChild(sv('path',{d:d,fill:'none',stroke:'var(--fu-broad)','stroke-width':1.6}));
  if(B){var lv=s[s.length-1][1],x0=X(s.length-1),x1=W-mr;
    var cone=function(lo,hi,op,k){svg.appendChild(sv('path',{'class':'fu-cone','data-k':k,d:'M'+x0.toFixed(1)+' '+Y1(lv).toFixed(1)+'L'+x1+' '+Y1(lv*(1+hi/100)).toFixed(1)+'L'+x1+' '+Y1(lv*(1+lo/100)).toFixed(1)+'Z',fill:'var(--fu-broad)','fill-opacity':op}))};
    cone(B[0],B[4],.14,'95');cone(B[1],B[3],.32,'68');
    var ct=sv('text',{x:x1,y:12,'text-anchor':'end','font-size':12,fill:'var(--muted)'});ct.textContent='未来 1 个月';svg.appendChild(ct)}
  // 最深的一次回撤：从哪天的高点跌到哪天
  var pk=0,best=0,bp=0,bt=0;for(var i=0;i<s.length;i++){if(s[i][1]>s[pk][1])pk=i;var r=s[i][1]/s[pk][1]-1;if(r<best){best=r;bp=pk;bt=i}}
  if(best<0){svg.appendChild(sv('circle',{cx:X(bp),cy:Y1(s[bp][1]),r:4,fill:'var(--surface)',stroke:'var(--amber)','stroke-width':2}));svg.appendChild(sv('circle',{cx:X(bt),cy:Y1(s[bt][1]),r:4,fill:'var(--amber)'}));
    // 标注放在谷底下方；谷底贴着底边时放到上方，免得压在横轴日期上（手机上历史短的 XUS 就是这样）
    var ty=Y1(s[bt][1])+16;if(ty>H1-22)ty=Math.max(14,Y1(s[bt][1])-10);
    // 标注的右边不越过喇叭的起点（有喇叭时）或画布右边；放不下长日期就只写月-日
    var lt='最深 '+pct(best*100)+'（'+s[bp][0]+' → '+s[bt][0]+'）',st2='最深 '+pct(best*100)+'（'+s[bp][0].slice(5)+' → '+s[bt][0].slice(5)+'）';
    var xr=B?X(s.length-1)-6:W-mr,txt=textW(lt)<=xr-ml-4?lt:st2,tw2=textW(txt);
    var t=sv('text',{x:Math.max(ml+4,Math.min(X(bt)+8,xr-tw2)),y:ty,'font-size':12,fill:'var(--amber)','font-weight':700,'class':'fu-deep',stroke:'var(--surface-2)','stroke-width':3,'paint-order':'stroke','stroke-linejoin':'round'});t.textContent=txt;svg.appendChild(t)}
  svg.appendChild(sv('line',{x1:ml,x2:W-mr,y1:Y2(0),y2:Y2(0),stroke:'var(--muted)'}));
  var ud=uw.map(function(v,i){return(i?'L':'M')+X(i).toFixed(1)+' '+Y2(v).toFixed(1)}).join('');
  svg.appendChild(sv('path',{d:ud+'L'+X(s.length-1)+' '+Y2(0)+'L'+X(0)+' '+Y2(0)+'Z',fill:'var(--amber)','fill-opacity':.25}));
  svg.appendChild(sv('path',{d:ud,fill:'none',stroke:'var(--amber)','stroke-width':1.2}));
  var t2=sv('text',{x:ml-6,y:Y2(umin)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t2.textContent=umin.toFixed(0)+'%';svg.appendChild(t2);
  var t3=sv('text',{x:ml+4,y:H1+g+H2+16,'font-size':12,fill:'var(--muted)'});t3.textContent='下方：离当时最高点跌了多少（水下曲线）';svg.appendChild(t3);
  [0,s.length-1].forEach(function(i){var t=sv('text',{x:X(i),y:H1+4,'text-anchor':i?'end':'start','font-size':12,fill:'var(--muted)'});t.textContent=s[i][0];svg.appendChild(t)});
  var left=el('div');left.appendChild(svg);box.appendChild(left);
  var right=el('div'),tb=el('table',{'class':'fu-ptab'}),th=el('tr');['时间段','收益','最大回撤'].forEach(function(h){th.appendChild(el('th',null,h))});tb.appendChild(th);
  ['w1','m1','ytd','y1'].forEach(function(p){var tr=el('tr'),r=ret(f,p),dv=dd(f,p);tr.appendChild(el('td',null,PL[p]));tr.appendChild(el('td',{'class':cls(r)},r==null?'上市不足':pct(r)));tr.appendChild(el('td',{'class':dv?'neg':'na'},r==null&&dv==null?'上市不足':pct(dv)));tb.appendChild(tr)});
  var tr=el('tr');tr.appendChild(el('td',null,'上市以来*'));tr.appendChild(el('td',{'class':cls(f.ret_all)},pct(f.ret_all)));tr.appendChild(el('td',{'class':f.dd_all?'neg':'na'},pct(f.dd_all)));tb.appendChild(tr);
  right.appendChild(tb);
  if(B)right.appendChild(el('div',{'class':'fu-dnote'},'未来 1 个月：大约 2/3 的可能在 '+pct(B[1],1)+' ～ '+pct(B[3],1)+'，大约 95% 在 '+pct(B[0],1)+' ～ '+pct(B[4],1)+'（按过去一年波动推算，不是预测）'));
  else if(has(f))right.appendChild(el('div',{'class':'fu-dnote'},'未来 1 个月：上市不满两个月，算不出'));
  if(f.yield)right.appendChild(el('div',{'class':'fu-dnote'},'预期年化 '+(f.yield.kind==='approx'?'≈':'')+f.yield.value.toFixed(2)+'%（'+f.yield.label+'，'+f.yield.asOf+(f.yield.stale?'，过期':'')+'）'));
  right.appendChild(el('div',{'class':'fu-dnote'},'* 从 '+f.first+' 起（最多取一年）。最新价 '+fmtPx(f.last)+' '+(f.currency||'')+'，'+f.date+'，来源：'+srcName(f)));
  box.appendChild(right);return box;}

function staleText(f){if(!f.error)return'';return'没取到，显示的是 '+f.date+' 的数据（'+f.error+'）'}
function list_(){var p=st.p,L=$('fu-list');L.replaceChildren();$('fu-colp').textContent=PL[p]+'：收益 / 最大回撤';
  var arr=shown();if(!arr.length){L.appendChild(el('div',{'class':'fu-empty'},'暂无'));return}
  var lim=Math.max(1,Math.max.apply(null,arr.map(function(f){return Math.max(Math.abs(ret(f,p)||0),Math.abs(dd(f,p)||0))})));
  (st.m?[st.m]:MKS).forEach(function(m){CATS.forEach(function(c){
    var g=arr.filter(function(f){return f.market===m&&f.category===c});if(!g.length)return;
    var h=el('div',{'class':'fu-group'});h.appendChild(el('i',{style:'background:'+CAT[c]}));h.appendChild(document.createTextNode((st.m?'':m+' · ')+c+' · '+g.length+' 只'));L.appendChild(h);
    g.forEach(function(f){var ok=has(f);
      var r=el('div',{'class':'fu-row',role:'button',tabindex:0,'data-code':f.code,'aria-expanded':ok&&st.open===f.code?'true':'false'});
      var nm=el('div',{'class':'fu-nm'});nm.appendChild(el('b',null,f.name));var sub=el('div');sub.appendChild(el('span',{'class':'fu-code'},f.code));if(f.tag)sub.appendChild(el('span',{'class':'fu-tag'},f.tag));nm.appendChild(sub);
      if(ok&&f.error)nm.appendChild(el('span',{'class':'fu-stale'},staleText(f)));
      else if(isOld(f)){var oa=oldAt(f);sub.appendChild(el('span',{'class':'fu-old',title:'这一只还是上次'+(oa?' '+tw(oa)+TZ:'')+'的数据，比标题的数据时间早'},'上次数据'+(oa?' '+tw(oa).slice(5):'')))}
      if(!ok)nm.appendChild(el('span',{'class':'fu-stale'},'没取到数据'+(f.error&&f.error!=='还没取过'?'：'+f.error:'，点「刷新数据」去取')));
      r.appendChild(nm);
      var px=el('div',{'class':'fu-px'},fmtPx(ok?f.last:null));if(ok)px.appendChild(el('small',null,(f.currency||'')+' · '+f.date.slice(5)));r.appendChild(px);
      var hot=ok&&f.d1!=null&&Math.abs(f.d1)>=TH;var d1=el('div',{'class':'fu-d1 '+cls(ret(f,'d1'))+(hot?' hot':'')});d1.appendChild(el('span',{'class':'k'},'1 日'));d1.appendChild(document.createTextNode(pct(ret(f,'d1'))));r.appendChild(d1);
      var bars=el('div',{'class':'fu-bars'}),rv=ret(f,p),dv=dd(f,p);
      function line(k,v,color,txtCls){var b=el('div',{'class':'fu-bl'});b.appendChild(el('span',{'class':'k'},k));var t=el('div',{'class':'fu-track'});
        t.appendChild(el('span',{'class':'zero',style:'left:50%'}));
        if(v!=null){var w=Math.min(50,Math.abs(v)/lim*50);t.appendChild(el('i',{style:'background:'+color+';left:'+(v>=0?50:50-w)+'%;width:'+Math.max(w,.6)+'%'}))}
        b.appendChild(t);b.appendChild(el('span',{'class':'v '+txtCls},v==null?(ok?'上市不足':'—'):pct(v,1)));return b}
      bars.appendChild(line('收益',rv,rv>=0?'var(--ok)':'var(--err)',cls(rv)));
      bars.appendChild(line('最大回撤',dv,'var(--amber)',dv?'neg':'na'));
      r.appendChild(bars);
      var sp=el('div',{'class':'fu-spark'});if(ok)sp.appendChild(spark(f));r.appendChild(sp);
      function tog(){if(!ok)return;st.open=st.open===f.code?null:f.code;list_();var x=document.querySelector('#fu-list [data-code="'+f.code+'"]');if(x)x.focus({preventScroll:true})}
      r.addEventListener('click',tog);r.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();tog()}});
      L.appendChild(r);if(ok&&st.open===f.code)L.appendChild(detail(f));});})});}

var CATK={'宽基':'fu-broad','债券':'fu-bond','红利':'fu-div'};
/** 第二版 ①：未来 1 个月的可能区间（按 2/3 那段的宽度从宽到窄排） */
function ranges(){var arr=shown().filter(band).sort(function(a,b){return(b.band[3]-b.band[1])-(a.band[3]-a.band[1])});
  var L=$('fu-rg-list'),sc=$('fu-rg-scale').children[1];L.replaceChildren();sc.replaceChildren();
  var young=shown().filter(function(f){return has(f)&&!band(f)}),none=shown().filter(function(f){return!has(f)}).length;
  $('fu-rg-sub').textContent='按过去一年的波动推算，不是预测涨跌'+(young.length?' · '+young.length+' 只上市不满两个月，算不出':'')+(none?' · '+none+' 只没有数据':'');
  var cov=D&&typeof D.band_coverage==='number'?D.band_coverage:null;
  $('fu-rg-disc').textContent=(cov!=null?'回测：拿过去一年每一段 1 个月（21 个交易日）对照，平均 '+Math.round(cov*100)+'% 的时候真实涨跌落在深色段里（设计目标约 2/3）。':'')+'只说明波动有多大，不代表会涨或会跌；不是投资建议。';
  if(!arr.length){L.appendChild(el('div',{'class':'fu-empty'},ITEMS.some(has)?'没有上市满两个月的产品，算不出':'还没有数据'));return}
  var lim=Math.max.apply(null,arr.map(function(f){return Math.max(Math.abs(f.band[0]),Math.abs(f.band[4]))}));lim=Math.max(1,Math.ceil(lim/5)*5);
  var X=function(v){return 50+v/lim*50};
  [-lim,-lim/2,0,lim/2,lim].forEach(function(v){sc.appendChild(el('span',{style:'left:'+X(v)+'%'},(v>0?'+':v<0?'−':'')+Math.abs(v)+'%'))});
  arr.forEach(function(f){var B=f.band,r=el('div',{'class':'fu-rg-row','data-rg':f.code}),nm=el('div',{'class':'nm'});nm.appendChild(document.createTextNode(f.name));nm.appendChild(el('small',null,f.code));r.appendChild(nm);
    var col='var(--'+CATK[f.category]+')',t=el('div',{'class':'fu-rg-track',role:'img','aria-label':f.name+' 未来 1 个月：大约 2/3 的可能在 '+pct(B[1],1)+' 到 '+pct(B[3],1)+'，大约 95% 在 '+pct(B[0],1)+' 到 '+pct(B[4],1)});
    t.appendChild(el('span',{'class':'axis'}));
    t.appendChild(el('span',{'class':'b95',style:'left:'+X(B[0])+'%;width:'+Math.max(.4,X(B[4])-X(B[0]))+'%;background:'+col}));
    t.appendChild(el('span',{'class':'b68',style:'left:'+X(B[1])+'%;width:'+Math.max(.4,X(B[3])-X(B[1]))+'%;background:'+col}));
    t.appendChild(el('span',{'class':'zero',style:'left:50%'}));
    t.appendChild(el('span',{'class':'mid',style:'left:calc('+X(B[2])+'% - 1px)'}));
    r.appendChild(t);r.appendChild(el('div',{'class':'fu-rg-v'},pct(B[1],1)+' ～ '+pct(B[3],1)));L.appendChild(r)});
  if(young.length)L.appendChild(el('div',{'class':'fu-miss'},'上市不满两个月，算不出：'+young.map(function(f){return f.name+'（'+f.code+'）'}).join('、')));}
/** 第二版 ③：债券类预期年化（从高到低；没取到过的排最后） */
var QL={auto:'每天自动',approx:'近似'};
function bonds(){var all=shown().filter(function(f){return f.category==='债券'});$('fu-yb').hidden=!all.length;
  var L=$('fu-yb-list');L.replaceChildren();if(!all.length)return;
  var v=function(f){return f.yield&&typeof f.yield.value==='number'?f.yield.value:null};
  var arr=all.slice().sort(function(a,b){var x=v(a),y=v(b);return x==null?(y==null?0:1):y==null?-1:y-x});
  var mx=Math.max(1,Math.max.apply(null,arr.map(function(f){return v(f)||0})));
  arr.forEach(function(f){var y=f.yield,val=v(f),r=el('div',{'class':'fu-yb','data-yb':f.code});
    var nm=el('div',{'class':'nm'});nm.appendChild(el('b',null,f.name));nm.appendChild(el('span',{'class':'fu-code'},f.code+(f.currency?' · '+f.currency:'')));r.appendChild(nm);
    var bw=el('div',{'class':'bar-w'});if(val!=null)bw.appendChild(el('div',{'class':'bar'+(y.kind==='approx'?' approx':'')+(y.stale?' stale':''),style:'width:'+Math.max(1,Math.max(0,val)/mx*100)+'%'}));r.appendChild(bw);
    r.appendChild(el('div',{'class':'v num'+(val==null?' na':'')},val==null?'—':(y.kind==='approx'?'≈':'')+val.toFixed(2)+'%'));
    var src=el('div',{'class':'src'});
    if(y){src.appendChild(el('span',{'class':'fu-q '+(y.kind==='approx'?'approx':'auto')},QL[y.kind]||'近似'));if(y.stale)src.appendChild(el('span',{'class':'fu-q stale',title:y.error||''},'过期'));
      src.appendChild(document.createTextNode(y.label+(y.duration!=null?' · 久期 '+y.duration+' 年':'')+' · '+(y.source||'')+' '+(y.asOf||'').slice(5)+(y.stale&&y.error?'（这次没取到：'+y.error+'）':'')))}
    else src.appendChild(document.createTextNode('还没有收益率数据，点「刷新数据」时会一起取'));
    r.appendChild(src);L.appendChild(r)});}
function render(){meta();lede();mkcards();scatter();ranges();bonds();list_()}
function showErr(m){$('fu-err').hidden=!m;$('fu-err-t').textContent=m||''}
async function getJson(url,body){var r;try{r=await fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}catch(e){throw new Error('网络断了或服务器没回应')}
  var j=await r.json().catch(function(){return{}});
  if(r.status===401){try{showLogin('请重新登录')}catch(e){}throw new Error('请重新登录')}
  if(!r.ok)throw new Error(j.error||('服务器出错了（'+r.status+'）'));return j}
async function load(){if(loading)return;loading=true;
  try{D=await getJson(BASE);ITEMS=D.items||[];pruneStale();showErr('');render();
    // 直接打开 #/funds/rg 这类地址时，数据画出来以后板块的位置变了：画完再滚过去一次（只在进页后第一次读到时）
    if(goMod){var gm=/^#\\/funds\\/([a-z0-9-]+)/.exec(location.hash),ge=gm&&$('fu-'+gm[1]);goMod=false;if(ge)ge.scrollIntoView({block:'start'})}
    // 上一次刷新的结果文字是按当时的数据写的；服务器的数据时间变了（别的设备 / 窗口刷过）就不再留着它，以服务器为准
    if(!busy&&$('fu-prog').textContent&&(D.fetched_at||null)!==progAt)prog([])}
  catch(e){showErr('基金数据读取失败：'+e.message+(D?'。下面是上次读到的。':'。'));if(!D){$('fu-meta').textContent='没读到';$('fu-lede').textContent='没读到数据，点上面的「再读一次」。'}}
  finally{loading=false}}
var goMod=false;
/** 刷新结果文字写下时的数据时间 */
var progAt=null;
function prog(parts,err){progAt=D&&D.fetched_at||null;var P=$('fu-prog');P.replaceChildren();P.className='fu-prog'+(err?' err':'');parts.forEach(function(x){P.appendChild(x[1]?el('b',null,x[0]):document.createTextNode(x[0]))})}
function names(codes){return codes.length<=5?'（'+codes.join('、')+'）':''}
/** 一次刷新最多发几次 POST：每批至少 1 只，正常最多"基金总数"批（现在 45）；超了说明进度没往前走，停下（防请求失控） */
function maxPosts(){return Math.max(45,ITEMS.length)}
async function refresh(){if(busy)return;busy=true;var btn=$('fu-refresh');btn.disabled=true;btn.textContent='正在刷新…';
  var cur=0,total=ITEMS.length||45,updated=[],failed=[],before=D&&D.fetched_at;
  var mk=function(i){var f=ITEMS[i];return f?f.market:''};
  var was=before?'显示的还是 '+tw(before)+' 的数据':'还没有数据';
  prog([['正在取 '],[mk(0)||'第一批',1],[' · 0 / '+total]]);
  var posts=0;
  try{while(cur!=null){if(posts>=maxPosts())throw new Error('已经发了 '+maxPosts()+' 次请求还没取完，先停下了，防止请求失控');posts++;
      var r=await getJson(BASE+'/refresh',{cursor:cur});total=r.total;updated=updated.concat(r.updated||[]);failed=failed.concat(r.failed||[]);
      if(r.next!=null&&!(r.next>cur))throw new Error('服务器回的进度没有往前走（'+cur+' → '+r.next+'），先停下了，防止请求失控');
      cur=r.next;
      if(cur!=null)prog([['正在取 '],[mk(cur),1],[' · '+r.done+' / '+r.total]]);}
    // 第二版 ③：45 只取完后再取一次债券收益率（单独一次 POST /api/funds/yields，≤ 45 个对外请求、约 25 秒）；它失败不影响上面的结果，只在债券那块写一句
    prog([['正在取 '],['债券收益率',1],[' · '+total+' / '+total]]);
    try{var yr=await getJson(BASE+'/yields',{});var yf=(yr&&yr.failed)||[];
      $('fu-yb-msg').textContent=yf.length?'这次有 '+yf.length+' 只的收益率没取到（'+yf.map(function(x){return x.code}).join('、')+'），显示的是上次的值，标了"过期"。':''}
    catch(e){$('fu-yb-msg').textContent='债券收益率这次没取到（'+e.message+'），显示的是上次的值。'}
    STALE=null;await load();
    if(!updated.length){prog([['这次没取到，'+was+'，可以再点一次']],true);return}
    var msg='已更新 '+updated.length+' / '+total+(D&&D.fetched_at?'，数据时间 '+tw(D.fetched_at):'');
    if(failed.length){
      // 有旧数据的和从没取到过的分开说（后者那几行是空的，不是"上次的数据"）
      var by={};ITEMS.forEach(function(f){by[f.code]=f});
      var keep=failed.filter(function(x){return has(by[x.code])}).map(function(x){return x.code}),never=failed.filter(function(x){return!has(by[x.code])}).map(function(x){return x.code});
      if(keep.length)msg+='；'+keep.length+' 只没取到'+names(keep)+'，'+(keep.length>1?'那几行':'那一行')+'显示的是上次的数据，行里写了原因';
      if(never.length)msg+='；'+never.length+' 只没取到数据'+names(never)+'，以前也没取到过，'+(never.length>1?'那几行':'那一行')+'还是空的';}
    prog([[msg]],failed.length>0);}
  catch(e){
    // 中途断了：只有已经回了结果的那几批算数（写库失败的那一批不算"已存好"）
    var why='（'+e.message+'）',codes={};
    ITEMS.forEach(function(f){if(updated.indexOf(f.code)<0)codes[f.code]=1});
    STALE=updated.length?{at:before,codes:codes}:null;
    await load();
    if(!updated.length)prog([['这次没取到，'+was+'，可以再点一次'+why]],true);
    else prog([['前 '+updated.length+' 只已更新，其余 '+(total-updated.length)+' 只'+(before?'还是 '+tw(before)+' 的数据':'还没有数据')+'，再点会从头取'+why]],true);}
  finally{busy=false;btn.disabled=false;btn.textContent='↻ 刷新数据'}}
document.querySelectorAll('#fu-periods .fu-chip').forEach(function(b){b.addEventListener('click',function(){st.p=b.dataset.p;document.querySelectorAll('#fu-periods .fu-chip').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});render()})});
document.querySelectorAll('#fu-markets .fu-chip').forEach(function(b){b.addEventListener('click',function(){st.m=b.dataset.m;document.querySelectorAll('#fu-markets .fu-chip').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false')});render()})});
$('fu-refresh').addEventListener('click',refresh);
// 触屏抽屉：点抽屉和散点图以外的地方、滚动页面、按 Esc 都关掉
function tipOpen(){var t=$('fu-tip');return!t.hidden&&t.classList.contains('touch')}
document.addEventListener('pointerdown',function(e){if(!tipOpen()||!tipOff)return;if($('fu-tip').contains(e.target)||$('fu-scatter').contains(e.target))return;tipOff()},true);
window.addEventListener('scroll',function(){if(tipOpen()&&tipOff)tipOff()},{passive:true});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&tipOpen()&&tipOff)tipOff()});
$('fu-retry').addEventListener('click',load);
// 只在**宽度**变了时重画：手机地址栏伸缩只改高度，重画会把散点的触屏抽屉关掉
var rt,lastW=window.innerWidth;window.addEventListener('resize',function(){if(window.innerWidth===lastW)return;lastW=window.innerWidth;if($('v-funds').hidden||!D)return;clearTimeout(rt);rt=setTimeout(function(){scatter();if(st.open)list_()},120)});
/** 每次进这一页（route() 调）都重新 GET /api/funds（不轮询）；已经有数据就先按当前宽度画出来，读到新的再重画。正在刷新时不读（刷完会读） */
window.fundsOpen=function(){goMod=true;if(D)render();if(!busy)load()};
})();
`;

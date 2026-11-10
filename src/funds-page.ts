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
#v-funds .fu-refresh{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;justify-content:flex-end}
#v-funds .fu-prog{font-size:var(--fs-aux);color:var(--muted);min-width:0}
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
#v-funds .fu-px{text-align:right;font-variant-numeric:tabular-nums}#v-funds .fu-px small{display:block;color:var(--muted);font-size:12px}
#v-funds .fu-d1{text-align:right;font-variant-numeric:tabular-nums;font-size:var(--fs-aux)}
#v-funds .fu-d1.hot{font-weight:700}#v-funds .fu-d1.hot::before{content:"⚑ ";font-size:12px}
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
@media (max-width:760px){
  #v-funds .fu-card{padding:var(--s4)}
  #v-funds .fu-colh{display:none}
  #v-funds .fu-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"nm px" "bars bars" "spark d1"}
  #v-funds .fu-row .fu-nm{grid-area:nm}#v-funds .fu-row .fu-px{grid-area:px}#v-funds .fu-row .fu-d1{grid-area:d1;align-self:end}#v-funds .fu-row .fu-bars{grid-area:bars}#v-funds .fu-row .fu-spark{grid-area:spark}
  #v-funds .fu-detail{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:no-preference){#v-funds .fu-track i{transition:width .35s ease,left .35s ease}}
`;

/** 整页 #v-funds（放在 #app 里，和 #v-tools 平级） */
export const FUNDS_MOD = `<section class="page plat" id="v-funds" hidden>
  <div class="fu-head">
    <div><h1>基金观察</h1><div class="fu-meta num" id="fu-meta">读取中…</div></div>
    <div class="fu-refresh"><span class="fu-prog" id="fu-prog" aria-live="polite"></span><button class="btn primary" id="fu-refresh" type="button">↻ 刷新数据</button></div>
  </div>
  <div class="fu-errbar" id="fu-err" role="alert" hidden><span id="fu-err-t"></span><span class="sp"></span><button class="btn small" type="button" id="fu-retry">再读一次</button></div>
  <section class="fu-card" aria-label="总结">
    <p class="fu-lede" id="fu-lede">读取中…</p>
    <div class="fu-alerts" id="fu-alerts"></div>
  </section>
  <div class="fu-controls">
    <div class="fu-seg" role="group" aria-label="时间段" id="fu-periods">
      <button class="fu-chip" type="button" data-p="w1" aria-pressed="false">近 1 周</button><button class="fu-chip" type="button" data-p="m1" aria-pressed="false">近 1 月</button><button class="fu-chip" type="button" data-p="ytd" aria-pressed="false">今年以来</button><button class="fu-chip" type="button" data-p="y1" aria-pressed="true">近 1 年</button>
    </div>
    <div class="fu-seg" role="tablist" aria-label="市场" id="fu-markets">
      <button class="fu-chip" role="tab" type="button" data-m="" aria-selected="true">全部</button><button class="fu-chip" role="tab" type="button" data-m="新加坡" aria-selected="false">新加坡</button><button class="fu-chip" role="tab" type="button" data-m="美国" aria-selected="false">美国</button><button class="fu-chip" role="tab" type="button" data-m="中国" aria-selected="false">中国</button>
    </div>
  </div>
  <div class="fu-grid3" id="fu-mkcards"></div>
  <section class="fu-card" aria-labelledby="fu-sc-h">
    <div class="fu-sec-h"><h2 id="fu-sc-h">赚了多少，中途最多亏过多少</h2><p id="fu-sc-sub"></p></div>
    <div class="fu-legend"><span><i style="background:var(--fu-broad)"></i>宽基</span><span><i style="background:var(--fu-bond)"></i>债券</span><span><i style="background:var(--fu-div)"></i>红利</span><span>越靠左上越好：收益高、回撤小</span></div>
    <div class="fu-scbox" id="fu-scbox"><svg id="fu-scatter" role="img"></svg><div class="fu-tip" id="fu-tip" hidden></div></div>
  </section>
  <section class="fu-card" aria-labelledby="fu-ls-h">
    <div class="fu-sec-h"><h2 id="fu-ls-h">逐只对比</h2><p>点一行看一年走势和回撤过程</p></div>
    <div class="fu-legend"><span><i class="bar" style="background:var(--ok)"></i>收益（涨）</span><span><i class="bar" style="background:var(--err)"></i>收益（跌）</span><span><i class="bar" style="background:var(--amber)"></i>期间最大回撤</span><span>⚑ 单日涨跌超过 ±3%</span></div>
    <div class="fu-colh"><span>产品</span><span>最新价</span><span>1 日</span><span id="fu-colp">近 1 年</span><span>一年走势</span></div>
    <div id="fu-list"></div>
  </section>
  <details class="fu-foot fu-card">
    <summary>数据从哪来、什么叫最大回撤、哪些格子是空的</summary>
    <ul>
      <li><b>最大回撤</b>：所选时间段里，从最高点跌到之后最低点的最大跌幅。比如"近 1 年 −10.9%"表示这一年里最多从高点回落过 10.9%。</li>
      <li>收益和回撤都按含分红的复权价算。场内 ETF 和新加坡场外基金来自 Yahoo Finance；000171、217003 和 Yahoo 缺历史的上交所 ETF（例如 511880）来自东方财富累计净值。</li>
      <li>"刷新数据"由服务器分几批去取（每批最多 45 个请求），全部取完大约半分钟；某只没取到时保留上次的数据，并在那一行标出"没取到，显示的是哪天的数据"。</li>
      <li>上市不满某段时间的，那一段的格子是空的（写"上市不足"）；展开那一行看"上市以来"（最多一年）。</li>
      <li>0P00006FY6 是按名称推断的代码，净值比场内产品晚几天。511990、511880 是货币 ETF，几乎不动。</li>
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
function pct(v,dig){if(v==null)return'—';dig=dig==null?2:dig;var s=Math.abs(v).toFixed(dig);if(+s===0)return(0).toFixed(dig)+'%';return(v>0?'+':'−')+s+'%'}
function cls(v){return v==null?'na':v>0?'pos':v<0?'neg':''}
function el(tag,attrs,text){var e=document.createElement(tag);if(attrs)for(var k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e}
function sv(tag,attrs){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);return e}
function has(f){return f&&f.last!=null&&Array.isArray(f.series)&&f.series.length>0}
function ret(f,p){return has(f)?(f[p]==null?null:f[p]):null}
function dd(f,p){return has(f)?(f['dd_'+p]==null?null:f['dd_'+p]):null}
function shown(){return ITEMS.filter(function(f){return!st.m||f.market===st.m})}
function fmtPx(v){return v==null?'—':v.toFixed(v<10?3:2)}
function tw(iso){if(!iso)return'';var d=new Date(Date.parse(iso)+8*3600e3).toISOString();return d.slice(0,10)+' '+d.slice(11,16)}
function cnt(m){return ITEMS.filter(function(f){return!m||f.market===m}).length}

function meta(){var ok=ITEMS.filter(has).length;
  $('fu-meta').textContent=D&&D.fetched_at?('数据时间 '+tw(D.fetched_at)+'（台湾时间）· '+ITEMS.length+' 只 · 新加坡、美国、中国'+(ok<ITEMS.length?' · '+(ITEMS.length-ok)+' 只还没有数据':'')):'还没取过数据，点右边「刷新数据」去取（大约半分钟）';
  document.querySelectorAll('#fu-markets .fu-chip').forEach(function(b){var m=b.dataset.m;b.textContent=(m||'全部')+' '+cnt(m)});}

function lede(){var p=st.p,L=$('fu-lede'),A=$('fu-alerts');L.replaceChildren();A.replaceChildren();
  var list=shown().filter(function(f){return ret(f,p)!=null});
  if(!list.length){L.textContent=ITEMS.some(has)?(PL[p]+'：'+(st.m||'这几个市场')+'没有上市满这段时间的产品。'):'还没有数据。点右上角「刷新数据」，服务器会分几批去取 45 只的价格。';return}
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
    var miss=all.length-list.length;
    c.appendChild(el('div',{'class':'fu-note num'},up+' 只涨 · '+down+' 只跌'+(miss?' · '+miss+' 只上市不满这段时间或没有数据':'')));
    C.appendChild(c);});}

function ticks(a,b,n){var step=Math.pow(10,Math.floor(Math.log10((b-a)/n)));var e=(b-a)/n/step;step*=e>5?10:e>2?5:e>1?2:1;var t=[];for(var v=Math.ceil(a/step)*step;v<=b+1e-9;v+=step)t.push(+v.toFixed(6));return t}
function scatter(){var p=st.p,list=shown().filter(function(f){return ret(f,p)!=null&&dd(f,p)!=null});
  var svg=$('fu-scatter'),box=$('fu-scbox'),tip=$('fu-tip');tip.hidden=true;
  var W=Math.max(300,box.clientWidth||600),H=Math.round(Math.min(420,Math.max(240,W*.5)));
  svg.replaceChildren();svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('aria-label',PL[p]+'各产品收益与最大回撤散点图，共 '+list.length+' 只');
  $('fu-sc-sub').textContent='横轴：'+PL[p]+'最大回撤（越往右跌得越深）；纵轴：'+PL[p]+'收益';
  if(!list.length){var t0=sv('text',{x:W/2,y:H/2,'text-anchor':'middle','font-size':13,fill:'var(--muted)'});t0.textContent='还没有数据';svg.appendChild(t0);return}
  var xs=list.map(function(f){return-dd(f,p)}),ys=list.map(function(f){return ret(f,p)});
  var xmax=Math.max(1,Math.max.apply(null,xs))*1.08,ymin=Math.min(0,Math.min.apply(null,ys)),ymax=Math.max(0,Math.max.apply(null,ys));var pad=(ymax-ymin)*.08||1;ymin-=pad;ymax+=pad;
  var m={l:52,r:16,t:12,b:34};
  var X=function(v){return m.l+v/xmax*(W-m.l-m.r)},Y=function(v){return m.t+(ymax-v)/(ymax-ymin)*(H-m.t-m.b)};
  var g=sv('g',{});svg.appendChild(g);
  ticks(ymin,ymax,5).forEach(function(v){g.appendChild(sv('line',{x1:m.l,x2:W-m.r,y1:Y(v),y2:Y(v),stroke:v===0?'var(--muted)':'var(--fu-grid)'}));var t=sv('text',{x:m.l-8,y:Y(v)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t.textContent=(v>0?'+':v<0?'−':'')+Math.abs(v)+'%';g.appendChild(t)});
  ticks(0,xmax,5).forEach(function(v){g.appendChild(sv('line',{x1:X(v),x2:X(v),y1:m.t,y2:H-m.b,stroke:'var(--fu-grid)'}));var t=sv('text',{x:X(v),y:H-m.b+16,'text-anchor':'middle','font-size':12,fill:'var(--muted)'});t.textContent=v===0?'0':'−'+v+'%';g.appendChild(t)});
  var lab=sv('text',{x:W-m.r,y:H-2,'text-anchor':'end','font-size':12,fill:'var(--muted)'});lab.textContent='最大回撤 →';g.appendChild(lab);
  list.forEach(function(f){
    var c=sv('circle',{cx:X(-dd(f,p)),cy:Y(ret(f,p)),r:6,fill:CAT[f.category],'fill-opacity':.8,stroke:'var(--surface)','stroke-width':1.5,tabindex:0,'data-code':f.code,'aria-label':f.name+' 收益 '+pct(ret(f,p))+' 最大回撤 '+pct(dd(f,p))});
    c.style.cursor='pointer';
    function show(){tip.replaceChildren();tip.appendChild(el('b',null,f.name));tip.appendChild(el('div',{'class':'num'},f.market+' · '+f.category+' · 收益 '+pct(ret(f,p))+' · 最大回撤 '+pct(dd(f,p))));tip.hidden=false;var bx=box.getBoundingClientRect(),r=c.getBoundingClientRect();var x=r.left-bx.left+12,y=r.top-bx.top-52;tip.style.left=Math.max(0,Math.min(x,bx.width-tip.offsetWidth-4))+'px';tip.style.top=(y<0?r.bottom-bx.top+8:y)+'px';c.setAttribute('r',8)}
    function hide(){tip.hidden=true;c.setAttribute('r',6)}
    c.addEventListener('mouseenter',show);c.addEventListener('focus',show);c.addEventListener('mouseleave',hide);c.addEventListener('blur',hide);
    function go(){st.open=f.code;list_();var r=document.querySelector('#fu-list [data-code="'+f.code+'"]');if(r){r.scrollIntoView({block:'center'});r.classList.add('flash');setTimeout(function(){r.classList.remove('flash')},1200);r.focus({preventScroll:true})}}
    c.addEventListener('click',go);c.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
    svg.appendChild(c);});}

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
function detail(f){var box=el('div',{'class':'fu-detail','data-detail':f.code}),s=f.series,W=640,H1=170,H2=80,g=10;
  var vals=s.map(function(x){return x[1]}),mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);if(mx===mn){mx+=1;mn-=1}
  var peak=-Infinity,uw=s.map(function(x){peak=Math.max(peak,x[1]);return(x[1]/peak-1)*100});
  var umin=Math.min(-1,Math.min.apply(null,uw)),n=Math.max(1,s.length-1);
  var ml=52,mr=8,X=function(i){return ml+i/n*(W-ml-mr)},Y1=function(v){return 8+(mx-v)/(mx-mn)*(H1-16)},Y2=function(v){return H1+g+(-v)/(-umin)*(H2-4)};
  var svg=sv('svg',{viewBox:'0 0 '+W+' '+(H1+g+H2+20),role:'img','aria-label':f.name+' 一年复权价走势和回撤过程'});
  [mn,(mn+mx)/2,mx].forEach(function(v){svg.appendChild(sv('line',{x1:ml,x2:W-mr,y1:Y1(v),y2:Y1(v),stroke:'var(--fu-grid)'}));var t=sv('text',{x:ml-6,y:Y1(v)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t.textContent=v>=100?v.toFixed(0):v.toPrecision(4);svg.appendChild(t)});
  var d=s.map(function(x,i){return(i?'L':'M')+X(i).toFixed(1)+' '+Y1(x[1]).toFixed(1)}).join('');
  svg.appendChild(sv('path',{d:d+'L'+X(s.length-1)+' '+(H1-8)+'L'+X(0)+' '+(H1-8)+'Z',fill:'var(--fu-broad)','fill-opacity':.08}));
  svg.appendChild(sv('path',{d:d,fill:'none',stroke:'var(--fu-broad)','stroke-width':1.6}));
  // 最深的一次回撤：从哪天的高点跌到哪天
  var pk=0,best=0,bp=0,bt=0;for(var i=0;i<s.length;i++){if(s[i][1]>s[pk][1])pk=i;var r=s[i][1]/s[pk][1]-1;if(r<best){best=r;bp=pk;bt=i}}
  if(best<0){svg.appendChild(sv('circle',{cx:X(bp),cy:Y1(s[bp][1]),r:4,fill:'var(--surface)',stroke:'var(--amber)','stroke-width':2}));svg.appendChild(sv('circle',{cx:X(bt),cy:Y1(s[bt][1]),r:4,fill:'var(--amber)'}));
    var t=sv('text',{x:Math.min(X(bt)+8,W-250),y:Math.min(Y1(s[bt][1])+16,H1-4),'font-size':12,fill:'var(--amber)','font-weight':700,'class':'fu-deep'});t.textContent='最深 '+pct(best*100)+'（'+s[bp][0]+' → '+s[bt][0]+'）';svg.appendChild(t)}
  svg.appendChild(sv('line',{x1:ml,x2:W-mr,y1:Y2(0),y2:Y2(0),stroke:'var(--muted)'}));
  var ud=uw.map(function(v,i){return(i?'L':'M')+X(i).toFixed(1)+' '+Y2(v).toFixed(1)}).join('');
  svg.appendChild(sv('path',{d:ud+'L'+X(s.length-1)+' '+Y2(0)+'L'+X(0)+' '+Y2(0)+'Z',fill:'var(--amber)','fill-opacity':.25}));
  svg.appendChild(sv('path',{d:ud,fill:'none',stroke:'var(--amber)','stroke-width':1.2}));
  var t2=sv('text',{x:ml-6,y:Y2(umin)+4,'text-anchor':'end','font-size':12,fill:'var(--muted)'});t2.textContent=umin.toFixed(0)+'%';svg.appendChild(t2);
  var t3=sv('text',{x:ml+4,y:H1+g+H2+16,'font-size':12,fill:'var(--muted)'});t3.textContent='下方：离当时最高点跌了多少（水下曲线）';svg.appendChild(t3);
  [0,s.length-1].forEach(function(i){var t=sv('text',{x:X(i),y:H1+4,'text-anchor':i?'end':'start','font-size':12,fill:'var(--muted)'});t.textContent=s[i][0];svg.appendChild(t)});
  var left=el('div');left.appendChild(svg);box.appendChild(left);
  var right=el('div'),tb=el('table',{'class':'fu-ptab'}),th=el('tr');['时间段','收益','最大回撤'].forEach(function(h){th.appendChild(el('th',null,h))});tb.appendChild(th);
  ['w1','m1','ytd','y1'].forEach(function(p){var tr=el('tr');tr.appendChild(el('td',null,PL[p]));tr.appendChild(el('td',{'class':cls(ret(f,p))},pct(ret(f,p))));tr.appendChild(el('td',{'class':dd(f,p)?'neg':'na'},pct(dd(f,p))));tb.appendChild(tr)});
  var tr=el('tr');tr.appendChild(el('td',null,'上市以来*'));tr.appendChild(el('td',{'class':cls(f.ret_all)},pct(f.ret_all)));tr.appendChild(el('td',{'class':f.dd_all?'neg':'na'},pct(f.dd_all)));tb.appendChild(tr);
  right.appendChild(tb);right.appendChild(el('div',{'class':'fu-dnote'},'* 从 '+f.first+' 起（最多取一年）。最新价 '+fmtPx(f.last)+' '+(f.currency||'')+'，'+f.date+'，来源：'+srcName(f)));
  box.appendChild(right);return box;}

function staleText(f){if(!f.stale)return'';return'这次没取到（'+f.stale.reason+'），显示的是 '+f.date+' 的数据'}
function list_(){var p=st.p,L=$('fu-list');L.replaceChildren();$('fu-colp').textContent=PL[p]+'：收益 / 最大回撤';
  var arr=shown();if(!arr.length){L.appendChild(el('div',{'class':'fu-empty'},'暂无'));return}
  var lim=Math.max(1,Math.max.apply(null,arr.map(function(f){return Math.max(Math.abs(ret(f,p)||0),Math.abs(dd(f,p)||0))})));
  (st.m?[st.m]:MKS).forEach(function(m){CATS.forEach(function(c){
    var g=arr.filter(function(f){return f.market===m&&f.category===c});if(!g.length)return;
    var h=el('div',{'class':'fu-group'});h.appendChild(el('i',{style:'background:'+CAT[c]}));h.appendChild(document.createTextNode((st.m?'':m+' · ')+c+' · '+g.length+' 只'));L.appendChild(h);
    g.forEach(function(f){var ok=has(f);
      var r=el('div',{'class':'fu-row',role:'button',tabindex:0,'data-code':f.code,'aria-expanded':ok&&st.open===f.code?'true':'false'});
      var nm=el('div',{'class':'fu-nm'});nm.appendChild(el('b',null,f.name));var sub=el('div');sub.appendChild(el('span',{'class':'fu-code'},f.code));if(f.tag)sub.appendChild(el('span',{'class':'fu-tag'},f.tag));nm.appendChild(sub);
      if(ok&&f.stale)nm.appendChild(el('span',{'class':'fu-stale'},staleText(f)));
      if(!ok)nm.appendChild(el('span',{'class':'fu-stale'},'没取到数据'+(f.error&&f.error!=='还没取过'?'：'+f.error:'，点「刷新数据」去取')));
      r.appendChild(nm);
      var px=el('div',{'class':'fu-px'},fmtPx(ok?f.last:null));if(ok)px.appendChild(el('small',null,(f.currency||'')+' · '+f.date.slice(5)));r.appendChild(px);
      var hot=ok&&f.d1!=null&&Math.abs(f.d1)>=TH;r.appendChild(el('div',{'class':'fu-d1 '+cls(ret(f,'d1'))+(hot?' hot':'')},pct(ret(f,'d1'))));
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

function render(){meta();lede();mkcards();scatter();list_()}
function showErr(m){$('fu-err').hidden=!m;$('fu-err-t').textContent=m||''}
async function getJson(url,body){var r;try{r=await fetch(url,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}catch(e){throw new Error('网络断了或服务器没回应')}
  var j=await r.json().catch(function(){return{}});
  if(r.status===401){try{showLogin('请重新登录')}catch(e){}throw new Error('请重新登录')}
  if(!r.ok)throw new Error(j.error||('服务器出错了（'+r.status+'）'));return j}
async function load(){if(loading)return;loading=true;
  try{D=await getJson(BASE);ITEMS=D.items||[];showErr('');render()}
  catch(e){showErr('基金数据读取失败：'+e.message+(D?'。下面是上次读到的。':'。'));if(!D){$('fu-meta').textContent='没读到';$('fu-lede').textContent='没读到数据，点上面的「再读一次」。'}}
  finally{loading=false}}
function prog(parts,err){var P=$('fu-prog');P.replaceChildren();P.className='fu-prog'+(err?' err':'');parts.forEach(function(x){P.appendChild(x[1]?el('b',null,x[0]):document.createTextNode(x[0]))})}
var MK_OF=null;
async function refresh(){if(busy)return;busy=true;var btn=$('fu-refresh');btn.disabled=true;btn.textContent='正在刷新…';
  var cur=0,total=ITEMS.length||45,updated=0,failed=[];
  var mk=function(i){var f=ITEMS[i];return f?f.market:''};
  prog([['正在取 '],[mk(0)||'第一批',1],[' · 0 / '+total]]);
  try{while(cur!=null){var r=await getJson(BASE+'/refresh',{cursor:cur});total=r.total;updated+=r.updated;failed=failed.concat(r.failed||[]);cur=r.next;
      if(cur!=null)prog([['正在取 '],[mk(cur),1],[' · '+r.done+' / '+r.total]]);}
    await load();
    var msg='已更新 '+updated+' / '+total+(D&&D.fetched_at?'，数据时间 '+tw(D.fetched_at):'');
    if(failed.length)msg+='；'+failed.length+' 只没取到（'+failed.map(function(x){return x.code}).join('、')+'），那几行显示的是上次的数据';
    prog([[msg]],failed.length>0);}
  catch(e){prog([['刷新到 '+(cur||0)+' / '+total+' 停了：'+e.message+'。已取到的已经存好，可以再点一次「刷新数据」（会从头取）。']],true);load();}
  finally{busy=false;btn.disabled=false;btn.textContent='↻ 刷新数据'}}
document.querySelectorAll('#fu-periods .fu-chip').forEach(function(b){b.addEventListener('click',function(){st.p=b.dataset.p;document.querySelectorAll('#fu-periods .fu-chip').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});render()})});
document.querySelectorAll('#fu-markets .fu-chip').forEach(function(b){b.addEventListener('click',function(){st.m=b.dataset.m;document.querySelectorAll('#fu-markets .fu-chip').forEach(function(x){x.setAttribute('aria-selected',x===b?'true':'false')});render()})});
$('fu-refresh').addEventListener('click',refresh);
$('fu-retry').addEventListener('click',load);
var rt;window.addEventListener('resize',function(){if($('v-funds').hidden)return;clearTimeout(rt);rt=setTimeout(scatter,120)});
/** 进这一页时读一次（route() 调）；已经读到就只按当前宽度重画散点图 */
window.fundsOpen=function(){if(D){render();return}load()};
})();
`;

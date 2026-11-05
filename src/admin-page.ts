import { ASSETS_CSS, ASSETS_JS, ASSETS_MOD } from './assets-page';
import { TTS_CSS, TTS_JS, TTS_MOD } from './tts-page';
import { VOICE_CSS, VOICE_JS } from './voice-page';
import { ENGLISH_CSS, ENGLISH_JS, ENGLISH_MOD } from './english-page';
import { EM_CSS, EM_JS, EM_MOD } from './english-memory-page';
import { EXTENSION_VERSION } from './extension-download';
import { MAX_PROJECT_PAGES, PLATFORM_CONFIG, PROJECT_PAGES_FALLBACK, PROJECT_SITE } from './projects';

/**
 * 网页后台 = 工作平台（agents C136；工作平台批 1：原型 agents 工作平台/原型-工作平台-v2.html，技术方案 工作平台/技术方案-工作平台*.md，Amos 2026-11-01"都按建议"）。
 * 外框：一级菜单"工作台 · 项目（**有几个出几个**）· 公共工具"，二级菜单直通模块，地址用锚点 #/work/todo、#/<项目>/guide、#/tools/queue，刷新停在原处；
 * 项目名单 2026-11-02 起**不写死**（Amos"项目也只有 forecast 一个，新项目哪儿去了"）：读 GET /api/company 的 projects 块算出来（规则和服务端同一份，
 * src/projects.ts projectPagesFrom），块还没推上来就用 CFG.PROJECT_PAGES_FALLBACK 兜底。项目页只有一套 DOM（#v-project、模块 id 还是 f-*），切项目时换数据不换结构；
 * 登录后默认工作台（P-9），/queue 打开直接进清单。没登录显示密码框；手机、电脑都能用。
 * 三段脚本：① 外框 + 清单、用量和限额、插件下载（接口没改；批 B 只加了一句话结论、筛选折叠这些渲染）；② "公司总览"（原运营仪表盘"公司"页，整段 try/catch）；
 * ③ 工作台、项目页（整段 try/catch，出错只影响这两页）。每个按钮都有处理中 / 成功 / 失败的反馈（C135）；删除先在页面上确认（删了不能恢复）。
 * 工作台"全部待办"：2026-11-02 起按项目分组（Amos"31 个待办混在一起 我要疯掉了"）；2026-11-04 界面改版·批 A 起改成按时间段分组
 * （已超时 / 24 小时内到期 / 之后到期 / 没定截止时间，最后一组默认收起）+ 上面按项目筛选（原型 prototype-work.html，Amos 同意换口径）。
 * 只改渲染，todo 块的数据结构（src/company.ts SCHEMA）没动。批 A 同时换了全站设计变量（:root）、外框菜单、工作台 7 个模块的结构。
 * 界面改版·批 B（2026-11-04，原型 prototype-tools.html）：项目页 8 个模块、公共工具 8 块也改成同样的卡片模块（标题行 → 一句话结论 → 主内容 → 默认收起的折叠说明）；
 * 公共工具子菜单顺序 = 页面顺序，"语音对话实测"并进"语音生成"的折叠；清单、用量、插件下载的接口和元素 id 都没改，只换排版。
 * 注意：整页是一个模板字符串，页面脚本里不能用反引号和 ${（只有插件版本号和 src/projects.ts 的对照表是在这里插进去的）。
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>工作平台</title>
<style>
/* 设计变量（工作平台界面改版·批 A，原型 prototype-work.html，Amos 2026-11-04"好很多了，改吧"）：
   颜色沿用原来的变量名，新增 --surface-2 次要区域、--ink-2 正文次级、--teal-ink 青色文字、--hero-bg / --hero-line 最该做的事、--gray-soft 中性标签；明暗两套。
   青色只给可点的主动作；红、橙、绿只表示状态；项目标签用中性灰。
   字号只用 5 级：页面标题 --fs-page、模块标题 --fs-mod、正文 --fs-body、辅助 --fs-aux、大数字 --fs-num（12px 只给角标标签）；间距 4/8/12/16/24/32/48。
   --muted、--ok 比原型深一点点：原型的值在 --bg、--gray-soft 上对比度不到 4.5:1（WCAG AA）。 */
:root{--bg:#F3F5F8;--surface:#fff;--surface-2:#F7F9FB;--ink:#13203A;--ink-2:#3D4A60;--muted:#616D80;--line:#E4E8EF;--navy:#0F1B33;--hero-bg:#0F1B33;--hero-line:transparent;
  --teal:#14B8A6;--teal-ink:#0B7A6E;--teal-soft:#E2F6F3;--amber:#B45309;--amber-soft:#FEF3E2;--ok:#147A3A;--ok-soft:#E5F5EA;--err:#C0262D;--err-strong:#C0262D;--amber-strong:#B45309;--err-soft:#FDECEC;--gray-soft:#EEF1F5;--th:#6B3FA0;--stale:#8A94A6;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--shadow:0 1px 2px rgba(15,27,51,.04),0 4px 14px rgba(15,27,51,.05);
  --fs-page:24px;--fs-mod:18px;--fs-body:15px;--fs-aux:13px;--fs-num:30px;
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--r-card:14px;--r-btn:10px;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0B1220;--surface:#121B2C;--surface-2:#172238;--ink:#E7ECF4;--ink-2:#BAC4D6;--muted:#8D99AE;--line:#223049;--navy:#08101F;--hero-bg:#15233F;--hero-line:#3A5285;
  --teal:#2DD4BF;--teal-ink:#5EEAD4;--teal-soft:#0F3632;--amber:#F5A524;--amber-soft:#382912;--ok:#4ADE80;--ok-soft:#12301E;--err:#F87171;--err-strong:#DC2626;--amber-strong:#B45309;--err-soft:#3A181B;--gray-soft:#1C2740;--th:#B993E6;--stale:#6B7689;--shadow:none;color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs-body)/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;-webkit-font-smoothing:antialiased}
/* 外框：顶栏（一级菜单：工作台 · 项目 · 公共工具）+ 二级菜单（直通模块），两层一起固定在屏幕顶部；地址用 #/work/todo 这类锚点 */
.bars{position:sticky;top:0;z-index:30}
.top{position:relative;display:flex;align-items:center;gap:var(--s3);height:52px;padding:0 max(var(--s5),env(safe-area-inset-left));background:var(--navy);color:#fff}
.logo{display:flex;gap:3px;align-items:flex-end;flex:0 0 auto}.logo i{display:block;width:6px;border-radius:2px}
.brand{font-size:16px;font-weight:700;margin-right:var(--s3);white-space:nowrap}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.nav1{display:flex;gap:2px;align-items:center;min-width:0;overflow-x:auto;scrollbar-width:none}.nav1::-webkit-scrollbar{display:none}
.nav1 a{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#C3CEE0;text-decoration:none;border-radius:99px;padding:6px 14px;white-space:nowrap}
.nav1 a:hover{background:rgba(255,255,255,.07)}.nav1 a[aria-current="page"]{background:#fff;color:#0F1B33;font-weight:700}
.nav1 .sep{width:1px;height:18px;background:#33425F;margin:0 var(--s2);flex:0 0 auto}
.nav1 .grp-l{font-size:12px;color:#7E8DA8;margin-right:2px;white-space:nowrap;flex:0 0 auto}
.nav1 .cnt{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--err-strong);color:#fff;font-size:12px;font-weight:700;line-height:1}
.nav1 a:focus-visible,.sub a:focus-visible,.top button:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.top .sp{flex:1}
.top button{font:inherit;font-size:13px;background:none;border:1px solid #33425F;color:#C3CEE0;border-radius:99px;padding:4px 12px;cursor:pointer;white-space:nowrap;flex:0 0 auto}
.top button:hover{border-color:#5B6B8C;color:#fff}
.top button[aria-current="page"]{background:#fff;border-color:#fff;color:#0F1B33;font-weight:700}
.more-menu{position:relative;flex:0 0 auto}.more-menu>summary{display:none;list-style:none;cursor:pointer}.more-menu>summary::-webkit-details-marker{display:none}
.tacts{display:flex;gap:var(--s3);align-items:center}.more-menu:not([open]) .tacts{display:none}
.tacts button:focus-visible,.more-menu>summary:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.sub{position:relative;background:var(--surface);border-bottom:1px solid var(--line)}
.sub .in{max-width:1120px;margin:0 auto;display:flex;gap:var(--s1);overflow-x:auto;scrollbar-width:none;padding:0 max(var(--s5),env(safe-area-inset-left))}
.sub .in::-webkit-scrollbar{display:none}
.sub a{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;height:46px;padding:0 var(--s3);font-size:14px;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap}
.sub a:hover{color:var(--ink)}.sub a[aria-current="true"]{color:var(--ink);font-weight:700;border-bottom-color:var(--teal)}
.sub .n{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;font-size:12px;font-weight:700;line-height:1;background:var(--gray-soft);color:var(--ink-2)}.sub .n.red{background:var(--err-strong);color:#fff}
main{max-width:1120px;margin:0 auto;padding:var(--s5) max(var(--s5),env(safe-area-inset-right)) var(--s7) max(var(--s5),env(safe-area-inset-left));min-width:0}
/* 批 A 去掉了 .page::after{height:60vh} 那段空白：页面底部的几块顶不到菜单下面时，二级菜单靠 subSpy() 的"快到底时判定线下移"选中 */
.page{display:grid;gap:var(--s5);min-width:0}
.mod{scroll-margin-top:calc(var(--bars-h,98px) + var(--s4));min-width:0}
.page{scroll-margin-top:var(--bars-h,98px)}
.crumb{display:flex;gap:var(--s2) var(--s3);align-items:baseline;flex-wrap:wrap;margin:0}.crumb h1{font-size:var(--fs-page);line-height:1.3;margin:0}
.mh{font-size:var(--fs-mod);margin:0 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mh .sp{flex:1}.mh #count{font-size:var(--fs-aux);font-weight:400;color:var(--muted)}
h3.mh{font-size:var(--fs-body)}
/* 手机：两层菜单各一行，放不下就横滑，右边缘渐隐提示"还有"（.more，subHint() 加）；选中项由 subShow() 滚进看得见的地方 */
@media (max-width:640px){:root{--fs-page:22px;--fs-mod:17px;--fs-num:26px}
  .top{height:48px;padding:0 var(--s3);gap:var(--s2)}.brand,.nav1 .grp-l,.top #nav,.top #extnav{display:none}
  .nav1 a{padding:5px 10px}.nav1 .sep{margin:0 2px}.top button{padding:3px 9px}
  /* 手机：品牌名和"公司总览 / 登出"收进"···"，一级菜单的宽度留给项目名 */
  .more-menu>summary{display:block;font-size:14px;line-height:1;color:#C3CEE0;border:1px solid #33425F;border-radius:99px;padding:5px 10px}
  .tacts{position:absolute;right:0;top:calc(100% + 10px);flex-direction:column;align-items:stretch;gap:2px;padding:6px;min-width:150px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:40}
  .tacts button{color:var(--ink);border:0;border-radius:8px;padding:8px 12px;text-align:left;font-size:14px}.tacts button:hover{background:var(--gray-soft);color:var(--ink)}
  .tacts button[aria-current="page"]{background:var(--gray-soft);color:var(--ink)}
  .sub .in{padding:0 var(--s2)}.sub a{height:42px;padding:0 10px}
  main{padding:var(--s4) max(var(--s4),env(safe-area-inset-right)) var(--s7) max(var(--s4),env(safe-area-inset-left))}}
.sub .in.more,.nav1.more{-webkit-mask-image:linear-gradient(90deg,#000 84%,transparent);mask-image:linear-gradient(90deg,#000 84%,transparent)}
/* 批 2 审查 R9：手机横屏（矮屏）两层菜单收紧，加起来 ≤ 屏幕高度 25% */
@media (max-height:500px){.top{height:40px;padding:0 var(--s3);gap:var(--s2)}.brand,.nav1 .grp-l,.top #nav,.top #extnav{display:none}.nav1 a{padding:3px 10px}.top button{padding:1px 8px}
  .sub a{height:34px;padding:0 10px}}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 10px}
.chip{font:inherit;font-size:14px;padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.chip[aria-pressed="true"]{background:var(--teal-soft);border-color:var(--teal);font-weight:700}
.filters label{font-size:13px;color:var(--muted)}
select,input{font:inherit;font-size:14px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
input[aria-invalid="true"]{border-color:var(--err);background:var(--err-soft)}
.sum{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--muted);margin:0 0 10px}
.sum .sp{flex:1}
.confirm{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-radius:10px;background:var(--err-soft);color:var(--err);margin:0 0 10px;font-size:14px}
.toast{margin:0 0 12px;padding:8px 12px;border-radius:8px;font-size:14px;background:var(--teal-soft)}.toast.err{background:var(--err-soft);color:var(--err)}
.item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);margin-bottom:10px}
@media (max-width:600px){.item{grid-template-columns:minmax(0,1fr)}.acts{flex-direction:row!important;flex-wrap:wrap}.acts>*{flex:1 1 calc(50% - 6px)}}
.who{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center}.who a{color:inherit}
.tag{font-size:12px;font-weight:700;border-radius:6px;padding:0 7px;border:1px solid var(--line);color:var(--ink)}
.tag.prod{background:var(--teal-soft);border-color:transparent}.tag.threads{color:var(--th);border-color:var(--th)}
.score{font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.times{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:2px}
.stale{color:var(--amber);font-weight:700}
.post{margin:6px 0 0;overflow-wrap:anywhere}
.why{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--bg);font-size:13px}.why b{display:block;font-size:12px;color:var(--muted)}.why ul{margin:0;padding-left:18px}
.draft{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--teal-soft);overflow-wrap:anywhere;white-space:pre-wrap}
.src{font-size:12px;color:var(--muted);margin-top:4px;white-space:normal}
.acts{display:flex;flex-direction:column;gap:6px;min-width:132px}
.btn{font:inherit;font-size:14px;font-weight:700;border-radius:10px;padding:9px 12px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);text-align:center;text-decoration:none}
.btn.primary{background:var(--teal);border-color:var(--teal);color:#0F1B33}.btn.danger{color:var(--err);border-color:var(--err)}.btn.small{font-size:13px;padding:5px 10px}
.btn[aria-disabled="true"],.btn:disabled{opacity:.5;pointer-events:none}
.steps{margin:6px 0 14px;padding-left:22px;line-height:1.7}.steps li{margin:2px 0}code{font-size:.92em;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:0 4px;word-break:break-all}
.btn:focus-visible,.chip:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.empty{padding:32px 12px;text-align:center;color:var(--muted)}
.login{max-width:360px;margin:12vh auto 0;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px;display:grid;gap:10px}
.login input{padding:10px 12px;background:var(--bg)}
.l-fail{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:8px;background:var(--err-soft);color:var(--err);font-size:var(--fs-aux)}.l-fail span{flex:1 1 12em}
.msg{margin:0;font-size:14px;color:var(--err)}.msg:empty{display:none}.msg.ok{color:var(--ok)}
/* 用量监控：Cloudflare 自己说"账号额度用完了"那条红字（置顶、到下一个 UTC 日自动不显示）和"这个数靠不靠得住"的说明 */
.acct{margin:0 0 10px;padding:12px 14px;border-radius:10px;background:var(--err-soft);color:var(--err);border:1px solid var(--err);font-size:14px;font-weight:700;line-height:1.6}
.acct .raw{display:block;margin-top:4px;font-weight:400;font-size:12px;opacity:.85;overflow-wrap:anywhere}
.caveat{margin:0 0 8px;padding:10px 12px;border-radius:8px;background:var(--amber-soft);color:var(--amber);font-size:13px;line-height:1.7}
.caveat b{display:block;margin-bottom:2px}
td .flag{display:block;font-size:12px;font-weight:400;color:var(--amber)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow);overflow:hidden}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600}td.n{text-align:right}
.meter{display:inline-block;width:70px;height:6px;border-radius:3px;background:var(--line);vertical-align:middle;position:relative;overflow:hidden}.meter i{position:absolute;inset:0 auto 0 0;background:var(--teal)}
.state{font-size:12px;font-weight:700;border-radius:99px;padding:2px 8px;background:var(--teal-soft)}.state.warn{background:var(--amber-soft);color:var(--amber)}
.cap-in{width:90px}
.pad{padding:14px;display:grid;gap:10px}.hint{font-size:13px;color:var(--muted);margin:0}
/* 公司总览（界面改版·批 C，2026-11-05）：并进工作台 / 项目页 / 公共工具同一套卡片模块（:is(...,#v-company) 那几条），这里只留公司总览自己的几样：
   超过 7 天没更新的整块 / 整行变灰、解析失败的红条、岗位学习的列表 */
#v-company .old{filter:grayscale(1);opacity:.62}#v-company .old .stamp,#v-company .old .aux{color:var(--stale)}
#v-company .co-err{margin:var(--s3) var(--s5) 0;padding:var(--s2) var(--s3);border-radius:10px;font-size:var(--fs-aux);color:var(--err);background:var(--err-soft)}
#v-company .list{list-style:none;margin:0;padding:0}
#v-company .list li{display:grid;grid-template-columns:72px minmax(0,1fr);gap:var(--s1) var(--s3);padding:var(--s3) var(--s5);border-top:1px solid var(--line);align-items:baseline}#v-company .list li:first-child{border-top:0}
#v-company .list .who{font-size:var(--fs-aux);color:var(--muted)}#v-company .list .what{min-width:0;overflow-wrap:anywhere}#v-company .list a{color:var(--ink)}
#co-body{gap:var(--s6)}#v-company .crumb .sp{flex:1}#v-company #co-at{font-size:var(--fs-aux);color:var(--muted)}
#v-company table{font-size:var(--fs-body)}#v-company table td.num{white-space:nowrap}#v-company table :is(th,td):first-child{padding-left:var(--s5)}#v-company table :is(th,td):last-child{padding-right:var(--s5)}
@media (max-width:640px){#co-body{gap:var(--s5)}#v-company table.stack td{padding-left:var(--s4);padding-right:var(--s4)}#v-company .co-err{margin:var(--s3) var(--s4) 0}#v-company .list li{padding:var(--s3) var(--s4);grid-template-columns:minmax(0,1fr)}}
/* 工作台、项目页（工作平台批 1，原型 v2）：样式都限定在 .plat 里，不影响清单、用量、插件下载和"公司总览" */
.plat .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow);min-width:0;overflow:hidden}
.plat .card>h2{font-size:var(--fs-mod);margin:0;padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.plat .card>h2 .sp{flex:1}.plat .stamp{font-size:var(--fs-aux);color:var(--muted);font-weight:400}
.plat .pd{padding:12px 16px}.plat .hint{font-size:12px}
.plat .foot-note{padding:8px 16px;border-top:1px solid var(--line)}
.plat .pill{display:inline-block;font-size:12px;border-radius:99px;padding:1px 8px;white-space:nowrap;line-height:1.6}
.plat .p-ok{background:var(--ok-soft);color:var(--ok)}.plat .p-warn{background:var(--amber-soft);color:var(--amber)}.plat .p-err{background:var(--err-soft);color:var(--err)}.plat .p-mute{background:var(--bg);color:var(--muted);border:1px solid var(--line)}.plat .p-teal{background:var(--teal-soft);color:var(--ink)}
.plat .btn{font-size:14px;padding:8px 14px;white-space:nowrap;display:inline-block;line-height:1.4}.plat .btn.small{font-size:13px;padding:4px 10px;border-radius:8px}.plat .btn.big{font-size:17px;padding:12px 22px;border-radius:12px}
.plat .warnbar{margin:0;padding:8px 12px;font-size:var(--fs-aux);border-radius:10px;background:var(--amber-soft);color:var(--amber)}
/* 待办一行（工作台、项目页共用 todoLi）：左边打勾圆圈 → 标题 + 一行辅助（还剩多久 · 截止 · 项目）→ 右边一个主按钮；超时 / 24 小时内左边一条色条 */
.plat .todos{list-style:none;margin:0;padding:0}
.plat .todo{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--s3) var(--s4);align-items:center;padding:var(--s4) var(--s5);border-top:1px solid var(--line);position:relative}
.plat .todo::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:transparent}
.plat .todo.over::before{background:var(--err)}.plat .todo.soon::before{background:var(--amber)}
#v-project .todos>.todo:first-child{border-top:0}
.plat .tick{width:24px;height:24px;border-radius:50%;border:2px solid var(--line);background:var(--surface);cursor:pointer;padding:0;display:grid;place-items:center;color:transparent;font-size:13px;font-weight:700;align-self:start;margin-top:1px}
.plat .tick:hover{border-color:var(--teal);color:var(--teal)}.plat .tick:disabled{background:var(--ok);border-color:var(--ok);color:#fff}
.plat .tick:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.plat .todo .body{min-width:0;display:grid;gap:2px}
.plat .todo .ttl{margin:0;font-weight:600;font-size:var(--fs-body);line-height:1.45;overflow-wrap:anywhere}
.plat .todo .due{display:flex;gap:var(--s1) var(--s3);flex-wrap:wrap;align-items:center;font-size:var(--fs-aux);color:var(--muted)}
.plat .todo .why{margin:0;padding:0;background:none;font-size:var(--fs-aux);color:var(--muted);overflow-wrap:anywhere}
.plat .todo .go{align-self:center}
.plat .form{display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center;margin-top:6px}
.plat .form label{font-size:var(--fs-aux);color:var(--muted);display:inline-flex;gap:4px;align-items:center}.plat .form input{width:84px}.plat .form .msg{width:100%}
/* 还剩多久：文字着色（红 = 已超时、橙 = 24 小时内），不再是描边的胶囊 */
.plat .badge{font-size:var(--fs-aux);font-weight:700;white-space:nowrap}
.plat .b-over{color:var(--err)}.plat .b-soon{color:var(--amber)}.plat .b-later{color:var(--ink-2)}.plat .b-none{color:var(--muted);font-weight:400}
/* 项目标签一律中性灰（颜色只表示状态） */
.plat .ptag{font-size:12px;border-radius:6px;padding:1px 8px;background:var(--gray-soft);color:var(--ink-2);white-space:nowrap}
/* ===== 工作台（批 A）：每个模块固定结构 = 标题行（标题 + 数量角标 + 右侧辅助）→ 一句话结论 .lead → 主内容 → 底部折叠"说明和更多" ===== */
#v-work,#v-project,#v-tools,#v-company{gap:var(--s6)}
:is(#v-work,#v-project,#v-tools,#v-company) .mh{display:flex;align-items:center;gap:var(--s2) var(--s3);flex-wrap:wrap;padding:var(--s5) var(--s5) 0;margin:0;font-size:inherit}
:is(#v-work,#v-project,#v-tools,#v-company) .mh h2{font-size:var(--fs-mod);line-height:1.35;margin:0;display:flex;align-items:center;gap:var(--s2)}
:is(#v-work,#v-project,#v-tools,#v-company) .mh .sp{flex:1}:is(#v-work,#v-project,#v-tools,#v-company) .mh .aux{font-size:var(--fs-aux);color:var(--muted)}
:is(#v-work,#v-project,#v-tools,#v-company) .cbadge{font-size:12px;font-weight:700;min-width:22px;height:22px;padding:0 7px;border-radius:99px;display:inline-grid;place-items:center;background:var(--gray-soft);color:var(--ink-2)}
:is(#v-work,#v-project,#v-tools,#v-company) .cbadge.red{background:var(--err-soft);color:var(--err)}
:is(#v-work,#v-project,#v-tools,#v-company) .lead{margin:var(--s2) var(--s5) 0;font-size:var(--fs-body);font-weight:600;color:var(--ink);line-height:1.6;overflow-wrap:anywhere}
:is(#v-work,#v-project,#v-tools,#v-company) .lead .soft{font-weight:400;color:var(--muted);margin-left:6px}
:is(#v-work,#v-project,#v-tools,#v-company) .dot{display:inline-block;width:8px;height:8px;border-radius:50%;vertical-align:middle;margin:-2px 8px 0 0;background:var(--stale)}
:is(#v-work,#v-project,#v-tools,#v-company) .dot.red{background:var(--err)}:is(#v-work,#v-project,#v-tools,#v-company) .dot.amber{background:var(--amber)}:is(#v-work,#v-project,#v-tools,#v-company) .dot.ok{background:var(--ok)}:is(#v-work,#v-project,#v-tools,#v-company) .dot.gray{background:var(--stale)}
:is(#v-work,#v-project,#v-tools,#v-company) .mbody{padding:var(--s4) var(--s5) var(--s5)}:is(#v-work,#v-project,#v-tools,#v-company) .mbody.flush{padding:var(--s4) 0 0}
:is(#v-work,#v-project,#v-tools,#v-company) details.more{border-top:1px solid var(--line);background:var(--surface-2)}
:is(#v-work,#v-project,#v-tools,#v-company) details.more>summary,:is(#v-work,#v-project,#v-tools,#v-company) details.grp>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:var(--s2);padding:var(--s3) var(--s5);font-size:var(--fs-aux);color:var(--muted)}
:is(#v-work,#v-project,#v-tools,#v-company) details.grp>summary{font-weight:700}
:is(#v-work,#v-project,#v-tools,#v-company) details.more>summary::-webkit-details-marker,:is(#v-work,#v-project,#v-tools,#v-company) details.grp>summary::-webkit-details-marker{display:none}
:is(#v-work,#v-project,#v-tools,#v-company) details.more>summary::before,:is(#v-work,#v-project,#v-tools,#v-company) details.grp>summary::before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s;flex:0 0 auto}
:is(#v-work,#v-project,#v-tools,#v-company) details.more[open]>summary::before,:is(#v-work,#v-project,#v-tools,#v-company) details.grp[open]>summary::before{transform:rotate(45deg)}
:is(#v-work,#v-project,#v-tools,#v-company) details.more>.in{padding:0 var(--s5) var(--s4);font-size:var(--fs-aux);color:var(--ink-2);line-height:1.75}
:is(#v-work,#v-project,#v-tools,#v-company) details.more>.in p{margin:0 0 var(--s2)}
:is(#v-work,#v-project,#v-tools,#v-company) details.grp{border-top:1px solid var(--line)}
:is(#v-work,#v-project,#v-tools,#v-company) .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 16px;font-size:14px;line-height:1.3;border-radius:var(--r-btn);white-space:nowrap}
:is(#v-work,#v-project,#v-tools,#v-company) .btn.small{min-height:32px;padding:0 12px;font-size:13px}:is(#v-work,#v-project,#v-tools,#v-company) .btn.big{min-height:50px;padding:0 26px;font-size:17px;border-radius:12px}
:is(#v-work,#v-project,#v-tools,#v-company) .btn.text{border:none;background:none;padding:0 4px;color:var(--muted);font-weight:600}:is(#v-work,#v-project,#v-tools,#v-company) .btn.text:hover{color:var(--ink)}
:is(#v-work,#v-project,#v-tools,#v-company) .btn[aria-busy="true"]{opacity:.65;pointer-events:none}
:is(#v-work,#v-project,#v-tools,#v-company) .btn.primary:hover{filter:brightness(1.05)}:is(#v-work,#v-project,#v-tools,#v-company) .btn:not(.primary):not(.text):hover{border-color:var(--muted)}
:is(#v-work,#v-project,#v-tools,#v-company) .empty{padding:var(--s6) var(--s5);text-align:center;display:grid;gap:var(--s1);justify-items:center;margin:0}
:is(#v-work,#v-project,#v-tools,#v-company) .empty b{font-size:var(--fs-body)}:is(#v-work,#v-project,#v-tools,#v-company) .empty span{font-size:var(--fs-aux);color:var(--muted)}
/* 读取中：占位骨架；读取失败：保留上次内容，上面一条红色提示 + "再读一次" */
:is(#v-work,#v-project,#v-tools,#v-company) .skel,.boot .skel{display:block;height:14px;border-radius:6px;background:linear-gradient(90deg,var(--gray-soft),var(--surface-2),var(--gray-soft));background-size:200% 100%;animation:sk 1.2s infinite linear}
:is(#v-work,#v-project,#v-tools,#v-company) .skels,.boot .skels{display:grid;gap:14px;padding:20px 24px}
@keyframes sk{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){:is(#v-work,#v-project,#v-tools,#v-company) .skel,.boot .skel{animation:none}}
:is(#v-work,#v-project,#v-tools,#v-company) .errbar{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;padding:var(--s3) var(--s4);border-radius:12px;background:var(--err-soft);color:var(--err);font-size:var(--fs-body);font-weight:600;margin:0 0 var(--s3)}
:is(#v-work,#v-project,#v-tools,#v-company) .errbar .sp{flex:1}
/* ① 最该做的事：全页唯一的深色块（深色模式用 --hero-bg 加描边） */
.plat .hero{background:var(--hero-bg);border:1px solid var(--hero-line);color:#fff;border-radius:18px;padding:var(--s6);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--s5) var(--s6);align-items:center;min-width:0}
.plat .hero .k{margin:0;font-size:var(--fs-aux);color:#9FB0CC;letter-spacing:.02em}
.plat .hero .one{margin:var(--s2) 0 var(--s3);font-size:28px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.plat .hero .when{display:flex;gap:var(--s2) var(--s3);flex-wrap:wrap;align-items:center;font-size:var(--fs-aux);color:#C3CEE0}
.plat .hero .when .badge{color:#fff;font-size:13px;border-radius:99px;padding:2px 10px;background:rgba(255,255,255,.12)}
.plat .hero .when .b-over{background:var(--err-strong)}.plat .hero .when .b-soon{background:var(--amber-strong)}
.plat .hero .ptag{background:rgba(255,255,255,.1);color:#DCE4F2}
.plat .hero .why{margin:var(--s3) 0 0;font-size:var(--fs-aux);color:#C3CEE0;overflow-wrap:anywhere;padding:0;background:none}
.plat .hero .act{display:grid;gap:var(--s3);justify-items:end}
#v-work .hero .act .btn.text{color:#9FB0CC}#v-work .hero .act .btn.text:hover{color:#fff}
.plat .hero .act .btn.ghost{background:transparent;color:#fff;border-color:#3A4A6A}
.plat .hero .next{margin:var(--s4) 0 0;font-size:var(--fs-aux);color:#9FB0CC}.plat .hero .next a{color:#DCE4F2}
.plat .hero.calm .one{font-size:24px}
.plat .hero .skel{opacity:.4}
/* 一眼三个数 */
.plat .glance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4);margin-top:var(--s4)}
.plat .gl{display:block;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:var(--s4) var(--s5);box-shadow:var(--shadow);min-width:0}
.plat a.gl:hover{border-color:var(--teal)}
.plat .gl .n{font-size:var(--fs-num);font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.plat .gl.red .n{color:var(--err)}
.plat .gl .l{font-size:var(--fs-aux);color:var(--muted);margin-top:2px}
/* ② 全部待办：按项目筛选 → 按时间段分组（已超时 / 24 小时内到期 / 之后到期 / 没定截止时间，最后一组默认折叠）→ 做完的（折叠） */
#v-work .filterbar{display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center;padding:var(--s4) var(--s5) 0}
#v-work .filterbar .chip{font-size:13px;color:var(--ink-2);padding:3px 12px;white-space:nowrap}
#v-work .filterbar .chip b{font-weight:700;margin-left:4px;color:var(--muted)}
#v-work .filterbar .chip[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink);font-weight:400}#v-work .filterbar .chip[aria-pressed="true"] b{color:inherit;opacity:.75}
#v-work .bucket{margin-top:var(--s4)}
#v-work .bucket-h{display:flex;align-items:center;gap:var(--s2);margin:0;padding:var(--s2) var(--s5);font-size:var(--fs-aux);font-weight:700;color:var(--muted)}
#v-work .bucket-h .n{font-weight:400}#v-work .bucket-h.over{color:var(--err)}#v-work .bucket-h.soon{color:var(--amber)}
#v-work details.grp.bucket{margin-top:var(--s4)}
#v-work .donelist{list-style:none;margin:0;padding:0 var(--s5) var(--s3)}
#v-work .donelist li{display:flex;gap:var(--s3);align-items:center;padding:6px 0;font-size:var(--fs-body);color:var(--muted);flex-wrap:wrap}#v-work .donelist li s{flex:1;min-width:0;overflow-wrap:anywhere}
#v-work .donelist .done-at{font-size:var(--fs-aux)}
/* ③ 团队在做什么 */
:is(#v-work,#v-project,#v-tools,#v-company) .seg{display:inline-flex;background:var(--gray-soft);border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
:is(#v-work,#v-project,#v-tools,#v-company) .seg button{font:inherit;font-size:13px;border:0;background:none;color:var(--muted);padding:4px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}
:is(#v-work,#v-project,#v-tools,#v-company) .seg button[aria-pressed="true"]{background:var(--surface);color:var(--ink);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.08)}
:is(#v-work,#v-project,#v-tools,#v-company) .seg button:focus-visible{outline:2px solid var(--amber);outline-offset:1px}
#v-work .live-warn{padding:var(--s3) var(--s5) 0;border:0}
#v-work #w-live .grp{padding:var(--s2) var(--s5);background:none;border:0;border-top:1px solid var(--line);font-size:var(--fs-aux)}
#v-work #w-live .act-item{padding:var(--s3) var(--s5);border-bottom:0;border-top:1px solid var(--line)}
#v-work #w-live .grp+.act-item{border-top:0}
#v-work #recent-body .act-item{padding:var(--s3) 0}
/* ④ 项目概况：每个项目一张卡 + 进度条 */
#v-work .projs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:var(--s4)}
#v-work .projcard{border:1px solid var(--line);border-radius:12px;padding:var(--s4) var(--s5);display:grid;gap:var(--s3);background:var(--surface);min-width:0;align-content:start}
#v-work .projcard .hd{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap}
#v-work .projcard .hd b{font-size:17px}#v-work .projcard .hd a{color:inherit;text-decoration:none}#v-work .projcard .hd a:hover{text-decoration:underline}
#v-work .projcard .stage{font-size:12px;border-radius:99px;padding:1px 9px;background:var(--gray-soft);color:var(--ink-2)}
#v-work .projcard .wk{margin:0;font-size:var(--fs-body);color:var(--ink-2);overflow-wrap:anywhere}
#v-work .metric{display:grid;gap:4px}
#v-work .metric .r{display:flex;justify-content:space-between;gap:var(--s3);font-size:var(--fs-aux);color:var(--muted);flex-wrap:wrap}
#v-work .metric .r>span:last-child{text-align:right}#v-work .metric .r b{font-size:15px;color:var(--ink)}
#v-work .metric .new{font-size:12px;color:var(--muted)}
#v-work .projcard .ft{display:flex;align-items:center;gap:var(--s3);justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:var(--s3)}
#v-work .wait{font-size:var(--fs-aux);font-weight:700;color:var(--amber)}#v-work .wait.none{color:var(--muted);font-weight:400}
.plat .meter{height:6px;border-radius:99px;background:var(--gray-soft);overflow:hidden;display:block;width:auto}.plat .meter i{display:block;height:100%;border-radius:99px;background:var(--teal)}
.plat .meter.warn i{background:var(--amber)}.plat .meter.bad i{background:var(--err)}
/* ⑤ 公司数字：数字块 */
#v-work .tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4)}
#v-work .tile{border:1px solid var(--line);border-radius:12px;padding:var(--s4) var(--s5);min-width:0}
#v-work .tile .n{font-size:var(--fs-num);font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}#v-work .tile .n small{font-size:15px;font-weight:600;color:var(--muted);margin-left:3px}
#v-work .tile .n.amber{color:var(--amber)}#v-work .tile .n.mute{color:var(--muted);font-size:var(--fs-body);line-height:2.3}#v-work .tile .n.txt{font-size:var(--fs-body);line-height:2.3}
#v-work .tile .l{font-size:var(--fs-aux);color:var(--muted);margin-top:2px;display:flex;justify-content:space-between;align-items:center;gap:var(--s2);flex-wrap:wrap}
/* ⑥ 经营会 */
#v-work .meet{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s5);align-items:center}
#v-work .date{width:84px;border-radius:12px;overflow:hidden;border:1px solid var(--line);text-align:center}
#v-work .date .mo{background:var(--err-strong);color:#fff;font-size:12px;font-weight:700;padding:2px 0}
#v-work .date .d{font-size:var(--fs-num);font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums}#v-work .date .w{font-size:12px;color:var(--muted);padding-bottom:6px}
#v-work .checks{list-style:none;margin:0;padding:0;display:grid;gap:var(--s2)}
#v-work .checks li{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;font-size:var(--fs-body)}
#v-work .checks .ic{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;flex:0 0 auto}
#v-work .checks .ic.ok{background:var(--ok-soft);color:var(--ok)}#v-work .checks .ic.warn{background:var(--amber-soft);color:var(--amber)}#v-work .checks .ic.wait{background:var(--gray-soft);color:var(--muted)}
#v-work .meet .links{display:flex;gap:var(--s2);flex-wrap:wrap;margin-top:var(--s3)}
@media (max-width:900px){.plat .hero{grid-template-columns:minmax(0,1fr)}.plat .hero .act{justify-items:stretch}.plat .hero .act .btn.big{width:100%}}
@media (max-width:640px){
  #v-work,#v-project,#v-tools,#v-company{gap:var(--s5)}
  :is(#v-work,#v-project,#v-tools,#v-company) .mh{padding:var(--s4) var(--s4) 0}:is(#v-work,#v-project,#v-tools,#v-company) .lead{margin:var(--s2) var(--s4) 0}:is(#v-work,#v-project,#v-tools,#v-company) .mbody{padding:var(--s3) var(--s4) var(--s4)}
  :is(#v-work,#v-project,#v-tools,#v-company) details.more>summary,:is(#v-work,#v-project,#v-tools,#v-company) details.grp>summary{padding:var(--s3) var(--s4)}:is(#v-work,#v-project,#v-tools,#v-company) details.more>.in{padding:0 var(--s4) var(--s4)}
  .plat .hero{padding:var(--s5) var(--s4);border-radius:16px}.plat .hero .one{font-size:22px}
  .plat .glance{gap:var(--s2)}.plat .gl{padding:var(--s3)}.plat .gl .n{font-size:24px}.plat .gl .l{font-size:12px;line-height:1.4}
  #v-work .filterbar{padding:var(--s3) var(--s4) 0}#v-work .bucket-h{padding-left:var(--s4);padding-right:var(--s4)}
  .plat .todo{grid-template-columns:auto minmax(0,1fr);padding:var(--s3) var(--s4)}.plat .todo .go{grid-column:2;justify-self:start;align-self:start}.plat .todo .go .btn{white-space:normal}
  #v-work .live-warn{padding:var(--s3) var(--s4) 0}#v-work #w-live .grp,#v-work #w-live .act-item{padding-left:var(--s4);padding-right:var(--s4)}
  #v-work .tiles{grid-template-columns:1fr 1fr}#v-work .tiles .tile:last-child:nth-child(odd){grid-column:1/-1}
  #v-work .meet{grid-template-columns:minmax(0,1fr)}#v-work .date{width:auto;display:flex;align-items:center;gap:12px;padding:8px 12px;text-align:left}#v-work .date .mo{border-radius:6px;padding:2px 8px}#v-work .date .d{font-size:22px}#v-work .date .w{padding:0}
  #v-work .donelist{padding:0 var(--s4) var(--s3)}
}
/* ===== 界面改版·批 B（2026-11-04，原型 prototype-tools.html；Amos"好很多了，改吧"）：项目页、公共工具也用批 A 的卡片模块
   （标题行 header.mh → .lead → 主内容 → 最后一块 details.more，样式就是上面 :is(#v-work,#v-project,#v-tools,#v-company) 那几条） ===== */
#v-project details.grp{display:block;padding:0;background:none;border-bottom:0;font-size:inherit;font-weight:400;color:inherit}
#v-project .todos>.todo:first-child,#t-queue #list>.item:first-child{border-top:0}
#v-project .mbody.flush,#v-tools .mbody.flush{padding:var(--s3) 0 0}
#v-project .live-warn{padding:var(--s3) var(--s5) 0;border:0}
#v-project #f-live-body .act-item{padding:var(--s3) var(--s5);border-bottom:0;border-top:1px solid var(--line)}#v-project #f-live-body>.act-item:first-child{border-top:0}
#v-project .hand li{padding:var(--s3) var(--s5);border-bottom:0;border-top:1px solid var(--line)}#v-project .hand li:first-child{border-top:0}
#v-project .donelist{padding:0 var(--s5) var(--s3)}#v-project .donelist li{padding:6px 0}
#v-project .progress,#v-project .bar-row{padding-left:var(--s5);padding-right:var(--s5)}#v-project .step{padding:var(--s4) var(--s5)}
#v-project .todo .go .btn:not(.primary){font-weight:600}
/* 本周帖子 / 焦点战：并排的两张卡等高（grid 默认拉伸），卡里竖排，底部折叠说明用 margin-top:auto 压到底，两张的底边和折叠对齐；手机上自动上下排 */
#v-project .two{gap:var(--s5)}#v-project .two>.card{display:flex;flex-direction:column}#v-project .two>.card>details.more{margin-top:auto}
#v-project .two>.card>.mbody{flex:0 0 auto}
#v-project .toolcard h3{font-size:var(--fs-body)}
/* 批 C：本周帖子 / 焦点战在手机上（≤640px）是列表，每条一行（以前是表格拆成"第几条：/ 写的什么：/ 几点发：/ 最晚："四行一组）。
   帖子：序号 · 写的什么 · 几点发，下面一行小字是最晚（表头才有"最晚"两个字）；焦点战：联赛 · 对阵 · 开赛。标题放不下时省略号，全文在 1280 宽的表格里。1280 宽仍是表格、两张卡并排等高 */
@media (max-width:640px){
  #v-project table.plist tr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;gap:0 var(--s3);padding:var(--s2) var(--s4);border-bottom:1px solid var(--line);line-height:1.45}
  #v-project table.plist tr:last-child{border-bottom:0}
  #v-project table.plist td{display:block;padding:0;border:0;min-width:0}
  #v-project table.plist td[data-label]::before{content:none}
  #v-project table.plist td:nth-child(2){font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #v-project table.plist td:nth-child(2) .hint{font-weight:400}
  #v-project table.plist td:nth-child(n+3){font-size:var(--fs-aux);color:var(--muted);white-space:nowrap;text-align:right}
  #v-project table.posts td:first-child{font-weight:700;color:var(--muted);font-family:inherit}
  #v-project table.posts td:first-child::after{content:"."}
  #v-project table.posts td:nth-child(4){grid-column:2/-1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
  #v-project table.matches td:first-child{font-size:12px;border-radius:6px;padding:0 8px;background:var(--gray-soft);color:var(--ink-2);white-space:nowrap}
}
/* 批 B：字号收进阶梯（原来 14px 的表格、做完的、进度、步骤编号、提示），深色下步骤编号做完后的绿底用深色字（白字压亮绿 1.74:1 不够） */
#v-project table{font-size:var(--fs-body)}#v-project .donelist li{font-size:var(--fs-body)}#v-project .progress{font-size:var(--fs-aux)}
#v-project .step .no{font-size:var(--fs-aux)}#v-project .step.done .no{color:var(--bg)}
:is(#v-project,#v-tools) .msg{font-size:var(--fs-aux)}
#v-tools code{font-size:var(--fs-aux)}
#tts-more:not([open]) #t-voice{display:none}
/* 公共工具 */
#v-tools .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow);min-width:0;overflow:hidden}
#v-tools .card .card{box-shadow:none}
#v-tools .capline{display:grid;gap:6px;min-width:200px}#v-tools .capline .r{display:flex;justify-content:space-between;gap:var(--s3);font-size:var(--fs-aux);color:var(--muted)}
#v-tools .meter{display:block;width:auto;height:6px;border-radius:99px;background:var(--gray-soft);position:relative;overflow:hidden}#v-tools .meter i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:var(--teal)}
#v-tools .meter.warn i{background:var(--amber)}#v-tools .meter.bad i{background:var(--err)}
#v-tools td .meter{display:inline-block;width:70px;vertical-align:middle}
#v-tools .toolbar{display:flex;gap:var(--s3);flex-wrap:wrap;align-items:center;padding:var(--s4) var(--s5) 0}
#v-tools .toolbar .sp{flex:1}
#v-tools details.qf{flex:1 1 100%}
#v-tools details.qf>summary{display:inline-flex;align-items:center;gap:var(--s2);list-style:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--ink-2);border:1px solid var(--line);border-radius:var(--r-btn);padding:5px 12px;background:var(--surface);max-width:100%;overflow-wrap:anywhere}
#v-tools details.qf>summary::-webkit-details-marker{display:none}
#v-tools details.qf>summary::after{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin:-3px 0 0 2px;transition:transform .15s;flex:0 0 auto}
#v-tools details.qf[open]>summary::after{transform:rotate(-135deg);margin-top:3px}
#v-tools details.qf>summary:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
#v-tools details.qf .filters{margin:var(--s3) 0 0}
#v-tools .sum{padding:var(--s3) var(--s5) 0;margin:0}
#v-tools #t-queue .confirm#bulk-confirm,#v-tools #t-queue .toast#toast{margin:var(--s3) var(--s5) 0}
#t-queue #list{margin-top:var(--s3)}
#t-queue .item{border:0;border-top:1px solid var(--line);border-radius:0;margin:0;padding:var(--s4) var(--s5);background:none}
#t-queue .draft{background:var(--surface-2);border:1px solid var(--line);border-left:3px solid var(--teal)}
#t-queue .draft .k{display:block;font-size:var(--fs-aux);font-weight:700;color:var(--teal-ink);white-space:normal}
#t-queue .why{background:var(--surface-2)}
#t-queue .tag.prod{background:var(--gray-soft);color:var(--ink-2);border-color:transparent}
#t-queue .acts .btn.text{min-height:32px;font-size:13px}#t-queue .acts .btn.text.danger{color:var(--err)}
#t-queue .acts .confirm{flex-direction:column;align-items:stretch;padding:var(--s2)}
#v-tools .tablewrap.boxed{border:1px solid var(--line);border-radius:12px}
#v-tools .tablewrap th{background:var(--surface-2)}
#v-tools .save-row{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;margin-top:var(--s4)}
#v-tools .save-row .msg{margin:0}
#v-tools details.grp.box{margin-top:var(--s4);border:1px solid var(--line);border-radius:12px}#v-tools details.grp.box>.in{padding:0 var(--s4) var(--s4)}
#v-tools .ext{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--s4) var(--s5);align-items:center}
#v-tools .ext .ver{font-size:var(--fs-num);font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
#v-tools .row2{display:grid;grid-template-columns:1fr 1fr;gap:var(--s5);margin-top:var(--s5)}
#v-tools .row2 .steps{margin:var(--s2) 0 0}
#v-tools .switch{display:inline-flex;align-items:center;gap:var(--s2);font:inherit;font-size:14px;font-weight:700;cursor:pointer;border:0;background:none;color:var(--ink);padding:4px 0}
#v-tools .switch i{width:40px;height:24px;border-radius:99px;background:var(--teal);position:relative;display:block;flex:0 0 auto;transition:background .15s}
#v-tools .switch i::after{content:"";position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2)}
#v-tools .switch[aria-pressed="false"] i{background:var(--line)}#v-tools .switch[aria-pressed="false"] i::after{right:auto;left:3px}
#v-tools .switch:disabled{opacity:.6;cursor:default}#v-tools .switch:focus-visible{outline:2px solid var(--amber);outline-offset:3px;border-radius:99px}
#v-tools .hint{font-size:var(--fs-aux)}
#t-voice{scroll-margin-top:calc(var(--bars-h,98px) + var(--s4));margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--line)}
#t-voice h3{margin:0 0 var(--s2);font-size:var(--fs-body)}
@media (max-width:640px){
  #v-project .live-warn{padding:var(--s3) var(--s4) 0}#v-project #f-live-body .act-item,#v-project .hand li{padding-left:var(--s4);padding-right:var(--s4)}
  #v-project .donelist{padding:0 var(--s4) var(--s3)}#v-project .progress,#v-project .bar-row{padding-left:var(--s4);padding-right:var(--s4)}#v-project .step{padding:var(--s3) var(--s4)}
  #v-tools .toolbar{padding:var(--s3) var(--s4) 0}#v-tools .sum{padding:var(--s3) var(--s4) 0}#v-tools #t-queue .confirm#bulk-confirm,#v-tools #t-queue .toast#toast{margin:var(--s3) var(--s4) 0}
  #t-queue .item{padding:var(--s4)}#t-queue .acts .btn.primary{flex-basis:100%}#t-queue .acts .btn.text{flex:0 0 auto;padding:0 10px}
  #v-tools .mh .capline{width:100%}
  #v-tools .ext{grid-template-columns:minmax(0,1fr)}#v-tools .ext .btn{width:100%}
  #v-tools .row2{grid-template-columns:minmax(0,1fr)}
  #v-tools .capline{min-width:0}
}
.plat details.fold>summary{cursor:pointer;padding:10px 16px;font-size:14px;font-weight:700;list-style:none;display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);color:var(--muted)}
.plat details.fold>summary::-webkit-details-marker{display:none}.plat details.fold>summary::before{content:"▸"}.plat details.fold[open]>summary::before{content:"▾"}
.plat .donelist{list-style:none;margin:0;padding:0 0 6px}
.plat .donelist li{display:flex;gap:10px;align-items:center;padding:6px 16px;font-size:14px;color:var(--muted);flex-wrap:wrap}.plat .donelist li s{flex:1;min-width:0;overflow-wrap:anywhere}
.plat .empty{padding:24px 16px;text-align:center;margin:0;display:grid;gap:6px;justify-items:center;color:var(--ink)}.plat .empty span{color:var(--muted);font-size:var(--fs-aux)}
.plat .gsteps{list-style:none;margin:0;padding:0}
.plat .step{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 14px;padding:14px 16px;border-bottom:1px solid var(--line);align-items:start}
.plat .step:last-child{border-bottom:0}
.plat .step .no{width:32px;height:32px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px}
.plat .step.done .no{background:var(--ok)}.plat .step.done .st{color:var(--muted);text-decoration:line-through}.plat .step.cur{background:var(--teal-soft)}
.plat .step .st{font-weight:700;overflow-wrap:anywhere}
.plat .step .acts{display:flex;flex-direction:column;gap:6px;align-items:stretch;min-width:0}
.plat .step label.ck{display:inline-flex;gap:6px;align-items:center;font-size:13px;cursor:pointer;white-space:nowrap;justify-content:center;border:1px solid var(--line);border-radius:8px;padding:4px 10px;background:var(--surface)}
.plat .step label.ck input{width:18px;height:18px;margin:0;accent-color:var(--ok)}
.plat .progress{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);font-size:14px;flex-wrap:wrap}
.plat .progress .meter{flex:1;max-width:none;min-width:80px;margin:0}
.plat .bar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);font-size:13px}
.plat textarea{width:100%;min-height:120px;font:13px/1.5 var(--mono);border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);padding:8px}
.plat table{table-layout:fixed;font-size:14px;font-variant-numeric:normal}
.plat th,.plat td{white-space:normal;vertical-align:top;overflow-wrap:anywhere;word-break:normal;padding:8px 10px}.plat th{font-weight:500}.plat tr:last-child td{border-bottom:0}
.plat td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.plat .m{margin:0 0 4px;line-height:1.45}.plat .m:last-child{margin:0}.plat .m .v{font-weight:700}.plat .m .to{color:var(--muted)}
.plat .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:18px}
.plat .toolcard{border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:grid;gap:8px;min-width:0}
.plat .toolcard h3{margin:0;font-size:15px}.plat .toolcard .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.plat .ul{margin:0;padding-left:20px}.plat .ul li{margin:3px 0}
.plat .hand{list-style:none;margin:0;padding:0}.plat .hand li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:12px 16px;border-bottom:1px solid var(--line)}.plat .hand li:last-child{border-bottom:0}
.plat .foot{font-size:12px;color:var(--muted);text-align:center;margin:0}
.plat .detail{margin-top:8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);display:grid;gap:8px;min-width:0;justify-items:start}
.plat .detail-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-body);line-height:1.6;width:100%}
.plat .detail-text.fold{max-height:12.8em;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,#000 75%,transparent);mask-image:linear-gradient(180deg,#000 75%,transparent)}
.plat .detail .qs{margin:0;padding-left:20px;display:grid;gap:4px;width:100%}.plat .detail .qs li{overflow-wrap:anywhere}
.plat .todo .go a.gh{font-size:var(--fs-aux);color:var(--ink)}
.plat .detail .cutnote{margin:0;font-size:13px;color:var(--amber)}.plat .detail a.gh{font-size:13px;color:var(--muted)}
#t-reply .cap-in{width:70px}
#p-toast{position:fixed;left:16px;right:16px;bottom:20px;margin:0 auto;max-width:480px;background:var(--navy);color:#fff;padding:12px 16px;border-radius:12px;font-size:14px;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;justify-content:center}
#p-toast:not([hidden])>span{flex:1}#p-toast button{font:inherit;font-size:14px;font-weight:700;color:#5EEAD4;background:none;border:0;cursor:pointer;padding:0}
@media (prefers-color-scheme: dark){#p-toast{background:#22314F}}
#p-toast.err{background:var(--err)}
@media (max-width:640px){
  .plat .step{grid-template-columns:auto minmax(0,1fr);padding:12px}.plat .step .acts{grid-column:2}.plat .step .btn{white-space:normal}
  .plat .hand li{grid-template-columns:minmax(0,1fr)}
  .plat table.stack{table-layout:auto}.plat table.stack colgroup{display:none}
  .plat table.stack thead{display:none}.plat table.stack tr{display:block;padding:8px 6px;border-bottom:1px solid var(--line)}.plat table.stack tr:last-child{border-bottom:0}
  .plat table.stack td{display:block;border:0;padding:2px 10px;text-align:left}.plat table.stack td.num{white-space:normal}
  .plat table.stack td[data-label]::before{content:attr(data-label) "：";color:var(--muted);font-size:12px;font-family:inherit}
}
/* 团队在做什么（工作平台批 3，原型 v2）：每条一个 仓库 + 分支；变灰 .old、CI 红 .red；外部人的标"外部" */
.plat .alert{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-radius:12px;background:var(--err-soft);color:var(--err);border:1px solid var(--err);font-size:var(--fs-body);margin-bottom:12px}.plat .alert .sp{flex:1}
.plat .live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.plat .live-dot.lag{background:var(--amber);box-shadow:0 0 0 3px var(--amber-soft)}.plat .live-dot.fail{background:var(--err);box-shadow:0 0 0 3px var(--err-soft)}.plat .live-dot.off{background:var(--stale);box-shadow:none}
.plat .grp{padding:6px 16px;background:var(--bg);font-size:12px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center}
.plat .live-warn{display:grid;gap:6px;padding:10px 16px;border-bottom:1px solid var(--line)}.plat .live-warn:empty{display:none}
.act-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:10px 16px;border-bottom:1px solid var(--line);min-width:0}
.act-item:last-child{border-bottom:0}
.act-item .bd{min-width:0;display:grid;gap:2px}
.act-item .tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px}
.act-item .ttl{font-weight:700;overflow-wrap:anywhere}
.act-item .br{font-size:var(--fs-aux);color:var(--muted);overflow-wrap:anywhere}.act-item .br code{font-size:11px;font-family:var(--mono)}
.act-item .stp{font-size:var(--fs-aux);overflow-wrap:anywhere}.act-item .ago{color:var(--muted);white-space:nowrap}
.act-item .go{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.act-item .note{font-size:12px;color:var(--stale)}
.act-item.old{background:repeating-linear-gradient(135deg,transparent 0 10px,rgba(138,148,166,.07) 10px 20px)}
.act-item.old .ttl,.act-item.old .stp{color:var(--stale)}
.act-item.red{box-shadow:inset 4px 0 0 var(--err)}
.act-item .role{font-size:12px;font-weight:700;border-radius:6px;padding:1px 8px;background:var(--gray-soft);color:var(--ink);white-space:nowrap}
.act-item .role.none{background:transparent;color:var(--stale);border:1px dashed var(--stale);font-weight:500}.act-item .role.ext{background:var(--amber-soft);color:var(--amber)}
/* 项目标签一律中性灰（批 A：颜色只表示状态） */
.act-item .proj{font-size:12px;border-radius:6px;padding:1px 8px;background:var(--gray-soft);color:var(--ink-2);white-space:nowrap}
.plat details.recent>summary{border-top:1px solid var(--line)}
@media (max-width:600px){.act-item{grid-template-columns:minmax(0,1fr)}.act-item .go{flex-direction:row;flex-wrap:wrap;align-items:flex-start}}
/* 收编进来的工具的样式：素材生成器（选择器都带 .ag）、语音生成（都带 .tv）、语音对话实测（都带 .vc），不串到别的模块 */
${ASSETS_CSS}${TTS_CSS}${VOICE_CSS}${ENGLISH_CSS}${EM_CSS}
</style></head><body>
<div class="bars" id="bars"><header class="top" id="top"><span class="logo" aria-hidden="true"><i style="height:16px;background:#2DD4BF"></i><i style="height:10px;background:#FBBF24"></i></span><span class="brand">工作平台</span><b class="sr" id="title">工作台</b>
  <nav class="nav1" id="nav1" aria-label="一级菜单" hidden><a href="#/work" data-p="work">工作台<span class="cnt" id="c-work" hidden></span></a><span class="sep" id="nav1-sep0" aria-hidden="true" hidden></span><span class="grp-l" id="nav1-grp" hidden>项目</span><span class="sep" id="nav1-sep" aria-hidden="true"></span><a href="#/tools" data-p="tools" id="nav1-tools">公共工具</a></nav>
  <span class="sp"></span><button id="nav" hidden>用量和限额 →</button><button id="extnav" hidden>插件下载</button><details class="more-menu" id="more-menu" hidden><summary aria-label="更多：公司总览、登出">···</summary><span class="tacts" id="tacts"><button id="conav" hidden>公司总览</button><button id="logout" hidden>登出</button></span></details></header>
<div id="subs" hidden>
<nav class="sub" id="sub-work" aria-label="工作台模块" hidden><div class="in">
  <a href="#/work/now" data-s="w-now">最该做的事</a><a href="#/work/todo" data-s="w-todo">全部待办<span class="n red" id="s-todo" hidden></span></a><a href="#/work/live" data-s="w-live">团队在做什么</a><a href="#/work/proj" data-s="w-proj">项目概况</a><a href="#/work/num" data-s="w-num">公司数字</a><a href="#/work/meet" data-s="w-meet">经营会</a><a href="#/work/english" data-s="w-english">英语练习</a>
</div></nav>
<nav class="sub" id="sub-project" aria-label="项目模块" hidden><div class="in">
  <a href="#/forecast/next" data-s="f-next" data-m="next">下一步做什么<span class="n red" id="s-fnext" hidden></span></a><a href="#/forecast/guide" data-s="f-guide" data-m="guide">操作指引<span class="n" id="s-guide" hidden></span></a><a href="#/forecast/live" data-s="f-live" data-m="live">团队在做什么</a><a href="#/forecast/card" data-s="f-card" data-m="card">数字和决定</a><a href="#/forecast/pack" data-s="f-pack" data-m="pack">本周帖子</a><a href="#/forecast/match" data-s="f-match" data-m="match">焦点战</a><a href="#/forecast/tools" data-s="f-tools" data-m="tools">用到的工具</a><a href="#/forecast/handoff" data-s="f-handoff" data-m="handoff">交接记录</a>
</div></nav>
<!-- 批 B：子菜单顺序 = 页面上模块的顺序（Webhook 开关挪到最后，和页面一致） -->
<nav class="sub" id="sub-tools" aria-label="公共工具模块" hidden><div class="in">
  <a href="#/tools/queue" data-s="t-queue">跟帖评论清单</a><a href="#/tools/reply" data-s="t-reply">每天回帖上限</a><a href="#/tools/usage" data-s="t-usage">用量和限额</a><a href="#/tools/byproj" data-s="t-byproj">按项目看用量</a><a href="#/tools/ext" data-s="t-ext">插件下载</a><a href="#/tools/assets" data-s="t-assets">素材生成器</a><a href="#/tools/tts" data-s="t-tts">语音生成</a><a href="#/tools/hook" data-s="t-hook">Webhook 开关</a>
</div></nav>
<!-- 批 C：公司总览的二级菜单，顺序 = 页面顺序；选中跟着滚动走（同一套 subSpy） -->
<nav class="sub" id="sub-company" aria-label="公司总览模块" hidden><div class="in">
  <a href="#/company/people" data-s="co-people">各岗位在做什么</a><a href="#/company/learn" data-s="co-learn">这周学到了什么</a><a href="#/company/health" data-s="co-health">做得怎么样</a>
</div></nav>
</div></div>
<form class="login" id="login" hidden>
  <b>登录</b><label for="pw">密码</label><input id="pw" type="password" autocomplete="current-password" required>
  <button class="btn primary" id="go" type="submit">登录</button><p class="msg" id="lmsg" role="alert"></p>
  <!-- 批 C：打开页面时读清单就失败、随后又要登录时，登录框上也写明读取失败和"再读一次"（boot() 重新读） -->
  <div class="l-fail" id="l-fail" role="alert" hidden><span id="l-fail-t"></span><button class="btn small" id="l-retry" type="button">再读一次</button></div>
</form>
<main id="app" hidden>
  <!-- 工作台（P-9 默认页）：内容由第三段脚本读 /api/company 后渲染 -->
  <section class="page plat" id="v-work" hidden>
    <p class="warnbar" id="w-err" role="status" hidden></p>
    <div class="alert" id="ci-alert" role="alert" hidden><b>有改动没通过自动检查</b><span id="ci-alert-t"></span><span class="sp"></span><a class="btn small danger" id="ci-alert-a" href="#/work/live">看哪里出错</a></div>
    <!-- ① 最该做的事 + 一眼三个数。读取失败时 #w-stale 显示"下面是 HH:MM 读到的"和"再读一次"，内容保留上次的 -->
    <section class="mod" id="w-now">
      <div class="errbar" id="w-stale" role="alert" hidden><span id="w-stale-t"></span><span class="sp"></span><button class="btn small" type="button" id="w-retry">再读一次</button></div>
      <div class="hero calm" id="hero" aria-busy="true"><div><p class="k">你现在最该做的一件事</p><div class="skels" style="padding:12px 0 0;width:min(420px,100%)"><span class="skel" style="height:26px"></span><span class="skel" style="width:60%"></span></div><p class="sr">正在读取…</p></div></div>
      <div class="glance" id="w-glance"><div class="gl"><span class="skel" style="height:30px;width:40%"></span></div><div class="gl"><span class="skel" style="height:30px;width:40%"></span></div><div class="gl"><span class="skel" style="height:30px;width:40%"></span></div></div>
    </section>
    <!-- ② 全部待办：按时间段分组（已超时 / 24 小时内到期 / 之后到期 / 没定截止时间），上面按项目筛选，做完的收进折叠 -->
    <section class="card mod" id="w-todo">
      <header class="mh"><h2>全部待办 <span class="cbadge red" id="w-todo-n">0</span></h2><span class="sp"></span><span class="aux">最急的在最上面</span></header>
      <p class="lead" id="w-todo-lead"><span class="skel" style="width:60%"></span></p>
      <div class="filterbar" id="w-todo-pf" role="group" aria-label="按项目看" hidden></div>
      <div id="w-todos"><div class="skels"><span class="skel"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:85%"></span></div></div>
      <details class="grp" id="w-done"><summary>做完的 <span class="n" id="w-done-n">（0）</span></summary><ul class="donelist" id="w-donelist"></ul></details>
      <details class="more"><summary>颜色和打勾是什么意思</summary><div class="in">
        <p>红色 = 已经超时；橙色 = 24 小时内到期；没定截止时间的排在最后、默认收起。上面的按钮按项目筛选，"全部"是所有项目加在一起。</p>
        <p>做完了点左边的圆圈打勾，它会收进"做完的"；提示条上点"撤销"、或者在"做完的"里点"撤销"都能放回来。手机、电脑打的勾是同一份。</p></div></details>
    </section>
    <!-- ③ 团队在做什么 -->
    <section class="card mod" id="w-live">
      <header class="mh"><h2><span class="live-dot" id="w-live-dot" aria-hidden="true"></span>团队在做什么 <span class="cbadge" id="w-live-n">0</span></h2><span class="sp"></span>
        <div class="seg" id="w-live-grp" role="group" aria-label="怎么分组"><button type="button" data-grp="time" aria-pressed="false">按时间</button><button type="button" data-grp="role" aria-pressed="true">按岗位</button><button type="button" data-grp="proj" aria-pressed="false">按项目</button></div></header>
      <p class="lead" id="w-live-lead"><span class="skel" style="width:50%"></span></p>
      <div class="live-warn" id="w-live-warn"></div>
      <div class="mbody flush" id="w-live-body"><div class="skels"><span class="skel"></span><span class="skel" style="width:70%"></span></div></div>
      <details class="more recent" id="recent"><summary>最近结束的（7 天内，<span id="recent-n">0</span> 件）· 灰色是什么意思</summary><div class="in">
        <p>每条是一个岗位正在做的一件事（一个分支）。<b>两小时没动静</b>会变灰；<b>一天没动静</b>、合并了或分支删了，收进下面的"最近结束"（只显示 7 天内的）。代码仓库（new-forecast、Marketing）只显示分支名、PR 标题和自动检查结果。</p>
        <p id="w-live-stamp"></p>
        <div id="recent-body"></div></div></details>
    </section>
    <!-- ④ 项目概况：每个在跑的项目一张卡 + 进度条 -->
    <section class="card mod" id="w-proj">
      <header class="mh"><h2>项目概况 <span class="cbadge" id="w-proj-n">0</span></h2><span class="sp"></span><span class="aux" id="w-proj-at"></span></header>
      <p class="lead" id="w-proj-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody" id="w-proj-body"><div class="skels" style="padding:0"><span class="skel"></span><span class="skel" style="width:70%"></span></div></div>
      <details class="more"><summary>为什么只有这几个</summary><div class="in"><p>只列正在跑、有状态卡的项目。以后发了启动命令的新项目会多一张卡。数字后面写"你 11/4 填的"的，是你在待办里填的数；进度条只在"现在"和"目标"都是数字时才画。</p></div></details>
    </section>
    <!-- ⑤ 公司数字：数字块 -->
    <section class="card mod" id="w-num">
      <header class="mh"><h2>公司数字</h2><span class="sp"></span><span class="aux" id="w-num-at"></span></header>
      <p class="lead" id="w-num-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody" id="w-num-body"><div class="skels" style="padding:0"><span class="skel"></span></div></div>
    </section>
    <!-- ⑥ 经营会 -->
    <section class="card mod" id="w-meet">
      <header class="mh"><h2>经营会</h2><span class="sp"></span><span class="aux">每周六晚上 8 点</span></header>
      <p class="lead" id="w-meet-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody" id="w-meet-body"></div>
    </section>
    ${ENGLISH_MOD}
    ${EM_MOD}
    <p class="foot">停在这一页时每 30 秒自动刷新；切到别的窗口时暂停，切回来马上刷新。</p>
  </section>
  <!-- 项目页（PR 2）：一套 DOM 轮流显示每个项目（#/<项目>/<模块>），模块 id 还是 f-* -->
  <section class="page plat" id="v-project" hidden>
    <div class="crumb"><h1 id="f-title">项目</h1><span class="hint" id="f-site"></span></div>
    <p class="warnbar" id="f-err" role="status" hidden></p>
    <!-- 批 B：读取失败时（照工作台 #w-stale）：上面一条红色提示 + "再读一次"；还没读到过就各模块写"暂时读不到"，不冒充"没事要做" -->
    <div class="errbar" id="f-stale" role="alert" hidden><span id="f-stale-t"></span><span class="sp"></span><button class="btn small" type="button" id="f-retry">再读一次</button></div>
    <!-- 批 B：每个模块 = 标题行 → 一句话结论 .lead（数据算）→ 主内容 → 最后一块折叠说明 details.more（默认收起） -->
    <section class="card mod" id="f-next">
      <header class="mh"><h2>下一步做什么 <span class="cbadge" id="f-next-n">0</span></h2><span class="sp"></span><span class="aux">最急的在最上面</span></header>
      <p class="lead" id="f-next-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody flush"><ul class="todos" id="f-todos"></ul></div>
      <details class="grp" id="f-done"><summary>做完的 <span class="n" id="f-done-n">（0）</span></summary><ul class="donelist" id="f-donelist"></ul></details>
      <details class="more"><summary>颜色、按钮和打勾是什么意思</summary><div class="in">
        <p>从第一条开始做就行。红色 = 已经超时；橙色 = 24 小时内到期。</p>
        <p>每条最多一个青色主按钮，点了直接带你去要操作的地方；没有链接的事（在 Claude 窗口里做、或者线下做的），右边是"做完了，打勾"。做完点左边圆圈打勾，收进"做完的"，在那里点"撤销"能放回来。</p></div></details>
    </section>
    <section class="card mod" id="f-guide">
      <header class="mh"><h2 id="f-guide-h">操作指引</h2><span class="sp"></span><span class="aux" id="f-guide-aux"></span></header>
      <p class="lead" id="f-guide-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody flush" id="f-guide-body"></div>
      <details class="more"><summary>每步怎么打勾、和待办是什么关系</summary><div class="in"><p>市场经理交了周包以后，这里一步步列出要你做的事。每步做完勾"这步做完了"；都勾了，待办里"照操作指引做完这周的几步"那件会自动打勾。手机、电脑勾的是同一份。</p></div></details>
    </section>
    <section class="card mod" id="f-live">
      <header class="mh"><h2><span class="live-dot" id="f-live-dot" aria-hidden="true"></span>团队在做什么 <span class="cbadge" id="f-live-n">0</span></h2><span class="sp"></span><span class="aux" id="f-live-stamp"></span></header>
      <p class="lead" id="f-live-lead"><span class="skel" style="width:50%"></span></p>
      <div class="live-warn" id="f-live-warn"></div>
      <div class="mbody flush" id="f-live-body"></div>
      <details class="more"><summary>灰色是什么意思</summary><div class="in"><p>每条是一个岗位正在做的一件事（一个分支），只列这个项目的。两小时没动静会变灰；一天没动静、合并了或分支删了，收进"最近结束"（只显示 7 天内的）。</p></div></details>
    </section>
    <section class="card mod" id="f-card">
      <header class="mh"><h2>数字和决定</h2><span class="sp"></span><span class="aux" id="f-card-at"></span></header>
      <p class="lead" id="f-card-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody flush" id="f-card-body"></div>
      <details class="more"><summary>这些数从哪来</summary><div class="in"><p>来自这个项目的状态卡；状态卡写"见工作平台"的那一格，换成你在待办里填的最新值，"从哪来"一栏写"你 11/4 填的"。</p></div></details>
    </section>
    <div class="two">
      <section class="card mod" id="f-pack">
        <header class="mh"><h2 id="f-pack-h">本周帖子</h2><span class="sp"></span><span class="aux" id="f-pack-aux"></span></header>
        <p class="lead" id="f-pack-lead"><span class="skel" style="width:50%"></span></p>
        <div class="mbody flush" id="f-pack-body"></div>
        <details class="more"><summary>这张表怎么看</summary><div class="in"><p>周包里这周要发的帖子，按第几条排。"几点发"是建议的发出时间，"最晚"之前发出去都算数；文案在操作指引每一步的"打开文案"里。</p></div></details>
      </section>
      <section class="card mod" id="f-match">
        <header class="mh"><h2 id="f-match-h">焦点战</h2><span class="sp"></span><span class="aux" id="f-match-aux"></span></header>
        <p class="lead" id="f-match-lead"><span class="skel" style="width:50%"></span></p>
        <div class="mbody flush" id="f-match-body"></div>
        <details class="more"><summary>怎么导入官网名单页</summary><div class="in"><p>在操作指引上面点"复制 N 场焦点战"，到官网名单页的"导入"里粘贴就行；浏览器不让复制时，会把整段文字摆出来让你手动复制。</p></div></details>
      </section>
    </div>
    <section class="card mod" id="f-tools">
      <header class="mh"><h2>本项目用到的工具</h2><span class="sp"></span><span class="aux" id="f-tools-stamp"></span></header>
      <p class="lead" id="f-tools-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody"><div class="two" id="f-tools-body"></div></div>
    </section>
    <section class="card mod" id="f-handoff">
      <header class="mh"><h2>交接记录</h2><span class="sp"></span><span class="aux">新的在上 · 换人接手时看</span></header>
      <p class="lead" id="f-handoff-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody flush" id="f-handoff-body"></div>
    </section>
  </section>
  <!-- 公共工具（界面改版·批 B，原型 prototype-tools.html）：每块一张卡片，"标题行 → 一句话结论 → 主内容 → 底部折叠说明"；
       页面顺序 = 二级菜单顺序（天天用 → 偶尔用 → 出事才用）。清单、用量、插件下载的脚本逻辑和接口不变，只换排版；元素 id 和 data-* 照旧 -->
  <section class="page" id="v-tools" hidden>
    <div class="crumb"><h1>公共工具</h1><span class="hint">各项目一起用的工具；上限只在这一页改</span></div>
    <!-- 批 B 走查 🟡：清单读取失败时和工作台、项目页一样：中文原因 + "下面是 HH:MM 读到的" + "再读一次"（以前是一条英文 Failed to fetch） -->
    <div class="errbar" id="t-stale" role="alert" hidden><span id="t-stale-t"></span><span class="sp"></span><button class="btn small" type="button" id="t-retry">再读一次</button></div>
    <section class="card mod" id="t-queue">
      <header class="mh"><h2>跟帖评论清单 <span class="cbadge" id="q-n">0</span></h2><span class="sp"></span>
        <div class="capline"><div class="r"><span id="count"></span></div><div class="meter" aria-hidden="true"><i id="q-bar" style="width:0"></i></div></div></header>
      <p class="lead" id="q-lead"><span class="skel" style="width:50%"></span></p>
  <section id="v-list">
    <div class="toolbar">
      <div class="seg" role="group" aria-label="状态"><button type="button" class="chip" data-f="pending" aria-pressed="true">待回</button><button type="button" class="chip" data-f="done" aria-pressed="false">已回</button><button type="button" class="chip" data-f="skip" aria-pressed="false">跳过</button></div>
      <span class="sp"></span><button class="btn small text danger" id="bulk" type="button" hidden>删除筛选出的这些</button>
      <!-- 筛选默认收起（批 B）：项目、平台、排序、存进来的时间 -->
      <details class="qf" id="q-filters"><summary id="q-filters-s">筛选</summary>
        <div class="filters" role="group" aria-label="筛选"><label for="f-prod">项目</label><select id="f-prod"><option value="">全部</option></select>
          <label for="f-plat">平台</label><select id="f-plat"><option value="">全部</option><option value="x">X</option><option value="threads">Threads</option></select>
          <label for="f-sort">排序</label><select id="f-sort"><option value="time">最新的在前</option><option value="score">评分从高到低</option></select></div>
        <div class="filters" role="group" aria-label="时间"><label>存进来的时间（台湾）</label><button class="chip" type="button" data-rg="today" aria-pressed="false">今天</button><button class="chip" type="button" data-rg="7" aria-pressed="false">近 7 天</button><button class="chip" type="button" data-rg="all" aria-pressed="true">全部</button>
          <label for="f-from">从</label><input type="date" id="f-from"><label for="f-to">到</label><input type="date" id="f-to"></div>
      </details>
    </div>
    <p class="sum"><span id="total"></span></p>
    <div class="confirm" id="bulk-confirm" role="alert" hidden><span id="bulk-text"></span><button class="btn small danger" id="bulk-yes" type="button">确认删除</button><button class="btn small" id="bulk-no" type="button">取消</button></div>
    <p class="toast" id="toast" role="status" hidden></p>
    <div id="list"></div>
  </section>
      <details class="more"><summary>打分是怎么来的 · 按钮怎么用</summary><div class="in">
        <p>分数是 AI 按"和产品话题相关、互动多、发帖时间新"打的，分够的才会写草稿、存进来；"打分依据"列出了这一条为什么值得回。草稿可以在 X / Threads 的回复框里改完再发，发送一定是你本人按。</p>
        <p>每条只有一个主按钮"一键回复"（打开官方回复窗口、草稿已填好）；发完回来点"我回了"。"跳过"能在"跳过"里放回来；"删除"要再确认一次，删了不能恢复。"删除筛选出的这些"按现在的筛选一次删完，也要先确认。</p></div></details>
    </section>
    <!-- 每天回帖上限按项目（工作平台批 2，D-2）：GET / POST /api/reply-cap -->
    <section class="card mod" id="t-reply">
      <header class="mh"><h2>每天回帖上限</h2><span class="sp"></span><span class="aux">每个项目一个数 · 1～50 条</span></header>
      <p class="lead" id="rc-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody"><div class="tablewrap boxed"><table><thead><tr><th>项目</th><th>每天上限</th><th>今天已回</th></tr></thead><tbody id="rc-rows"><tr><td colspan="3">正在读取…</td></tr></tbody></table></div>
        <div class="save-row"><button class="btn primary" id="rc-save" type="button">保存上限</button><p class="msg" id="rc-msg" role="status"></p></div></div>
      <details class="more"><summary>怎么算的</summary><div class="in"><p>插件里"同意"和清单里"我回了"合起来算，按台湾日期每天重新数。某个项目到上限后，只有这个项目的"一键回复"变灰，别的项目照常。每个项目 1～50 条；没单独设过的项目用默认值。</p></div></details>
    </section>
    <section class="card mod" id="t-usage">
      <header class="mh"><h2>用量和限额</h2><span class="sp"></span><span class="aux" id="u-at">还没读取</span></header>
      <p class="lead" id="u-lead"><span class="skel" style="width:50%"></span></p>
  <section id="v-usage" class="mbody">
    <!-- 用量监控（Amos 2026-11-03"可以看到剩余和分别用到了哪里"）第一块：还剩多少。数据来自 /api/usage 的 left（src/usage.ts usageLeft） -->
    <h3 class="sr">还剩多少</h3>
    <!-- Cloudflare 自己说"账号额度用完了"：数据来自 /api/usage 的 accountLimit（表 account_limit，迁移 0011）。
         这是唯一可靠的信号——下面表里的数只是本环境记下的下限。到下一个 UTC 日（台湾早上 8 点）自动不显示 -->
    <p class="acct" id="u-acct" role="alert" hidden></p>
    <div class="tablewrap boxed"><table><thead><tr><th>这本账</th><th>今天已用</th><th>每天上限</th><th>还剩</th><th>什么时候清零（台湾时间）</th></tr></thead><tbody id="u-left"><tr><td colspan="5">正在读取…</td></tr></tbody></table></div>
    <!-- 每一行的"这个数靠不靠得住"：Workers AI 那一行写明是本环境记的账、Cloudflare 按整个账号算（src/usage.ts waiCaveat） -->
    <div id="u-left-notes" style="margin-top:var(--s3)"></div>
    <div class="save-row" style="margin-top:var(--s2)"><button class="btn small" id="u-refresh" type="button">立即刷新</button></div>
    <details class="grp box" id="u-caps"><summary>每个模型的用量和上限（要改上限点这里）</summary><div class="in">
      <div class="tablewrap boxed"><table><thead><tr><th>模型</th><th>今天请求</th><th>今天 token（入 / 出）</th><th>每天上限</th><th>用量</th><th>状态</th><th>下次重置（台湾时间）</th></tr></thead><tbody id="u-rows"></tbody></table></div>
      <div class="save-row"><button class="btn primary" id="u-save" type="button">保存上限</button><p class="msg" id="u-msg" role="status"></p></div>
      <p class="hint">Gemini 的真实免费额度 Google 不提供查询，这里是我们自己数的次数和 token；Google 说用完（429）时状态会标出来。到了我们设的上限，这个模型今天先跳过，换下一个。Gemini 按次数（1～10,000），Workers AI 按 neurons（1～9,500；免费额度 10,000，超过不让保存）。"今天"按各家的重置时间算。</p></div></details>
    <!-- 用量监控第二块：分别用到了哪里。数据来自 /api/usage 的 byPurpose（表 usage_by_purpose，迁移 0010） -->
    <details class="grp box" id="u-purpose-box"><summary>分别用到了哪里（今天 · 按用途 · 只看、不设上限）</summary><div class="in">
      <div class="tablewrap boxed"><table><thead><tr><th>用途</th><th>Workers AI（neurons）</th><th>Workers AI 次数</th><th>Gemini 次数</th></tr></thead><tbody id="u-purpose"><tr><td colspan="4">正在读取…</td></tr></tbody></table></div>
      <p class="hint">按"这一笔是干什么用的"分开记（表 <code>usage_by_purpose</code>）。为什么不看"按项目看用量"：素材生成器的图片和音频都算同一个项目，按项目分不出哪一笔是出图、哪一笔是配音。neurons 是<b>按价格表估算</b>的，不是 Cloudflare 的账单。<b>这一版上线以前记下的用量没有用途，不回填也不估算</b>，单独列成"没按用途记下来的"；那一行的次数写"没记录"，因为当时确实没记下来。</p></div></details>
  </section>
      <details class="more"><summary>这些数靠不靠得住？两本账怎么看</summary><div class="in"><p class="hint">两本账<b>分开看、不要加在一起</b>（单位都不一样）：Workers AI 按 neurons 算，备用 AI、素材生成器、语音生成花的都是这一本；Gemini 按请求次数算。<b>"一天"按各家自己的重置时间</b>：Workers AI 是 UTC 0 点清零，也就是<b>台湾早上 8 点</b>；Gemini 是美国太平洋时间半夜清零，也就是<b>台湾下午 3 点或 4 点</b>（看美国当时有没有夏令时）。这里的"上限"是我们自己在下面那张表里设的数，<b>不是各家的真实剩余额度</b>——Google 不提供查询接口；Cloudflare 的免费额度每天 10,000 neurons 是<b>按整个账号算的</b>，正式版和测试版共用一份、却各记各的账（两个不同的数据库），所以上面那个"还剩"只能当<b>最多还有这么多</b>看。<b>要知道真实剩余只有两条路</b>：一是 Cloudflare 自己报错（报了上面就出红字），二是去接 Cloudflare 的分析接口（要 Amos 的 API 令牌，这一版没做）。</p></div></details>
    </section>
    <!-- 按项目看用量（工作平台批 2，D-3）：/api/usage 的 byProject；只记、不当限额 -->
    <section class="card mod" id="t-byproj">
      <header class="mh"><h2>按项目看用量</h2><span class="sp"></span><span class="aux">今天 · 只看、不设上限</span></header>
      <p class="lead" id="bp-lead"><span class="skel" style="width:50%"></span></p>
      <div class="mbody"><div class="tablewrap boxed"><table><thead><tr><th>项目</th><th>Gemini</th><th>Workers AI</th></tr></thead><tbody id="bp-rows"><tr><td colspan="3">正在读取…</td></tr></tbody></table></div></div>
      <details class="more"><summary>这一版上线以前没分项目（不回填）：加起来可能比上面的总数少</summary><div class="in"><p>"今天"和上面的用量和限额一样按各家的重置时间算。额度是所有项目一起用的，上限只在"用量和限额"里设。"平台自己"是设置页"测试 AI"这类平台自己发的请求。这一版上线以前没分项目（不回填），所以今天按项目加起来可能比上面的总数少。</p></div></details>
    </section>
    <!-- 插件下载（批 B：原来在页面最后，现在照菜单放第 5） -->
    <section class="card mod" id="t-ext">
      <header class="mh"><h2>插件下载</h2><span class="sp"></span><span class="aux">副驾驶 · 和这个后台同一次部署</span></header>
      <p class="lead"><span class="dot ok"></span><span>最新版 ${EXTENSION_VERSION}，和这个后台是同一次部署，版本对得上。</span><span class="soft">装过的话，只要覆盖文件夹再点刷新。</span></p>
  <section id="v-ext" class="mbody">
      <div class="ext"><div class="ver">${EXTENSION_VERSION}</div><div><p class="sum" style="padding:0">副驾驶插件 <b>${EXTENSION_VERSION}</b>（Chrome 插件 · zip）</p><p class="msg" id="dl-msg" role="status"></p></div>
        <button class="btn primary big" id="dl" type="button">下载插件 ${EXTENSION_VERSION}</button></div>
      <div class="row2">
        <div><b>第一次安装（电脑上的 Chrome）</b>
      <ol class="steps">
        <li>点上面的按钮下载，把 zip 解压到一个固定的地方（例如"文件"里），得到 <code>marketing-copilot</code> 文件夹。<b>以后不要移动或删除这个文件夹</b>，插件就从这里读。</li>
        <li>Chrome 地址栏打开 <code>chrome://extensions</code>，打开右上角的"开发者模式"。</li>
        <li>点"加载已解压的扩展程序"，选 <code>marketing-copilot</code> 文件夹。</li>
        <li>打开 X 或 Threads，点插件图标打开侧边栏，到"设置"填中转服务地址 <code id="origin"></code> 和连接令牌（令牌只填在插件里，不要发到聊天里）。</li>
      </ol></div>
        <div><b>更新到新版本</b>
      <ol class="steps">
        <li>下载新版，解压后把里面的文件<b>覆盖</b>到原来的 <code>marketing-copilot</code> 文件夹（位置不变，插件的设置会保留）。</li>
        <li>到 <code>chrome://extensions</code> 找到"Quick Come 副驾驶"，点刷新按钮 ↻，再刷新 X / Threads 页面。</li>
      </ol></div>
      </div>
  </section>
    </section>
  ${ASSETS_MOD}
  ${TTS_MOD}
    <!-- Webhook 开关（工作平台批 3；批 B 改成开关样式、放到最后）：settings 的 hook:github；GET /api/active 的 on、POST /api/hook {on} -->
    <section class="card mod" id="t-hook">
      <header class="mh"><h2>Webhook 开关</h2><span class="sp"></span><span class="aux">工作台"团队在做什么"的数据来源</span></header>
      <p class="lead" id="hook-lead"><span class="dot gray"></span><span>正在读取开关…</span></p>
      <div class="mbody"><div class="save-row" style="margin:0"><button class="switch" id="hook-toggle" type="button" role="switch" aria-pressed="true" aria-checked="true" hidden><i aria-hidden="true"></i><span id="hook-state">正在读取…</span></button><span class="msg" id="hook-msg" role="status"></span></div></div>
      <details class="more"><summary>开着、关着分别会怎样</summary><div class="in"><p>开着：GitHub 发来的推送、PR、自动检查结果写进"团队在做什么"。关着：签名对的事件照样回"收到"，但一条都不写（出问题时先关这里止损）。要连请求都挡住，到 GitHub 仓库 Settings → Webhooks 取消 Active。</p></div></details>
    </section>
  </section>
  <!-- 公司总览（右上角"公司总览"进入，地址 #/company；界面改版·批 C 2026-11-05 并进统一的卡片模块）：只留三块——各岗位这周在做什么、这周学到了什么、做得怎么样。
       "需要我的事"去掉了（和工作台"全部待办"重复、件数对不上），项目、下周的事在工作台。内容由第二段脚本读 /api/company 后渲染 -->
  <section class="page plat" id="v-company" hidden>
    <div class="crumb"><h1>公司总览</h1><span id="co-at">还没读取</span><span class="sp"></span><button class="btn small" id="co-refresh" type="button">刷新</button></div>
    <div class="page" id="co-body"></div>
  </section>
</main>
<!-- 工作台第一次读取中的占位骨架（批 A）：读到数据就藏起来、显示 #app -->
<main class="boot" id="boot" aria-busy="true" hidden><div class="page plat" style="gap:var(--s6)">
  <div class="hero calm"><div style="display:grid;gap:12px;width:min(420px,100%)"><span class="skel" style="width:40%"></span><span class="skel" style="height:26px"></span><span class="skel" style="width:60%"></span></div><p class="sr">正在读取…</p></div>
  <div class="card"><div class="skels"><span class="skel" style="width:30%;height:18px"></span><span class="skel"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:85%"></span></div></div>
  <div class="card"><div class="skels"><span class="skel" style="width:30%;height:18px"></span><span class="skel"></span><span class="skel" style="width:60%"></span></div></div>
</div></main>
<script>
const $=(id)=>document.getElementById(id);
let filter='pending', view='list', state={items:[],total:0,max:500,products:[],doneToday:0,cap:10}, usage=[];
const P={x:'X',threads:'Threads'}, PROD={forecast:'Quick Come'};
const tw=(ms)=>new Date(ms+8*3600e3).toISOString().replace('T',' ').slice(0,19);
const twDay=(ms)=>tw(ms).slice(0,10);
function toast(t,err){const e=$('toast');e.textContent=t;e.className='toast'+(err?' err':'');e.hidden=!t;}
async function call(path,body){let r;try{r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});}catch(e){throw new Error('网络断了或服务没回应');}const j=await r.json().catch(()=>({}));if(r.status===401&&path!=='/api/login'){showLogin('请重新登录');throw new Error('请重新登录');}if(!r.ok){const er=new Error(j.error||('出错了（'+r.status+'）'));er.status=r.status;throw er;}return j;}
let authed=false;
function showLogin(m){authed=false;$('more-menu').hidden=true;moreMenu(false);$('app').hidden=true;$('boot').hidden=true;$('subs').hidden=true;$('nav1').hidden=true;$('logout').hidden=true;$('nav').hidden=true;$('extnav').hidden=true;$('conav').hidden=true;$('login').hidden=false;$('count').textContent='';$('lmsg').textContent=m||'';try{$('l-fail').hidden=!bootErr;}catch(e){}$('pw').focus();try{platformStop();}catch(e){}}
// #app 由 route() 决定什么时候显示：工作台、项目页等第一次读到数据再显示（免得看到空模块），工作台在这之前显示占位骨架 #boot（批 A）；清单、用量、插件下载、公司总览马上显示
function showApp(){authed=true;$('subs').hidden=false;$('nav1').hidden=false;$('logout').hidden=false;$('more-menu').hidden=false;frameButtons();setTimeout(()=>{try{subHint();}catch(e){}},0);}
$('login').addEventListener('submit',async(e)=>{e.preventDefault();const b=$('go');b.disabled=true;b.textContent='正在登录…';$('lmsg').textContent='';
  try{await call('/api/login',{password:$('pw').value});$('pw').value='';$('login').hidden=true;}catch(err){$('lmsg').textContent=err.message;return;}finally{b.disabled=false;b.textContent='登录';}
  // 批 C：登录成功后不管清单读没读到都照常进页面；清单读失败时由 load() → qFail() 在公共工具上写红条和"再读一次"（以前 load() 一出错就跳过 route()，整页只剩顶栏）
  try{await load();}catch(e){}if(!$('login').hidden)return;// 读清单时又要求重新登录：停在登录框
  if(!authed)showApp();route();});
$('logout').addEventListener('click',async()=>{moreMenu(false);await call('/api/logout',{}).catch(()=>{});showLogin('已登出');});
const TITLES={hook:'Webhook 开关',list:'跟帖评论清单',usage:'用量和限额',reply:'每天回帖上限',ext:'插件下载',assets:'素材生成器',tts:'语音生成',voice:'语音对话实测',company:'公司总览',work:'工作台'};
// 外框路由（工作平台批 1）：#/<页>/<模块>；页 = work / <项目> / tools / company；模块 id = 页的前缀 + 模块名（#/work/todo → w-todo）
// 2026-11-02：项目不再写死。地址里第一段是项目名时，内部页名一律是 'project'（一套 DOM #v-project 轮流显示），当前项目记在 proj 里。
let page='', proj='';
const FIXED={work:'w-',tools:'t-',company:''};
const PFX={work:'w-',project:'f-',tools:'t-',company:'co-'}, TOOLV={queue:'list',usage:'usage',ext:'ext',reply:'reply',byproj:'usage',hook:'hook',assets:'assets',tts:'tts',voice:'voice'};
// 有项目页的项目：先用兜底名单（src/projects.ts PROJECT_PAGES_FALLBACK），读到 /api/company 后由第三段脚本调 setProjects() 换成真的
const PCFG=${JSON.stringify({ PROJECT_PAGES_FALLBACK, MAX_PROJECT_PAGES, PROJECT_SITE })};
let PROJS=PCFG.PROJECT_PAGES_FALLBACK.slice();
// 批 B 走查：名单还没从服务器读到之前（projsReady=false），地址里的项目名先照着打开（刷新 #/Practical 不再被兜底名单踢回工作台、也不再拿第一个项目的数据冒充）；
// 读到名单后 setProjects() 再判一次，不在名单里的才回工作台
let projsReady=false;
/** 一级菜单上的项目链接：有几个项目出几个（每个带待办数的小红点 #c-<项目名>） */
function renderNav1(){const nav=$('nav1'),tools=$('nav1-sep');
  nav.querySelectorAll('a[data-proj]').forEach((a)=>a.remove());
  PROJS.forEach((p)=>{const a=document.createElement('a');a.href='#/'+encodeURIComponent(p);a.dataset.p='project';a.dataset.proj=p;a.textContent=p;
    const c=document.createElement('span');c.className='cnt';c.id='c-'+p;c.hidden=true;a.append(c);
    a.addEventListener('click',()=>{if(a.getAttribute('href')===location.hash)setTimeout(route,0);});
    nav.insertBefore(a,tools);});
  $('nav1-grp').hidden=$('nav1-sep0').hidden=!PROJS.length;setTimeout(()=>{try{subHint();}catch(e){}},0);}
/** 第三段脚本读到 projects 块后调这个：名单变了就重画一级菜单；当前项目没了就回工作台 */
function setProjects(list){const next=(list&&list.length?list:PCFG.PROJECT_PAGES_FALLBACK).slice(0,PCFG.MAX_PROJECT_PAGES);const first=!projsReady;projsReady=true;
  if(JSON.stringify(next)===JSON.stringify(PROJS)){if(first&&authed&&page==='project'&&PROJS.indexOf(proj)<0)route();return;}PROJS=next;renderNav1();if(authed)route();}
/** 二级菜单、标题、副标题指向哪个项目 */
function setProject(p){proj=p;$('f-title').textContent=p;
  document.querySelectorAll('#sub-project a[data-m]').forEach((a)=>{a.href='#/'+encodeURIComponent(p)+'/'+a.dataset.m;});
  const site=PCFG.PROJECT_SITE[p],e=$('f-site');e.replaceChildren();
  if(site){e.append(site.text+' ');const a=document.createElement('a');a.href=site.url;a.target='_blank';a.rel='noopener';a.textContent=site.url.replace(/^https:\\/\\/(www\\.)?/,'');e.append(a);}}
renderNav1();
// 批 C：公司总览页上不再显示"← 跟帖评论清单""插件下载"两个旧按钮（别的页只有"公司总览 / 登出"），"公司总览"按钮标成当前页
function frameButtons(){const t=page==='tools';$('nav').hidden=!t;$('extnav').hidden=!t||view==='ext';$('conav').hidden=false;if(page==='company')$('conav').setAttribute('aria-current','page');else $('conav').removeAttribute('aria-current');$('nav').textContent=view==='list'?'用量和限额 →':'← 跟帖评论清单';}
function hashOf(){const m=/^#\\/([^\\/?#]+)(?:\\/([a-z0-9-]+))?/.exec(location.hash);if(!m)return null;
  let seg=m[1];try{seg=decodeURIComponent(m[1]);}catch(e){}
  if(Object.hasOwn(FIXED,seg))return {p:seg,m:m[2]||'',proj:''};
  return PROJS.indexOf(seg)>=0||!projsReady?{p:'project',m:m[2]||'',proj:seg}:null;}
function route(){if(!authed)return;let h=hashOf();
  if(!h){history.replaceState(null,'',location.pathname+location.search+(location.pathname==='/queue'?'#/tools/queue':'#/work'));h=hashOf();}
  const prev=page,prevProj=proj;page=h.p;view=page==='tools'?(TOOLV[h.m]||'list'):page;
  if(page==='project')setProject(h.proj);
  const mod=h.m&&PFX[page]?PFX[page]+h.m:'';
  const ready=(typeof platformReady!=='function')||platformReady();
  // 批 A：工作台第一次读到数据之前显示占位骨架 #boot（在 #app 外面，#app 还是读到数据再显示，免得看到空模块）；项目页照旧
  $('app').hidden=(page==='work'||page==='project')&&!ready;$('boot').hidden=!(page==='work'&&!ready);
  ['work','project','tools','company'].forEach(x=>{$('v-'+x).hidden=x!==page;const sb=$('sub-'+x);if(sb)sb.hidden=x!==page;});
  document.querySelectorAll('#nav1 a[data-p]').forEach(a=>{const on=a.dataset.p===page&&(!a.dataset.proj||a.dataset.proj===proj);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  inView($('nav1'),$('nav1').querySelector('a[aria-current="page"]'));
  document.querySelectorAll('nav.sub a[data-s]').forEach(a=>a.setAttribute('aria-current',String(a.dataset.s===mod)));subPin=null;
  const t=page==='project'?proj:(TITLES[view]||TITLES[page]);$('title').textContent=t;document.title=t+' · 工作平台';frameButtons();
  usageTimer(page==='tools');
  if(page==='tools'){if(prev!==''&&prev!=='tools')load();else if(prev==='tools'&&view==='list')load();if(view==='usage'||prev!=='tools'){uEditing=false;loadUsage(true);}if(view==='reply'||prev!=='tools')loadReply();if(view==='hook'||prev!=='tools')loadHook();}
  if(page==='tools'&&view==='assets'){try{window.assetsOpen();}catch(e){}}
  if(page==='tools'&&view==='tts'){try{window.ttsOpen();}catch(e){}}
  if(page==='tools'&&view==='voice'){try{window.voiceOpen();}catch(e){}}
  if(page==='company'){try{companyOpen(prev==='company');}catch(e){$('co-at').textContent='这一页出错了：'+e.message;}}
  // 批 2：在公共工具、公司总览刷新时，一级菜单上的待办数量也马上读出来（以前要切到工作台才有）
  if(page==='work'||page==='project'){try{platformOpen(page,mod);}catch(e){}}else{try{platformStop();platformPeek();}catch(e){}}
  // 工作台最下面的"它记得住你"（跨轮记忆，english-memory-page.ts）：进工作台时读一次（没登录时 route() 根本不往下走）
  if(page==='work'){try{window.engmemOpen();}catch(e){}}
  // 批 B：语音对话实测台在"语音生成"的折叠 #tts-more 里：打开 #/tools/voice 先把折叠打开再滚过去
  if(page==='tools'&&view==='voice'){const f=$('tts-more');if(f)f.open=true;}
  // 批 C：公司总览的模块是读到数据才画出来的，这时还没有就记下 coMod，第二段脚本画完再滚过去（同样 subPin）
  if(page==='company')coMod=mod&&!$(mod)?mod:'';
  // 批 C：模块不在二级菜单里时（#/tools/voice 的 #t-voice 在"语音生成"#t-tts 里面），选中它所在的那一项，不能按滚动位置算成别的
  const el=mod&&$(mod);if(el&&!el.closest('[hidden]')){el.scrollIntoView({block:'start'});subPinTo(subHost(el)||mod,el);}else if(prev!==page||prevProj!==proj)window.scrollTo(0,0);
  subLast='';subSpy();}
window.addEventListener('hashchange',route);
// 二级菜单跟着滚动选中（2026-11-04）：只改 aria-current，不改地址（不碰 hash / pushState / replaceState）。
// 选"顶端已经过了顶栏底边（+16px）"的最后一个模块；滑到页面最底选最后一个；都没过选第一个。模块按页面上的位置排，[hidden] 里的不算。
// 批 A：快到底时这条"顶栏底边 +16px"的判定线往下移（见 subSpy 里的注释），因为页面底部不再垫 60vh 空白。
// 点菜单跳过去以后、用户还没再滚之前，以点的那个为准（subPin）：页面底部的几个模块顶不到顶栏下面，不这样会和点的打架。
// 第 2 轮（产品口径）：B. 并排的几块（顶端差 ≤4px）算一排：当前选中的在这一排里就不变，从别处滑进这一排选菜单里靠前的那个；
// A. 选中项变了、子菜单 .sub .in 要横滑时，只改 .in 的 scrollLeft 把它滚进看得见的地方（尽量离开右边约 18% 的渐隐），不用 scrollIntoView、不动页面 scrollY。
let subPin=null,subRaf=0,subLast='',coMod='';
/** 跳到某个模块后记下 pin：选中哪一项（s）、当时的 scrollY、跳到的元素和它当时在屏幕上的位置 */
function subPinTo(s,el){subPin={s,y:scrollY,el,top:el.getBoundingClientRect().top};}
/** 元素在二级菜单的哪一项里：菜单项自己，或者包着它的那个模块（#t-voice → t-tts）；都不是回 '' */
function subHost(el){const a=[...document.querySelectorAll('nav.sub a[data-s]')].find((x)=>{const m=$(x.dataset.s);return m&&!m.closest('[hidden]')&&m.contains(el);});return a?a.dataset.s:'';}
function subSpy(){subRaf=0;const nav=[...document.querySelectorAll('nav.sub')].find((n)=>!n.closest('[hidden]'));if(!nav)return;
  const links=[...nav.querySelectorAll('a[data-s]')],order=links.map((a)=>a.dataset.s);
  const secs=links.map((a)=>$(a.dataset.s)).filter((e)=>e&&!e.closest('[hidden]')&&e.getClientRects().length).map((e)=>({id:e.id,top:e.getBoundingClientRect().top,n:order.indexOf(e.id)})).sort((a,b)=>a.top-b.top||a.n-b.n);
  if(!secs.length)return;
  const was=(links.find((a)=>a.getAttribute('aria-current')==='true')||{dataset:{}}).dataset.s;
  let cur='';
  // 批 C：pin 还算数 = scrollY 没变，或者跳过去的那个元素在屏幕上的位置没变（下面 / 上面的内容异步画完、浏览器的滚动锚定调了 scrollY，元素还在原处，
  // 不算用户滚过；#/tools/voice 打开后实测台的内容读完就是这样，以前会按位置算成最后一块 Webhook 开关）。用户自己滚了，两样都会变
  const pinOk=subPin&&(Math.abs(scrollY-subPin.y)<=2||(subPin.el&&subPin.el.isConnected&&subPin.el.getClientRects().length&&Math.abs(subPin.el.getBoundingClientRect().top-subPin.top)<=2));
  if(pinOk&&secs.some((x)=>x.id===subPin.s))cur=subPin.s;
  else{subPin=null;const de=document.documentElement;
    if(scrollY>0&&innerHeight+scrollY>=de.scrollHeight-2)cur=secs[secs.length-1].id;
    else{// 批 A 去掉了页面底部 60vh 的空白：快到底时判定线往下移（剩下不到 0.6 屏时开始，到底时移到屏幕底边上面 60px），
      // 短的最后几块也能依次被选中，不会从中间直接跳到最后一个。还在最上面（scrollY=0）时不移。
      const base=$('bars').getBoundingClientRect().bottom+16,rest=de.scrollHeight-innerHeight-scrollY;
      const k=scrollY>0?Math.max(0,Math.min(1,1-rest/(innerHeight*0.6))):0;const line=base+k*Math.max(0,innerHeight-base-60);
      let c=secs[0];secs.forEach((x)=>{if(x.top<=line)c=x;});
      const row=secs.filter((x)=>Math.abs(x.top-c.top)<=4);
      cur=row.length>1?(row.some((x)=>x.id===was)?was:row.reduce((m,x)=>x.n<m.n?x:m).id):c.id;}}
  links.forEach((a)=>a.setAttribute('aria-current',String(a.dataset.s===cur)));
  const key=nav.id+'/'+cur;if(key!==subLast){subLast=key;subShow(nav,links[order.indexOf(cur)]);}}
/** A：选中项滚进横向子菜单的可见范围（只改 .sub .in 的 scrollLeft） */
function subShow(nav,a){inView(nav.querySelector('.in'),a);}
/** 横向滚动的菜单（二级菜单 .sub .in、手机上的一级菜单 #nav1）：把 a 滚进看得见的地方，只改 box 的 scrollLeft */
function inView(box,a){if(!a||!box||box.scrollWidth<=box.clientWidth+1)return;
  const b=box.getBoundingClientRect(),r=a.getBoundingClientRect();const fade=Math.max(0,Math.min(b.width*0.18,b.width-r.width-16));
  const d=r.left<b.left+8?r.left-b.left-8:r.right>b.right-fade?r.right-(b.right-fade):0;if(d)box.scrollLeft+=d;}
function subSpySoon(){if(!subRaf)subRaf=requestAnimationFrame(subSpy);}
window.addEventListener('scroll',subSpySoon,{passive:true});window.addEventListener('resize',subSpySoon);
document.querySelectorAll('nav.sub a[data-s], #nav1 a[data-p]').forEach(a=>a.addEventListener('click',()=>{if(a.getAttribute('href')===location.hash)setTimeout(route,0);}));
/** 旧的三个按钮（用量和限额、插件下载、公司总览）：跳到公共工具里的模块或公司总览 */
function go(v){const h=v==='company'?'#/company':'#/tools/'+({list:'queue',usage:'usage',ext:'ext'}[v]||'queue');if(location.hash===h)route();else location.hash=h;}
$('nav').addEventListener('click',()=>go(view==='list'?'usage':'list'));
$('extnav').addEventListener('click',()=>go('ext'));
$('conav').addEventListener('click',()=>{moreMenu(false);go('company');});
/** 手机上（≤640px）"公司总览、登出"收进顶栏右边的"···"（批 A，原型 .more-menu）：点"···"展开 / 收起，点别处或 Esc 收起；电脑上两个按钮直接在顶栏 */
// 实现：一个 details#more-menu。电脑上它一直是 open、summary 藏起来，两个按钮就在顶栏；手机上默认收起，点 summary"···"展开
const MM=matchMedia('(max-width:640px)');
function moreMenu(open){const d=$('more-menu');d.open=MM.matches?!!open:true;}
try{MM.addEventListener('change',()=>moreMenu(false));}catch(e){}moreMenu(false);
document.addEventListener('click',(e)=>{const d=$('more-menu');if(MM.matches&&d.open&&!d.contains(e.target))moreMenu(false);});
document.addEventListener('keydown',(e)=>{const d=$('more-menu');if(e.key==='Escape'&&MM.matches&&d.open){moreMenu(false);d.querySelector('summary').focus();}});
$('origin').textContent=location.origin;
// 自己点开"语音生成"底部折叠时，实测台的价格表和场景也要读出来（window.voiceOpen 只读一次）
// 点"语音对话实测台 ↓"时当场打开折叠（不等 hashchange 之后的 route()，免得地址变了、实测台还没露出来）
document.querySelectorAll('#t-tts a[href="#/tools/voice"]').forEach((a)=>a.addEventListener('click',()=>{$('tts-more').open=true;}));
$('tts-more').addEventListener('toggle',()=>{if($('tts-more').open){try{window.voiceOpen();}catch(e){}}subSpySoon();});
$('dl').addEventListener('click',async()=>{const b=$('dl'),m=$('dl-msg');b.disabled=true;b.textContent='下载中…';m.className='msg';m.textContent='';
  try{const r=await fetch('/api/extension.zip',{credentials:'same-origin'});if(r.status===401){showLogin('请重新登录');return;}if(!r.ok)throw new Error('下载失败（'+r.status+'），稍后再试');
    const name=(/filename="([^"]+)"/.exec(r.headers.get('content-disposition')||'')||[])[1]||'marketing-copilot.zip';const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    m.className='msg ok';m.textContent='✓ 已下载 '+name+'，按下面的步骤安装或更新';}
  catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='下载插件 ${EXTENSION_VERSION}';}});
document.querySelectorAll('[data-f]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.f;document.querySelectorAll('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));toast('');load();}));
function setRange(rg){document.querySelectorAll('[data-rg]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.rg===rg)));const t=twDay(Date.now());
  if(rg==='today'){$('f-from').value=t;$('f-to').value=t;}else if(rg==='7'){$('f-from').value=twDay(Date.now()-6*864e5);$('f-to').value=t;}else{$('f-from').value='';$('f-to').value='';}load();}
document.querySelectorAll('[data-rg]').forEach(b=>b.addEventListener('click',()=>setRange(b.dataset.rg)));
['f-from','f-to'].forEach(id=>$(id).addEventListener('change',()=>{document.querySelectorAll('[data-rg]').forEach(x=>x.setAttribute('aria-pressed','false'));load();}));
['f-prod','f-plat'].forEach(id=>$(id).addEventListener('change',()=>load()));
// 排序记在这台电脑上，下次打开还是同样的排序
try{if(localStorage.getItem('qc-sort')==='score')$('f-sort').value='score';}catch(e){}
$('f-sort').addEventListener('change',()=>{try{localStorage.setItem('qc-sort',$('f-sort').value);}catch(e){}load();});
function query(){const q=new URLSearchParams({status:filter});if($('f-prod').value)q.set('product',$('f-prod').value);if($('f-plat').value)q.set('platform',$('f-plat').value);if($('f-from').value)q.set('from',$('f-from').value);if($('f-to').value)q.set('to',$('f-to').value);if($('f-sort').value==='score')q.set('sort','score');return '/api/queue?'+q;}
let qOkAt=0;
// 批 B 发版前（测试会话查出，改版前就有）：读清单不分先后，慢的旧请求晚到会盖掉新请求的结果（下拉是 demo2、列表却是 forecast 的），
// 旧的成功也会收掉新的失败红条。现在每次读拿一个序号 qSeq，只认最新那次；画上去的结果记下它对应的查询 qShown（批量删除前核对用）
let qSeq=0,qShown='',qShownSeq=0;
async function load(){
  $('bulk-confirm').hidden=true;
  const my=++qSeq,qs=query();let got;
  try{got=await call(qs);}catch(e){if(my!==qSeq)return;
    // 筛的项目在清单里已经一条都没有了（例如刚把它的都删了）：服务端不再认这个名字（400"不认识的项目"），这里如实写"0 条"，不当成读取失败、也不退回"全部"
    if(e.status===400&&$('f-prod').value&&/^不认识的项目/.test(e.message)){const pv=$('f-prod').value;state=Object.assign({},state,{items:[],total:0});qShown=qs;qShownSeq=my;qOkAt=Date.now();$('t-stale').hidden=true;showApp();render();$('total').textContent='共 0 条（'+(PROD[pv]||pv)+' 在清单里已经没有记录了）';subSpySoon();return;}
    if(e.message!=='请重新登录')qFail(e);return;}
  if(my!==qSeq)return;
  state=got;qShown=qs;qShownSeq=my;qOkAt=Date.now();$('t-stale').hidden=true;try{bootErr='';$('l-fail').hidden=true;}catch(e){}showApp();render();subSpySoon();
}
/** 清单读取失败：公共工具顶上的红条写中文原因；还没读到过时清单那块的结论也写明（不写"0 条"冒充没有） */
function qFail(e){const hm=qOkAt?tw(qOkAt).slice(11,16):'';$('t-stale-t').textContent='跟帖评论清单读取失败：'+e.message+'。'+(qOkAt?'下面是 '+hm+' 读到的内容。':'还没读到过内容。')+'点"再读一次"重试。';$('t-stale').hidden=false;
  if(!qOkAt){const l=$('q-lead');l.replaceChildren(Object.assign(document.createElement('span'),{className:'dot red'}),Object.assign(document.createElement('span'),{textContent:'清单还没读到，现在不知道有几条。'}));$('q-n').textContent='—';$('list').replaceChildren();}}
$('t-retry').addEventListener('click',async()=>{const b=$('t-retry');b.setAttribute('aria-busy','true');b.textContent='正在读…';await load();b.removeAttribute('aria-busy');b.textContent='再读一次';if($('t-stale').hidden)toast('已重新读取，现在是最新的');});
function render(){
  // 每天回帖上限按项目（D-2）：每条看它所在项目的"今天已回 / 上限"（state.caps）；老接口没有 caps 时用整体的
  const fullOf=(p)=>{const c=state.caps&&state.caps[p];return c?c.doneToday>=c.cap:state.doneToday>=state.cap;};
  $('count').textContent='今天已回 '+state.doneToday+' / '+state.cap;
  try{queueHead(fullOf);}catch(e){}
  const sel=$('f-prod'), cur=sel.value; sel.replaceChildren(Object.assign(document.createElement('option'),{value:'',textContent:'全部'}),...state.products.map(p=>Object.assign(document.createElement('option'),{value:p,textContent:PROD[p]||p})));sel.value=cur;
  $('total').textContent='共 '+state.total+' 条'+(state.total>state.items.length?'（只显示最近 '+state.items.length+' 条）':'');
  $('bulk').hidden=!state.items.length;$('bulk').textContent='删除筛选出的这 '+state.items.length+' 条';
  $('q-filters-s').textContent='筛选：'+filterText();
  const L=$('list');L.replaceChildren();
  if(!state.items.length){L.innerHTML='<div class="empty">'+(filter==='pending'?'没有待回的帖子。打开插件的自动模式，或者自己往下滑，分数够的会出现在这里。':'这里还没有记录。')+'</div><p class="hint" style="text-align:center">也可以换个筛选条件看看。</p>';return;}
  for(const it of state.items){
    const d=document.createElement('div');d.className='item';
    const left=document.createElement('div');left.style.minWidth='0';
    const who=document.createElement('div');who.className='who';
    const a=document.createElement('a');a.href=it.postUrl;a.target='_blank';a.rel='noopener';a.textContent=it.author||'原帖';
    who.append(Object.assign(document.createElement('span'),{className:'tag prod',textContent:PROD[it.product]||it.product}),Object.assign(document.createElement('span'),{className:'tag '+it.platform,textContent:P[it.platform]||it.platform}),a);
    if(it.score!=null)who.append(Object.assign(document.createElement('span'),{className:'score',textContent:it.score+' 分'}));
    if(it.stale&&filter==='pending')who.append(Object.assign(document.createElement('span'),{className:'stale',textContent:'可能已过时'}));
    const times=document.createElement('div');times.className='times';
    times.append(Object.assign(document.createElement('span'),{textContent:'存进来 '+tw(it.savedAt)}));
    if(it.postAt)times.append(Object.assign(document.createElement('span'),{textContent:'原帖发布 '+tw(it.postAt).slice(0,16)+'（约）'}));
    if(it.handledAt)times.append(Object.assign(document.createElement('span'),{textContent:(it.status==='done'?'我回了 ':'跳过 ')+tw(it.handledAt)}));
    left.append(who,times,Object.assign(document.createElement('p'),{className:'post',textContent:it.snippet}));
    if(it.reasons&&it.reasons.length){const w=document.createElement('div');w.className='why';w.append(Object.assign(document.createElement('b'),{textContent:'打分依据'}));const ul=document.createElement('ul');it.reasons.forEach(r=>ul.append(Object.assign(document.createElement('li'),{textContent:r})));w.append(ul);left.append(w);}
    const dr=Object.assign(document.createElement('div'),{className:'draft'});dr.append(Object.assign(document.createElement('span'),{className:'k',textContent:'AI 草稿'}),document.createTextNode(it.draft||''));
    if(it.source)dr.append(Object.assign(document.createElement('div'),{className:'src',textContent:'数据来源：'+it.source}));
    if(it.engine==='workers-ai')dr.append(Object.assign(document.createElement('div'),{className:'src',textContent:'备用 AI 写的（Gemini 当时用不了），发之前多看一眼'}));
    left.append(dr);
    const acts=document.createElement('div');acts.className='acts';
    if(filter==='pending'){
      const r=Object.assign(document.createElement('a'),{className:'btn primary',href:it.replyUrl,target:'_blank',rel:'noopener',textContent:'一键回复'});
      if(fullOf(it.product)){r.setAttribute('aria-disabled','true');r.textContent='今天已到上限';}
      r.addEventListener('click',()=>toast('已打开回复窗口。发完回来点"我回了"。'));
      acts.append(r,mk(it,'done','我回了'),mk(it,'skip','跳过','btn text'));
    }else acts.append(mk(it,'pending','放回待回'));
    acts.append(del(it,acts));
    d.append(left,acts);L.append(d);
  }
}
function mk(it,to,label,cls){const b=Object.assign(document.createElement('button'),{className:cls||'btn',type:'button',textContent:label});
  b.addEventListener('click',async()=>{b.disabled=true;b.textContent='处理中…';
    try{await call('/api/queue/'+it.id,{status:to});toast(to==='done'?'已移到"已回"':to==='skip'?'已移到"跳过"':'已放回待回');await load();}
    catch(e){toast(e.message,true);b.disabled=false;b.textContent=label;}});return b;}
function del(it,acts){const b=Object.assign(document.createElement('button'),{className:'btn text danger',type:'button',textContent:'删除'});
  b.addEventListener('click',()=>{const c=document.createElement('div');c.className='confirm';c.style.margin='0';
    c.append('删了不能恢复，确定？');
    const y=Object.assign(document.createElement('button'),{className:'btn small danger',type:'button',textContent:'确认删除'});
    const n=Object.assign(document.createElement('button'),{className:'btn small',type:'button',textContent:'取消'});
    n.addEventListener('click',()=>{c.replaceWith(b);});
    y.addEventListener('click',async()=>{y.disabled=true;y.textContent='正在删除…';n.disabled=true;
      try{await call('/api/queue/delete',{ids:[it.id]});toast('已删除 1 条');await load();}catch(e){toast('没删掉：'+e.message,true);y.disabled=false;y.textContent='确认删除';n.disabled=false;}});
    c.append(y,n);b.replaceWith(c);});
  return b;}
function rangeText(){const parts=[{pending:'待回',done:'已回',skip:'跳过'}[filter]];if($('f-prod').value)parts.push(PROD[$('f-prod').value]||$('f-prod').value);if($('f-plat').value)parts.push(P[$('f-plat').value]);if($('f-from').value||$('f-to').value)parts.push(($('f-from').value||'最早')+' ～ '+($('f-to').value||'今天'));return parts.join(' · ');}
/** 批 B：清单的一句话结论、角标、"今天已回"进度条（数据都来自这次 /api/queue 的返回） */
function queueHead(fullOf){const pend=filter==='pending',n=state.total,cap=state.cap,done=state.doneToday,left=Math.max(0,cap-done);
  const q=$('q-n');q.textContent=String(pend?n:state.items.length);q.className='cbadge'+(pend&&n?' red':'');
  const bar=$('q-bar');bar.style.width=(cap>0?Math.min(100,Math.round(done/cap*100)):0)+'%';bar.parentElement.className='meter'+(done>=cap?' bad':done>=cap*0.8?' warn':'');
  const sel=$('f-prod').value;const full=sel?fullOf(sel):done>=cap;let L;
  if(!pend)L=['gray',(filter==='done'?'已回 ':'跳过 ')+n+' 条'+(rangeText().indexOf(' · ')>0?'（'+rangeText().split(' · ').slice(1).join(' · ')+'）':'')+'。','点"放回待回"能放回去。'];
  else if(!n)L=['ok','没有待回的。','插件存进新的帖子后会出现在这里。'];
  else if(full)L=['red',n+' 条等你回，但今天已到上限（'+done+' / '+cap+'）。','明天再回，或者到"每天回帖上限"里调高。'];
  else L=['amber',n+' 条等你回，今天还能回 '+left+' 条。','先回分高的。'];
  const e=$('q-lead');e.replaceChildren(Object.assign(document.createElement('span'),{className:'dot '+L[0]}),Object.assign(document.createElement('span'),{textContent:L[1]}));if(L[2])e.append(Object.assign(document.createElement('span'),{className:'soft',textContent:L[2]}));}
/** 折叠"筛选"上写现在筛的是什么，不点开也知道 */
function filterText(){const ps=[$('f-prod').value?(PROD[$('f-prod').value]||$('f-prod').value):'全部项目',$('f-plat').value?P[$('f-plat').value]:'全部平台',$('f-sort').value==='score'?'评分高的在前':'最新的在前'];
  const rg=document.querySelector('[data-rg][aria-pressed="true"]');ps.push($('f-from').value||$('f-to').value?(rg&&rg.dataset.rg==='today'?'今天':rg&&rg.dataset.rg==='7'?'近 7 天':($('f-from').value||'最早')+' ～ '+($('f-to').value||'今天')):'全部时间');return ps.join(' · ');}
/** 一句话结论写进 .lead（和第三段脚本的 setLead 一样：圆点 + 结论 + 浅色补充） */
function leadT(id,dot,main,soft){const e=$(id);if(!e)return;e.replaceChildren(Object.assign(document.createElement('span'),{className:'dot '+dot}),Object.assign(document.createElement('span'),{textContent:main}));if(soft)e.append(Object.assign(document.createElement('span'),{className:'soft',textContent:soft}));}
// 批量删除按"确认框上写的那份列表"删：点按钮时记下这份列表的 id 和它对应的查询；按"确认删除"时再核对——列表还是这份、筛选没改、没有更新的读取在途，才删；
// 对不上就一条都不删，提示原因并重新读（删的是 id，服务端按 id 删，所以页面上看到的、确认框写的、实际删的三者必须是同一份）
let bulkSnap=null;
$('bulk').addEventListener('click',()=>{bulkSnap={q:qShown,seq:qShownSeq,ids:state.items.map(x=>x.id)};$('bulk-text').textContent='要永久删除现在列出的 '+state.items.length+' 条（'+rangeText()+'），删了不能恢复。';$('bulk-confirm').hidden=false;$('bulk-yes').focus();});
$('bulk-no').addEventListener('click',()=>{$('bulk-confirm').hidden=true;});
$('bulk-yes').addEventListener('click',async()=>{const y=$('bulk-yes');y.disabled=true;y.textContent='正在删除…';$('bulk-no').disabled=true;
  const same=bulkSnap&&bulkSnap.seq===qSeq&&bulkSnap.seq===qShownSeq&&bulkSnap.q===query()&&JSON.stringify(bulkSnap.ids)===JSON.stringify(state.items.map(x=>x.id));
  if(!same){bulkSnap=null;$('bulk-confirm').hidden=true;y.disabled=false;y.textContent='确认删除';$('bulk-no').disabled=false;toast('没删：列表和筛选条件对不上（刚改过筛选或列表正在重新读），一条都没删。已重新读取，请看清楚再点一次。',true);await load();return;}
  try{const r=await call('/api/queue/delete',{ids:bulkSnap.ids});bulkSnap=null;toast('已删除 '+r.deleted+' 条');await load();}catch(e){toast('没删掉：'+e.message,true);}
  finally{y.disabled=false;y.textContent='确认删除';$('bulk-no').disabled=false;}});
// 用量页：打开时读一次；停在这一页时每 30 秒自动刷新（0.3.5，B-2）；输入框正在改时不覆盖
let uTimer=null, uEditing=false;
function uStamp(){$('u-at').textContent='更新于 '+tw(Date.now()).slice(11)+'（停在这一页时每 30 秒自动刷新）';}
/** 批 B：用量和限额、按项目看用量的一句话结论（数据来自 /api/usage 的 left、accountLimit、byProject） */
function usageLead(j){const L=j.left||[];
  if(j.accountLimit&&j.accountLimit.text)leadT('u-lead','red','Cloudflare 说今天账号的额度用完了。','到台湾早上 8 点清零，下面写了原话。');
  else if(!L.length)leadT('u-lead','gray','读不到额度。','过 30 秒自动再试。');
  else{const ps=L.map((x)=>({x,left:x.cap>0?Math.max(0,Math.round((1-x.used/x.cap)*100)):0}));const worst=ps.reduce((a,b)=>b.left<a.left?b:a);
    if(worst.left<=10)leadT('u-lead','red',worst.x.label+' 今天只剩 '+worst.left+'%。','用完以后这本账的请求今天先停；两本账分开看。');
    else if(worst.left<=30)leadT('u-lead','amber',worst.x.label+' 今天还剩 '+worst.left+'%，省着用。','两本账分开看，不要加在一起。');
    else leadT('u-lead','ok','今天额度宽裕：'+ps.map((p)=>p.x.label+' 还剩 '+p.left+'%').join('，')+'。','两本账分开看，不要加在一起。');}
  const B=j.byProject||[];if(!B.length)leadT('bp-lead','gray','今天还没有按项目记下的用量。','插件第一次打分后，这里每个项目一行。');
  else{const g=B.reduce((a,x)=>a+x.gemini,0),w=B.reduce((a,x)=>a+x.workersAi,0);leadT('bp-lead','ok','今天 '+B.length+' 个项目有用量：Gemini 合计 '+g.toLocaleString()+' 次，Workers AI 合计 '+Math.round(w).toLocaleString()+' neurons。','只看、不设上限。');}}
async function loadUsage(manual){const b=$('u-refresh');if(manual){b.disabled=true;b.textContent='正在刷新…';}
  try{const j=await call('/api/usage');const rows=j.rows;if(!uEditing||manual){usage=rows;renderUsage();}renderByProject(j.byProject||[]);renderAcct(j.accountLimit);renderLeft(j.left||[]);renderPurpose(j.byPurpose||[]);usageLead(j);uStamp();subSpySoon();if(manual)$('u-msg').textContent='';}
  catch(e){$('u-at').textContent='刷新失败：'+e.message+'（30 秒后再试）';}
  finally{if(manual){b.disabled=false;b.textContent='立即刷新';}}}
function usageTimer(on){clearInterval(uTimer);uTimer=on?setInterval(()=>{if(page==='tools'&&document.visibilityState==='visible')loadUsage(false);},30000):null;}
$('u-refresh').addEventListener('click',()=>loadUsage(true));
$('u-rows').addEventListener('input',()=>{uEditing=true;});
function renderUsage(){const T=$('u-rows');T.replaceChildren();
  usage.forEach((u,i)=>{const tr=document.createElement('tr');const pct=Math.min(100,Math.round(u.used/u.cap*100));
    const cells=[u.label,String(u.req),u.tokIn.toLocaleString()+' / '+u.tokOut.toLocaleString()];
    cells.forEach((c,k)=>tr.append(Object.assign(document.createElement('td'),{className:k?'n':'',textContent:c})));
    const capTd=document.createElement('td');const inp=Object.assign(document.createElement('input'),{className:'cap-in',id:'cap-'+i,value:String(u.cap),inputMode:'numeric'});inp.setAttribute('aria-label',u.label+' 每天上限');capTd.append(inp,' '+u.unit);tr.append(capTd);
    const mt=document.createElement('td');mt.innerHTML='<span class="meter"><i></i></span> ';mt.querySelector('i').style.width=pct+'%';mt.append(u.used.toLocaleString()+' / '+u.cap.toLocaleString());tr.append(mt);
    const st=document.createElement('td');st.append(Object.assign(document.createElement('span'),{className:'state'+(u.state==='ok'?'':' warn'),textContent:u.stateText}));tr.append(st);
    tr.append(Object.assign(document.createElement('td'),{textContent:tw(u.resetAt).slice(5,16)+(u.model==='workers-ai'?'（UTC 0 点）':'（美西 0 点）')}));
    T.append(tr);});}
/** 按项目看用量（D-3）：今天每个项目的 Gemini 次数和 Workers AI neurons */
function renderByProject(list){const T=$('bp-rows');T.replaceChildren();
  if(!list.length){const tr=document.createElement('tr');tr.append(Object.assign(document.createElement('td'),{colSpan:3,textContent:'今天还没有按项目记下的用量'}));T.append(tr);return;}
  list.forEach(x=>{const tr=document.createElement('tr');const cell=(t,label,cls)=>{const c=Object.assign(document.createElement('td'),{textContent:t});if(label)c.dataset.label=label;if(cls)c.className=cls;tr.append(c);};
    cell(x.project==='_platform'?'平台自己（"测试 AI"）':(PROD[x.project]?x.project+'（'+PROD[x.project]+'）':x.project));cell(x.gemini.toLocaleString()+' 次','Gemini','n');cell(Math.round(x.workersAi).toLocaleString()+' neurons','Workers AI','n');T.append(tr);});}
/** 用量监控 · 还剩多少（Amos 2026-11-03）：两本账各一行，单位不一样，不加在一起 */
function tdc(tr,t,label,cls){const c=Object.assign(document.createElement('td'),{textContent:t});if(label)c.dataset.label=label;if(cls)c.className=cls;tr.append(c);return c;}
function renderLeft(list){const T=$('u-left'),N=$('u-left-notes');T.replaceChildren();N.replaceChildren();
  if(!list.length){const tr=document.createElement('tr');tr.append(Object.assign(document.createElement('td'),{colSpan:5,textContent:'读不到额度'}));T.append(tr);return;}
  list.forEach(x=>{const tr=document.createElement('tr');
    tdc(tr,x.label,'这本账');
    tdc(tr,x.used.toLocaleString()+' '+x.unit,'今天已用','n');
    tdc(tr,x.cap.toLocaleString()+' '+x.unit,'每天上限','n');
    const pct=x.cap>0?Math.min(100,Math.round(x.used/x.cap*100)):0;
    const L=tdc(tr,'','还剩','n');L.innerHTML='<span class="meter"><i></i></span> ';L.querySelector('i').style.width=pct+'%';
    const b=document.createElement('b');b.textContent=x.left.toLocaleString()+' '+x.unit;L.append(b,'（已用 '+pct+'%）');
    // 这个数靠不靠得住，就写在数字底下（服务端给的 caveatShort / caveat，src/usage.ts）：看得见数字就看得见这句话
    if(x.caveatShort)L.append(Object.assign(document.createElement('span'),{className:'flag',textContent:x.caveatShort}));
    tdc(tr,tw(x.resetAt).slice(5,16)+' · '+x.resetText,'什么时候清零');
    T.append(tr);
    if(x.caveat){const p=document.createElement('p');p.className='caveat';p.append(Object.assign(document.createElement('b'),{textContent:x.label+'：这个数怎么看'}),x.caveat);N.append(p);}});}
/** Cloudflare 自己说"账号额度用完了"：有就置顶一句红字，没有就整条不显示（服务端只给今天 UTC 日那一条，到点自动失效） */
function renderAcct(a){const P=$('u-acct');P.replaceChildren();
  if(!a||!a.text){P.hidden=true;return;}
  P.append(document.createTextNode(a.text));
  if(a.raw)P.append(Object.assign(document.createElement('span'),{className:'raw',textContent:'Cloudflare 原话：'+a.raw}));
  P.hidden=false;}
/** 用量监控 · 分别用到了哪里：没记下来的那一行次数写"没记录"，不补 0（底线 3） */
function renderPurpose(list){const T=$('u-purpose');T.replaceChildren();
  if(!list.length){const tr=document.createElement('tr');tr.append(Object.assign(document.createElement('td'),{colSpan:4,textContent:'今天还没有按用途记下的用量'}));T.append(tr);return;}
  list.forEach(x=>{const tr=document.createElement('tr');const n=x.neurons>=10?Math.round(x.neurons):Math.round(x.neurons*10)/10;
    tdc(tr,x.label,'用途');
    tdc(tr,n.toLocaleString()+' neurons','Workers AI（neurons）','n');
    tdc(tr,x.waiReq==null?'没记录':x.waiReq.toLocaleString()+' 次','Workers AI 次数','n');
    tdc(tr,x.geminiReq.toLocaleString()+' 次','Gemini 次数','n');
    T.append(tr);});}
// Webhook 开关（工作平台批 3）：读到状态才显示按钮（免得先显示一个不对的状态）；点了以后等服务端确认再变
// 审查 R8：每次读 / 切都拿一个序号，只认最新那次的返回（晚到的旧 GET 不能把按钮改回去）
let hookSeq=0;
async function loadHook(){const my=++hookSeq;const m=$('hook-msg');try{const a=await call('/api/active');if(my===hookSeq)showHook(a.on);}catch(e){if(e.message!=='请重新登录'){m.className='msg';m.textContent='读不到开关：'+e.message;leadT('hook-lead','red','暂时读不到开关。','点"公共工具"重新进来会再读一次。');}}}
// 批 B：开关样式（.switch，aria-pressed / aria-checked 都跟着），一句话结论写在 #hook-lead
function showHook(on){const b=$('hook-toggle');b.hidden=false;b.disabled=false;b.setAttribute('aria-pressed',String(!!on));b.setAttribute('aria-checked',String(!!on));$('hook-state').textContent=on?'开着（点一下关掉）':'关着（点一下打开）';b.className='switch';
  if(on)leadT('hook-lead','ok','开着：GitHub 的推送、PR、检查结果在正常写进来。','出问题时先关这里止损。');else leadT('hook-lead','amber','关着：新的事件不再写进"团队在做什么"。','要恢复就点开关打开。');}
$('hook-toggle').addEventListener('click',async()=>{const b=$('hook-toggle'),m=$('hook-msg');const want=b.getAttribute('aria-pressed')!=='true';++hookSeq;b.disabled=true;m.className='msg';m.textContent=want?'正在打开…':'正在关…';$('hook-state').textContent='处理中…';
  try{const r=await fetch('/api/hook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on:want}),credentials:'same-origin'});
    if(r.status===401){showLogin('请重新登录');return;}if(!r.ok)throw new Error('没切成（'+r.status+'），稍后再试');const j=await r.json().catch(()=>({on:want}));hookSeq++;showHook(typeof j.on==='boolean'?j.on:want);m.className='msg ok';m.textContent=want?'✓ 已打开：新的事件会写进"团队在做什么"':'✓ 已关掉：新的事件不写库';}
  catch(e){b.disabled=false;showHook(!want);m.className='msg';m.textContent=e.message;}});
// 每天回帖上限按项目（工作平台批 2，D-2）：GET / POST /api/reply-cap；1～50 的整数，前后端同一个范围
let replyRows=[];
async function loadReply(){try{replyRows=(await call('/api/reply-cap')).rows;renderReply();subSpySoon();}catch(e){if(e.message!=='请重新登录'){const m=$('rc-msg');m.className='msg';m.textContent='读不到上限：'+e.message;leadT('rc-lead','red','暂时读不到上限。','刷新页面再试。');
  // 批 C：还没读到过时表格也写读不到（以前结论写读不到、表格还是"正在读取…"）；读到过就保留上次的数
  if(!replyRows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='暂时读不到上限：'+e.message+'。刷新页面再试。';tr.append(td);$('rc-rows').replaceChildren(tr);}}}}
function renderReply(){const T=$('rc-rows');T.replaceChildren();
  replyRows.forEach(r=>{const tr=document.createElement('tr');tr.append(Object.assign(document.createElement('td'),{textContent:PROD[r.project]?r.project+'（'+PROD[r.project]+'）':r.project}));
    const c=document.createElement('td');c.dataset.label='每天上限';const inp=Object.assign(document.createElement('input'),{className:'cap-in',id:'rc-'+r.project,value:String(r.cap),inputMode:'numeric'});inp.setAttribute('aria-label',r.project+' 每天上限');c.append(inp,' 条');tr.append(c);
    const d=document.createElement('td');d.dataset.label='今天已回';d.textContent=r.doneToday+' 条'+(r.doneToday>=r.cap?'（到上限了）':'')+' ';
    const mt=document.createElement('span');mt.className='meter'+(r.doneToday>=r.cap?' bad':r.doneToday>=r.cap*0.8?' warn':'');mt.setAttribute('aria-hidden','true');const i=document.createElement('i');i.style.width=(r.cap>0?Math.min(100,Math.round(r.doneToday/r.cap*100)):0)+'%';mt.append(i);d.append(mt);tr.append(d);T.append(tr);});
  // 批 B：一句话结论（哪个项目今天到上限了）
  const full=replyRows.filter((r)=>r.doneToday>=r.cap);
  if(!replyRows.length)leadT('rc-lead','gray','还没有项目。','有项目页的项目会各占一行。');
  else if(full.length)leadT('rc-lead','amber',full.map((r)=>r.project+' 今天到上限了（'+r.doneToday+' / '+r.cap+'）').join('；')+'。','到上限的项目"一键回复"变灰，别的照常。');
  else leadT('rc-lead','ok',(replyRows.length>1?replyRows.length+' 个项目今天都没到上限':replyRows[0].project+' 今天还能回 '+(replyRows[0].cap-replyRows[0].doneToday)+' 条')+'。','上限按项目分开算。');}
$('rc-save').addEventListener('click',async()=>{const b=$('rc-save'),m=$('rc-msg');const caps={},bad=[];
  replyRows.forEach(r=>{const el=$('rc-'+r.project);const v=String(el.value).trim();const n=Number(v);const ok=/^[0-9]+$/.test(v)&&n>=1&&n<=50;el.setAttribute('aria-invalid',String(!ok));if(!ok)bad.push(r.project+' 要在 1～50 之间（整数）');caps[r.project]=n;});
  if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
  b.disabled=true;b.textContent='正在保存…';m.textContent='';
  try{replyRows=(await call('/api/reply-cap',{caps})).rows;renderReply();m.className='msg ok';m.textContent='✓ 已保存，马上生效';load();}catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='保存上限';}});
// 两层菜单固定在屏幕顶部（批 2，Amos 2026-11-02）：量出菜单高度，跳到模块时模块顶端停在菜单下面
function barsH(){const h=Math.ceil($('bars').getBoundingClientRect().height);document.documentElement.style.setProperty('--bars-h',h+'px');}
try{new ResizeObserver(barsH).observe($('bars'));}catch(e){window.addEventListener('resize',barsH);}barsH();
/** 二级菜单（批 A 起一级菜单也算）能往右横滑时加 .more（右边缘渐隐），滑到底就去掉 */
function subHint(){document.querySelectorAll('.sub .in, #nav1').forEach(x=>x.classList.toggle('more',x.scrollWidth>x.clientWidth+1&&x.scrollLeft+x.clientWidth<x.scrollWidth-1));}
document.querySelectorAll('.sub .in, #nav1').forEach(x=>x.addEventListener('scroll',subHint,{passive:true}));window.addEventListener('resize',subHint);
window.addEventListener('hashchange',()=>setTimeout(subHint,0));setTimeout(subHint,0);
$('u-save').addEventListener('click',async()=>{const b=$('u-save'),m=$('u-msg');const caps={};const bad=[];
  usage.forEach((u,i)=>{const el=$('cap-'+i);const v=Number(el.value);const ok=Number.isInteger(v)&&v>=1&&v<=u.max;el.setAttribute('aria-invalid',String(!ok));if(!ok)bad.push(u.label+' 要在 1～'+u.max.toLocaleString()+' 之间');caps[u.model]=v;});
  if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
  b.disabled=true;b.textContent='正在保存…';m.textContent='';
  try{const j=await call('/api/usage',{caps});usage=j.rows;uEditing=false;renderUsage();renderAcct(j.accountLimit);renderLeft(j.left||[]);uStamp();m.className='msg ok';m.textContent='✓ 已保存，下一次请求开始生效';}catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='保存上限';}});
// 打开页面时先读一次清单，顺便判断登录了没有（没登录回 401 → 登录框）。
// 批 C：以前别的失败（服务出错、断网）一律吞掉，页面只剩顶栏；现在照样显示页面框架，清单那块写中文原因 + "再读一次"（同 load() 的失败）
// 读失败时记在 bootErr：如果随后发现没登录（别的接口回 401 → showLogin），登录框上也写明读取失败 + "再读一次"
let bootErr='';
function boot(){const my=++qSeq,qs=query();return call(qs).then(j=>{bootErr='';$('l-fail').hidden=true;if(my===qSeq){state=j;qShown=qs;qShownSeq=my;qOkAt=Date.now();}showApp();render();route();})
  .catch((e)=>{if(e.message==='请重新登录'||my!==qSeq)return;bootErr=e.message;$('l-fail-t').textContent='跟帖评论清单读取失败：'+e.message+'。登录后会再读一次，也可以点"再读一次"。';showApp();route();qFail(e);});}
$('l-retry').addEventListener('click',async()=>{const b=$('l-retry');b.disabled=true;b.textContent='正在读…';await boot();b.disabled=false;b.textContent='再读一次';});
boot();
</script>
<script>
// 公司总览（原运营仪表盘"公司"页）：整段 try/catch；这里只定义函数，打开公司总览（go('company')）时才读数据、渲染，出错只影响这一页
// 界面改版·批 C（2026-11-05，Amos"第三批选 a"）：三块都是统一的卡片模块"header.mh → .lead（由数据算）→ 主内容 → 默认收起的 details.more"；
// 只留 各岗位这周在做什么（co-people）、这周学到了什么（co-learn）、做得怎么样（co-health），顺序 = 二级菜单 #sub-company 的顺序。
// "需要我的事"去掉了（和工作台"全部待办"重复、件数对不上）；项目、下周的事、摘要数字也不在这一页了（工作台有项目概况、公司数字）。
try{
const CO={data:null,latest:null};
const SRCN={agents:'agents','new-forecast':'new-forecast',marketing:'Marketing'};
const KINDN={projects:'项目版图',status:'状态卡',handoff:'交接记录',todo:'Amos 待办',weekly:'周报',learning:'岗位学习',prs:'要你决定的 PR',ci:'自动检查'};
const ROLES=['产品','市场','研发','测试','运维安全','运维','安全','经营'];
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;};
const ago=(ms)=>{const m=Math.floor(Math.max(0,CO.data.now-ms)/60000);if(m<1)return '刚刚';if(m<60)return m+' 分钟前';const h=Math.floor(m/60);if(h<48)return h+' 小时前';return Math.floor(h/24)+' 天前';};
const blocks=(kind)=>CO.data.blocks.filter(b=>b.kind===kind);
const newest=(bs)=>bs.reduce((a,b)=>(!a||b.source_at>a.source_at)?b:a,null);
const roleIdx=(b)=>{const k=ROLES.indexOf((b.payload&&b.payload.role)||b.key);return k<0?99:k;};
const roleOf=(b)=>(b.payload&&b.payload.role)||b.key||'';
function stamp(bs,label){const n=newest(bs);if(!n)return el('span','stamp',label||'');const s=el('span','stamp',(label?label+' · ':'')+'更新于 '+ago(n.source_at)+(bs.every(b=>b.stale)?'（超过 7 天没更新）':''));s.title=tw(n.source_at);return s;}
/** 一句话结论（同工作台 setLead）：前面一个状态点 .dot.red/.amber/.ok/.gray，后面主句 + 灰色补充 */
function lead(dot,main,soft){const p=el('p','lead');p.append(el('span','dot '+dot),el('span',null,main));if(soft)p.append(el('span','soft',soft));return p;}
/** 卡片模块：标题行（标题 + 角标 + 右边"哪份文件 · 更新于"）→ 解析失败的红条 → 结论 → 主内容 → 折叠说明 */
function card(id,title,bs,label,o){const sec=el('section','card mod');sec.id=id;const h=el('header','mh');const h2=el('h2',null,title);if(o&&o.badge!=null)h2.append(' ',el('span','cbadge'+(o.red?' red':''),o.badge));
  h.append(h2,el('span','sp'));if(bs)h.append(stamp(bs,label));sec.append(h);
  if(bs&&bs.length&&bs.every(b=>b.stale))sec.classList.add('old');
  if(bs)bs.filter(b=>b.status==='error').forEach(b=>sec.append(el('p','co-err','解析失败：'+b.error+'（'+KINDN[b.kind]+(b.key?' · '+b.key:'')+(b.payload?'，下面是上次成功的内容':'')+'）')));
  return sec;}
function more(sum,paras){const d=el('details','more');d.append(el('summary',null,sum));const i=el('div','in');paras.forEach(t=>i.append(el('p',null,t)));d.append(i);return d;}
const body=(flush)=>el('div','mbody'+(flush?' flush':''));
const empty=(t,s)=>{const p=el('p','empty co-empty');p.append(el('b',null,t||'还没收到数据'));if(s)p.append(el('span',null,s));return p;};
function pill(text,cls){return el('span','pill '+cls,text);}
function table(heads,rows,widths){const w=el('div','tablewrap');const t=el('table','stack');if(widths){const cg=el('colgroup');widths.forEach(x=>{const c=el('col');c.style.width=x;cg.append(c);});t.append(cg);}const th=el('thead');const tr=el('tr');heads.forEach(h=>tr.append(el('th',null,h)));th.append(tr);const tb=el('tbody');rows.forEach(r=>tb.append(r));t.append(th,tb);w.append(t);return w;}
function td(label,content,cls){const c=el('td',cls||null);if(label)c.dataset.label=label;(Array.isArray(content)?content:[content]).forEach(x=>{if(x==null||x==='')return;c.append(x);});if(!c.childNodes.length)c.append('—');return c;}
const errs=(bs)=>bs.filter(b=>b.status==='error').length;
/** ① 各岗位这周在做什么（交接记录）。结论：几个岗位有记录、谁超过 7 天没更新、重复犯错共几次 */
function peopleCard(){const hs=blocks('handoff').slice().sort((a,b)=>roleIdx(a)-roleIdx(b));
  const c=card('co-people','各岗位这周在做什么',hs,'交接记录',{badge:hs.length});
  const old=hs.filter(b=>b.stale).map(roleOf),mis=hs.map(b=>({r:roleOf(b),n:b.payload&&typeof b.payload.mistakes==='number'?b.payload.mistakes:0})).filter(x=>x.n>0),sum=mis.reduce((a,x)=>a+x.n,0);
  const soft=sum?'重复犯错共 '+sum+' 次（'+mis.map(x=>x.r+' '+x.n).join('、')+'）。':'这周没有重复犯错。';
  if(!hs.length)c.append(lead('gray','还没收到交接记录。','各岗位交接时写的"做了什么、下一步"会列在这里。'));
  else if(errs(hs))c.append(lead('red',errs(hs)+' 份交接记录解析失败，下面是上次成功的内容。',soft));
  else if(old.length)c.append(lead('amber',hs.length+' 个岗位有交接记录，'+old.join('、')+' 超过 7 天没更新。',soft));
  else c.append(lead(sum?'amber':'ok',hs.length+' 个岗位这周都更新了交接记录。',soft));
  const b=body(true);
  if(!hs.length)b.append(empty());
  else b.append(table(['岗位','做了什么','下一步','重复犯错'],hs.map(x=>{const p=x.payload||{};const tr=el('tr');if(x.stale)tr.classList.add('old');tr.append(td(null,el('b',null,roleOf(x))),td('做了什么',p.done||''),td('下一步',p.next||''),td('重复犯错',typeof p.mistakes==='number'?String(p.mistakes):'','num'));return tr;}),['14%','38%','34%','14%']));
  c.append(b,more('这一块从哪来',['来自 agents 仓库各岗位的交接记录，合并到 main 时自动送来。"重复犯错"是交接记录里自己报的同一个错又犯的次数。','灰色的一行 = 那个岗位的交接记录超过 7 天没更新。']));return c;}
/** ② 这周学到了什么（岗位学习）。结论：这周几条、各岗位几条 */
function learnCard(){const ls=blocks('learning').slice().sort((a,b)=>roleIdx(a)-roleIdx(b));const items=[];ls.forEach(b=>{const p=b.payload||{};(p.items||[]).forEach(x=>items.push({role:p.role||b.key,title:x.title,link:x.link}));});
  const note=ls.map(b=>b.payload&&b.payload.note).filter(Boolean)[0];
  const c=card('co-learn','这周学到了什么',ls,note||'岗位学习',{badge:items.length});
  const by=[];items.forEach(x=>{const f=by.find(y=>y.r===x.role);if(f)f.n++;else by.push({r:x.role,n:1});});
  if(!ls.length)c.append(lead('gray','还没收到岗位学习。','各岗位这周学到的东西会列在这里。'));
  else if(errs(ls))c.append(lead('red','岗位学习解析失败，下面是上次成功的内容。',''));
  else if(!items.length)c.append(lead('gray','这周还没有新的学习。',''));
  else c.append(lead(ls.every(b=>b.stale)?'amber':'ok','这周学到 '+items.length+' 条。'+(ls.every(b=>b.stale)?'超过 7 天没更新。':''),by.map(x=>x.r+' '+x.n).join('、')));
  const b=body(true);
  if(!ls.length)b.append(empty());else if(!items.length)b.append(empty('这周还没有新的学习'));
  else{const ul=el('ul','list');items.forEach(x=>{const li=el('li');li.append(el('span','who',x.role));const w=el('span','what');if(x.link){const a=el('a',null,x.title);a.href=x.link;a.target='_blank';a.rel='noopener';w.append(a);}else w.append(x.title||'');li.append(w);ul.append(li);});b.append(ul);}
  c.append(b,more('这一块从哪来',['来自 agents 仓库各岗位的学习记录（经验、案例），点标题看原文。整块变灰 = 超过 7 天没有新的学习送来。']));return c;}
const CIP={success:['绿','p-ok'],failure:['红','p-err'],cancelled:['已取消','p-warn'],running:['运行中','p-warn'],none:['无 CI','p-mute'],off:['已关','p-warn']};
/** ③ 做得怎么样（各仓库 main 的 CI、最近部署）。结论：几个红的、几个在跑、都绿；补充是周报里的规则版本、成本、重复犯错 */
function healthCard(){const order=['marketing','new-forecast','agents'];const cs=blocks('ci').slice().sort((a,b)=>(a.key?1:0)-(b.key?1:0)||order.indexOf(a.source)-order.indexOf(b.source));
  const nameOf=(b)=>{const p=b.payload||{};return p.name||b.key||SRCN[b.source]||b.source;};
  const red=cs.filter(b=>b.payload&&b.payload.conclusion==='failure'),run=cs.filter(b=>b.payload&&b.payload.conclusion==='running'),old=cs.filter(b=>b.stale);
  const c=card('co-health','做得怎么样',cs,'',{badge:red.length?red.length+' 红':null,red:true});
  const w=CO.latest&&CO.latest.payload;const parts=[];if(w){if(w.rules)parts.push('规则版本 '+w.rules);if(w.cost)parts.push('本周成本 '+w.cost);if(typeof w.mistakes==='number')parts.push('重复犯错 '+w.mistakes+' 次');}
  const soft=parts.join(' · ');
  if(!cs.length)c.append(lead('gray','还没收到自动检查的结果。',soft));
  else if(red.length)c.append(lead('red',red.length+' 个 main 的自动检查是红的：'+red.map(nameOf).join('、')+'。',soft));
  else if(run.length)c.append(lead('amber',run.map(nameOf).join('、')+' 的自动检查还在跑，其余都是绿的。',soft));
  else if(old.length)c.append(lead('amber',cs.length+' 个都不是红的，'+old.map(nameOf).join('、')+' 超过 7 天没更新。',soft));
  else c.append(lead('ok',cs.length+' 个仓库 / 任务的 main 都没有红的。',soft));
  const b=body(true);
  if(!cs.length)b.append(empty());
  else{const rows=cs.map(x=>{const p=x.payload||{};const tr=el('tr');if(x.stale)tr.classList.add('old');const k=CIP[p.conclusion]||['—','p-mute'];
    let ci=pill(k[0],k[1]);if(p.url){const a=el('a','pill '+k[1],k[0]);a.href=p.url;a.target='_blank';a.rel='noopener';ci=a;}
    const dep=p.sha?(p.sha.slice(0,7)+(typeof p.at==='number'?' · '+tw(p.at).slice(5,10).replace('-','/'):'')):'';
    tr.append(td(null,el('b',null,nameOf(x))),td('main 的 CI',ci),td('最近部署',dep,'num'),td('说明',p.note||''));return tr;});
    b.append(table(['仓库 / 任务','main 的 CI','最近部署','说明'],rows,['26%','16%','22%','36%']));}
  c.append(b,more('颜色和更新时间怎么看',['"绿 / 红"是各仓库 main 分支最近一次自动检查（CI）的结果，点一下看那次运行。','灰色 = 数据超过 7 天没更新。每块右上角写"更新于多久前"。合并或开、关 PR 后 1～2 分钟送到，点上面的"刷新"再看。']));return c;}
function renderCompany(){const B=$('co-body');B.replaceChildren();
  if(!CO.data.configured&&!CO.data.blocks.length&&!CO.data.weekly){const c=card('co-off','还没开通',null);c.append(lead('gray','公司数据还没接上。','等 Amos 填好连接各仓库的令牌后，各仓库合并或开、关 PR 时会自动把最新情况送来。'));const b=body(true);b.append(empty('还没开通'));c.append(b);B.append(c);subSpySoon();return;}
  B.append(peopleCard(),learnCard(),healthCard());
  // 从 #/company/<模块> 打开时，模块要等数据画完才有：画完滚过去，并以它为二级菜单的选中项（同 route() 的 subPin）
  if(coMod){const m=$(coMod);coMod='';if(m){m.scrollIntoView({block:'start'});subPinTo(m.id,m);}}
  subLast='';subSpySoon();}
/* 读取的序号和在飞数量：同一时刻可能有好几次读（进页、切回这一页、点刷新），每次读回来都会整块重画 #co-body。
   只认最新一次读的结果（CO_SEQ），先发后到的旧结果丢掉；刷新按钮等所有读都回来了再恢复（CO_N）。 */
let CO_SEQ=0,CO_N=0;
async function loadCompany(){const seq=++CO_SEQ;const b=$('co-refresh');CO_N++;b.disabled=true;b.textContent='正在刷新…';
  try{const j=await call('/api/company');
    if(seq!==CO_SEQ)return;// 这次读已经过期（有更新的读）：丢掉，别盖掉新的
    CO.data=j;CO.latest=j.weekly;
    $('co-at').textContent='读取于 '+tw(j.now).slice(11)+(j.configured?'':'（还没开通，显示的是以前收到的）');renderCompany();}
  catch(e){if(e.message==='请重新登录'||seq!==CO_SEQ)return;$('co-at').textContent='暂时读不到：'+e.message+'，点"刷新"再试';
    if(!CO.data){const B=$('co-body');B.replaceChildren();const c=card('co-fail','暂时读不到',null);c.append(lead('red','暂时读不到：'+e.message,'公司数据存在这个服务里，读不到一般是服务暂时出错或网络断了，过一会儿再试。'));
      const r=el('button','btn','重试');r.type='button';r.addEventListener('click',()=>loadCompany());const p=body();p.append(r);c.append(p);B.append(c);}}
  finally{if(!--CO_N){b.disabled=false;b.textContent='刷新';}}}
/** 打开公司总览。already = 本来就停在这一页（route() 可能因为别的原因再跑一遍，比如项目名单变了）：已经读到或正在读就不再读一遍 */
var companyOpen=function(already){if(already&&(CO.data||CO_N))return;
  if(!CO.data){const B=$('co-body');B.replaceChildren();const c=el('section','card');const s=el('div','skels');s.append(el('span','skel'),el('span','skel'),el('span','skel'));c.append(s,el('p','sr','正在读取…'));B.append(c);}loadCompany();};
$('co-refresh').addEventListener('click',()=>loadCompany());
}catch(e){var companyOpen=function(){$('co-at').textContent='这一页出错了：'+e.message;};}
</script>
<script>
// 工作台、forecast 项目页（工作平台批 1：PR 1、PR 2）：整段 try/catch，出错只影响这两页（同"公司总览"页的做法）；清单、用量、插件下载的脚本不动。
// 数据：GET /api/company（块、打勾、填的数字）+ GET /api/queue（清单条数）。打勾 POST /api/company/done 带 seen（另一处改过就 409）；填数字 POST /api/company/report。
// 时间一律用浏览器的 Date.now()（台湾时间显示）；停在这两页时每 30 秒重读一次，切走停、切回马上读。
try{
const CFG=${JSON.stringify(PLATFORM_CONFIG)};
// okAt = 上一次读成功的时间（读取失败时写"下面是 HH:MM 读到的"）；pf = 全部待办按哪个项目筛选（'' = 全部）；noneOpen = "没定截止时间"那组展开了没有（只记在这一页）
const PL={active:null,data:null,qAll:null,qProj:{},done:new Map(),reports:[],page:'',proj:'',scroll:'',timer:null,busy:false,again:false,err:'',errWhy:'',at:0,okAt:0,want:new Map(),copy:null,open:new Set(),vals:{},det:new Set(),more:new Set(),peek:false,retry:0,pf:'',noneOpen:false,ver:0,local:new Map()};
/** 现在打开的是哪个项目（地址里的；地址没指就用第一个） */
const curProj=()=>(typeof proj==='string'&&proj&&(PROJS.indexOf(proj)>=0||!projsReady))?proj:(PROJS[0]||'');
/** projects 块 → 有项目页的项目名；和服务端 src/projects.ts projectPagesFrom 同一套规则（C108） */
function pagesFrom(data){const b=((data&&data.blocks)||[]).find((x)=>x.kind==='projects'&&x.payload);const its=b&&Array.isArray(b.payload.items)?b.payload.items:[];const out=[];
  its.forEach((x)=>{const n=x&&typeof x.name==='string'?x.name.trim():'';if(n&&CFG.NOT_PROJECTS.indexOf(n)<0&&out.indexOf(n)<0)out.push(n);});
  return out.length?out.slice(0,PCFG.MAX_PROJECT_PAGES):PCFG.PROJECT_PAGES_FALLBACK.slice();}
const HR=3600e3,DY=864e5,WD='日一二三四五六';
const SRC={agents:'agents','new-forecast':'new-forecast',marketing:'Marketing'};
const pe=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;};
const link=(text,href,cls,ext)=>{const a=pe('a',cls||null,text);a.href=href;if(ext!==false&&/^https:/.test(href)){a.target='_blank';a.rel='noopener';}return a;};
const p2=(n)=>String(n).padStart(2,'0');
const tp=(ms)=>{const d=new Date(ms+8*HR);return {y:d.getUTCFullYear(),mo:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),mi:d.getUTCMinutes(),wd:d.getUTCDay()};};
const md=(ms)=>{const t=tp(ms);return t.mo+'/'+t.d;};
const dateL=(ms)=>{const t=tp(ms);return t.mo+'/'+t.d+'（周'+WD[t.wd]+'）'+p2(t.h)+':'+p2(t.mi);};
function dur(ms){const m=Math.floor(Math.abs(ms)/6e4);const day=Math.floor(m/1440),h=Math.floor(m%1440/60),mi=m%60;if(day)return day+' 天'+(h?' '+h+' 小时':'');if(h)return h+' 小时'+(mi?' '+mi+' 分':'');return Math.max(1,mi)+' 分钟';}
/** 提示条：成功 3 秒、失败 8 秒；带 act 时多一个按钮（例如打勾后的"撤销"），有按钮时停 5 秒 */
function toastP(t,err,act){let e=$('p-toast');if(!e){e=pe('p');e.id='p-toast';e.setAttribute('role','status');document.body.append(e);}e.replaceChildren(pe('span',null,t));e.className=err?'err':'';
  if(act){const b=pe('button',null,act.label);b.type='button';b.addEventListener('click',()=>{e.hidden=true;act.fn();});e.append(b);}
  e.hidden=false;clearTimeout(toastP.t);toastP.t=setTimeout(()=>{e.hidden=true;},err?8000:act?5000:3000);}
// 填数字：和服务端 src/projects.ts normReport 同一套规则（C108）
function normReport(name,raw){const f=CFG.REPORT_FIELDS[name];if(!f)return {why:'不认识这一格'};const s=String(raw==null?'':raw).replace(/[０-９]/g,(c)=>String.fromCharCode(c.charCodeAt(0)-0xfee0)).replace(/[\\s　]+/g,'');
  if(!s)return {why:'还没填（不知道就填 0）'};if(!/^\\d{1,9}$/.test(s))return {why:'要填 0 或正整数，不带小数点和负号'};const n=Number(s);if(f.max!=null&&n>f.max)return {why:'要在 0～'+f.max+' 之间'};return {value:String(n)};}
const blocks=(kind)=>PL.data?PL.data.blocks.filter((b)=>b.kind===kind):[];
const okBlocks=(kind)=>blocks(kind).filter((b)=>b.payload);
/** 在跑的项目：有状态卡、又不是工具层的（工作平台、Marketing） */
function projects(){return okBlocks('status').map((b)=>b.key).filter((k)=>CFG.NOT_PROJECTS.indexOf(k)<0);}
const repoProj=(src)=>CFG.REPO_PROJECT[src]||'公司';
const packKey=(p)=>'pack:'+p.project+':'+p.date;
const stepKey=(p,n)=>'step:'+p.project+':'+p.date+':'+n;
const isDone=(key)=>PL.want.has(key)?PL.want.get(key):PL.done.has(key);
// 批 2：待办正文在当前页面展开（Amos 2026-11-02："看待办 加载的不就是文字吗"）。有 body / questions、链接不是外部平台的 → 主按钮在页面里展开正文；
// 要到外部平台（X、Threads 等）操作的照旧是外链。正文只用 textContent 显示，服务端已按白名单和 4000 字上限清洗过。
const external=(u)=>!!u&&!/^https:\\/\\/github\\.com\\//.test(u);
function withDetail(o,it,href){const body=typeof it.body==='string'?it.body:'';const qs=Array.isArray(it.questions)?it.questions.filter((q)=>q&&q.q):[];
  if((body.trim()||qs.length)&&!external(href))o.detail={body,cut:it.body_cut===true,qs,href:href||''};return o;}
function formFor(text){for(const f of CFG.REPORT_FORMS)if(new RegExp(f.match).test(text||''))return f.fields;return null;}
/** 全部待办（各来源合在一起）：{key, proj, title, why, due, urgent, href/btn 或 form 或 go} */
function items(){const out=[];const pj=projects();const projOf=(k)=>pj.indexOf(k)>=0?k:'公司';
  okBlocks('ci').forEach((b)=>{const p=b.payload;if(p.conclusion!=='failure')return;
    out.push({key:'ci:'+b.source+':'+(b.key||'')+':'+(p.sha||p.at||b.source_at),urgent:true,proj:repoProj(b.source),title:(SRC[b.source]||b.source)+(b.key?' · '+b.key:'')+'：有一项改动没通过自动检查',why:'没通过前不能合并，团队会先修；你看一眼就行。'+(p.note?'（'+p.note+'）':''),href:p.url,btn:'看哪里出错'});});
  okBlocks('todo').forEach((b)=>{const n={};(b.payload.items||[]).forEach((it)=>{const t=it.type||'action';n[t]=n[t]==null?0:n[t]+1;
    const o={key:'todo:'+b.key+':'+(it.id||(t==='confirm'?'c':t.charAt(0))+n[t]),proj:projOf(b.key),title:it.text||'',why:[t==='confirm'?'要你决定'+(it.level?'（'+it.level+'）':''):'',it.hint||''].filter(Boolean).join(' · '),due:typeof it.due==='number'?it.due:null};
    const f=t==='report'?formFor(it.text):null;if(f){o.form=f;o.btn='去填数字';}else{if(it.link){o.href=it.link;o.btn=it.link_text||'打开';}withDetail(o,it,it.link);if(o.detail&&!o.btn)o.btn='看说明';}out.push(o);});});
  okBlocks('prs').forEach((b)=>(b.payload.items||[]).forEach((it)=>{const look=it.tag==='look';
    // 批 2 新口径（Amos 2026-11-02："只有agents才是公司……如果真有人提交了，只需要给我看就好"）：外部人提交的单独一条，只给"在GitHub 打开"，不当"要你决定"
    if(it.external){out.push({key:'pr:'+b.source+':'+it.number,proj:repoProj(b.source),title:it.title||'',why:'外部提交，给你看一下（'+(SRC[b.source]||b.source)+' #'+it.number+'）',due:null,gh:it.url});return;}
    // 正文只认 agents：代码仓库推来的 PR 只显示标题和链接（服务端也不存，这里再挡一次）
    const src=b.source==='agents'?it:{};
    out.push(withDetail({key:'pr:'+b.source+':'+it.number,proj:repoProj(b.source),title:it.title||'',why:(look?'只要看，不用回；你不反对的话开 PR 后 48 小时自动生效。':'要你决定：看完在 Claude 窗口里回复。')+'（'+(SRC[b.source]||b.source)+' #'+it.number+'）',due:look&&typeof it.opened_at==='number'?it.opened_at+48*HR:null,href:it.url,btn:look?'去看这份改动':'看 PR'},src,it.url));}));
  okBlocks('status').forEach((b)=>(b.payload.waiting||[]).forEach((it)=>out.push(withDetail({key:'wait:'+b.key+':'+(it.id||String(it.text||'').slice(0,80)),proj:projOf(b.key),title:it.text||'',why:'状态卡"在等谁"'+(it.hint?' · '+it.hint:''),due:null,href:it.link||b.payload.link,btn:it.link?'打开':'看状态卡'},it,it.link||b.payload.link))));
  okBlocks('pack').forEach((b)=>{const p=b.payload;if(!p.project||!p.date)return;const first=(p.posts||[])[0];
    const o={key:packKey(p),proj:p.project,title:'照操作指引做完这周的 '+(p.steps||[]).length+' 步（周包 '+p.date.slice(5).replace('-','/')+'）',why:(first?'第 1 条帖子要在 '+(first.at_text||'')+' 发出。':'')+'跟着指引一步步做，每步做完打勾；都勾了这件自动打勾。',due:typeof p.due==='number'?p.due:null};
    if(PROJS.indexOf(p.project)>=0){o.go='#/'+encodeURIComponent(p.project)+'/guide';o.btn='打开分步指引';}else if(p.link){o.href=p.link;o.btn='看周包';}out.push(o);});
  return out;}
function sorted(list){const v=(x)=>x.urgent?-Infinity:x.due==null?Infinity:x.due;return list.map((x,i)=>[x,i]).sort((a,b)=>{const p=v(a[0]),q=v(b[0]);return p===q?a[1]-b[1]:p<q?-1:1;}).map((x)=>x[0]);}
function lvl(x,now){if(x.urgent)return 'over';if(x.due==null)return 'none';const d=x.due-now;return d<0?'over':d<DY?'soon':'later';}
function badge(x,now){const l=lvl(x,now);const t=x.urgent?'没通过':l==='none'?'没定截止时间':(x.due<now?'已超时 ':'还剩 ')+dur(x.due-now);return pe('span','badge b-'+l,t);}
const dueText=(x)=>x.urgent?'现在就看':x.due==null?'':'截止 '+dateL(x.due);
// ---- 打勾（带 seen：页面上次看到的完成时间；另一处改过就 409，刷新后提示） ----
async function post(path,body){try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.status===401)showLogin('请重新登录');return {ok:r.ok,status:r.status,j};}
  catch(e){return {ok:false,status:0,j:{error:'连不上服务（'+e.message+'），稍后再试'}};}}
async function setDone(key,done){const seen=PL.done.has(key)?PL.done.get(key):null;PL.want.set(key,done);
  const r=await post('/api/company/done',{key,done,seen});PL.want.delete(key);
  if(r.status===409){toastP('已被另一处改过，已刷新',true);await refresh();return false;}
  if(!r.ok){toastP('没记上：'+(r.j.error||'出错了（'+r.status+'）')+'，请再点一次',true);renderAll();return false;}
  // 批 C（测试会话查出，改版前就有）：打勾成功后记一个"本地已确认"的版本；在这之前发出的 GET /api/company 晚回来时，不许拿旧的 done 盖掉它（见 refresh()）
  PL.ver++;PL.local.set(key,{ver:PL.ver,done,at:r.j.at});
  if(done)PL.done.set(key,r.j.at);else PL.done.delete(key);return true;}
async function tick(x,b){b.disabled=true;if(await setDone(x.key,true)){toastP('已打勾，收进"做完的"。',false,{label:'撤销',fn:async()=>{if(await setDone(x.key,false)){toastP('已放回待办');renderAll();}}});renderAll();}}
async function undo(x,b){b.disabled=true;b.textContent='处理中…';if(await setDone(x.key,false)){toastP('已放回待办');renderAll();}}
// ---- 待办列表 ----
function todoLi(x,first,now){const l=lvl(x,now);const li=pe('li','todo '+l+(first?' first':''));li.dataset.key=x.key;
  const t=pe('button','tick','✓');t.type='button';t.setAttribute('aria-label','做完了，打勾');t.title='做完了点这里';t.addEventListener('click',()=>tick(x,t));
  // 批 A：标题在上，下面一行辅助（还剩多久 · 截止 · 项目），再下面一行为什么（原型 prototype-work.html .todo .t / .m）
  const body=pe('div','body');const due=pe('div','due');due.append(badge(x,now));const dt=dueText(x);if(dt)due.append(pe('span',null,dt));due.append(pe('span','ptag',x.proj));
  body.append(pe('div','ttl',x.title),due);if(x.why)body.append(pe('p','why',x.why));
  const go=pe('div','go');
  if(x.form){const f=formEl(x);body.append(f);const b=pe('button','btn primary',x.btn+' →');b.type='button';b.dataset.act=x.key;b.addEventListener('click',()=>{f.hidden=false;PL.open.add(x.key);const i=f.querySelector('input');if(i)i.focus();});go.append(b);}
  else if(x.go)go.append(link(x.btn+' →',x.go,'btn primary'));
  else if(x.gh)go.append(link('在 GitHub 打开',x.gh,'gh'));
  else if(x.detail){const on=PL.det.has(x.key);const b=pe('button','btn primary',x.btn+(on?' ↑':' ↓'));b.type='button';b.setAttribute('aria-expanded',String(on));
    b.dataset.label=x.btn;
    b.addEventListener('click',()=>{const open=!PL.det.has(x.key);
      // 一次只展开一条：先收起别的（同一件待办在工作台、项目页各有一份，都收起）
      if(open){PL.det.clear();document.querySelectorAll('.plat li.todo .detail').forEach((d)=>{const ob=d.closest('li.todo').querySelector('.go button[aria-expanded]');if(ob){ob.setAttribute('aria-expanded','false');ob.textContent=ob.dataset.label+' ↓';}d.remove();});PL.det.add(x.key);}
      else{PL.det.delete(x.key);const d=body.querySelector('.detail');if(d)d.remove();}
      if(open)body.append(detailEl(x));b.setAttribute('aria-expanded',String(open));b.textContent=x.btn+(open?' ↑':' ↓');});
    go.append(b);if(on)body.append(detailEl(x));}
  else if(x.href)go.append(link(x.btn+' →',x.href,'btn primary'));
  // 批 B（批 A 走查："审《阶段计划》并过关卡 A"那条右边什么都没有）：agents 推来的待办没带链接、也没带正文时，上面几种都不成立；
  // 有链接才给青色主按钮，没有就给一个明确的次按钮"做完了，打勾"（和左边圆圈同一个动作），并在下面写一句去哪做
  if(!go.childNodes.length){const b=pe('button','btn','做完了，打勾');b.type='button';b.dataset.act='tick';b.addEventListener('click',()=>{b.setAttribute('aria-busy','true');b.textContent='处理中…';tick(x,b);});go.append(b);
    body.append(pe('p','why','没有链接：在 Claude 窗口里或线下做完，回来打勾。'));}
  li.append(t,body,go);return li;}
/** 展开的正文：正文（长的先折叠，"展开全文"）、"已截断"、要你决定的问题表（每条带建议）、小链接"在 GitHub 打开"。全部 textContent */
function detailEl(x){const D=x.detail;const d=pe('div','detail');
  if(D.body.trim()){const t=pe('div','detail-text'+(PL.more.has(x.key)?'':' fold'),D.body);d.append(t);
    const more=pe('button','btn small',PL.more.has(x.key)?'收起':'展开全文');more.type='button';more.dataset.more='1';more.setAttribute('aria-expanded',String(PL.more.has(x.key)));
    more.addEventListener('click',()=>{const open=t.classList.contains('fold');t.classList.toggle('fold',!open);if(open)PL.more.add(x.key);else PL.more.delete(x.key);more.setAttribute('aria-expanded',String(open));more.textContent=open?'收起':'展开全文';});
    d.append(more);if(!PL.more.has(x.key))requestAnimationFrame(()=>{if(t.isConnected&&t.scrollHeight<=t.clientHeight+2){t.classList.remove('fold');more.hidden=true;}});}
  if(D.cut)d.append(pe('p','cutnote','已截断：正文太长，这里只显示前面一部分'+(D.href?'，全文点下面的链接看':'')+'。'));
  if(D.qs.length){d.append(pe('b',null,'要你决定的问题（'+D.qs.length+'）'));const ul=pe('ul','qs');D.qs.forEach((q)=>{const li=pe('li');li.append(pe('span',null,q.q));if(q.advice)li.append(pe('br'),pe('span','hint','建议：'+q.advice));ul.append(li);});d.append(ul);}
  if(D.href)d.append(link(/^https:\\/\\/github\\.com\\//.test(D.href)?'在 GitHub 打开':'打开原文',D.href,'gh'));
  return d;}
function formEl(x){const f=pe('div','form');f.hidden=!PL.open.has(x.key);const ins=x.form.map((name)=>{const l=pe('label',null,name+(CFG.REPORT_FIELDS[name]&&CFG.REPORT_FIELDS[name].max?'（0～'+CFG.REPORT_FIELDS[name].max+'）':'')+' ');const i=pe('input');i.inputMode='numeric';i.dataset.name=name;i.placeholder='不知道填 0';
    i.value=(PL.vals[x.key]||{})[name]||'';i.addEventListener('input',()=>{(PL.vals[x.key]=PL.vals[x.key]||{})[name]=i.value;});l.append(i);f.append(l);return i;});
  const b=pe('button','btn small primary','保存');b.type='button';const m=pe('span','msg');m.setAttribute('role','status');f.append(b,m);
  b.addEventListener('click',async()=>{const bad=[],values={};ins.forEach((i)=>{const r=normReport(i.dataset.name,i.value);i.setAttribute('aria-invalid',String(!!r.why));if(r.why)bad.push(i.dataset.name+'：'+r.why);else values[i.dataset.name]=i.value;});
    if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
    b.disabled=true;b.textContent='保存中…';m.textContent='';const r=await post('/api/company/report',{key:x.key,project:PROJS.indexOf(x.proj)>=0?x.proj:'公司',values});
    if(!r.ok){b.disabled=false;b.textContent='保存';const bb=(r.j&&r.j.bad)||[];ins.forEach((i)=>{if(bb.some((y)=>y.name===i.dataset.name))i.setAttribute('aria-invalid','true');});m.className='msg';m.textContent='没保存：'+(bb.length?bb.map((y)=>y.name+'：'+y.why).join('；'):(r.j.error||'出错了（'+r.status+'）'));return;}
    PL.open.delete(x.key);delete PL.vals[x.key];PL.done.set(x.key,r.j.at);toastP('已保存，这件事自动打勾了。');await refresh();});
  return f;}
function doneLi(x){const li=pe('li');li.append(pe('span','pill p-ok','✓'),pe('s',null,x.title),pe('span','hint','做完 '+md(PL.done.get(x.key))));const b=pe('button','btn small','撤销');b.type='button';b.dataset.undo=x.key;b.addEventListener('click',()=>undo(x,b));li.append(b);return li;}
function fillList(ulId,doneId,nId,dnId,list,now,emptyB,emptyS){const open=list.filter((x)=>!isDone(x.key)),closed=list.filter((x)=>isDone(x.key)&&PL.done.has(x.key));
  const ul=$(ulId);ul.replaceChildren(...open.map((x,i)=>todoLi(x,i===0,now)));if(!open.length){const e=pe('li','empty');e.append(pe('b',null,emptyB),pe('span',null,emptyS));ul.append(e);}
  $(doneId).replaceChildren(...closed.map(doneLi));if(!closed.length)$(doneId).append(pe('li','none','还没有'));$(nId).textContent=open.length;$(nId).className='cbadge'+(open.length?' red':'');$(dnId).textContent='（'+closed.length+'）';return open;}
/**
 * 工作台"全部待办"按时间段分组（批 A，2026-11-04；Amos 同意从"按项目折叠"改成这个口径）：
 * 已超时（含自动检查没过的"现在就看"）/ 24 小时内到期 / 之后到期 / 没定截止时间（这一组默认折叠）；
 * 上面一排按项目筛选的按钮（带件数，"全部"在最前）；做完的收进"做完的"折叠。
 * 只改渲染：todo 块的数据结构（src/company.ts SCHEMA ↔ agents 工具/company-report.mjs）没动。
 */
const BUCKETS=[['over','已超时'],['soon','24 小时内到期'],['later','之后到期'],['none','没定截止时间']];
/** 筛选按钮的项目顺序：一级菜单上的项目在前（按菜单顺序），其余（"公司"等）在后 */
function projOrder(list){const ks=[];PROJS.forEach((k)=>{if(list.some((x)=>x.proj===k))ks.push(k);});list.forEach((x)=>{if(ks.indexOf(x.proj)<0)ks.push(x.proj);});return ks;}
function fillBuckets(list,now){const open=list.filter((x)=>!isDone(x.key)),closed=list.filter((x)=>isDone(x.key)&&PL.done.has(x.key));
  const ks=projOrder(open);if(PL.pf&&ks.indexOf(PL.pf)<0)PL.pf='';
  // 按项目筛选（带件数）
  const F=$('w-todo-pf');F.replaceChildren();F.hidden=ks.length<2;
  [['','全部']].concat(ks.map((k)=>[k,k])).forEach(([k,label])=>{const n=open.filter((x)=>!k||x.proj===k).length;const c=pe('button','chip',label);c.type='button';c.dataset.pf=k;
    c.setAttribute('aria-pressed',String(PL.pf===k));c.append(pe('b',null,String(n)));c.addEventListener('click',()=>{PL.pf=k;PL.det.clear();renderAll();});F.append(c);});
  const shown=open.filter((x)=>!PL.pf||x.proj===PL.pf);
  const B=$('w-todos');B.replaceChildren();
  BUCKETS.forEach(([b,label])=>{const xs=shown.filter((x)=>lvl(x,now)===b);if(!xs.length)return;
    const ul=pe('ul','todos');xs.forEach((x,i)=>ul.append(todoLi(x,false,now)));
    if(b!=='none'){const sec=pe('section','bucket');sec.dataset.bucket=b;const h=pe('h3','bucket-h '+b);h.append(pe('span',null,label),pe('span','n','· '+xs.length+' 件'));sec.append(h,ul);B.append(sec);}
    else{const d=pe('details','grp bucket');d.dataset.bucket=b;d.open=PL.noneOpen||PL.det.has((xs.find((x)=>PL.det.has(x.key))||{}).key);
      d.append(pe('summary',null,label+' · '+xs.length+' 件'),ul);d.addEventListener('toggle',()=>{PL.noneOpen=d.open;});B.append(d);}});
  if(!shown.length){const e=pe('div','empty');e.append(pe('b',null,'现在没事要做'),pe('span',null,nextHint(now)));B.append(e);}
  $('w-donelist').replaceChildren(...closed.map(doneLi));if(!closed.length)$('w-donelist').append(pe('li','none','还没有'));
  $('w-todo-n').textContent=open.length;$('w-todo-n').className='cbadge'+(open.length?' red':'');$('w-done-n').textContent='（'+closed.length+'）';
  // 一句话结论跟着筛选算（选了某个项目就只说这个项目的）
  const ld=todoLead(shown,now);if(PL.pf)ld[1]=PL.pf+'：'+ld[1];setLead('w-todo-lead',...ld);
  return open;}
const setCnt=(id,n,txt)=>{const e=$(id);if(!e)return;e.textContent=txt!=null?txt:String(n);e.hidden=!n&&txt==null;};
// ---- 一句话结论（每个模块标题下面那一句，全部由数据算出来）----
/** 写进 .lead：前面一个状态圆点（red / amber / ok / gray），一句结论，后面一句浅色的补充 */
function setLead(id,dot,main,soft){const e=$(id);if(!e)return;e.replaceChildren(pe('span','dot '+dot),pe('span',null,main));if(soft)e.append(pe('span','soft',soft));}
/** 下一次经营会（每周六 20:00 台湾时间） */
function nextMeet(now){const t=tp(now);let next=Date.UTC(t.y,t.mo-1,t.d+((6-t.wd+7)%7),20,0)-8*HR;if(next<now)next+=7*DY;return next;}
/** 没事要做时：下一件什么时候出现（经营会后会派新的事；是估计，所以写"预计"） */
const nextHint=(now)=>'下一件预计在 '+dateL(nextMeet(now))+' 经营会后出现';
/** 待办：例如"1 件已超时、2 件 24 小时内到期，先做这 3 件。其余 6 件不急。" */
function todoLead(open,now){if(!open.length)return ['ok','现在没事要做。',nextHint(now)+'。'];
  const n={over:0,soon:0,later:0,none:0};open.forEach((x)=>{n[lvl(x,now)]++;});const hot=n.over+n.soon,rest=open.length-hot;
  if(hot){const ps=[];if(n.over)ps.push(n.over+' 件已超时');if(n.soon)ps.push(n.soon+' 件 24 小时内到期');
    return [n.over?'red':'amber',ps.join('、')+'，先做'+(hot>1?'这 '+hot+' 件':'这件')+'。',rest?'其余 '+rest+' 件不急。':''];}
  const first=open.find((x)=>x.due!=null);
  const rest2=open.length-1;
  return ['gray','没有急的。',first?'最近的一件'+dueLeft(first,now)+(rest2?'；还有 '+rest2+' 件，有空就做。':'。'):(open.length===1?'这 1 件没定截止时间，有空就做。':open.length+' 件都没定截止时间，有空就做。')];}
const dueLeft=(x,now)=>'还剩 '+dur(x.due-now)+'（'+dateL(x.due)+'）';
// ---- 填的数字：状态卡写"见工作平台"的那一格换成平台里的最新值 ----
const latest=(proj,name)=>PL.reports.find((r)=>r.project===proj&&r.name===name)||null;
function fromReports(proj,metric){const names=CFG.METRIC_FROM_REPORT[metric];if(!names)return null;const rs=names.map((n)=>latest(proj,n));if(rs.some((r)=>!r))return {missing:true};
  return {value:String(rs.reduce((a,r)=>a+Number(r.value),0)),detail:names.length>1?names.map((n,i)=>n.replace(' 关注','')+' '+rs[i].value).join('、'):'',at:Math.max.apply(null,rs.map((r)=>r.at))};}
function metricNow(proj,m,srcAt){const see=CFG.SEE_PLATFORM.some((k)=>String(m.now||'').indexOf(k)>=0);const r=fromReports(proj,m.name);
  if(see){if(!r||r.missing)return {now:[pe('span','pill p-warn','还没填'),' ',link('去填 →','#/work/todo')],src:'平台里还没有'};
    const out=[pe('b',null,r.value)];if(r.detail)out.push(' ',pe('span','hint',r.detail));return {now:out,src:'你 '+md(r.at)+' 填的',v:r.value};}
  const out=[pe('b',null,m.now||'—')];let src='状态卡';if(r&&!r.missing&&r.at>srcAt){out.push(pe('br'),pe('span','hint','平台里有你 '+md(r.at)+' 填的新值 '+r.value+'（状态卡还是旧值）'));}return {now:out,src};}
function table(heads,rows,widths,cls){const w=pe('div','tablewrap');const t=pe('table','stack'+(cls?' '+cls:''));if(widths){const cg=pe('colgroup');widths.forEach((x)=>{const c=pe('col');c.style.width=x;cg.append(c);});t.append(cg);}
  if(heads){const th=pe('thead'),tr=pe('tr');heads.forEach((h)=>tr.append(pe('th',null,h)));th.append(tr);t.append(th);}const tb=pe('tbody');rows.forEach((r)=>tb.append(r));t.append(tb);w.append(t);return w;}
function td(label,content,cls){const c=pe('td',cls||null);if(label)c.dataset.label=label;(Array.isArray(content)?content:[content]).forEach((x)=>{if(x!=null&&x!=='')c.append(x);});if(!c.childNodes.length)c.append('—');return c;}
const tr=(...cells)=>{const r=pe('tr');r.append(...cells);return r;};
const emptyP=(t)=>pe('p','empty',t);
const stampOf=(b)=>b?'更新于 '+md(b.source_at)+' '+p2(tp(b.source_at).h)+':'+p2(tp(b.source_at).mi):'';
// ---- 团队在做什么（工作平台批 3）：GET /api/active；变灰、最近结束服务端按读的时间算好；只用 textContent 显示 ----
const ROLE={main:'主会话',pm:'产品',mkt:'市场',dev:'研发',qa:'测试',ops:'运维安全',review:'审查',amos:'Amos'};
const PROJN={forecast:'forecast',platform:'工作平台',company:'公司'};
const ENDN={merged:'已合并',closed:'没合并就关了',deleted:'分支已删',timeout:'一天没动静，收起来了'};
let GRP='role';try{const g=localStorage.getItem('qc-live-grp');if(g==='proj'||g==='time')GRP=g;}catch(e){}
const roleName=(x)=>x.external?'外部':x.role==='none'?'未标':(ROLE[x.role]||x.role);
function actItem(x,now,ended){const red=!ended&&x.ci==='failure'&&!x.external;const d=pe('div','act-item'+(!ended&&x.idle?' old':'')+(red?' red':''));d.dataset.branch=x.branch;d.dataset.repo=x.repo;
  const bd=pe('div','bd');const tags=pe('div','tags');tags.append(pe('span','role'+(x.external?' ext':x.role==='none'?' none':''),roleName(x)),pe('span','proj '+x.project,PROJN[x.project]||x.project));
  if(ended)tags.append(pe('span','pill '+(x.end==='merged'?'p-ok':'p-mute'),ENDN[x.end]||'结束了'));
  if(x.pr!=null)tags.append(pe('span','pill p-teal','PR #'+x.pr));else if(!ended)tags.append(pe('span','pill p-mute','还没开 PR'));
  if(x.ci==='failure')tags.append(pe('span','pill p-err','自动检查没通过'));else if(x.ci==='success')tags.append(pe('span','pill p-ok','自动检查通过'));
  if(!ended&&x.decide)tags.append(pe('span','pill p-warn','要你决定'));
  if(!ended&&x.delivered)tags.append(pe('span','pill p-ok','交了，等主会话'));
  if(!ended&&x.idle)tags.append(pe('span','pill p-mute','可能停了 · '+dur(now-x.at)+'没动静'));
  bd.append(tags,pe('div','ttl',x.title||x.branch));if(x.step)bd.append(pe('div','stp','上一步：'+x.step));
  const br=pe('div','br');br.append((SRC[x.repo]||x.repo)+' · ',pe('code',null,x.branch),' · ',pe('span','ago',dur(now-x.at)+'前'));bd.append(br);
  if(x.external)bd.append(pe('div','note','外部人提交的：只显示分支名和标题，给你看一下，不用回。'));
  else if(!x.labeled&&x.role!=='amos')bd.append(pe('div','note','分支名没按约定（claude/<岗位>-<项目>-<主题>）'+(x.role==='none'?'：认不出岗位，项目是按仓库和改的文件夹猜的':'：岗位和项目按 PR 标题认的')));
  d.append(bd);const go=pe('div','go');if(x.url)go.append(link(x.pr!=null?'看 PR':'看分支',x.url,'btn small'+(red?' danger':'')));d.append(go);return d;}
/** 进度来源的状态：还没接上 / 签名不对 / 有延迟 / 开关关着 / 读不到 */
function liveFeed(now){const A=PL.active;const w=[];let cls='',stamp='';
  if(!A)return {cls:'fail',stamp:'',warns:['暂时读不到团队进度（过一会儿自动再试）'],none:false};
  if(A.badSigAt!=null&&now-A.badSigAt<DY){cls='fail';w.push('收到了 GitHub 的事件但签名不对（最近一次在 '+dur(now-A.badSigAt)+'前）：检查 Webhook 的 Secret 是不是和 COMPANY_INGEST_TOKEN 一样、前后有没有空格。改对后下一次事件就好。');}
  if(A.limitedAt!=null){if(!cls)cls='lag';w.push('有延迟：GitHub 一下子发来太多，有几条被挡了。不用管，下一次推送会带上最新状态补齐。');}
  if(!A.on){cls='off';w.push('Webhook 开关关着（公共工具 → Webhook 开关）：新的进度不会进来，下面是关之前的。');}
  if(A.lastAt!=null){const ag=now-A.lastAt;stamp=ag>=2*HR?'进度 '+dur(ag)+'前（没人干活时这是正常的）':'最近收到 '+dur(ag)+'前 · 每 30 秒刷新';}
  return {cls,stamp,warns:w,none:A.lastAt==null};}
const NOT_YET='团队在做什么：还没接上（等 Webhook 配好）。配好后岗位一推分支，这里几秒内就会出现。';
function groups(list){const by=GRP==='proj'?(x)=>PROJN[x.project]||x.project:GRP==='role'?roleName:null;const s=list.slice().sort((a,b)=>b.at-a.at);if(!by)return [['新的在上',s]];
  const m=new Map();s.forEach((x)=>{const k=by(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x);});return [...m.entries()];}
function renderLive(now){const f=liveFeed(now);const A=PL.active||{items:[],ended:[]};
  const fill=(id,list)=>{const B=$(id);B.replaceChildren();list.forEach((t)=>B.append(pe('p','warnbar',t)));};
  // 工作台
  fill('w-live-warn',f.warns);$('w-live-dot').className='live-dot '+f.cls;$('w-live-stamp').textContent=f.stamp;$('w-live-n').textContent=String(A.items.filter((x)=>!x.external).length);
  setLead('w-live-lead',...liveLead(f,A,now));
  document.querySelectorAll('#w-live-grp [data-grp]').forEach((b)=>b.setAttribute('aria-pressed',String(b.dataset.grp===GRP)));
  const B=$('w-live-body');B.replaceChildren();$('w-live-grp').hidden=!A.items.length;
  if(!PL.active)B.append(pe('p','empty','暂时读不到团队进度。'));else if(f.none)B.append(pe('p','empty',NOT_YET));else if(!A.items.length)B.append(pe('p','empty','团队现在没有在做的事。派完活后，岗位一开工这里就会出现。'));
  else groups(A.items).forEach(([k,arr])=>{const g=pe('div','grp',k+' ');g.append(pe('span','pill p-mute',String(arr.length)));B.append(g);arr.forEach((x)=>B.append(actItem(x,now,false)));});
  $('recent-n').textContent=String(A.ended.length);const R=$('recent-body');R.replaceChildren(...A.ended.map((x)=>actItem(x,now,true)));if(!A.ended.length)R.append(pe('p','empty','7 天内没有结束的。'));
  const reds=A.items.filter((x)=>x.ci==='failure'&&!x.external);$('ci-alert').hidden=!reds.length;
  if(reds.length){const x=reds[0];$('ci-alert-t').textContent=(SRC[x.repo]||x.repo)+'：'+(x.title||x.branch)+(reds.length>1?'（还有 '+(reds.length-1)+' 项）':'')+'。团队会先修，修好前不会合并。';const a=$('ci-alert-a');a.href=x.url||'#/work/live';if(/^https:/.test(a.href)){a.target='_blank';a.rel='noopener';}}
  // 项目页：只看当前这个项目的
  const cp=curProj();$('f-live-stamp').textContent=cp?'只看 '+cp+' 的':'';
  fill('f-live-warn',f.warns);$('f-live-dot').className='live-dot '+f.cls;const fl=A.items.filter((x)=>x.project===cp),fe=A.ended.filter((x)=>x.project===cp);$('f-live-n').textContent=String(fl.filter((x)=>!x.external).length);
  { const L=liveLead(f,{items:fl,ended:fe},now);if(!f.none&&f.cls!=='off'&&PL.active&&!fl.filter((x)=>!x.external).length)L[1]=cp+' 现在没有在做的事。';setLead('f-live-lead',...L); }
  const F=$('f-live-body');F.replaceChildren();if(!PL.active)F.append(pe('p','empty','暂时读不到团队进度。'));else if(f.none)F.append(pe('p','empty',NOT_YET));else if(!fl.length)F.append(pe('p','empty',cp+' 现在没有在做的事。'));
  fl.slice().sort((a,b)=>b.at-a.at).forEach((x)=>F.append(actItem(x,now,false)));
  if(fe.length){const d=pe('details','grp recent');const sm=pe('summary',null,'最近结束 ');sm.append(pe('span','pill p-mute',String(fe.length)));d.append(sm);fe.forEach((x)=>d.append(actItem(x,now,true)));F.append(d);}}
/** 团队在做什么：例如"3 件在做，其中 1 件 3 小时没动静。不用你处理，看看就好。" */
function liveLead(f,A,now){if(!PL.active)return ['red','暂时读不到团队进度。','过一会儿自动再试。'];
  if(f.none)return ['gray','还没接上：等 Webhook 配好。','配好后岗位一推分支，这里几秒内就会出现。'];
  if(f.cls==='off')return ['amber','Webhook 开关关着，新的进度不会进来。','下面是关之前的。'];
  const mine=A.items.filter((x)=>!x.external);if(!mine.length)return ['gray','团队现在没有在做的事。','派完活后，岗位一开工这里就会出现。'];
  const red=mine.filter((x)=>x.ci==='failure'),idle=mine.filter((x)=>x.idle);let main=mine.length+' 件在做',dot='ok';
  if(red.length){main+='，其中 '+red.length+' 件没通过自动检查（团队会先修）';dot='red';}
  else if(idle.length){main+='，其中 '+(idle.length===1?'1 件 '+dur(now-idle[0].at)+'没动静':idle.length+' 件超过 2 小时没动静');dot='amber';}
  return [dot,main+'。','不用你处理，看看就好。'];}
document.querySelectorAll('#w-live-grp [data-grp]').forEach((b)=>b.addEventListener('click',()=>{GRP=b.dataset.grp;try{localStorage.setItem('qc-live-grp',GRP);}catch(e){}renderAll();}));
// ---- 工作台 ----
const hm=(ms)=>p2(tp(ms).h)+':'+p2(tp(ms).mi);
/** 还没读成功过一次（第一次就失败）：各模块写"暂时读不到"，不冒充"没事要做" */
function renderBlind(){const why=PL.errWhy||'暂时出错';
  const h=$('hero');h.removeAttribute('aria-busy');h.className='hero calm';const l=pe('div');l.append(pe('p','k','你现在最该做的一件事'),pe('h2','one','暂时读不到'),pe('div','when',why+'。点上面的"再读一次"，或者等一会儿自动再试。'));h.replaceChildren(l);
  $('w-glance').replaceChildren();$('w-todos').replaceChildren(emptyP('读不到待办：'+why));$('w-todo-pf').hidden=true;$('w-todo-n').textContent='—';
  ['w-todo-lead','w-proj-lead','w-num-lead','w-meet-lead'].forEach((id)=>setLead(id,'gray','暂时读不到。','读到后这里会写结论。'));
  $('w-proj-body').replaceChildren(emptyP('暂时读不到'));$('w-num-body').replaceChildren(emptyP('暂时读不到'));$('w-meet-body').replaceChildren();}
function renderWork(all,now){if(!PL.okAt){renderBlind();return;}
  const open=fillBuckets(all,now);
  setCnt('c-work',open.length);setCnt('s-todo',open.length);
  // 一级菜单上每个项目的待办数（不只当前打开的那个）
  PROJS.forEach((k)=>setCnt('c-'+k,all.filter((x)=>x.proj===k&&!isDone(x.key)).length));
  renderHero(open,now);
  // 一眼三个数：等你处理 · 跟帖评论清单 · 团队正在做
  const g=$('w-glance');g.replaceChildren();const tile=(n,l,href,cls)=>{const a=href?link('',href,'gl'+(cls?' '+cls:'')):pe('div','gl'+(cls?' '+cls:''));a.append(pe('div','n',n),pe('div','l',l));g.append(a);};
  const over=open.filter((x)=>lvl(x,now)==='over').length;
  tile(String(open.length),'件等你处理'+(over?' · '+over+' 件已超时':''),'#/work/todo',over?'red':'');
  tile(PL.qAll?String(PL.qAll.total):'—','条跟帖评论清单等你回'+(PL.qAll?' · 今天已回 '+PL.qAll.doneToday+' / '+PL.qAll.cap:''),'#/tools/queue');
  tile(PL.active?String(PL.active.items.filter((x)=>!x.external).length):'—','件事团队正在做 · 不用你管','#/work/live');
  renderProj(now);renderNum(now);renderMeet(now);}
/** ① 最该做的一件事：排第一的那条；一个主按钮 + "做完了，打勾" */
function renderHero(open,now){const h=$('hero');h.removeAttribute('aria-busy');const l=pe('div');l.append(pe('p','k','你现在最该做的一件事'));const act=pe('div','act');
  if(!open.length){h.className='hero calm';const w=pe('div','when');w.append('下一件预计在 ',pe('b',null,dateL(nextMeet(now))+' 经营会后'),' 出现');l.append(pe('h2','one','现在没事要做'),w);
    act.append(link('趁空练 10 分钟英语 →','#/work/english','btn big ghost'));h.replaceChildren(l,act);return;}
  const x=open[0];h.className='hero';const w=pe('div','when');w.append(badge(x,now));const dt=dueText(x);if(dt)w.append(pe('span',null,dt));w.append(pe('span','ptag',x.proj));
  l.append(pe('h2','one',x.title),w);if(x.why)l.append(pe('p','why',x.why));
  if(open.length>1){const n=pe('p','next');n.append('后面还有 '+(open.length-1)+' 件，',link('已经按截止时间排好 ↓','#/work/todo'));l.append(n);}
  const toTodo=()=>{PL.pf='';PL.det.clear();PL.det.add(x.key);setTimeout(renderAll,0);};
  if(x.form){const a=link(x.btn+' →','#/work/todo','btn primary big');a.addEventListener('click',()=>{PL.pf='';PL.open.add(x.key);setTimeout(renderAll,0);});act.append(a);}
  else if(x.go)act.append(link(x.btn+' →',x.go,'btn primary big'));
  else if(x.gh)act.append(link('在 GitHub 打开',x.gh,'btn big'));
  else if(x.detail){const a=link(x.btn+' ↓','#/work/todo','btn primary big');a.addEventListener('click',toTodo);act.append(a);}
  else if(x.href)act.append(link(x.btn+' →',x.href,'btn primary big'));
  const t=pe('button',act.childNodes.length?'btn text':'btn big ghost','做完了，打勾 ✓');t.type='button';t.addEventListener('click',()=>{t.setAttribute('aria-busy','true');t.textContent='处理中…';tick(x,t);});act.append(t);
  h.replaceChildren(l,act);}
/** 数字和目标都是数时才画进度条："50"、"100"、"5 万 / 月"（= 50000）这类；"2026-12-31 前"这种不画 */
function numOf(v){const m=/^\\s*(\\d+(?:\\.\\d+)?)\\s*(万)?\\s*(?:\\/\\s*\\S+)?\\s*$/.exec(String(v==null?'':v));return m?Number(m[1])*(m[2]?10000:1):null;}
/** ④ 项目概况：每个在跑的项目一张卡（阶段、这周、数字 + 进度条、在等你几件） */
function renderProj(now){const pi=(k)=>{const i=PROJS.indexOf(k);return i<0?99:i;};const sts=okBlocks('status').filter((b)=>CFG.NOT_PROJECTS.indexOf(b.key)<0).sort((a,b)=>pi(a.key)-pi(b.key));const B=$('w-proj-body');$('w-proj-at').textContent=sts.length?'状态卡'+stampOf(newestOf(sts)):'';$('w-proj-n').textContent=String(sts.length);
  if(!sts.length){B.replaceChildren(emptyP('还没收到项目的状态卡'));setLead('w-proj-lead','gray','还没收到项目的状态卡。','项目开工后，状态卡一推上来这里就有一张卡。');return;}
  const all=items();const waits=[];let gap='';
  const cards=sts.map((b)=>{const p=b.payload;const c=pe('div','projcard');c.dataset.proj=b.key;const hd=pe('div','hd');const has=PROJS.indexOf(b.key)>=0;
    const nm=has?link('','#/'+encodeURIComponent(b.key)):pe('span');nm.append(pe('b',null,b.key));hd.append(nm);if(p.state)hd.append(pe('span','stage',p.state));c.append(hd);
    if(p.week)c.append(pe('p','wk','这周：'+p.week));
    (p.metrics||[]).forEach((m)=>{const v=metricNow(b.key,m,b.source_at);const d=pe('div','metric');const r=pe('div','r');const right=pe('span');const extra=[];
      v.now.forEach((x)=>{if(x&&x.nodeType===1&&(x.tagName==='BR'||x.classList.contains('hint')))extra.push(x);else right.append(x);});
      if(m.target)right.append(' / '+m.target);r.append(pe('span',null,m.name),right);d.append(r);
      extra.filter((x)=>x.tagName!=='BR').forEach((x)=>d.append(pe('div','new',x.textContent)));
      if(/^你 /.test(v.src||''))d.append(pe('div','new',v.src));
      const cur=numOf(v.v!=null?v.v:m.now),goal=numOf(m.target);
      if(cur!=null&&goal){const mt=pe('div','meter'+(p.level==='warn'?' warn':p.level==='err'?' bad':''));const i=pe('i');i.style.width=Math.min(100,Math.round(cur/goal*100))+'%';mt.append(i);d.append(mt);
        if(!gap&&cur<goal)gap=b.key+' 的'+m.name+'离目标还差 '+(goal-cur).toLocaleString();}
      c.append(d);});
    const waiting=all.filter((x)=>x.proj===b.key&&!isDone(x.key)).length;if(waiting)waits.push(b.key+' 在等你 '+waiting+' 件');
    const ft=pe('div','ft');ft.append(pe('span','wait'+(waiting?'':' none'),waiting?'在等你 '+waiting+' 件':'没有在等你的事'));
    if(has)ft.append(link((waiting?'去 '+b.key+' 处理':'看 '+b.key)+' →','#/'+encodeURIComponent(b.key)+(waiting?'/next':''),'btn small'+(waiting?' primary':'')));
    c.append(ft);return c;});
  const g=pe('div','projs');g.append(...cards);B.replaceChildren(g);
  const ps=(waits.length>2?waits.slice(0,2).concat(['还有 '+(waits.length-2)+' 个项目在等你']):waits).concat(gap?[gap]:[]);setLead('w-proj-lead',waits.length?'amber':'ok',ps.length?ps.join('；')+'。':'项目都在走，没有在等你的事。');}
const newestOf=(bs)=>bs.reduce((a,b)=>(!a||b.source_at>a.source_at)?b:a,null);
/** "0 元" → 大字 0 + 小字 元；不是"数字 + 短单位"的整段当文字显示 */
function numTile(v){const m=/^\\s*([\\d.,]+)\\s*(\\S{0,3})\\s*$/.exec(String(v==null?'':v));const n=pe('div','n');if(m){n.append(m[1]);if(m[2])n.append(pe('small',null,m[2]));}else{n.classList.add('txt');n.textContent=String(v==null||v===''?'—':v);}return n;}
/** ⑤ 公司数字：周报里的数 + 你填的数，每个一个数字块 */
function renderNum(now){const B=$('w-num-body');const wb=PL.data.weekly;const w=wb&&wb.payload;$('w-num-at').textContent=w?'周报'+(w.title||'')+(w.range?' · '+w.range:''):'';
  const tiles=[];const tile=(n,l,cls,extra)=>{const t=pe('div','tile');if(cls)n.classList.add(cls);t.append(n);const lb=pe('div','l',l);if(extra)lb.append(extra);t.append(lb);tiles.push(t);};
  if(w){(w.highlights||[]).forEach((x)=>{if(x.until){const d=Math.round((Date.parse(x.until+'T23:59:59+08:00')-now)/DY);tile(numTile(d+' 天'),x.label||'');}else tile(numTile(x.value||'—'),x.label||'');});
    if(w.cost)tile(numTile(w.cost),'本周花了多少钱');if(typeof w.mistakes==='number')tile(numTile(w.mistakes+' 次'),'同类错误又犯',w.mistakes>0?'amber':'');if(w.rules)tile(numTile(w.rules),'公司规则');}
  const projs=[...new Set(PL.reports.map((r)=>r.project))].filter((p)=>p!=='公司');
  projs.forEach((pj)=>Object.keys(CFG.METRIC_FROM_REPORT).forEach((name)=>{const r=fromReports(pj,name);if(!r||r.missing)return;tile(numTile(r.value),pj+' · '+name+(r.detail?'（'+r.detail+'）':'')+' · 你 '+md(r.at)+' 填的');}));
  const use=PL.reports.filter((r)=>r.name==='Claude 用量').sort((a,b)=>b.at-a.at)[0];
  if(use)tile(numTile(use.value+'%'),'Claude 用量 · 你 '+md(use.at)+' 填的');else tile(pe('div','n','还没报'),'Claude 用量','mute',link('去报 →','#/work/todo','btn small'));
  const g=pe('div','tiles');g.append(...tiles);B.replaceChildren(g);
  if(!w){setLead('w-num-lead','gray','还没收到周报。','周报每周六 17:00 前到。');return;}
  const ps=[];ps.push(!w.cost?'周报里没写花了多少钱':/^\\s*0(\\s|元|$)/.test(w.cost)?'本周没花钱':'本周花了 '+w.cost);const calm=ps.length;
  if(w.mistakes>0)ps.push('同类错误又犯了 '+w.mistakes+' 次，经营会要看');if(!use)ps.push('Claude 用量还没报');if(ps.length===calm)ps.push('没有要你看的数');
  setLead('w-num-lead',w.mistakes>0||!use?'amber':'ok',ps.join('；')+'。');}
/** ⑥ 经营会：日期块 + 三件要确认的事 */
function renderMeet(now){const B=$('w-meet-body');const next=nextMeet(now);const t=tp(next);
  const mb=okBlocks('todo').find((b)=>b.key==='经营会');const open=mb?(mb.payload.items||[]).filter((x,i)=>!isDone('todo:经营会:'+(x.id||'c'+i))).length:0;
  const d=pe('div','date');d.append(pe('div','mo',t.mo+' 月'),pe('div','d',String(t.d)),pe('div','w','周'+WD[t.wd]+' '+p2(t.h)+':'+p2(t.mi)));
  const ul=pe('ul','checks');const ck=(ic,cls,text,extra)=>{const li=pe('li');li.append(pe('span','ic '+cls,ic),pe('span',null,text));if(extra)li.append(extra);ul.append(li);};
  ck('…','wait','周报：当天 17:00 前到');
  if(mb){if(open){const a=link('去打勾 →','#/work/todo','btn small');a.addEventListener('click',()=>{PL.pf='公司';setTimeout(renderAll,0);});ck('!','warn','上次要你定的事：还有 '+open+' 件没打勾',a);}else ck('✓','ok','上次要你定的事：都打勾了');}
  const right=pe('div');right.append(ul);const ls=pe('div','links');if(mb&&mb.payload.link)ls.append(link('看上次会议记录',mb.payload.link,'btn small'));
  const wb=PL.data.weekly;if(wb&&wb.payload&&wb.payload.link)ls.append(link('看周报'+(wb.payload.title||''),wb.payload.link,'btn small'));if(ls.childNodes.length)right.append(ls);
  const m=pe('div','meet');m.append(d,right);B.replaceChildren(m);
  setLead('w-meet-lead',open?'amber':'gray','下一次还剩 '+dur(next-now)+(open?'；上次要你定的事还有 '+open+' 件没打勾':'')+'。');}
// ---- forecast 项目页 ----
const P_LEADS=['f-next-lead','f-guide-lead','f-card-lead','f-pack-lead','f-match-lead','f-tools-lead','f-handoff-lead'];
/** 批 B：项目页还没读成功过一次（第一次就失败）——照工作台 renderBlind：各模块写"暂时读不到"，不冒充"现在没事要做""本周还没有周包" */
function renderProjectBlind(pj){const why=PL.errWhy||'暂时出错';
  const ul=$('f-todos');const e=pe('li','empty');e.append(pe('b',null,'暂时读不到'),pe('span',null,'读不到 '+pj+' 的待办：'+why+'。点上面的"再读一次"，或者等一会儿自动再试。'));ul.replaceChildren(e);
  $('f-next-n').textContent='—';$('f-next-n').className='cbadge';$('f-donelist').replaceChildren();$('f-done-n').textContent='（—）';setCnt('s-fnext',0);setCnt('s-guide',0);
  P_LEADS.forEach((id)=>setLead(id,'gray','暂时读不到。','读到后这里会写结论。'));
  ['f-guide-aux','f-card-at','f-pack-aux','f-match-aux'].forEach((id)=>{$(id).textContent='';});$('f-guide-h').textContent='操作指引';$('f-pack-h').textContent='本周帖子';$('f-match-h').textContent='焦点战';
  ['f-guide-body','f-card-body','f-pack-body','f-match-body','f-handoff-body'].forEach((id)=>$(id).replaceChildren(emptyP('暂时读不到')));
  $('f-tools-stamp').textContent='只算 '+pj+' 的';renderTools(pj);}
function renderProject(pj,all,now){if(!pj)return;if(!PL.okAt){renderProjectBlind(pj);return;}const mine=all.filter((x)=>x.proj===pj);const open=fillList('f-todos','f-donelist','f-next-n','f-done-n',mine,now,pj+' 现在没事要做','有新的事会出现在这里。');
  const ld=todoLead(open,now);setLead('f-next-lead',ld[0],ld[1],ld[2]);
  setCnt('s-fnext',open.length);$('f-tools-stamp').textContent='只算 '+pj+' 的';
  const pb=okBlocks('pack').find((b)=>b.key===pj);const p=pb&&pb.payload;renderGuide(p,now);renderPack(p,now);
  renderCard(pj);renderTools(pj);renderHandoff(pj);}
function renderGuide(p,now){const B=$('f-guide-body');const H=$('f-guide-h');
  if(!p||!(p.steps||[]).length){H.textContent='操作指引';$('f-guide-aux').textContent='';B.replaceChildren(emptyP('本周还没有周包：市场经理交了周包以后，这里一步步列出要你做的事。'));setCnt('s-guide',0);
    setLead('f-guide-lead','gray','本周还没有周包。','市场经理交了周包以后，这里一步步列出要你做的事。');return;}
  const steps=p.steps;const c=steps.filter((s)=>isDone(stepKey(p,s.n))).length;H.textContent='操作指引'+(typeof p.due==='number'?' · '+dateL(p.due):'');$('f-guide-aux').textContent='周包 '+p.date+' · '+steps.length+' 步';
  const cur=steps.find((s)=>!isDone(stepKey(p,s.n)));
  // 一句话结论：做到第几步、还剩几步、什么时候截止
  if(!cur)setLead('f-guide-lead','ok',steps.length+' 步都做完了。','待办里的这件已自动打勾。');
  else{const late=typeof p.due==='number'&&p.due<now,soon=typeof p.due==='number'&&p.due-now<DY;setLead('f-guide-lead',late?'red':soon?'amber':'gray','做完 '+c+' / '+steps.length+' 步，现在做第 '+cur.n+' 步。',typeof p.due==='number'?(late?'已超时 ':'还剩 ')+dur(p.due-now)+'（'+dateL(p.due)+'）。':'');}
  const pr=pe('div','progress');const g=pe('span',null,'完成 '+c+' / '+steps.length+(cur?' · 现在做第 '+cur.n+' 步':''));g.id='g-prog';const mt=pe('div','meter');const fill=pe('i');fill.style.width=Math.round(c/steps.length*100)+'%';mt.append(fill);pr.append(g,mt);
  const bar=pe('div','bar-row');const cb=pe('button','btn small','复制 '+(p.matches||[]).length+' 场焦点战');cb.type='button';cb.id='copy-match';const cm=pe('span','msg');cm.id='copy-msg';cm.setAttribute('role','status');
  bar.append(cb,cm,link('看周包全文',p.link||'#','btn small'));const ta=pe('textarea');ta.readOnly=true;ta.hidden=true;ta.setAttribute('aria-label','焦点战（手动复制）');
  if(PL.copy){cm.className='msg'+(PL.copy.ok?' ok':'');cm.textContent=PL.copy.msg;if(!PL.copy.ok){ta.hidden=false;ta.value=PL.copy.text;}}
  if(!(p.matches||[]).length)cb.hidden=true;
  cb.addEventListener('click',()=>copyMatches(p,cb,cm,ta));
  const ol=pe('ol','gsteps');ol.id='g-steps';
  steps.forEach((s)=>{const k=stepKey(p,s.n);const on=isDone(k);const li=pe('li','step'+(on?' done':'')+(cur===s?' cur':''));li.dataset.step=s.n;
    const d=pe('div');d.append(pe('div','st',s.text));const acts=pe('div','acts');if(s.link)acts.append(link('打开文案',s.link,'btn primary small'));
    const l=pe('label','ck');const i=pe('input');i.type='checkbox';i.checked=on;l.append(i,' 这步做完了');acts.append(l);
    i.addEventListener('change',()=>stepChange(p,s,i.checked));li.append(pe('span','no',s.n),d,acts);ol.append(li);});
  const fin=pe('p','msg ok',steps.length+' 步都做完了，待办里的这件已自动打勾。');fin.style.padding='10px 16px';fin.hidden=c<steps.length;
  B.replaceChildren(pr,bar,ta,ol,fin);setCnt('s-guide',1,c+'/'+steps.length);}
async function stepChange(p,s,on){const ok=await setDone(stepKey(p,s.n),on);if(!ok)return;
  const all=p.steps.every((x)=>isDone(stepKey(p,x.n)));const pk=packKey(p);
  if(all&&!PL.done.has(pk))await setDone(pk,true);else if(!all&&PL.done.has(pk))await setDone(pk,false);
  renderAll();if(on)toastP(all?p.steps.length+' 步都做完了！':'第 '+s.n+' 步打勾了，接着做下一步。');}
function copyMatches(p,b,m,ta){const text=(p.matches||[]).map((x)=>[x.league,x.home,x.away,x.time,x.note||''].join('\\t')).join('\\n');b.disabled=true;
  const fin=(ok)=>{b.disabled=false;PL.copy={ok,text,msg:ok?'已复制 '+p.matches.length+' 场。到官网名单页的"导入"里粘贴就行。':'没复制成功（浏览器不让）。下面整段已经选好，请手动复制（Ctrl+C / ⌘C）。'};
    m.className='msg'+(ok?' ok':'');m.textContent=PL.copy.msg;if(!ok){ta.hidden=false;ta.value=text;ta.focus();ta.select();}else ta.hidden=true;};
  try{if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('no clipboard');navigator.clipboard.writeText(text).then(()=>fin(true),()=>fin(false));}catch(e){fin(false);}}
function renderPack(p,now){const none='本周还没有周包';
  if(!p){$('f-pack-h').textContent='本周帖子';$('f-match-h').textContent='焦点战';$('f-pack-aux').textContent='';$('f-match-aux').textContent='';$('f-pack-body').replaceChildren(emptyP(none));$('f-match-body').replaceChildren(emptyP(none));
    setLead('f-pack-lead','gray',none+'。','周包到了，这周要发的帖子列在这里。');setLead('f-match-lead','gray',none+'。','周包到了，这周的焦点战列在这里。');return;}
  const posts=p.posts||[],ms=p.matches||[];
  const d0=Date.parse(p.date+'T12:00:00+08:00');$('f-pack-h').textContent='本周帖子 · '+md(d0)+'～'+md(d0+6*DY);$('f-pack-aux').textContent=posts.length+' 条';
  // 一句话结论：下一条什么时候发（有发出时间的才算；都过了就直说）
  const timed=posts.filter((x)=>typeof x.at==='number'),nx=timed.filter((x)=>x.at>=now).sort((a,b)=>a.at-b.at)[0];
  if(!posts.length)setLead('f-pack-lead','gray','这一包没有帖子。','');
  else if(nx)setLead('f-pack-lead',nx.at-now<DY?'amber':'gray','这周 '+posts.length+' 条，下一条（第 '+nx.n+' 条）'+dateL(nx.at)+' 发。','还剩 '+dur(nx.at-now)+'。');
  else if(timed.length)setLead('f-pack-lead','ok','这周 '+posts.length+' 条都过了建议发出的时间。','没发的看"最晚"那一栏。');
  else setLead('f-pack-lead','gray','这周 '+posts.length+' 条帖子。','发出时间看"几点发"那一栏。');
  setLead('f-match-lead',ms.length?'gray':'gray',ms.length?'这周 '+ms.length+' 场焦点战，要导入官网名单页。':'这一包没有焦点战。',ms.length?'在操作指引里一键复制。':'');
  $('f-pack-body').replaceChildren((p.posts||[]).length?table(['第几条','写的什么','几点发','最晚'],p.posts.map((x)=>tr(td('第几条',String(x.n),'num'),td('写的什么',x.title),td('几点发',x.at_text||(x.at?dateL(x.at):'')),td('最晚',x.deadline||''))),['13%','40%','22%','25%'],'plist posts'):emptyP('这一包没有帖子'));
  $('f-match-h').textContent='焦点战 · '+ms.length+' 场';$('f-match-aux').textContent='导入官网名单页';
  $('f-match-body').replaceChildren((p.matches||[]).length?table(['联赛','对阵','开赛（台湾）'],p.matches.map((x)=>tr(td('联赛',x.league),td('对阵',[x.home+' vs '+x.away,x.note?' ':null,x.note?pe('span','hint',x.note):null]),td('开赛',x.time,'num'))),['16%','52%','32%'],'plist matches'):emptyP('这一包没有焦点战'));}
function renderCard(pj){const b=okBlocks('status').find((x)=>x.key===pj);const B=$('f-card-body');$('f-card-at').textContent=b?'状态卡 '+stampOf(b):'';
  if(!b){B.replaceChildren(emptyP('还没收到 '+pj+' 的状态卡'));setLead('f-card-lead','gray','还没收到 '+pj+' 的状态卡。','状态卡推上来后，这里列出要看的数和在等你的事。');return;}const p=b.payload;
  let miss=0;const rows=(p.metrics||[]).map((m)=>{const v=metricNow(pj,m,b.source_at);if(v.src==='平台里还没有')miss++;return tr(td('看什么',m.name),td('现在',v.now),td('目标',m.target||'—'),td('从哪来',v.src));});
  { const ws=(p.waiting||[]).length,n=(p.metrics||[]).length;const ps=[];if(ws)ps.push('在等你 '+ws+' 件');if(miss)ps.push(miss+' 个数还没填');
    setLead('f-card-lead',ps.length?'amber':'ok',ps.length?ps.join('，')+'。':(n?n+' 个数都有了，没有在等你的事。':'状态卡里没有数字，也没有在等你的事。'),p.state?'现在的阶段：'+p.state:''); }
  const out=[table(['看什么','现在','目标','从哪来'],rows,['28%','30%','20%','22%'])];const pd=pe('div','pd');pd.style.borderTop='1px solid var(--line)';
  if(p.state)pd.append(pe('p',null,'现在的阶段：'+p.state));if(p.week)pd.append(pe('p',null,'这周：'+p.week));
  const ws=(p.waiting||[]);if(ws.length){const ul=pe('ul','ul');ws.forEach((w)=>ul.append(pe('li',null,'在等你：'+(w.text||''))));pd.append(ul);}
  if(p.link)pd.append(link('看状态卡全文',p.link,'btn small'));out.push(pd);B.replaceChildren(...out);}
function renderTools(pj){const q=PL.qProj[pj];const B=$('f-tools-body');const a=pe('div','toolcard');a.append(pe('h3',null,'副驾驶 · 跟帖评论清单'));
  a.append(pe('p',null,q?'等你回 '+q.total+' 条 · 今天已回 '+q.doneToday+' / '+q.cap:'清单条数暂时读不到'));
  if(!q)setLead('f-tools-lead','gray','跟帖评论清单的条数暂时读不到。','AI 用量看"按项目看用量"。');
  else if(!q.total)setLead('f-tools-lead','ok','跟帖评论清单里没有 '+pj+' 待回的。','今天已回 '+q.doneToday+' / '+q.cap+'。');
  else setLead('f-tools-lead',q.doneToday>=q.cap?'red':'amber','跟帖评论清单里 '+pj+' 有 '+q.total+' 条等你回。',q.doneToday>=q.cap?'今天已到上限（'+q.doneToday+' / '+q.cap+'）。':'今天还能回 '+Math.max(0,q.cap-q.doneToday)+' 条。');const r=pe('div','row');r.append(link('去跟帖评论清单 →','#/tools/queue','btn primary'));a.append(r);
  const u=pe('div','toolcard');u.append(pe('h3',null,'AI 用量'),pe('p','hint','额度是所有项目一起用的；每个项目今天各用了多少，看"按项目看用量"。'));const r2=pe('div','row');r2.append(link('按项目看用量 →','#/tools/byproj','btn'),link('用量和限额 →','#/tools/usage','btn'));u.append(r2);B.replaceChildren(a,u);}
function renderHandoff(pj){const hs=okBlocks('handoff').filter((b)=>b.key.indexOf(pj+'/')===0).sort((a,b)=>String(b.payload.date||'').localeCompare(String(a.payload.date||''))||b.source_at-a.source_at);const B=$('f-handoff-body');
  if(!hs.length){B.replaceChildren(emptyP('还没有 '+pj+' 的交接记录'));setLead('f-handoff-lead','gray','还没有 '+pj+' 的交接记录。','换人接手时，交接记录会列在这里。');return;}const ul=pe('ul','hand');
  { const t=hs[0].payload||{};setLead('f-handoff-lead','gray','共 '+hs.length+' 条，最近一条是 '+(t.date||'')+' '+(t.role||hs[0].key.split('/').pop())+'交的。',t.next?'下一步：'+t.next:''); }
  hs.forEach((b)=>{const p=b.payload;const li=pe('li');const d=pe('div');d.append(pe('div','hint',(p.date||'')+' · '+(p.role||b.key.split('/').pop())),pe('div',null,p.done||''));if(p.next)d.append(pe('div','hint','下一步：'+p.next));li.append(d);
    const g=pe('div');if(p.link)g.append(link('看全文',p.link,'btn small'));li.append(g);ul.append(li);});B.replaceChildren(ul);}
// ---- 读数据、渲染、30 秒刷新 ----
function renderAll(){if(!PL.data)return;const now=Date.now();const all=sorted(items());
  $('f-err').hidden=true;$('w-err').hidden=true;
  // 工作台读取失败（批 A）：保留上次读到的内容，上面写"下面是 HH:MM 读到的"和"再读一次"；还没读到过就直说
  $('w-stale').hidden=$('f-stale').hidden=!PL.err;if(PL.err)$('w-stale-t').textContent=$('f-stale-t').textContent='读取失败：'+PL.errWhy+'。'+(PL.okAt?'下面是 '+hm(PL.okAt)+' 读到的内容。':'还没读到过内容。')+'过一会儿也会自动再试。';
  try{renderWork(all,now);}catch(e){$('w-err').hidden=false;$('w-err').textContent='工作台这一页出错了：'+e.message;}
  try{renderProject(curProj(),all,now);}catch(e){$('f-err').hidden=false;$('f-err').textContent='项目页出错了：'+e.message;}
  try{renderLive(now);}catch(e){$('w-err').hidden=false;$('w-err').textContent='团队在做什么出错了：'+e.message;}
  if(PL.page){$('app').hidden=false;$('boot').hidden=true;}
  if(PL.scroll){const el=$(PL.scroll);PL.scroll='';if(el){el.scrollIntoView({block:'start'});subPinTo(el.id,el);}}
  subSpySoon();}
async function getJ(u){const r=await fetch(u,{credentials:'same-origin'});if(r.status===401){showLogin('请重新登录');throw new Error('请重新登录');}if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'出错了（'+r.status+'）');}return r.json();}
async function refresh(){if(PL.busy){PL.again=true;return;}PL.busy=true;const v0=PL.ver;// 这次读发出时本地已确认到哪个版本
  // 批 B：只有停在项目页时才读「这个项目的清单条数」；停在公共工具、公司总览（PL.peek）时不读，免得和清单自己那次 product=forecast 的读取一模一样、重复发两次
  const want=PL.page==='project'?curProj():'';
  try{const [c,qa,qp,ac]=await Promise.all([getJ('/api/company'),getJ('/api/queue?status=pending').catch(()=>null),want?getJ('/api/queue?status=pending&product='+encodeURIComponent(want)).catch(()=>null):Promise.resolve(null),getJ('/api/active').catch(()=>undefined)]);
    PL.data=c;PL.done=new Map((c.done||[]).map((x)=>[x.key,x.at]));
    // 读发出之后才打的勾 / 撤销（ver > v0）：服务器这次回的是旧状态，以本地确认的为准；读发出之前就确认的，这次读已经包含了，不用再记
    PL.local.forEach((x,k)=>{if(x.ver>v0){if(x.done)PL.done.set(k,x.at);else PL.done.delete(k);}else PL.local.delete(k);});PL.reports=c.reports||[];PL.qAll=qa;if(want)PL.qProj[want]=qp;if(ac!==undefined)PL.active=ac;PL.err='';PL.errWhy='';PL.at=PL.okAt=Date.now();
    // 项目名单来自 projects 块：变了就重画一级菜单（setProjects 内部会在需要时重新路由）
    try{setProjects(pagesFrom(c));}catch(e){}}
  catch(e){if(e.message==='请重新登录'){PL.busy=false;return;}PL.errWhy=e instanceof TypeError?'网络断了或服务没回应':e.message;PL.err='暂时读不到最新情况：'+PL.errWhy+'（过一会儿自动再试）';if(!PL.data)PL.data={blocks:[],done:[],reports:[],weekly:null};
    // 读取失败：5 秒后先重试一次，之后照 30 秒一次（R10）
    clearTimeout(PL.retry);PL.retry=setTimeout(()=>{if(PL.page||PL.peek)refresh();},5000);}
  finally{PL.busy=false;}
  renderAll();if(PL.again){PL.again=false;refresh();}}
// 批 2 审查 R10：停在工作台、项目页，或者停在公共工具、公司总览（只为一级菜单上的数字，PL.peek）时，都每 30 秒重读一次
function tickTimer(){clearInterval(PL.timer);PL.timer=setInterval(()=>{if((PL.page||PL.peek)&&document.visibilityState==='visible')refresh();},30000);}
document.addEventListener('visibilitychange',()=>{if((PL.page||PL.peek)&&document.visibilityState==='visible')refresh();});
var platformOpen=function(p,mod){const changed=PL.page!==p||PL.proj!==curProj();PL.page=p;PL.proj=curProj();PL.peek=false;if(!PL.timer)tickTimer();
  if(!PL.data||changed||Date.now()-PL.at>30000){PL.scroll=mod||'';refresh();}else renderAll();};
var platformStop=function(){PL.page='';PL.peek=false;};
/** 停在公共工具、公司总览时：还没读过就读一次，让一级菜单上的待办数量马上显示（批 1 问题，Amos 2026-11-02） */
var platformPeek=function(){PL.peek=true;if(!PL.timer)tickTimer();if(!PL.data&&!PL.busy)refresh();};
['w-retry','f-retry'].forEach((id)=>$(id).addEventListener('click',async()=>{const b=$(id);b.setAttribute('aria-busy','true');b.textContent='正在读…';await refresh();b.removeAttribute('aria-busy');b.textContent='再读一次';
  if(!PL.err)toastP('已重新读取，现在是最新的');}));
/** 第一次读到数据之前，工作台、项目页先不显示（免得看到空的模块）；工作台这段时间显示占位骨架 #boot（批 A） */
var platformReady=function(){return !!PL.data;};
}catch(e){var platformReady=function(){return true;};var platformOpen=function(){['w-err','f-err'].forEach((id)=>{const x=document.getElementById(id);if(x){x.hidden=false;x.textContent='这一页出错了：'+e.message;}});};var platformStop=function(){};var platformPeek=function(){};}
</script>
<script>window.__assetsBase='/api/assets/';window.__ttsBase='/api/tts/';window.__voiceBase='/api/voice/';window.__engmemBase='/api/english/';</script>
<script>${ASSETS_JS}</script>
<script>${TTS_JS}</script>
<script>${VOICE_JS}</script>
<script>${ENGLISH_JS}</script>
<script>${EM_JS}</script>
</body></html>`;

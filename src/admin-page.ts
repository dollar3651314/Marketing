import { ASSETS_CSS, ASSETS_JS, ASSETS_MOD } from './assets-page';
import { TTS_CSS, TTS_JS, TTS_MOD } from './tts-page';
import { VOICE_CSS, VOICE_JS, VOICE_MOD } from './voice-page';
import { ENGLISH_CSS, ENGLISH_JS, ENGLISH_MOD } from './english-page';
import { EXTENSION_VERSION } from './extension-download';
import { MAX_PROJECT_PAGES, PLATFORM_CONFIG, PROJECT_PAGES_FALLBACK, PROJECT_SITE } from './projects';

/**
 * 网页后台 = 工作平台（agents C136；工作平台批 1：原型 agents 工作平台/原型-工作平台-v2.html，技术方案 工作平台/技术方案-工作平台*.md，Amos 2026-11-01"都按建议"）。
 * 外框：一级菜单"工作台 · 项目（**有几个出几个**）· 公共工具"，二级菜单直通模块，地址用锚点 #/work/todo、#/<项目>/guide、#/tools/queue，刷新停在原处；
 * 项目名单 2026-11-02 起**不写死**（Amos"项目也只有 forecast 一个，新项目哪儿去了"）：读 GET /api/company 的 projects 块算出来（规则和服务端同一份，
 * src/projects.ts projectPagesFrom），块还没推上来就用 CFG.PROJECT_PAGES_FALLBACK 兜底。项目页只有一套 DOM（#v-project、模块 id 还是 f-*），切项目时换数据不换结构；
 * 登录后默认工作台（P-9），/queue 打开直接进清单。没登录显示密码框；手机、电脑都能用。
 * 三段脚本：① 外框 + 清单、用量和限额、插件下载（这三块的脚本和接口没改，只换外框）；② "公司总览"（原运营仪表盘"公司"页，整段 try/catch）；
 * ③ 工作台、项目页（整段 try/catch，出错只影响这两页）。每个按钮都有处理中 / 成功 / 失败的反馈（C135）；删除先在页面上确认（删了不能恢复）。
 * 工作台"全部待办"2026-11-02 起按项目分组（Amos"31 个待办混在一起 我要疯掉了"）：逾期的单独置顶一块，其余每个项目一个可折叠分组、默认收起，
 * 展开状态记在这台设备的 localStorage 里。只改渲染，todo 块的数据结构（src/company.ts SCHEMA）没动。
 * 注意：整页是一个模板字符串，页面脚本里不能用反引号和 ${（只有插件版本号和 src/projects.ts 的对照表是在这里插进去的）。
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>工作平台</title>
<style>
:root{--bg:#F4F6F9;--surface:#fff;--ink:#13203A;--muted:#5B6678;--line:#D9DEE7;--navy:#0F1B33;--teal:#14B8A6;--teal-soft:#D5F5F0;--amber:#B26B00;--amber-soft:#FDF1DC;--ok:#15803D;--err:#B91C1C;--err-soft:#FDE8E8;--th:#6B3FA0;--ok-soft:#DCFCE7;--stale:#8A94A6;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme: dark){:root{--bg:#0B1220;--surface:#131C2E;--ink:#E6EBF3;--muted:#9AA6BA;--line:#26324A;--navy:#0A1324;--teal:#2DD4BF;--teal-soft:#0F3B37;--amber:#E9A641;--amber-soft:#3A2C14;--ok:#4ADE80;--err:#F87171;--err-soft:#3A1717;--th:#B993E6;--ok-soft:#14321F;--stale:#6B7689;color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}
/* 外框（工作平台批 1，原型 v2）：顶部一级菜单（工作台 · 项目 · 公共工具）、二级菜单直通模块，地址用 #/work/todo 这类锚点 */
.bars{position:sticky;top:0;z-index:30}
.top{position:relative;display:flex;align-items:center;gap:6px 8px;padding:8px max(16px,env(safe-area-inset-left));background:var(--navy);color:#fff;min-height:48px;flex-wrap:wrap}
.logo{display:flex;gap:3px;align-items:flex-end;flex:0 0 auto}.logo i{display:block;width:6px;border-radius:2px}
.brand{font-size:16px;font-weight:700;margin-right:8px;white-space:nowrap}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.nav1{display:flex;gap:6px;align-items:center;min-width:0;flex-wrap:wrap}
.nav1 a{font-size:14px;color:#C9D4E6;text-decoration:none;border-radius:99px;padding:5px 14px;border:1px solid transparent;white-space:nowrap}
.nav1 a:hover{border-color:#3A4A6A}.nav1 a[aria-current="page"]{background:#fff;color:var(--navy);font-weight:700}
.nav1 .grp-l{font-size:11px;color:#7E8DA8;margin-left:6px;white-space:nowrap}
.nav1 .cnt{display:inline-block;min-width:18px;padding:0 5px;margin-left:5px;border-radius:99px;background:#E5484D;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
.top .sp{flex:1}
.top button{font:inherit;font-size:12px;background:none;border:1px solid #3A4A6A;color:#C9D4E6;border-radius:99px;padding:3px 10px;cursor:pointer;white-space:nowrap}
.sub{position:relative;background:var(--surface);border-bottom:1px solid var(--line);box-shadow:0 2px 6px rgba(15,27,51,.05)}
.sub .in{max-width:1120px;margin:0 auto;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding:0 max(12px,env(safe-area-inset-left))}
.sub .in::-webkit-scrollbar{display:none}
.sub a{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:11px 12px 10px;font-size:14px;color:var(--muted);text-decoration:none;border-bottom:3px solid transparent;white-space:nowrap}
.sub a:hover{color:var(--ink)}.sub a[aria-current="true"]{color:var(--ink);font-weight:700;border-bottom-color:var(--teal)}
.sub .n{font-size:11px;font-weight:700;border-radius:99px;padding:0 6px;background:var(--bg);color:var(--muted);border:1px solid var(--line)}.sub .n.red{background:var(--err);color:#fff;border-color:var(--err)}
main{max-width:1120px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-right)) 40px max(16px,env(safe-area-inset-left));min-width:0}
.page{display:grid;gap:18px;min-width:0}.page::after{content:"";display:block;height:60vh}
.mod{scroll-margin-top:calc(var(--bars-h,104px) + 8px);min-width:0}
.page{scroll-margin-top:var(--bars-h,104px)}
.crumb{display:flex;gap:8px 10px;align-items:baseline;flex-wrap:wrap;margin:0}.crumb h1{font-size:22px;margin:0}
.mh{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.mh .sp{flex:1}.mh #count{font-size:13px;font-weight:400;color:var(--muted)}
@media (max-width:640px){.brand{display:none}.nav1{gap:2px}.nav1 a{padding:4px 9px}.nav1 .grp-l{display:none}.top{padding:6px 12px;min-height:44px;gap:4px 6px}
  .top #nav,.top #extnav{display:none}.top button{padding:2px 8px}.sub a{padding:8px 10px 7px}
  /* 批 2 审查 R8：公共工具手机上折行，"插件下载"不用横滑就看得到。
     批 4 收编了两个工具变成 8 项，批 5 下线一项、新增一项，还是 8 项——字号和内边距再收一点，仍然折成两行，
     两层菜单加起来还在屏幕高度 25% 以内（e2e-tools E 段守着；工具再多就得分组了，见 agents 工作平台/工具台账.md 的"菜单项上限"） */
  #sub-tools .in{flex-wrap:wrap;overflow-x:visible;row-gap:0;gap:2px}#sub-tools a{padding:5px 5px 4px;font-size:12px;gap:4px}
  /* 2026-11-03：工作台加了第 7 项"英语练习"，390 宽横着放不下（6 项时就已经要横滑了）。
     按 T-4 治公共工具的同一个办法折成两行——Amos 明早是来找这一项的，不能让它藏在屏幕右边要滑才看得到。 */
  #sub-work .in{flex-wrap:wrap;overflow-x:visible;row-gap:0;gap:2px}#sub-work a{padding:6px 7px 5px;font-size:13px;gap:4px}}
/* 其他二级菜单能横滑时，右边缘渐隐提示"还有"（R8） */
.sub .in.more{-webkit-mask-image:linear-gradient(90deg,#000 82%,transparent);mask-image:linear-gradient(90deg,#000 82%,transparent)}
/* 批 2 审查 R9：手机横屏（矮屏）两层菜单收紧，加起来 ≤ 屏幕高度 25% */
@media (max-height:500px){.top{min-height:0;padding:3px 12px;gap:2px 6px;flex-wrap:nowrap}.brand,.nav1 .grp-l,.top #nav,.top #extnav{display:none}.nav1{flex-wrap:nowrap;gap:2px}.nav1 a{padding:2px 9px}.top button{padding:1px 8px}
  .sub a{padding:4px 10px 3px}#sub-tools .in{flex-wrap:nowrap;overflow-x:auto}#sub-work .in{flex-wrap:nowrap;overflow-x:auto}}
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
.msg{margin:0;font-size:14px;color:var(--err)}.msg:empty{display:none}.msg.ok{color:var(--ok)}
/* 用量监控：Cloudflare 自己说"账号额度用完了"那条红字（置顶、到下一个 UTC 日自动不显示）和"这个数靠不靠得住"的说明 */
.acct{margin:0 0 10px;padding:12px 14px;border-radius:10px;background:var(--err-soft);color:var(--err);border:1px solid var(--err);font-size:14px;font-weight:700;line-height:1.6}
.acct .raw{display:block;margin-top:4px;font-weight:400;font-size:12px;opacity:.85;overflow-wrap:anywhere}
.caveat{margin:0 0 8px;padding:10px 12px;border-radius:8px;background:var(--amber-soft);color:var(--amber);font-size:13px;line-height:1.7}
.caveat b{display:block;margin-bottom:2px}
td .flag{display:block;font-size:12px;font-weight:400;color:var(--amber)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600}td.n{text-align:right}
.meter{display:inline-block;width:70px;height:6px;border-radius:3px;background:var(--line);vertical-align:middle;position:relative;overflow:hidden}.meter i{position:absolute;inset:0 auto 0 0;background:var(--teal)}
.state{font-size:12px;font-weight:700;border-radius:99px;padding:2px 8px;background:var(--teal-soft)}.state.warn{background:var(--amber-soft);color:var(--amber)}
.cap-in{width:90px}
.pad{padding:14px;display:grid;gap:10px}.hint{font-size:13px;color:var(--muted);margin:0}
/* 公司页（原型 2026-11-01）：样式都限定在 #v-company 里，不影响旧三页 */
#v-company,#co-body{display:grid;gap:16px}
#v-company .co-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:0}#v-company .co-bar .sp{flex:1}
#v-company .card{min-width:0}
#v-company .card h2{font-size:14px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#v-company .card h2 .sp{flex:1}
#v-company .stamp{font-size:12px;color:var(--muted);font-weight:400}
#v-company .old{filter:grayscale(1);opacity:.62}#v-company .old .stamp{color:var(--stale)}
#v-company .hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
#v-company .tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-width:0}
#v-company .tile .n{font:700 28px/1.1 var(--mono);font-variant-numeric:tabular-nums}#v-company .tile .l{color:var(--muted);font-size:12px;margin-top:4px}
#v-company .tile.need{border-color:var(--err);background:var(--err-soft)}#v-company .tile.need .n{color:var(--err)}
#v-company .pill{display:inline-block;font-size:12px;border-radius:99px;padding:1px 8px;white-space:nowrap;text-decoration:none}
#v-company .p-ok{background:var(--ok-soft);color:var(--ok)}#v-company .p-warn{background:var(--amber-soft);color:var(--amber)}#v-company .p-err{background:var(--err-soft);color:var(--err)}#v-company .p-mute{background:var(--bg);color:var(--muted);border:1px solid var(--line)}
#v-company table{font-variant-numeric:normal}
#v-company th,#v-company td{white-space:normal;vertical-align:top;padding:8px 10px}#v-company th{font-weight:500}#v-company tr:last-child td{border-bottom:0}
#v-company td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
#v-company .btn{font-size:13px;padding:6px 10px;white-space:nowrap}
#v-company .list{list-style:none;margin:0;padding:0}#v-company .list li{display:flex;gap:10px;align-items:flex-start;padding:10px 16px;border-bottom:1px solid var(--line)}#v-company .list li:last-child{border-bottom:0}
#v-company .list .who{display:block;flex:0 0 72px;color:var(--muted);font-size:12px;padding-top:2px}#v-company .list .what{flex:1;min-width:0;overflow-wrap:anywhere}#v-company .list .act{flex:0 0 auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#v-company .list li.done .what{color:var(--muted);text-decoration:line-through}#v-company .list li.done .what .hint{text-decoration:none}#v-company .co-done{color:var(--ok)!important}
#v-company .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
#v-company .bar{height:6px;background:var(--bg);border-radius:3px;overflow:hidden;margin:4px 0 2px;max-width:160px}#v-company .bar i{display:block;height:100%;background:var(--teal)}
#v-company .co-err{margin:0;padding:8px 16px;font-size:13px;color:var(--err);background:var(--err-soft);border-bottom:1px solid var(--line)}
#v-company .co-err-t{color:var(--err)}
#v-company .co-empty{padding:20px 16px;color:var(--muted);text-align:center;margin:0}
#v-company .msg{padding:0 16px}#v-company .msg:not(:empty){padding:8px 16px 0}
#v-company .list .what .detail{display:grid;gap:8px;margin-top:8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);justify-items:start}
#v-company .detail-text{white-space:pre-wrap;overflow-wrap:anywhere;width:100%}#v-company .detail-text.fold{max-height:12.8em;overflow:hidden}
#v-company .detail .qs{margin:0;padding-left:20px}#v-company .detail a.gh{font-size:13px;color:var(--muted)}
#v-company .co-foot{padding:10px 16px;display:grid;gap:4px;border-top:1px solid var(--line)}
/* 项目表（2026-11-01 Amos 截图：长数字把"本周"挤成一字一行、右边被截掉）：固定列宽，全部可换行；数字一条一行"名称 · 现在 → 目标"；本周最多 3 行，点一下展开 */
#v-company table.co-proj{table-layout:fixed}
#v-company table.co-proj td{white-space:normal;overflow-wrap:anywhere;word-break:normal}
#v-company table.co-proj .pill{white-space:normal;overflow-wrap:anywhere}
#v-company .co-m{margin:0 0 6px;line-height:1.45}#v-company .co-m:last-child{margin-bottom:0}
#v-company .co-m .k{color:var(--ink)}#v-company .co-m .s{color:var(--muted)}#v-company .co-m .v{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}#v-company .co-m .to{color:var(--muted)}
#v-company .co-week{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;line-height:1.5}
#v-company .co-week.can{cursor:pointer;border-radius:4px}#v-company .co-week:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
#v-company .co-week.open{display:block;-webkit-line-clamp:unset;line-clamp:none;overflow:visible}
#v-company tr.co-plan td,#v-company tr.co-plan td b{color:var(--muted);font-weight:400}
@media (max-width:600px){#v-company .list .who{flex-basis:100%;padding-top:0}#v-company .list li{flex-wrap:wrap}#v-company .list .act{justify-content:flex-start}
  #v-company table.stack thead{display:none}#v-company table.stack tr{display:block;padding:8px 6px;border-bottom:1px solid var(--line)}#v-company table.stack tr:last-child{border-bottom:0}
  #v-company table.stack td{display:block;border:0;padding:2px 10px}#v-company table.stack td.num{white-space:normal}
  #v-company table.stack td[data-label]::before{content:attr(data-label) "：";color:var(--muted);font-size:12px;font-family:inherit}
  #v-company table.co-proj{table-layout:auto}#v-company table.co-proj colgroup{display:none}}
/* 工作台、项目页（工作平台批 1，原型 v2）：样式都限定在 .plat 里，不影响清单、用量、插件下载和"公司总览" */
.plat .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;min-width:0;overflow:hidden}
.plat .card>h2{font-size:16px;margin:0;padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.plat .card>h2 .sp{flex:1}.plat .stamp{font-size:12px;color:var(--muted);font-weight:400}
.plat .lead{margin:0;padding:10px 16px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);background:var(--bg)}
.plat .pd{padding:12px 16px}.plat .hint{font-size:12px}
.plat .foot-note{padding:8px 16px;border-top:1px solid var(--line)}
.plat .pill{display:inline-block;font-size:12px;border-radius:99px;padding:1px 8px;white-space:nowrap;line-height:1.6}
.plat .p-ok{background:var(--ok-soft);color:var(--ok)}.plat .p-warn{background:var(--amber-soft);color:var(--amber)}.plat .p-err{background:var(--err-soft);color:var(--err)}.plat .p-mute{background:var(--bg);color:var(--muted);border:1px solid var(--line)}.plat .p-teal{background:var(--teal-soft);color:var(--ink)}
.plat .btn{font-size:14px;padding:8px 14px;white-space:nowrap;display:inline-block;line-height:1.4}.plat .btn.small{font-size:13px;padding:4px 10px;border-radius:8px}.plat .btn.big{font-size:17px;padding:12px 22px;border-radius:12px}
.plat .warnbar{margin:0;padding:8px 12px;font-size:13px;border-radius:10px;background:var(--amber-soft);color:var(--amber)}
.plat .hero{border-radius:16px;padding:20px 22px;background:var(--navy);color:#fff;display:grid;gap:10px;min-width:0}
.plat .hero .k{font-size:13px;color:#9FB0CC;margin:0}.plat .hero .one{font-size:22px;font-weight:700;line-height:1.4;margin:0;overflow-wrap:anywhere}
.plat .hero .when{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px;color:#C9D4E6}
.plat .hero .why{margin:0;font-size:14px;color:#C9D4E6;overflow-wrap:anywhere;padding:0;background:none}
.plat .hero .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:4px}.plat .hero .row a.sec{color:#9FB0CC;font-size:13px}
.plat .hero.calm{background:var(--surface);color:var(--ink);border:1px solid var(--line)}.plat .hero.calm .k,.plat .hero.calm .why{color:var(--muted)}
.plat .glance{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:10px}
.plat .gl{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px;text-decoration:none;color:inherit;min-width:0}
.plat a.gl:hover{border-color:var(--teal)}.plat .gl .n{font:700 22px/1.2 var(--mono);overflow-wrap:anywhere}.plat .gl .l{font-size:12px;color:var(--muted)}.plat .gl.red .n{color:var(--err)}
.plat .todos{list-style:none;margin:0;padding:0}
.plat .todo{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 14px;align-items:start;padding:14px 16px;border-bottom:1px solid var(--line);border-left:4px solid transparent}
.plat .todo:last-child{border-bottom:0}
.plat .todo.over{border-left-color:var(--err);background:linear-gradient(90deg,var(--err-soft),transparent 40%)}
.plat .todo.soon{border-left-color:var(--amber);background:linear-gradient(90deg,var(--amber-soft),transparent 40%)}
.plat .todo.first .ttl{font-size:17px}
.plat .tick{width:26px;height:26px;border-radius:50%;border:2px solid var(--line);background:var(--surface);cursor:pointer;margin-top:2px;display:grid;place-items:center;color:transparent;font-size:14px;padding:0}
.plat .tick:hover{border-color:var(--ok);color:var(--ok)}.plat .tick:disabled{background:var(--ok);border-color:var(--ok);color:#fff}
.plat .tick:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.plat .todo .body{min-width:0;display:grid;gap:3px}
.plat .todo .due{display:flex;gap:6px 8px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--muted)}
.plat .todo .ttl{font-weight:700;font-size:15px;overflow-wrap:anywhere}
.plat .todo .why{margin:0;padding:0;background:none;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.plat .todo .go{align-self:center}
.plat .form{display:flex;gap:6px 10px;flex-wrap:wrap;align-items:center;margin-top:6px}
.plat .form label{font-size:13px;color:var(--muted);display:inline-flex;gap:4px;align-items:center}.plat .form input{width:84px}.plat .form .msg{width:100%}
.plat .badge{font-size:12px;font-weight:700;border-radius:99px;padding:1px 9px;white-space:nowrap}
.plat .b-over{background:var(--err-soft);color:var(--err);border:1px solid var(--err)}.plat .b-soon{background:var(--amber-soft);color:var(--amber);border:1px solid var(--amber)}
.plat .b-later{background:var(--bg);color:var(--ink);border:1px solid var(--line)}.plat .b-none{background:var(--bg);color:var(--muted);border:1px dashed var(--line)}
.plat .projtag{font-size:12px;border-radius:6px;padding:0 7px;background:var(--teal-soft);white-space:nowrap}.plat .projtag.company{background:var(--bg);color:var(--muted);border:1px solid var(--line)}
/* 全部待办按项目分组（2026-11-02）：逾期的置顶一块（常显），其余每个项目一个 details，默认收起 */
.plat .tgrp{border-top:1px solid var(--line)}
.plat .tgrp:first-child{border-top:0}
.plat .over-grp .tgrp-h{margin:0;padding:10px 16px;font-size:14px;display:flex;gap:8px;align-items:center;color:var(--err);background:var(--err-soft)}
.plat details.tgrp>summary{color:var(--ink);flex-wrap:wrap}
.plat details.tgrp>summary .gname{font-weight:700}
.plat details.tgrp>summary .gnext{font-weight:400;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 140px}
.plat #w-todo-bar{justify-content:flex-start}
.plat details.fold>summary{cursor:pointer;padding:10px 16px;font-size:14px;font-weight:700;list-style:none;display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);color:var(--muted)}
.plat details.fold>summary::-webkit-details-marker{display:none}.plat details.fold>summary::before{content:"▸"}.plat details.fold[open]>summary::before{content:"▾"}
.plat .donelist{list-style:none;margin:0;padding:0 0 6px}
.plat .donelist li{display:flex;gap:10px;align-items:center;padding:6px 16px;font-size:14px;color:var(--muted);flex-wrap:wrap}.plat .donelist li s{flex:1;min-width:0;overflow-wrap:anywhere}
.plat .empty{padding:24px 16px;text-align:center;margin:0;display:grid;gap:6px;justify-items:center;color:var(--ink)}.plat .empty span{color:var(--muted);font-size:14px}
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
.plat .meter{height:6px;background:var(--bg);border:1px solid var(--line);border-radius:3px;overflow:hidden;margin-top:4px;max-width:140px;display:block;width:auto}.plat .meter i{display:block;height:100%;background:var(--teal);position:static}
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
.plat .detail-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6;width:100%}
.plat .detail-text.fold{max-height:12.8em;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,#000 75%,transparent);mask-image:linear-gradient(180deg,#000 75%,transparent)}
.plat .detail .qs{margin:0;padding-left:20px;display:grid;gap:4px;width:100%}.plat .detail .qs li{overflow-wrap:anywhere}
.plat .todo .go a.gh{font-size:14px;color:var(--ink)}
.plat .detail .cutnote{margin:0;font-size:13px;color:var(--amber)}.plat .detail a.gh{font-size:13px;color:var(--muted)}
#t-reply .cap-in{width:70px}
#p-toast{position:fixed;left:16px;right:16px;bottom:20px;margin:0 auto;max-width:520px;background:var(--navy);color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:50;box-shadow:0 6px 20px rgba(0,0,0,.25);text-align:center}
#p-toast.err{background:var(--err)}
@media (max-width:640px){
  .plat .hero{padding:16px}.plat .hero .one{font-size:19px}.plat .hero .row .btn{width:100%}
  .plat .todo{grid-template-columns:auto minmax(0,1fr);padding:12px}.plat .todo .go{grid-column:2;align-self:start}.plat .todo .go .btn{width:100%;white-space:normal}
  .plat .step{grid-template-columns:auto minmax(0,1fr);padding:12px}.plat .step .acts{grid-column:2}.plat .step .btn{white-space:normal}
  .plat .hand li{grid-template-columns:minmax(0,1fr)}
  .plat table.stack{table-layout:auto}.plat table.stack colgroup{display:none}
  .plat table.stack thead{display:none}.plat table.stack tr{display:block;padding:8px 6px;border-bottom:1px solid var(--line)}.plat table.stack tr:last-child{border-bottom:0}
  .plat table.stack td{display:block;border:0;padding:2px 10px;text-align:left}.plat table.stack td.num{white-space:normal}
  .plat table.stack td[data-label]::before{content:attr(data-label) "：";color:var(--muted);font-size:12px;font-family:inherit}
}
/* 团队在做什么（工作平台批 3，原型 v2）：每条一个 仓库 + 分支；变灰 .old、CI 红 .red；外部人的标"外部" */
.plat .alert{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-radius:12px;background:var(--err-soft);color:var(--err);border:1px solid var(--err);font-size:14px;margin-bottom:12px}.plat .alert .sp{flex:1}
.plat .live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.plat .live-dot.lag{background:var(--amber);box-shadow:0 0 0 3px var(--amber-soft)}.plat .live-dot.fail{background:var(--err);box-shadow:0 0 0 3px var(--err-soft)}.plat .live-dot.off{background:var(--stale);box-shadow:none}
.plat .grp{padding:6px 16px;background:var(--bg);font-size:12px;font-weight:700;color:var(--muted);border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:center}
.plat .live-warn{display:grid;gap:6px;padding:10px 16px;border-bottom:1px solid var(--line)}.plat .live-warn:empty{display:none}
.act-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:10px 16px;border-bottom:1px solid var(--line);min-width:0}
.act-item:last-child{border-bottom:0}
.act-item .bd{min-width:0;display:grid;gap:2px}
.act-item .tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px}
.act-item .ttl{font-weight:700;overflow-wrap:anywhere}
.act-item .br{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.act-item .br code{font-size:11px;font-family:var(--mono)}
.act-item .stp{font-size:13px;overflow-wrap:anywhere}.act-item .ago{color:var(--muted);white-space:nowrap}
.act-item .go{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.act-item .note{font-size:12px;color:var(--stale)}
.act-item.old{background:repeating-linear-gradient(135deg,transparent 0 10px,rgba(138,148,166,.07) 10px 20px)}
.act-item.old .ttl,.act-item.old .stp{color:var(--stale)}
.act-item.red{box-shadow:inset 4px 0 0 var(--err)}
.act-item .role{font-size:12px;font-weight:700;border-radius:6px;padding:0 7px;background:var(--navy);color:#fff;white-space:nowrap}
.act-item .role.none{background:transparent;color:var(--stale);border:1px dashed var(--stale);font-weight:500}.act-item .role.ext{background:var(--amber-soft);color:var(--amber)}
.act-item .proj{font-size:12px;border-radius:6px;padding:0 7px;border:1px solid var(--line);white-space:nowrap}
.act-item .proj.forecast{background:var(--teal-soft);border-color:transparent}.act-item .proj.platform{color:var(--th);border-color:var(--th)}.act-item .proj.company{color:var(--muted)}
.plat details.recent>summary{border-top:1px solid var(--line)}
@media (max-width:600px){.act-item{grid-template-columns:minmax(0,1fr)}.act-item .go{flex-direction:row;flex-wrap:wrap;align-items:flex-start}}
/* 收编进来的工具的样式：素材生成器（选择器都带 .ag）、语音生成（都带 .tv）、语音对话实测（都带 .vc），不串到别的模块 */
${ASSETS_CSS}${TTS_CSS}${VOICE_CSS}${ENGLISH_CSS}
</style></head><body>
<div class="bars" id="bars"><header class="top" id="top"><span class="logo" aria-hidden="true"><i style="height:16px;background:#2DD4BF"></i><i style="height:10px;background:#FBBF24"></i></span><span class="brand">工作平台</span><b class="sr" id="title">工作台</b>
  <nav class="nav1" id="nav1" aria-label="一级菜单" hidden><a href="#/work" data-p="work">工作台<span class="cnt" id="c-work" hidden></span></a><span class="grp-l" id="nav1-grp" hidden>项目</span><a href="#/tools" data-p="tools" id="nav1-tools">公共工具</a></nav>
  <span class="sp"></span><button id="nav" hidden>用量和限额 →</button><button id="extnav" hidden>插件下载</button><button id="conav" hidden>公司</button><button id="logout" hidden>登出</button></header>
<div id="subs" hidden>
<nav class="sub" id="sub-work" aria-label="工作台模块" hidden><div class="in">
  <a href="#/work/now" data-s="w-now">最该做的事</a><a href="#/work/todo" data-s="w-todo">全部待办<span class="n red" id="s-todo" hidden></span></a><a href="#/work/live" data-s="w-live">团队在做什么</a><a href="#/work/proj" data-s="w-proj">项目概况</a><a href="#/work/num" data-s="w-num">公司数字</a><a href="#/work/meet" data-s="w-meet">经营会</a><a href="#/work/english" data-s="w-english">英语练习</a>
</div></nav>
<nav class="sub" id="sub-project" aria-label="项目模块" hidden><div class="in">
  <a href="#/forecast/next" data-s="f-next" data-m="next">下一步做什么<span class="n red" id="s-fnext" hidden></span></a><a href="#/forecast/guide" data-s="f-guide" data-m="guide">操作指引<span class="n" id="s-guide" hidden></span></a><a href="#/forecast/live" data-s="f-live" data-m="live">团队在做什么</a><a href="#/forecast/card" data-s="f-card" data-m="card">数字和决定</a><a href="#/forecast/pack" data-s="f-pack" data-m="pack">本周帖子</a><a href="#/forecast/match" data-s="f-match" data-m="match">焦点战</a><a href="#/forecast/tools" data-s="f-tools" data-m="tools">用到的工具</a><a href="#/forecast/handoff" data-s="f-handoff" data-m="handoff">交接记录</a>
</div></nav>
<nav class="sub" id="sub-tools" aria-label="公共工具模块" hidden><div class="in">
  <a href="#/tools/queue" data-s="t-queue">跟帖评论清单</a><a href="#/tools/reply" data-s="t-reply">每天回帖上限</a><a href="#/tools/usage" data-s="t-usage">用量和限额</a><a href="#/tools/byproj" data-s="t-byproj">按项目看用量</a><a href="#/tools/ext" data-s="t-ext">插件下载</a><a href="#/tools/hook" data-s="t-hook">Webhook 开关</a><a href="#/tools/assets" data-s="t-assets">素材生成器</a><a href="#/tools/tts" data-s="t-tts">语音生成</a>
</div></nav>
</div></div>
<form class="login" id="login" hidden>
  <b>登录</b><label for="pw">密码</label><input id="pw" type="password" autocomplete="current-password" required>
  <button class="btn primary" id="go" type="submit">登录</button><p class="msg" id="lmsg" role="alert"></p>
</form>
<main id="app" hidden>
  <!-- 工作台（P-9 默认页）：内容由第三段脚本读 /api/company 后渲染 -->
  <section class="page plat" id="v-work" hidden>
    <p class="warnbar" id="w-err" role="status" hidden></p>
    <div class="alert" id="ci-alert" role="alert" hidden><b>有改动没通过自动检查</b><span id="ci-alert-t"></span><span class="sp"></span><a class="btn small danger" id="ci-alert-a" href="#/work/live">看哪里出错</a></div>
    <section class="mod" id="w-now"><div class="hero calm" id="hero"><p class="k">你现在最该做的一件事</p><p class="one">正在读取…</p></div></section>
    <div class="glance" id="w-glance"></div>
    <section class="card mod" id="w-todo">
      <h2>全部待办 <span class="pill p-err" id="w-todo-n">0</span><span class="sp"></span><span class="stamp">最急的在最上面</span></h2>
      <p class="lead"><b>逾期的单独放在最上面</b>，剩下的按项目收进分组（点一下展开）。红色＝已经超时，橙色＝24 小时内到期。做完了点左边的圆圈打勾，它会收进最下面"做完的"；手机、电脑打的勾是同一份，展开 / 收起只记在这台设备上。</p>
      <div class="bar-row" id="w-todo-bar" hidden><span>按项目分组</span><button class="chip" type="button" id="w-todo-all" aria-pressed="false">全部展开</button></div>
      <div id="w-todos"></div>
      <details class="fold" id="w-done"><summary>做完的 <span class="pill p-mute" id="w-done-n">0</span></summary><ul class="donelist" id="w-donelist"></ul></details>
    </section>
    <section class="card mod" id="w-live"><h2><span class="live-dot" id="w-live-dot" aria-hidden="true"></span>团队在做什么 <span class="pill p-teal" id="w-live-n">0</span><span class="sp"></span><span class="stamp" id="w-live-stamp"></span></h2>
      <p class="lead">不用你处理，看看就好。每条是一个岗位正在做的一件事（一个分支）；<b>两小时没动静</b>会变灰，<b>一天没动静</b>、合并了或分支删了收进"最近结束"。代码仓库（new-forecast、Marketing）只显示分支名、PR 标题和自动检查结果。</p>
      <div class="live-warn" id="w-live-warn"></div>
      <div class="bar-row" id="w-live-grp"><span>怎么分组</span><button class="chip" type="button" data-grp="role" aria-pressed="true">按岗位</button><button class="chip" type="button" data-grp="proj" aria-pressed="false">按项目</button><button class="chip" type="button" data-grp="time" aria-pressed="false">按时间</button></div>
      <div id="w-live-body"></div>
      <details class="fold recent" id="recent"><summary>最近结束 <span class="pill p-mute" id="recent-n">0</span><span class="hint" style="font-weight:400">只显示 7 天内的</span></summary><div id="recent-body"></div></details>
    </section>
    <section class="card mod" id="w-proj"><h2>项目概况 <span class="sp"></span><span class="stamp" id="w-proj-at"></span></h2><div id="w-proj-body"></div><p class="hint foot-note">只列正在跑、有状态卡的项目。以后发了启动命令的新项目会多一行。</p></section>
    <section class="card mod" id="w-num"><h2>公司数字 <span class="sp"></span><span class="stamp" id="w-num-at"></span></h2><div id="w-num-body"></div></section>
    <section class="card mod" id="w-meet"><h2>经营会 <span class="sp"></span><span class="stamp">每周六晚上 8 点</span></h2><div class="pd" id="w-meet-body"></div></section>
    ${ENGLISH_MOD}
    <p class="foot">停在这一页时每 30 秒自动刷新；切到别的窗口时暂停，切回来马上刷新。</p>
  </section>
  <!-- 项目页（PR 2）：一套 DOM 轮流显示每个项目（#/<项目>/<模块>），模块 id 还是 f-* -->
  <section class="page plat" id="v-project" hidden>
    <div class="crumb"><h1 id="f-title">项目</h1><span class="hint" id="f-site"></span></div>
    <p class="warnbar" id="f-err" role="status" hidden></p>
    <section class="card mod" id="f-next">
      <h2>下一步做什么 <span class="pill p-err" id="f-next-n">0</span><span class="sp"></span><span class="stamp">最急的在最上面</span></h2>
      <p class="lead">从第一条开始做就行。红色＝已经超时，橙色＝24 小时内到期。每条只有一个按钮，点了直接带你去要操作的地方；做完点左边圆圈打勾。</p>
      <ul class="todos" id="f-todos"></ul>
      <details class="fold" id="f-done"><summary>做完的 <span class="pill p-mute" id="f-done-n">0</span></summary><ul class="donelist" id="f-donelist"></ul></details>
    </section>
    <section class="card mod" id="f-guide"><h2 id="f-guide-h">操作指引</h2><div id="f-guide-body"></div></section>
    <section class="card mod" id="f-live"><h2><span class="live-dot" id="f-live-dot" aria-hidden="true"></span>团队在做什么 <span class="pill p-teal" id="f-live-n">0</span><span class="sp"></span><span class="stamp" id="f-live-stamp"></span></h2><div class="live-warn" id="f-live-warn"></div><div id="f-live-body"></div></section>
    <section class="card mod" id="f-card"><h2>数字和决定 <span class="sp"></span><span class="stamp" id="f-card-at"></span></h2><div id="f-card-body"></div></section>
    <div class="two">
      <section class="card mod" id="f-pack"><h2 id="f-pack-h">本周帖子</h2><div id="f-pack-body"></div></section>
      <section class="card mod" id="f-match"><h2 id="f-match-h">焦点战</h2><div id="f-match-body"></div></section>
    </div>
    <section class="card mod" id="f-tools"><h2>本项目用到的工具 <span class="sp"></span><span class="stamp" id="f-tools-stamp"></span></h2><div class="pd two" id="f-tools-body"></div></section>
    <section class="card mod" id="f-handoff"><h2>交接记录 <span class="sp"></span><span class="stamp">新的在上 · 换人接手时看</span></h2><div id="f-handoff-body"></div></section>
  </section>
  <!-- 公共工具：清单、用量和限额、插件下载三块的脚本和接口不动，只换外框 -->
  <section class="page" id="v-tools" hidden>
    <div class="crumb"><h1>公共工具</h1><span class="hint">各项目一起用的工具；上限只在这一页改</span></div>
    <section class="mod" id="t-queue"><h2 class="mh">跟帖评论清单<span class="sp"></span><span id="count"></span></h2>
  <section id="v-list">
    <div class="filters" role="group" aria-label="状态"><button class="chip" data-f="pending" aria-pressed="true">待回</button><button class="chip" data-f="done" aria-pressed="false">已回</button><button class="chip" data-f="skip" aria-pressed="false">跳过</button>
      <label for="f-prod">项目</label><select id="f-prod"><option value="">全部</option></select>
      <label for="f-plat">平台</label><select id="f-plat"><option value="">全部</option><option value="x">X</option><option value="threads">Threads</option></select>
      <label for="f-sort">排序</label><select id="f-sort"><option value="time">最新的在前</option><option value="score">评分从高到低</option></select></div>
    <div class="filters" role="group" aria-label="时间"><label>存进来的时间（台湾）</label><button class="chip" data-rg="today" aria-pressed="false">今天</button><button class="chip" data-rg="7" aria-pressed="false">近 7 天</button><button class="chip" data-rg="all" aria-pressed="true">全部</button>
      <label for="f-from">从</label><input type="date" id="f-from"><label for="f-to">到</label><input type="date" id="f-to"></div>
    <p class="sum"><span id="total"></span><span class="sp"></span><button class="btn small danger" id="bulk" type="button" hidden>删除筛选出的这些</button></p>
    <div class="confirm" id="bulk-confirm" role="alert" hidden><span id="bulk-text"></span><button class="btn small danger" id="bulk-yes" type="button">确认删除</button><button class="btn small" id="bulk-no" type="button">取消</button></div>
    <p class="toast" id="toast" role="status" hidden></p>
    <div id="list"></div>
  </section></section>
  <!-- 每天回帖上限按项目（工作平台批 2，D-2）：GET / POST /api/reply-cap -->
  <section class="mod" id="t-reply"><h2 class="mh">每天回帖上限<span class="sp"></span><span class="hint">每个项目一个数</span></h2>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>项目</th><th>每天上限</th><th>今天已回</th></tr></thead><tbody id="rc-rows"><tr><td colspan="3">正在读取…</td></tr></tbody></table></div>
      <div class="pad"><button class="btn primary" id="rc-save" type="button">保存上限</button><p class="msg" id="rc-msg" role="status"></p>
        <p class="hint">插件里"同意"和清单里"我回了"合起来算，按台湾日期每天重新数。某个项目到上限后，只有这个项目的"一键回复"变灰，别的项目照常。每个项目 1～50 条；没单独设过的项目用默认值。</p></div></div>
  </section>
  <section class="mod" id="t-usage"><h2 class="mh">用量和限额<span class="sp"></span><span class="hint">还剩多少 · 分别用到了哪里</span></h2>
  <section id="v-usage">
    <!-- 用量监控（Amos 2026-11-03"可以看到剩余和分别用到了哪里"）第一块：还剩多少。数据来自 /api/usage 的 left（src/usage.ts usageLeft） -->
    <h3 class="mh">还剩多少</h3>
    <!-- Cloudflare 自己说"账号额度用完了"：数据来自 /api/usage 的 accountLimit（表 account_limit，迁移 0011）。
         这是唯一可靠的信号——下面表里的数只是本环境记下的下限。到下一个 UTC 日（台湾早上 8 点）自动不显示 -->
    <p class="acct" id="u-acct" role="alert" hidden></p>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>这本账</th><th>今天已用</th><th>每天上限</th><th>还剩</th><th>什么时候清零（台湾时间）</th></tr></thead><tbody id="u-left"><tr><td colspan="5">正在读取…</td></tr></tbody></table></div>
      <!-- 每一行的"这个数靠不靠得住"：Workers AI 那一行写明是本环境记的账、Cloudflare 按整个账号算（src/usage.ts waiCaveat） -->
      <div class="pad" id="u-left-notes"></div>
      <div class="pad"><p class="hint">两本账<b>分开看、不要加在一起</b>（单位都不一样）：Workers AI 按 neurons 算，备用 AI、素材生成器、语音生成花的都是这一本；Gemini 按请求次数算。<b>"一天"按各家自己的重置时间</b>：Workers AI 是 UTC 0 点清零，也就是<b>台湾早上 8 点</b>；Gemini 是美国太平洋时间半夜清零，也就是<b>台湾下午 3 点或 4 点</b>（看美国当时有没有夏令时）。这里的"上限"是我们自己在下面那张表里设的数，<b>不是各家的真实剩余额度</b>——Google 不提供查询接口；Cloudflare 的免费额度每天 10,000 neurons 是<b>按整个账号算的</b>，正式版和测试版共用一份、却各记各的账（两个不同的数据库），所以上面那个"还剩"只能当<b>最多还有这么多</b>看。<b>要知道真实剩余只有两条路</b>：一是 Cloudflare 自己报错（报了上面就出红字），二是去接 Cloudflare 的分析接口（要 Amos 的 API 令牌，这一版没做）。</p></div></div>
    <h3 class="mh">每个模型的用量和上限</h3>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>模型</th><th>今天请求</th><th>今天 token（入 / 出）</th><th>每天上限</th><th>用量</th><th>状态</th><th>下次重置（台湾时间）</th></tr></thead><tbody id="u-rows"></tbody></table></div>
      <div class="pad"><p class="sum" style="margin:0"><span id="u-at">还没读取</span><span class="sp"></span><button class="btn small" id="u-refresh" type="button">立即刷新</button></p>
        <button class="btn primary" id="u-save" type="button">保存上限</button><p class="msg" id="u-msg" role="status"></p>
        <p class="hint">Gemini 的真实免费额度 Google 不提供查询，这里是我们自己数的次数和 token；Google 说用完（429）时状态会标出来。到了我们设的上限，这个模型今天先跳过，换下一个。Gemini 按次数（1～10,000），Workers AI 按 neurons（1～9,500；免费额度 10,000，超过不让保存）。"今天"按各家的重置时间算。</p></div></div>
    <!-- 用量监控第二块：分别用到了哪里。数据来自 /api/usage 的 byPurpose（表 usage_by_purpose，迁移 0010） -->
    <h3 class="mh">分别用到了哪里<span class="sp"></span><span class="hint">今天 · 按用途 · 只看、不设上限</span></h3>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>用途</th><th>Workers AI（neurons）</th><th>Workers AI 次数</th><th>Gemini 次数</th></tr></thead><tbody id="u-purpose"><tr><td colspan="4">正在读取…</td></tr></tbody></table></div>
      <div class="pad"><p class="hint">按"这一笔是干什么用的"分开记（表 <code>usage_by_purpose</code>）。为什么不看"按项目看用量"：素材生成器的图片和音频都算同一个项目，按项目分不出哪一笔是出图、哪一笔是配音。neurons 是<b>按价格表估算</b>的，不是 Cloudflare 的账单。<b>这一版上线以前记下的用量没有用途，不回填也不估算</b>，单独列成"没按用途记下来的"；那一行的次数写"没记录"，因为当时确实没记下来。</p></div></div>
  </section></section>
  <!-- 按项目看用量（工作平台批 2，D-3）：/api/usage 的 byProject；只记、不当限额 -->
  <section class="mod" id="t-byproj"><h2 class="mh">按项目看用量<span class="sp"></span><span class="hint">今天 · 只看、不设上限</span></h2>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>项目</th><th>Gemini</th><th>Workers AI</th></tr></thead><tbody id="bp-rows"><tr><td colspan="3">正在读取…</td></tr></tbody></table></div>
      <div class="pad"><p class="hint">"今天"和上面的用量和限额一样按各家的重置时间算。额度是所有项目一起用的，上限只在"用量和限额"里设。"平台自己"是设置页"测试 AI"这类平台自己发的请求。这一版上线以前没分项目（不回填），所以今天按项目加起来可能比上面的总数少。</p></div></div>
  </section>
  <!-- Webhook 开关（工作平台批 3）：settings 的 hook:github；GET /api/active 的 on、POST /api/hook {on} -->
  <section class="mod" id="t-hook"><h2 class="mh">Webhook 开关<span class="sp"></span><span class="hint">工作台"团队在做什么"的数据来源</span></h2>
    <div class="card"><div class="pad">
      <p class="sum" style="margin:0"><button class="btn primary" id="hook-toggle" type="button" aria-pressed="true" hidden>正在读取…</button><span class="msg" id="hook-msg" role="status"></span></p>
      <p class="hint">开着：GitHub 发来的推送、PR、自动检查结果写进"团队在做什么"。关着：签名对的事件照样回"收到"，但一条都不写（出问题时先关这里止损）。要连请求都挡住，到 GitHub 仓库 Settings → Webhooks 取消 Active。</p>
    </div></div>
  </section>
  ${ASSETS_MOD}
  ${TTS_MOD}
  ${VOICE_MOD}
  <section class="mod" id="t-ext"><h2 class="mh">插件下载</h2>
  <section id="v-ext">
    <div class="card"><div class="pad">
      <p class="sum" style="margin:0">副驾驶插件 <b>${EXTENSION_VERSION}</b>（和这个后台是同一次部署，版本对得上）</p>
      <button class="btn primary" id="dl" type="button">下载插件 ${EXTENSION_VERSION}</button><p class="msg" id="dl-msg" role="status"></p>
      <b>第一次安装（电脑上的 Chrome）</b>
      <ol class="steps">
        <li>点上面的按钮下载，把 zip 解压到一个固定的地方（例如"文件"里），得到 <code>marketing-copilot</code> 文件夹。<b>以后不要移动或删除这个文件夹</b>，插件就从这里读。</li>
        <li>Chrome 地址栏打开 <code>chrome://extensions</code>，打开右上角的"开发者模式"。</li>
        <li>点"加载已解压的扩展程序"，选 <code>marketing-copilot</code> 文件夹。</li>
        <li>打开 X 或 Threads，点插件图标打开侧边栏，到"设置"填中转服务地址 <code id="origin"></code> 和连接令牌（令牌只填在插件里，不要发到聊天里）。</li>
      </ol>
      <b>更新到新版本</b>
      <ol class="steps">
        <li>下载新版，解压后把里面的文件<b>覆盖</b>到原来的 <code>marketing-copilot</code> 文件夹（位置不变，插件的设置会保留）。</li>
        <li>到 <code>chrome://extensions</code> 找到"Quick Come 副驾驶"，点刷新按钮 ↻，再刷新 X / Threads 页面。</li>
      </ol>
    </div></div>
  </section></section>
  </section>
  <!-- 公司总览：原运营仪表盘"公司"页（右上角"公司总览"进入，地址 #/company），脚本和样式都没改 -->
  <section id="v-company" hidden>
    <p class="co-bar"><span id="co-at">还没读取</span><span class="sp"></span><button class="btn small" id="co-refresh" type="button">刷新</button></p>
    <div id="co-body"></div>
  </section>
</main>
<script>
const $=(id)=>document.getElementById(id);
let filter='pending', view='list', state={items:[],total:0,max:500,products:[],doneToday:0,cap:10}, usage=[];
const P={x:'X',threads:'Threads'}, PROD={forecast:'Quick Come'};
const tw=(ms)=>new Date(ms+8*3600e3).toISOString().replace('T',' ').slice(0,19);
const twDay=(ms)=>tw(ms).slice(0,10);
function toast(t,err){const e=$('toast');e.textContent=t;e.className='toast'+(err?' err':'');e.hidden=!t;}
async function call(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.status===401&&path!=='/api/login'){showLogin('请重新登录');throw new Error('请重新登录');}if(!r.ok)throw new Error(j.error||('出错了（'+r.status+'）'));return j;}
let authed=false;
function showLogin(m){authed=false;$('app').hidden=true;$('subs').hidden=true;$('nav1').hidden=true;$('logout').hidden=true;$('nav').hidden=true;$('extnav').hidden=true;$('conav').hidden=true;$('login').hidden=false;$('count').textContent='';$('lmsg').textContent=m||'';$('pw').focus();try{platformStop();}catch(e){}}
// #app 由 route() 决定什么时候显示：工作台、项目页等第一次读到数据再显示（免得看到空模块），清单、用量、插件下载、公司总览马上显示
function showApp(){authed=true;$('subs').hidden=false;$('nav1').hidden=false;$('logout').hidden=false;frameButtons();setTimeout(()=>{try{subHint();}catch(e){}},0);}
$('login').addEventListener('submit',async(e)=>{e.preventDefault();const b=$('go');b.disabled=true;b.textContent='正在登录…';$('lmsg').textContent='';
  try{await call('/api/login',{password:$('pw').value});$('pw').value='';$('login').hidden=true;await load();route();}catch(err){$('lmsg').textContent=err.message;}finally{b.disabled=false;b.textContent='登录';}});
$('logout').addEventListener('click',async()=>{await call('/api/logout',{}).catch(()=>{});showLogin('已登出');});
const TITLES={hook:'Webhook 开关',list:'跟帖评论清单',usage:'用量和限额',reply:'每天回帖上限',ext:'插件下载',assets:'素材生成器',tts:'语音生成',voice:'语音对话实测',company:'公司',work:'工作台'};
// 外框路由（工作平台批 1）：#/<页>/<模块>；页 = work / <项目> / tools / company；模块 id = 页的前缀 + 模块名（#/work/todo → w-todo）
// 2026-11-02：项目不再写死。地址里第一段是项目名时，内部页名一律是 'project'（一套 DOM #v-project 轮流显示），当前项目记在 proj 里。
let page='', proj='';
const FIXED={work:'w-',tools:'t-',company:''};
const PFX={work:'w-',project:'f-',tools:'t-',company:''}, TOOLV={queue:'list',usage:'usage',ext:'ext',reply:'reply',byproj:'usage',hook:'hook',assets:'assets',tts:'tts',voice:'voice'};
// 有项目页的项目：先用兜底名单（src/projects.ts PROJECT_PAGES_FALLBACK），读到 /api/company 后由第三段脚本调 setProjects() 换成真的
const PCFG=${JSON.stringify({ PROJECT_PAGES_FALLBACK, MAX_PROJECT_PAGES, PROJECT_SITE })};
let PROJS=PCFG.PROJECT_PAGES_FALLBACK.slice();
/** 一级菜单上的项目链接：有几个项目出几个（每个带待办数的小红点 #c-<项目名>） */
function renderNav1(){const nav=$('nav1'),tools=$('nav1-tools');
  nav.querySelectorAll('a[data-proj]').forEach((a)=>a.remove());
  PROJS.forEach((p)=>{const a=document.createElement('a');a.href='#/'+encodeURIComponent(p);a.dataset.p='project';a.dataset.proj=p;a.textContent=p;
    const c=document.createElement('span');c.className='cnt';c.id='c-'+p;c.hidden=true;a.append(c);
    a.addEventListener('click',()=>{if(a.getAttribute('href')===location.hash)setTimeout(route,0);});
    nav.insertBefore(a,tools);});
  $('nav1-grp').hidden=!PROJS.length;}
/** 第三段脚本读到 projects 块后调这个：名单变了就重画一级菜单；当前项目没了就回工作台 */
function setProjects(list){const next=(list&&list.length?list:PCFG.PROJECT_PAGES_FALLBACK).slice(0,PCFG.MAX_PROJECT_PAGES);
  if(JSON.stringify(next)===JSON.stringify(PROJS))return;PROJS=next;renderNav1();if(authed)route();}
/** 二级菜单、标题、副标题指向哪个项目 */
function setProject(p){proj=p;$('f-title').textContent=p;
  document.querySelectorAll('#sub-project a[data-m]').forEach((a)=>{a.href='#/'+encodeURIComponent(p)+'/'+a.dataset.m;});
  const site=PCFG.PROJECT_SITE[p],e=$('f-site');e.replaceChildren();
  if(site){e.append(site.text+' ');const a=document.createElement('a');a.href=site.url;a.target='_blank';a.rel='noopener';a.textContent=site.url.replace(/^https:\\/\\/(www\\.)?/,'');e.append(a);}}
renderNav1();
function frameButtons(){const t=page==='tools'||page==='company';$('nav').hidden=!t;$('extnav').hidden=!t||view==='ext';$('conav').hidden=false;$('nav').textContent=view==='list'?'用量和限额 →':'← 跟帖评论清单';}
function hashOf(){const m=/^#\\/([^\\/?#]+)(?:\\/([a-z0-9-]+))?/.exec(location.hash);if(!m)return null;
  let seg=m[1];try{seg=decodeURIComponent(m[1]);}catch(e){}
  if(Object.hasOwn(FIXED,seg))return {p:seg,m:m[2]||'',proj:''};
  return PROJS.indexOf(seg)>=0?{p:'project',m:m[2]||'',proj:seg}:null;}
function route(){if(!authed)return;let h=hashOf();
  if(!h){history.replaceState(null,'',location.pathname+location.search+(location.pathname==='/queue'?'#/tools/queue':'#/work'));h=hashOf();}
  const prev=page,prevProj=proj;page=h.p;view=page==='tools'?(TOOLV[h.m]||'list'):page;
  if(page==='project')setProject(h.proj);
  const mod=h.m&&PFX[page]?PFX[page]+h.m:'';
  const ready=(typeof platformReady!=='function')||platformReady();
  $('app').hidden=(page==='work'||page==='project')&&!ready;
  ['work','project','tools','company'].forEach(x=>{$('v-'+x).hidden=x!==page;const sb=$('sub-'+x);if(sb)sb.hidden=x!==page;});
  document.querySelectorAll('#nav1 a[data-p]').forEach(a=>{const on=a.dataset.p===page&&(!a.dataset.proj||a.dataset.proj===proj);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.querySelectorAll('nav.sub a[data-s]').forEach(a=>a.setAttribute('aria-current',String(a.dataset.s===mod)));
  const t=page==='project'?proj:(TITLES[view]||TITLES[page]);$('title').textContent=t;document.title=t+' · 工作平台';frameButtons();
  usageTimer(page==='tools');
  if(page==='tools'){if(prev!==''&&prev!=='tools')load();else if(prev==='tools'&&view==='list')load();if(view==='usage'||prev!=='tools'){uEditing=false;loadUsage(true);}if(view==='reply'||prev!=='tools')loadReply();if(view==='hook'||prev!=='tools')loadHook();}
  if(page==='tools'&&view==='assets'){try{window.assetsOpen();}catch(e){}}
  if(page==='tools'&&view==='tts'){try{window.ttsOpen();}catch(e){}}
  if(page==='tools'&&view==='voice'){try{window.voiceOpen();}catch(e){}}
  if(page==='company'){try{companyOpen(prev==='company');}catch(e){$('co-at').textContent='这一页出错了：'+e.message;}}
  // 批 2：在公共工具、公司总览刷新时，一级菜单上的待办数量也马上读出来（以前要切到工作台才有）
  if(page==='work'||page==='project'){try{platformOpen(page,mod);}catch(e){}}else{try{platformStop();platformPeek();}catch(e){}}
  const el=mod&&$(mod);if(el&&!el.closest('[hidden]'))el.scrollIntoView({block:'start'});else if(prev!==page||prevProj!==proj)window.scrollTo(0,0);}
window.addEventListener('hashchange',route);
document.querySelectorAll('nav.sub a[data-s], #nav1 a[data-p]').forEach(a=>a.addEventListener('click',()=>{if(a.getAttribute('href')===location.hash)setTimeout(route,0);}));
/** 旧的三个按钮（用量和限额、插件下载、公司总览）：跳到公共工具里的模块或公司总览 */
function go(v){const h=v==='company'?'#/company':'#/tools/'+({list:'queue',usage:'usage',ext:'ext'}[v]||'queue');if(location.hash===h)route();else location.hash=h;}
$('nav').addEventListener('click',()=>go(view==='list'?'usage':'list'));
$('extnav').addEventListener('click',()=>go('ext'));
$('conav').addEventListener('click',()=>go('company'));
$('origin').textContent=location.origin;
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
async function load(){
  $('bulk-confirm').hidden=true;
  try{state=await call(query());}catch(e){if(e.message!=='请重新登录')toast(e.message,true);return;}
  showApp();render();
}
function render(){
  // 每天回帖上限按项目（D-2）：每条看它所在项目的"今天已回 / 上限"（state.caps）；老接口没有 caps 时用整体的
  const fullOf=(p)=>{const c=state.caps&&state.caps[p];return c?c.doneToday>=c.cap:state.doneToday>=state.cap;};
  $('count').textContent='今天已回 '+state.doneToday+' / '+state.cap;
  const sel=$('f-prod'), cur=sel.value; sel.replaceChildren(Object.assign(document.createElement('option'),{value:'',textContent:'全部'}),...state.products.map(p=>Object.assign(document.createElement('option'),{value:p,textContent:PROD[p]||p})));sel.value=cur;
  $('total').textContent='共 '+state.total+' 条'+(state.total>state.items.length?'（只显示最近 '+state.items.length+' 条）':'');
  $('bulk').hidden=!state.items.length;$('bulk').textContent='删除筛选出的这 '+state.items.length+' 条';
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
    const dr=Object.assign(document.createElement('div'),{className:'draft',textContent:it.draft});
    if(it.source)dr.append(Object.assign(document.createElement('div'),{className:'src',textContent:'数据来源：'+it.source}));
    if(it.engine==='workers-ai')dr.append(Object.assign(document.createElement('div'),{className:'src',textContent:'备用 AI 写的（Gemini 当时用不了），发之前多看一眼'}));
    left.append(dr);
    const acts=document.createElement('div');acts.className='acts';
    if(filter==='pending'){
      const r=Object.assign(document.createElement('a'),{className:'btn primary',href:it.replyUrl,target:'_blank',rel:'noopener',textContent:'一键回复'});
      if(fullOf(it.product)){r.setAttribute('aria-disabled','true');r.textContent='今天已到上限';}
      r.addEventListener('click',()=>toast('已打开回复窗口。发完回来点"我回了"。'));
      acts.append(r,mk(it,'done','我回了'),mk(it,'skip','跳过'));
    }else acts.append(mk(it,'pending','放回待回'));
    acts.append(del(it,acts));
    d.append(left,acts);L.append(d);
  }
}
function mk(it,to,label){const b=Object.assign(document.createElement('button'),{className:'btn',textContent:label});
  b.addEventListener('click',async()=>{b.disabled=true;b.textContent='处理中…';
    try{await call('/api/queue/'+it.id,{status:to});toast(to==='done'?'已移到"已回"':to==='skip'?'已移到"跳过"':'已放回待回');await load();}
    catch(e){toast(e.message,true);b.disabled=false;b.textContent=label;}});return b;}
function del(it,acts){const b=Object.assign(document.createElement('button'),{className:'btn small danger',textContent:'删除'});
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
$('bulk').addEventListener('click',()=>{$('bulk-text').textContent='要永久删除现在列出的 '+state.items.length+' 条（'+rangeText()+'），删了不能恢复。';$('bulk-confirm').hidden=false;$('bulk-yes').focus();});
$('bulk-no').addEventListener('click',()=>{$('bulk-confirm').hidden=true;});
$('bulk-yes').addEventListener('click',async()=>{const y=$('bulk-yes');y.disabled=true;y.textContent='正在删除…';$('bulk-no').disabled=true;
  try{const r=await call('/api/queue/delete',{ids:state.items.map(x=>x.id)});toast('已删除 '+r.deleted+' 条');await load();}catch(e){toast('没删掉：'+e.message,true);}
  finally{y.disabled=false;y.textContent='确认删除';$('bulk-no').disabled=false;}});
// 用量页：打开时读一次；停在这一页时每 30 秒自动刷新（0.3.5，B-2）；输入框正在改时不覆盖
let uTimer=null, uEditing=false;
function uStamp(){$('u-at').textContent='更新于 '+tw(Date.now()).slice(11)+'（停在这一页时每 30 秒自动刷新）';}
async function loadUsage(manual){const b=$('u-refresh');if(manual){b.disabled=true;b.textContent='正在刷新…';}
  try{const j=await call('/api/usage');const rows=j.rows;if(!uEditing||manual){usage=rows;renderUsage();}renderByProject(j.byProject||[]);renderAcct(j.accountLimit);renderLeft(j.left||[]);renderPurpose(j.byPurpose||[]);uStamp();if(manual)$('u-msg').textContent='';}
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
async function loadHook(){const my=++hookSeq;const m=$('hook-msg');try{const a=await call('/api/active');if(my===hookSeq)showHook(a.on);}catch(e){if(e.message!=='请重新登录'){m.className='msg';m.textContent='读不到开关：'+e.message;}}}
function showHook(on){const b=$('hook-toggle');b.hidden=false;b.disabled=false;b.setAttribute('aria-pressed',String(!!on));b.textContent=on?'开着（点一下关掉）':'关着（点一下打开）';b.className='btn '+(on?'primary':'danger');}
$('hook-toggle').addEventListener('click',async()=>{const b=$('hook-toggle'),m=$('hook-msg');const want=b.getAttribute('aria-pressed')!=='true';++hookSeq;b.disabled=true;m.className='msg';m.textContent=want?'正在打开…':'正在关…';
  try{const r=await fetch('/api/hook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({on:want}),credentials:'same-origin'});
    if(r.status===401){showLogin('请重新登录');return;}if(!r.ok)throw new Error('没切成（'+r.status+'），稍后再试');const j=await r.json().catch(()=>({on:want}));hookSeq++;showHook(typeof j.on==='boolean'?j.on:want);m.className='msg ok';m.textContent=want?'✓ 已打开：新的事件会写进"团队在做什么"':'✓ 已关掉：新的事件不写库';}
  catch(e){b.disabled=false;m.className='msg';m.textContent=e.message;}});
// 每天回帖上限按项目（工作平台批 2，D-2）：GET / POST /api/reply-cap；1～50 的整数，前后端同一个范围
let replyRows=[];
async function loadReply(){try{replyRows=(await call('/api/reply-cap')).rows;renderReply();}catch(e){if(e.message!=='请重新登录'){const m=$('rc-msg');m.className='msg';m.textContent='读不到上限：'+e.message;}}}
function renderReply(){const T=$('rc-rows');T.replaceChildren();
  replyRows.forEach(r=>{const tr=document.createElement('tr');tr.append(Object.assign(document.createElement('td'),{textContent:PROD[r.project]?r.project+'（'+PROD[r.project]+'）':r.project}));
    const c=document.createElement('td');c.dataset.label='每天上限';const inp=Object.assign(document.createElement('input'),{className:'cap-in',id:'rc-'+r.project,value:String(r.cap),inputMode:'numeric'});inp.setAttribute('aria-label',r.project+' 每天上限');c.append(inp,' 条');tr.append(c);
    const d=document.createElement('td');d.dataset.label='今天已回';d.textContent=r.doneToday+' 条'+(r.doneToday>=r.cap?'（到上限了）':'');tr.append(d);T.append(tr);});}
$('rc-save').addEventListener('click',async()=>{const b=$('rc-save'),m=$('rc-msg');const caps={},bad=[];
  replyRows.forEach(r=>{const el=$('rc-'+r.project);const v=String(el.value).trim();const n=Number(v);const ok=/^[0-9]+$/.test(v)&&n>=1&&n<=50;el.setAttribute('aria-invalid',String(!ok));if(!ok)bad.push(r.project+' 要在 1～50 之间（整数）');caps[r.project]=n;});
  if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
  b.disabled=true;b.textContent='正在保存…';m.textContent='';
  try{replyRows=(await call('/api/reply-cap',{caps})).rows;renderReply();m.className='msg ok';m.textContent='✓ 已保存，马上生效';load();}catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='保存上限';}});
// 两层菜单固定在屏幕顶部（批 2，Amos 2026-11-02）：量出菜单高度，跳到模块时模块顶端停在菜单下面
function barsH(){const h=Math.ceil($('bars').getBoundingClientRect().height);document.documentElement.style.setProperty('--bars-h',h+'px');}
try{new ResizeObserver(barsH).observe($('bars'));}catch(e){window.addEventListener('resize',barsH);}barsH();
/** 二级菜单能往右横滑时加 .more（右边缘渐隐），滑到底就去掉 */
function subHint(){document.querySelectorAll('.sub .in').forEach(x=>x.classList.toggle('more',x.scrollWidth>x.clientWidth+1&&x.scrollLeft+x.clientWidth<x.scrollWidth-1));}
document.querySelectorAll('.sub .in').forEach(x=>x.addEventListener('scroll',subHint,{passive:true}));window.addEventListener('resize',subHint);
window.addEventListener('hashchange',()=>setTimeout(subHint,0));setTimeout(subHint,0);
$('u-save').addEventListener('click',async()=>{const b=$('u-save'),m=$('u-msg');const caps={};const bad=[];
  usage.forEach((u,i)=>{const el=$('cap-'+i);const v=Number(el.value);const ok=Number.isInteger(v)&&v>=1&&v<=u.max;el.setAttribute('aria-invalid',String(!ok));if(!ok)bad.push(u.label+' 要在 1～'+u.max.toLocaleString()+' 之间');caps[u.model]=v;});
  if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
  b.disabled=true;b.textContent='正在保存…';m.textContent='';
  try{const j=await call('/api/usage',{caps});usage=j.rows;uEditing=false;renderUsage();renderAcct(j.accountLimit);renderLeft(j.left||[]);uStamp();m.className='msg ok';m.textContent='✓ 已保存，下一次请求开始生效';}catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='保存上限';}});
call(query()).then(j=>{state=j;showApp();render();route();}).catch(()=>{});
</script>
<script>
// 公司页（运营仪表盘）：整段 try/catch；这里只定义函数，打开"公司"页（go('company')）时才读数据、渲染，出错只影响这一页
try{
const CO={data:null,latest:null,done:new Map(),week:'',open:'',more:false};
const SRCN={agents:'agents','new-forecast':'new-forecast',marketing:'Marketing'};
const KINDN={projects:'项目版图',status:'状态卡',handoff:'交接记录',todo:'Amos 待办',weekly:'周报',learning:'岗位学习',prs:'要你决定的 PR',ci:'自动检查'};
const ROLES=['产品','市场','研发','测试','运维安全','运维','安全','经营'];
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=String(text);return e;};
const ago=(ms)=>{const m=Math.floor(Math.max(0,CO.data.now-ms)/60000);if(m<1)return '刚刚';if(m<60)return m+' 分钟前';const h=Math.floor(m/60);if(h<48)return h+' 小时前';return Math.floor(h/24)+' 天前';};
const blocks=(kind)=>CO.data.blocks.filter(b=>b.kind===kind);
const newest=(bs)=>bs.reduce((a,b)=>(!a||b.source_at>a.source_at)?b:a,null);
function stamp(bs,label){const n=newest(bs);if(!n)return el('span','stamp',label||'');const s=el('span','stamp',(label?label+' ':'')+'更新于 '+ago(n.source_at)+(bs.every(b=>b.stale)?'（超过 7 天没更新）':''));s.title=tw(n.source_at);return s;}
function card(id,title,bs,label){const sec=el('section','card');sec.id=id;const h=el('h2');h.append(title);const sp=el('span','sp');h.append(sp);if(bs)h.append(stamp(bs,label));sec.append(h);
  if(bs&&bs.length&&bs.every(b=>b.stale))sec.classList.add('old');
  if(bs)bs.filter(b=>b.status==='error').forEach(b=>sec.append(el('p','co-err','解析失败：'+b.error+'（'+KINDN[b.kind]+(b.key?' · '+b.key:'')+(b.payload?'，下面是上次成功的内容':'')+'）')));
  return {sec,h,sp};}
const empty=(t)=>el('p','co-empty',t||'还没收到数据');
function pill(text,cls){return el('span','pill '+cls,text);}
function table(heads,rows,widths,cls){const w=el('div','tablewrap');const t=el('table','stack'+(cls?' '+cls:''));if(widths){const cg=el('colgroup');widths.forEach(x=>{const c=el('col');c.style.width=x;cg.append(c);});t.append(cg);}const th=el('thead');const tr=el('tr');heads.forEach(h=>tr.append(el('th',null,h)));th.append(tr);const tb=el('tbody');rows.forEach(r=>tb.append(r));t.append(th,tb);w.append(t);return w;}
function td(label,content,cls){const c=el('td',cls||null);if(label)c.dataset.label=label;(Array.isArray(content)?content:[content]).forEach(x=>{if(x==null||x==='')return;c.append(x);});if(!c.childNodes.length)c.append('—');return c;}
const lines=(parts)=>{const out=[];parts.filter(x=>x!=null&&x!=='').forEach((x,i)=>{if(i)out.push(el('br'));out.push(x);});return out;};
function needItems(){const out=[];
  // 批 2 审查 R5：有正文的（只认 agents 推来的）点了在本页展开，同工作台；外部平台的照旧外链。外部人提交的 PR 只给"在 GitHub 打开"
  const add=(it,b,o)=>{if(b.kind==='prs'&&it.external){o.who='外部提交';o.hint='给你看一下 · '+(SRCN[b.source]||b.source);o.linkText='在 GitHub 打开';out.push(o);return;}
    const body=b.source==='agents'&&typeof it.body==='string'?it.body:'';const qs=b.source==='agents'&&Array.isArray(it.questions)?it.questions.filter(q=>q&&q.q):[];
    if((body.trim()||qs.length)&&(!o.link||/^https:\\/\\/github\\.com\\//.test(o.link)))o.detail={body,cut:it.body_cut===true,qs,href:o.link||''};out.push(o);};
  blocks('todo').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).filter(it=>it.type==='confirm').forEach((it,i)=>add(it,b,{key:'todo:'+b.key+':'+(it.id||'c'+i),who:'决定'+(it.level?' · '+it.level:''),id:it.id,text:it.text,hint:it.hint,link:it.link,linkText:it.link_text})));
  blocks('prs').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).forEach(it=>add(it,b,{key:'pr:'+b.source+':'+it.number,who:'PR 要你决定',id:'#'+it.number,text:it.title,hint:(SRCN[b.source]||b.source)+(typeof it.days==='number'?' · 开了 '+it.days+' 天':''),link:it.url,linkText:'看 PR'})));
  blocks('status').filter(b=>b.payload).forEach(b=>(b.payload.waiting||[]).forEach(it=>add(it,b,{key:'wait:'+b.key+':'+(it.id||String(it.text||'').slice(0,80)),who:'在等你',id:it.id,text:it.text,hint:(b.payload.product||b.key)+(it.hint?' · '+it.hint:''),link:it.link||b.payload.link,linkText:it.link?'打开':'看状态卡'})));
  ['action','report'].forEach(t=>blocks('todo').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).filter(it=>it.type===t).forEach((it,i)=>add(it,b,{key:'todo:'+b.key+':'+(it.id||t[0]+i),who:t==='action'?'操作':'回报',id:it.id,text:it.text,hint:it.hint,link:it.link,linkText:it.link_text}))));
  return out;}
function heroTiles(need){const h=el('section','hero');h.setAttribute('aria-label','摘要');
  const tile=(n,l,cls)=>{const t=el('div','tile'+(cls?' '+cls:''));t.append(el('div','n',n),el('div','l',l));h.append(t);};
  const open=need.filter(x=>!CO.done.has(x.key)).length;tile(String(open),'需要我的事',open?'need':'');
  const pj=blocks('projects')[0];const st=blocks('status').filter(b=>b.payload&&(b.payload.metrics||[]).some(x=>x.target));
  const pn=pj&&pj.payload?(pj.payload.items||[]).length:blocks('status').length;tile(String(pn),'项目 · '+st.length+' 条业务线有数字目标');
  const w=CO.latest&&CO.latest.payload;(w&&w.highlights||[]).slice(0,3).forEach(x=>{let v=x.value||'';if(x.until&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.until)){v=Math.round((Date.parse(x.until)-Date.parse(twDay(CO.data.now)))/864e5)+' 天';}tile(v||'—',x.label||'');});
  return h;}
function needCard(need){const bs=[...blocks('todo'),...blocks('prs'),...blocks('status')];const open=need.filter(x=>!CO.done.has(x.key)).length;
  const c=card('co-need','需要我的事 ',bs);c.h.insertBefore(pill(String(open),open?'p-err':'p-ok'),c.sp);
  const msg=el('p','msg');msg.id='co-msg';msg.setAttribute('role','status');c.sec.append(msg);
  if(!bs.length){c.sec.append(empty());return c.sec;}
  if(!need.length){c.sec.append(empty('现在没有要你处理的事'));return c.sec;}
  const ul=el('ul','list');
  need.forEach(it=>{const at=CO.done.get(it.key);const li=el('li',at?'done':'');li.dataset.key=it.key;li.append(el('span','who',it.who));
    const w=el('span','what');if(it.id)w.append(el('b',null,it.id),' ');w.append(it.text||'');if(it.hint)w.append(el('br'),el('span','hint',it.hint));if(at)w.append(el('br'),el('span','hint co-done','✓ 已做 '+tw(at)));li.append(w);
    const act=el('span','act');
    if(it.detail){const on=CO.open===it.key;const d=el('button','btn',(it.linkText||'看说明')+(on?' ↑':' ↓'));d.type='button';d.setAttribute('aria-expanded',String(on));d.addEventListener('click',()=>{CO.open=CO.open===it.key?'':it.key;renderCompany();});act.append(d);if(on)w.append(coDetail(it));}
    else if(it.link){const a=el('a','btn',it.linkText||'打开');a.href=it.link;a.target='_blank';a.rel='noopener';act.append(a);}
    const b=el('button','btn',at?'取消':'我做了');b.type='button';b.addEventListener('click',()=>markDone(it,!at,b));act.append(b);li.append(act);ul.append(li);});
  c.sec.append(ul);return c.sec;}
/** 公司总览的正文（同工作台 detailEl）：全部 textContent；长的先折叠；被截断写明；问题表每条带建议；小链接"在 GitHub 打开" */
function coDetail(it){const D=it.detail;const d=el('div','detail');
  if(D.body.trim()){const t=el('div','detail-text'+(CO.more?'':' fold'),D.body);d.append(t);const m=el('button','btn',CO.more?'收起':'展开全文');m.type='button';m.dataset.more='1';m.setAttribute('aria-expanded',String(!!CO.more));
    m.addEventListener('click',()=>{CO.more=!CO.more;t.classList.toggle('fold',!CO.more);m.setAttribute('aria-expanded',String(CO.more));m.textContent=CO.more?'收起':'展开全文';});d.append(m);
    if(!CO.more)requestAnimationFrame(()=>{if(t.isConnected&&t.scrollHeight<=t.clientHeight+2){t.classList.remove('fold');m.hidden=true;}});}
  if(D.cut)d.append(el('p','hint','已截断：正文太长，这里只显示前面一部分。'));
  if(D.qs.length){d.append(el('b',null,'要你决定的问题（'+D.qs.length+'）'));const ul=el('ul','qs');D.qs.forEach(q=>{const li=el('li');li.append(el('span',null,q.q));if(q.advice)li.append(el('br'),el('span','hint','建议：'+q.advice));ul.append(li);});d.append(ul);}
  if(D.href){const a=el('a','gh',/^https:\\/\\/github\\.com\\//.test(D.href)?'在 GitHub 打开':'打开原文');a.href=D.href;a.target='_blank';a.rel='noopener';d.append(a);}
  return d;}
async function markDone(it,done,b){const label=b.textContent;b.disabled=true;b.textContent='处理中…';const m=$('co-msg');m.className='msg';m.textContent='';
  try{const r=await call('/api/company/done',{key:it.key,done});CO_SEQ++;// 这之前发出的读拿的是旧状态，别让它盖掉这一下
    if(done)CO.done.set(it.key,r.at);else CO.done.delete(it.key);renderCompany();
    const m2=$('co-msg');m2.className='msg ok';m2.textContent=done?'✓ 已记下：'+(it.id?it.id+' ':'')+'做完了（'+tw(r.at)+'）':'已取消"我做了"：'+(it.id||it.text||'');}
  catch(e){b.disabled=false;b.textContent=label;m.className='msg';m.textContent='没记上：'+e.message+'，请再点一次';}}
function projectsCard(){const pj=blocks('projects')[0];const sts=blocks('status');const ver=pj&&pj.payload&&pj.payload.version;
  const c=card('co-projects','项目',[...(pj?[pj]:[]),...sts],'状态卡');if(ver)c.h.querySelector('.stamp').append(' · 项目版图 '+ver);
  if(!pj&&!sts.length){c.sec.append(empty());return c.sec;}
  const items=(pj&&pj.payload&&pj.payload.items)||[];const used=new Set();
  const find=(name)=>sts.find(s=>!used.has(s)&&(s.key===name||(s.payload&&s.payload.product===name)));
  const row=(it,s)=>{if(s)used.add(s);const p=(s&&s.payload)||{};const tr=el('tr');if(s&&s.stale)tr.classList.add('old');if(!s)tr.classList.add('co-plan');
    tr.append(td(null,lines([el('b',null,it.name||p.product||(s&&s.key)||''),it.sub?el('span','hint',it.sub):null])));
    tr.append(td('阶段',lines([it.stage||'',it.note?el('span','hint',it.note):null])));
    const num=(p.metrics||[]).map(x=>{const d=el('div','co-m');if(x.name)d.append(el('span','k',x.name),el('span','s',' · '));d.append(el('span','v',x.now||'—'));if(x.target)d.append(el('span','to',' → '),el('span','v',x.target));
      if(typeof x.pct==='number'){const bar=el('div','bar');const fill=el('i');fill.style.width=Math.max(0,Math.min(100,x.pct))+'%';bar.append(fill);d.append(bar);}return d;});
    tr.append(td('数字 → 目标',num));
    tr.append(td('本周',p.week?el('div','co-week',p.week):''));
    const sc=[];if(!s)sc.push(el('span','hint','还没有状态卡'));else{if(p.state)sc.push(pill(p.state,'p-'+(p.level||'mute')));const stuck=(p.open||[]).filter(o=>o.stuck).length;if(stuck){sc.push(' ');sc.push(pill('卡住 '+stuck+' 件','p-err'));}
      if(s.status==='error'){sc.push(el('br'));sc.push(el('span','hint co-err-t','解析失败：'+s.error));}if(s.stale){sc.push(el('br'));sc.push(el('span','hint','超过 7 天没更新'));}}
    tr.append(td('状态',sc));return tr;};
  // 有状态卡的在前（按项目版图顺序），再是只有状态卡没进版图的，最后是规划中、还没有状态卡的（次要色）
  const withCard=[],plan=[];items.forEach(it=>{const s=find(it.name);(s?withCard:plan).push(row(it,s));});
  sts.filter(s=>!used.has(s)).forEach(s=>withCard.push(row({},s)));
  c.sec.append(table(['项目','阶段','数字 → 目标','本周','状态'],[...withCard,...plan],['16%','16%','32%','26%','10%'],'co-proj'));return c.sec;}
/** "本周"超过 3 行的才能点开：点一下或按回车 / 空格展开、收起 */
function fitWeek(){document.querySelectorAll('#v-company .co-week').forEach(w=>{if(w.classList.contains('open'))return;const can=w.scrollHeight>w.clientHeight+1;w.classList.toggle('can',can);
  if(can){w.setAttribute('role','button');w.tabIndex=0;w.setAttribute('aria-expanded','false');w.title='点一下展开';}else{w.removeAttribute('role');w.removeAttribute('tabindex');w.removeAttribute('aria-expanded');w.removeAttribute('title');}});}
function toggleWeek(w){if(!w.classList.contains('can'))return;const open=w.classList.toggle('open');w.setAttribute('aria-expanded',String(open));w.title=open?'点一下收起':'点一下展开';}
$('co-body').addEventListener('click',e=>{const w=e.target.closest&&e.target.closest('.co-week');if(w&&!(window.getSelection&&String(window.getSelection())))toggleWeek(w);});
$('co-body').addEventListener('keydown',e=>{const w=e.target.closest&&e.target.closest('.co-week');if(w&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleWeek(w);}});
let fitT=0;window.addEventListener('resize',()=>{clearTimeout(fitT);fitT=setTimeout(fitWeek,150);});
function peopleCard(){const hs=blocks('handoff').slice().sort((a,b)=>{const i=(x)=>{const k=ROLES.indexOf((x.payload&&x.payload.role)||x.key);return k<0?99:k;};return i(a)-i(b);});
  const c=card('co-people','每个岗位这周',hs,'交接记录');if(!hs.length){c.sec.append(empty());return c.sec;}
  const rows=hs.map(b=>{const p=b.payload||{};const tr=el('tr');if(b.stale)tr.classList.add('old');tr.append(td(null,p.role||b.key),td('做了什么',p.done||''),td('下一步',p.next||''),td('重复犯错',typeof p.mistakes==='number'?String(p.mistakes):'','num'));return tr;});
  c.sec.append(table(['岗位','做了什么','下一步','重复犯错'],rows));return c.sec;}
function learnCard(){const ri=(b)=>{const k=ROLES.indexOf((b.payload&&b.payload.role)||b.key);return k<0?99:k;};const ls=blocks('learning').slice().sort((a,b)=>ri(a)-ri(b));const items=[];ls.forEach(b=>{const p=b.payload||{};(p.items||[]).forEach(x=>items.push({role:p.role||b.key,title:x.title,link:x.link}));});
  const note=ls.map(b=>b.payload&&b.payload.note).filter(Boolean)[0];
  const c=card('co-learn','这周学到了什么 ',ls,note||'');if(ls.length)c.h.insertBefore(pill(items.length+' 条','p-mute'),c.sp);
  if(!ls.length){c.sec.append(empty());return c.sec;}if(!items.length){c.sec.append(empty('这周还没有新的学习'));return c.sec;}
  const ul=el('ul','list');items.forEach(x=>{const li=el('li');li.append(el('span','who',x.role));const w=el('span','what');if(x.link){const a=el('a',null,x.title);a.href=x.link;a.target='_blank';a.rel='noopener';w.append(a);}else w.append(x.title||'');li.append(w);ul.append(li);});
  c.sec.append(ul);return c.sec;}
const STP=(t)=>/完成|已做|done/i.test(t)?'p-ok':/进行|做中/.test(t)?'p-warn':/卡|延|风险/.test(t)?'p-err':'p-mute';
function nextCard(){const w=CO.data.weekly;const p=(w&&w.payload)||{};const isLatest=!CO.data.weeks.length||!CO.week||CO.week===CO.data.weeks[0];
  const c=card('co-next','下周'+(p.range?'（'+p.range+'）':'')+' ',w?[w]:[],p.title?'周报'+p.title:'周报');if(!isLatest)c.sec.classList.remove('old');
  if(CO.data.weeks.length>1){const sel=el('select');sel.id='co-week';sel.setAttribute('aria-label','看哪一期周报');CO.data.weeks.forEach(k=>{const o=el('option',null,k);o.value=k;sel.append(o);});sel.value=w?w.key:CO.data.weeks[0];sel.addEventListener('change',()=>loadCompany(sel.value));c.h.insertBefore(sel,c.sp.nextSibling);}
  if(!w){c.sec.append(empty());return c.sec;}
  const rows=(p.next||[]).map(x=>{const tr=el('tr');tr.append(td(null,x.what||''),td('谁',x.who||''),td('何时',x.when||''),td('状态',pill(x.status||'—',STP(x.status||''))));return tr;});
  if(!rows.length){c.sec.append(empty('这一期没有写下周的事'));return c.sec;}
  c.sec.append(table(['事','谁','何时','状态'],rows));return c.sec;}
const CIP={success:['绿','p-ok'],failure:['红','p-err'],cancelled:['已取消','p-warn'],running:['运行中','p-warn'],none:['无 CI','p-mute'],off:['已关','p-warn']};
function healthCard(){const order=['marketing','new-forecast','agents'];const cs=blocks('ci').slice().sort((a,b)=>(a.key?1:0)-(b.key?1:0)||order.indexOf(a.source)-order.indexOf(b.source));
  const c=card('co-health','做得怎么样',cs);
  if(!cs.length)c.sec.append(empty());else{const rows=cs.map(b=>{const p=b.payload||{};const tr=el('tr');if(b.stale)tr.classList.add('old');const k=CIP[p.conclusion]||['—','p-mute'];
    let ci=pill(k[0],k[1]);if(p.url){const a=el('a','pill '+k[1],k[0]);a.href=p.url;a.target='_blank';a.rel='noopener';ci=a;}
    const dep=p.sha?(p.sha.slice(0,7)+(typeof p.at==='number'?' · '+tw(p.at).slice(5,10).replace('-','/'):'')):'';
    tr.append(td(null,p.name||b.key||SRCN[b.source]||b.source),td('main 的 CI',ci),td('最近部署',dep,'num'),td('说明',p.note||''));return tr;});
    c.sec.append(table(['仓库 / 任务','main 的 CI','最近部署','说明'],rows));}
  const foot=el('div','co-foot');const w=CO.latest&&CO.latest.payload;
  if(w){const parts=[];if(w.rules)parts.push('规则版本 '+w.rules);if(w.cost)parts.push('本周成本 '+w.cost);if(typeof w.mistakes==='number')parts.push('重复犯错 '+w.mistakes+' 次');if(parts.length)foot.append(el('p','hint',parts.join(' · ')));}
  foot.append(el('p','hint','灰色 = 数据超过 7 天没更新。每块右上角写"更新于多久前"。合并或开、关 PR 后 1～2 分钟送到，点上面的"刷新"再看。'));c.sec.append(foot);return c.sec;}
function renderCompany(){const B=$('co-body');B.replaceChildren();
  if(!CO.data.configured&&!CO.data.blocks.length&&!CO.data.weekly){const c=card('co-off','还没开通',null);c.sec.append(el('p','co-empty','公司数据还没接上：等 Amos 填好连接各仓库的令牌后，各仓库合并或开、关 PR 时会自动把最新情况送来。'));B.append(c.sec);return;}
  const need=needItems();const two=el('div','two');two.append(peopleCard(),learnCard());
  B.append(heroTiles(need),needCard(need),projectsCard(),two,nextCard(),healthCard());fitWeek();}
/* 读取的序号和在飞数量：同一时刻可能有好几次读（进页、切回这一页、点刷新、换周报），每次读回来都会整块重画 #co-body。
   不管顺序的话，先发后到的那次会用旧快照盖掉刚点的"我做了 / 取消"：提示被抹掉、那一条又变回原样；
   正赶上点按钮时重画，按下和松开之间整棵子树被换掉，这一下点击直接丢了（谁也没发请求）。
   所以：只认最新一次读的结果（CO_SEQ），改过状态就把更早的读作废；刷新按钮等所有读都回来了再恢复（CO_N）。 */
let CO_SEQ=0,CO_N=0;
async function loadCompany(week){const seq=++CO_SEQ;const b=$('co-refresh');CO_N++;b.disabled=true;b.textContent='正在刷新…';
  try{const j=await call('/api/company'+(week?'?week='+encodeURIComponent(week):''));
    if(seq!==CO_SEQ)return;// 这次读已经过期（有更新的读，或页面上刚改过状态）：丢掉，别盖掉新的
    CO.data=j;CO.week=week||'';if(!week)CO.latest=j.weekly;CO.done=new Map(j.done.map(x=>[x.key,x.at]));
    $('co-at').textContent='读取于 '+tw(j.now).slice(11)+(j.configured?'':'（还没开通，显示的是以前收到的）');renderCompany();}
  catch(e){if(e.message==='请重新登录'||seq!==CO_SEQ)return;$('co-at').textContent='暂时读不到：'+e.message+'，点"刷新"再试';
    if(!CO.data){const B=$('co-body');B.replaceChildren();const c=card('co-fail','暂时读不到',null);c.sec.append(el('p','co-empty','暂时读不到：'+e.message));const r=el('button','btn','重试');r.type='button';r.addEventListener('click',()=>loadCompany(''));const p=el('p','co-empty');p.append(r);c.sec.append(p);B.append(c.sec);}}
  finally{if(!--CO_N){b.disabled=false;b.textContent='刷新';}}}
/** 打开"公司"页。already = 本来就停在这一页（route() 可能因为别的原因再跑一遍，比如项目名单变了）：已经读到或正在读就不再读一遍 */
var companyOpen=function(already){if(already&&(CO.data||CO_N))return;if(!CO.data)$('co-body').replaceChildren(el('p','co-empty','正在读取…'));loadCompany(CO.week);};
$('co-refresh').addEventListener('click',()=>loadCompany(CO.week));
}catch(e){var companyOpen=function(){$('co-at').textContent='这一页出错了：'+e.message;};}
</script>
<script>
// 工作台、forecast 项目页（工作平台批 1：PR 1、PR 2）：整段 try/catch，出错只影响这两页（同"公司总览"页的做法）；清单、用量、插件下载的脚本不动。
// 数据：GET /api/company（块、打勾、填的数字）+ GET /api/queue（清单条数）。打勾 POST /api/company/done 带 seen（另一处改过就 409）；填数字 POST /api/company/report。
// 时间一律用浏览器的 Date.now()（台湾时间显示）；停在这两页时每 30 秒重读一次，切走停、切回马上读。
try{
const CFG=${JSON.stringify(PLATFORM_CONFIG)};
const PL={active:null,data:null,qAll:null,qProj:{},done:new Map(),reports:[],page:'',proj:'',scroll:'',timer:null,busy:false,again:false,err:'',at:0,want:new Map(),copy:null,open:new Set(),vals:{},det:new Set(),more:new Set(),peek:false,retry:0,grp:new Set()};
// 待办分组展开 / 收起：只记在这台设备上（localStorage 读不到也照常跑）
try{const g=localStorage.getItem('qc-todo-grp');if(g)JSON.parse(g).forEach((x)=>PL.grp.add(x));}catch(e){}
const saveGrp=()=>{try{localStorage.setItem('qc-todo-grp',JSON.stringify([...PL.grp]));}catch(e){}};
/** 现在打开的是哪个项目（地址里的；地址没指就用第一个） */
const curProj=()=>(typeof proj==='string'&&PROJS.indexOf(proj)>=0)?proj:(PROJS[0]||'');
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
function toastP(t,err){let e=$('p-toast');if(!e){e=pe('p');e.id='p-toast';e.setAttribute('role','status');document.body.append(e);}e.textContent=t;e.className=err?'err':'';e.hidden=false;clearTimeout(toastP.t);toastP.t=setTimeout(()=>{e.hidden=true;},err?8000:3000);}
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
const dueText=(x)=>x.urgent?'现在就看':x.due==null?'有空就做':'截止 '+dateL(x.due);
// ---- 打勾（带 seen：页面上次看到的完成时间；另一处改过就 409，刷新后提示） ----
async function post(path,body){try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.status===401)showLogin('请重新登录');return {ok:r.ok,status:r.status,j};}
  catch(e){return {ok:false,status:0,j:{error:'连不上服务（'+e.message+'），稍后再试'}};}}
async function setDone(key,done){const seen=PL.done.has(key)?PL.done.get(key):null;PL.want.set(key,done);
  const r=await post('/api/company/done',{key,done,seen});PL.want.delete(key);
  if(r.status===409){toastP('已被另一处改过，已刷新',true);await refresh();return false;}
  if(!r.ok){toastP('没记上：'+(r.j.error||'出错了（'+r.status+'）')+'，请再点一次',true);renderAll();return false;}
  if(done)PL.done.set(key,r.j.at);else PL.done.delete(key);return true;}
async function tick(x,b){b.disabled=true;if(await setDone(x.key,true)){toastP('已打勾，收进"做完的"。点"撤销"可以放回来。');renderAll();}}
async function undo(x,b){b.disabled=true;b.textContent='处理中…';if(await setDone(x.key,false)){toastP('已放回待办');renderAll();}}
// ---- 待办列表 ----
function todoLi(x,first,now){const l=lvl(x,now);const li=pe('li','todo '+l+(first?' first':''));li.dataset.key=x.key;
  const t=pe('button','tick','✓');t.type='button';t.setAttribute('aria-label','做完了，打勾');t.title='做完了点这里';t.addEventListener('click',()=>tick(x,t));
  const body=pe('div','body');const due=pe('div','due');due.append(badge(x,now),pe('span',null,dueText(x)),pe('span','projtag'+(x.proj==='公司'?' company':''),x.proj));
  body.append(due,pe('div','ttl',x.title));if(x.why)body.append(pe('p','why',x.why));
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
  $(doneId).replaceChildren(...closed.map(doneLi));if(!closed.length)$(doneId).append(pe('li','none','还没有'));$(nId).textContent=open.length;$(dnId).textContent=closed.length;return open;}
/**
 * 工作台"全部待办"按项目分组（2026-11-02，Amos"31 个待办混在一起 我要疯掉了"）：
 * ① 逾期（含自动检查没过的"现在就看"）不管哪个项目，都抽出来置顶一块、常显；② 其余按项目一个 details，默认收起，展开状态记在本机。
 * 只改渲染：todo 块的数据结构（src/company.ts SCHEMA ↔ agents 工具/company-report.mjs）没动。
 */
function fillGrouped(list,now){const open=list.filter((x)=>!isDone(x.key)),closed=list.filter((x)=>isDone(x.key)&&PL.done.has(x.key));
  const B=$('w-todos');B.replaceChildren();
  const over=open.filter((x)=>lvl(x,now)==='over'),rest=open.filter((x)=>lvl(x,now)!=='over');
  if(over.length){const sec=pe('section','tgrp over-grp');const h=pe('h3','tgrp-h');h.append('逾期 · 现在就看 ',pe('span','pill p-err',String(over.length)));
    const ul=pe('ul','todos');over.forEach((x,i)=>ul.append(todoLi(x,i===0,now)));sec.append(h,ul);B.append(sec);}
  const by=new Map();PROJS.forEach((k)=>by.set(k,[]));
  rest.forEach((x)=>{if(!by.has(x.proj))by.set(x.proj,[]);by.get(x.proj).push(x);});
  let groups=0;
  by.forEach((arr,k)=>{if(!arr.length)return;groups++;
    const d=pe('details','fold tgrp');d.dataset.proj=k;d.open=PL.grp.has(k);
    const sm=pe('summary');sm.append(pe('span','gname',k),pe('span','pill p-mute',String(arr.length)));
    const soon=arr.filter((x)=>lvl(x,now)==='soon').length;if(soon)sm.append(pe('span','pill p-warn','24 小时内 '+soon+' 件'));
    sm.append(pe('span','hint gnext','最近：'+(arr[0].title||'')));
    const ul=pe('ul','todos');arr.forEach((x)=>ul.append(todoLi(x,false,now)));d.append(sm,ul);
    d.addEventListener('toggle',()=>{if(d.open)PL.grp.add(k);else PL.grp.delete(k);saveGrp();syncGrpBtn();});
    B.append(d);});
  if(!over.length&&!groups){const e=pe('p','empty');e.append(pe('b',null,'现在没事要做'),pe('span',null,'有新的事会出现在这里。'));B.append(e);}
  $('w-todo-bar').hidden=groups<1;syncGrpBtn();
  $('w-donelist').replaceChildren(...closed.map(doneLi));if(!closed.length)$('w-donelist').append(pe('li','none','还没有'));
  $('w-todo-n').textContent=open.length;$('w-done-n').textContent=closed.length;return open;}
function syncGrpBtn(){const ds=[...document.querySelectorAll('#w-todos details.tgrp')];const all=ds.length>0&&ds.every((d)=>d.open);
  const b=$('w-todo-all');b.textContent=all?'全部收起':'全部展开';b.setAttribute('aria-pressed',String(all));}
$('w-todo-all').addEventListener('click',()=>{const ds=[...document.querySelectorAll('#w-todos details.tgrp')];const openAll=!ds.every((d)=>d.open);
  ds.forEach((d)=>{d.open=openAll;if(openAll)PL.grp.add(d.dataset.proj);else PL.grp.delete(d.dataset.proj);});saveGrp();syncGrpBtn();});
const setCnt=(id,n,txt)=>{const e=$(id);if(!e)return;e.textContent=txt!=null?txt:String(n);e.hidden=!n&&txt==null;};
// ---- 填的数字：状态卡写"见工作平台"的那一格换成平台里的最新值 ----
const latest=(proj,name)=>PL.reports.find((r)=>r.project===proj&&r.name===name)||null;
function fromReports(proj,metric){const names=CFG.METRIC_FROM_REPORT[metric];if(!names)return null;const rs=names.map((n)=>latest(proj,n));if(rs.some((r)=>!r))return {missing:true};
  return {value:String(rs.reduce((a,r)=>a+Number(r.value),0)),detail:names.length>1?names.map((n,i)=>n.replace(' 关注','')+' '+rs[i].value).join('、'):'',at:Math.max.apply(null,rs.map((r)=>r.at))};}
function metricNow(proj,m,srcAt){const see=CFG.SEE_PLATFORM.some((k)=>String(m.now||'').indexOf(k)>=0);const r=fromReports(proj,m.name);
  if(see){if(!r||r.missing)return {now:[pe('span','pill p-warn','还没填'),' ',link('去填 →','#/work/todo')],src:'平台里还没有'};
    const out=[pe('b',null,r.value)];if(r.detail)out.push(' ',pe('span','hint',r.detail));return {now:out,src:'你 '+md(r.at)+' 填的',v:r.value};}
  const out=[pe('b',null,m.now||'—')];let src='状态卡';if(r&&!r.missing&&r.at>srcAt){out.push(pe('br'),pe('span','hint','平台里有你 '+md(r.at)+' 填的新值 '+r.value+'（状态卡还是旧值）'));}return {now:out,src};}
function table(heads,rows,widths){const w=pe('div','tablewrap');const t=pe('table','stack');if(widths){const cg=pe('colgroup');widths.forEach((x)=>{const c=pe('col');c.style.width=x;cg.append(c);});t.append(cg);}
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
  document.querySelectorAll('#w-live-grp [data-grp]').forEach((b)=>b.setAttribute('aria-pressed',String(b.dataset.grp===GRP)));
  const B=$('w-live-body');B.replaceChildren();$('w-live-grp').hidden=!A.items.length;
  if(f.none)B.append(pe('p','empty',NOT_YET));else if(!A.items.length)B.append(pe('p','empty','团队现在没有在做的事。派完活后，岗位一开工这里就会出现。'));
  else groups(A.items).forEach(([k,arr])=>{const g=pe('div','grp',k+' ');g.append(pe('span','pill p-mute',String(arr.length)));B.append(g);arr.forEach((x)=>B.append(actItem(x,now,false)));});
  $('recent-n').textContent=String(A.ended.length);const R=$('recent-body');R.replaceChildren(...A.ended.map((x)=>actItem(x,now,true)));if(!A.ended.length)R.append(pe('p','empty','30 天内没有结束的。'));
  const reds=A.items.filter((x)=>x.ci==='failure'&&!x.external);$('ci-alert').hidden=!reds.length;
  if(reds.length){const x=reds[0];$('ci-alert-t').textContent=(SRC[x.repo]||x.repo)+'：'+(x.title||x.branch)+(reds.length>1?'（还有 '+(reds.length-1)+' 项）':'')+'。团队会先修，修好前不会合并。';const a=$('ci-alert-a');a.href=x.url||'#/work/live';if(/^https:/.test(a.href)){a.target='_blank';a.rel='noopener';}}
  // 项目页：只看当前这个项目的
  const cp=curProj();$('f-live-stamp').textContent=cp?'只看 '+cp+' 的':'';
  fill('f-live-warn',f.warns);$('f-live-dot').className='live-dot '+f.cls;const fl=A.items.filter((x)=>x.project===cp),fe=A.ended.filter((x)=>x.project===cp);$('f-live-n').textContent=String(fl.filter((x)=>!x.external).length);
  const F=$('f-live-body');F.replaceChildren();if(f.none)F.append(pe('p','empty',NOT_YET));else if(!fl.length)F.append(pe('p','empty',cp+' 现在没有在做的事。'));
  fl.slice().sort((a,b)=>b.at-a.at).forEach((x)=>F.append(actItem(x,now,false)));
  if(fe.length){const d=pe('details','fold recent');const sm=pe('summary',null,'最近结束 ');sm.append(pe('span','pill p-mute',String(fe.length)));d.append(sm);fe.forEach((x)=>d.append(actItem(x,now,true)));F.append(d);}}
document.querySelectorAll('#w-live-grp [data-grp]').forEach((b)=>b.addEventListener('click',()=>{GRP=b.dataset.grp;try{localStorage.setItem('qc-live-grp',GRP);}catch(e){}renderAll();}));
// ---- 工作台 ----
function renderWork(all,now){const open=fillGrouped(all,now);
  setCnt('c-work',open.length);setCnt('s-todo',open.length);
  // 一级菜单上每个项目的待办数（不只当前打开的那个）
  PROJS.forEach((k)=>setCnt('c-'+k,all.filter((x)=>x.proj===k&&!isDone(x.key)).length));
  const h=$('hero');h.replaceChildren(pe('p','k','你现在最该做的一件事'));
  if(!open.length){h.className='hero calm';h.append(pe('p','one','现在没事要做'),pe('p','why','有新的事会出现在这里。团队在做的事可以往下看。'));}
  else{const x=open[0];h.className='hero';const w=pe('div','when');w.append(badge(x,now),pe('span',null,dueText(x)));h.append(pe('p','one',x.title),w);if(x.why)h.append(pe('p','why',x.why));
    const row=pe('div','row');if(x.form)row.append(link(x.btn+' →','#/work/todo','btn primary big'));else if(x.go)row.append(link(x.btn+' →',x.go,'btn primary big'));
    else if(x.gh)row.append(link('在 GitHub 打开',x.gh,'btn big'));
    else if(x.detail){const a=link(x.btn+' ↓','#/work/todo','btn primary big');a.addEventListener('click',()=>{PL.det.clear();PL.det.add(x.key);setTimeout(renderAll,0);});row.append(a);}else if(x.href)row.append(link(x.btn+' →',x.href,'btn primary big'));
    if(open.length>1)row.append(link('做完了？后面还有 '+(open.length-1)+' 件，已经按截止时间排好 ↓','#/work/todo','sec'));h.append(row);}
  const g=$('w-glance');g.replaceChildren();const tile=(n,l,href,cls)=>{const a=href?link('',href,'gl'+(cls?' '+cls:'')):pe('div','gl'+(cls?' '+cls:''));a.append(pe('div','n',n),pe('div','l',l));g.append(a);};
  tile(String(open.length),'件事等你处理','#/work/todo',open.length?'red':'');
  tile(PL.qAll?String(PL.qAll.total):'—','跟帖评论清单 · 条待回'+(PL.qAll?'（今天已回 '+PL.qAll.doneToday+' / '+PL.qAll.cap+'）':''),'#/tools/queue');
  const w=PL.data.weekly&&PL.data.weekly.payload;(w&&w.highlights||[]).filter((x)=>x.until).slice(0,1).forEach((x)=>{const d=Math.round((Date.parse(x.until+'T23:59:59+08:00')-now)/DY);tile(d+' 天',x.label||'');});
  tile(PL.active?String(PL.active.items.filter((x)=>!x.external).length):'—','件事团队正在做','#/work/live');
  renderProj(now);renderNum();renderMeet(now);}
function renderProj(now){const sts=okBlocks('status').filter((b)=>CFG.NOT_PROJECTS.indexOf(b.key)<0);const B=$('w-proj-body');$('w-proj-at').textContent=sts.length?'状态卡 '+stampOf(sts[0]):'';
  if(!sts.length){B.replaceChildren(emptyP('还没收到项目的状态卡'));return;}
  const all=items();const rows=sts.map((b)=>{const p=b.payload;const name=PROJS.indexOf(b.key)>=0?link('','#/'+encodeURIComponent(b.key)):pe('span');name.append(pe('b',null,b.key));
    const nums=(p.metrics||[]).map((m)=>{const v=metricNow(b.key,m,b.source_at);const d=pe('p','m');d.append(m.name+' ');v.now.forEach((x)=>d.append(x));if(m.target)d.append(pe('span','to',' → '+m.target));return d;});
    const waiting=all.filter((x)=>x.proj===b.key&&!isDone(x.key)).length;const wk=[p.week||''];if(waiting){wk.push(pe('br'),pe('span','pill p-warn','在等你：'+waiting+' 件'),' ');if(PROJS.indexOf(b.key)>=0)wk.push(link('去看 →','#/'+encodeURIComponent(b.key)+'/next'));}
    return tr(td('项目',[name,pe('br'),pe('span','hint',p.state||'')]),td('数字 → 目标',nums),td('这周在做 · 在等谁',wk));});
  B.replaceChildren(table(['项目','数字 → 目标','这周在做 · 在等谁'],rows,['22%','40%','38%']));}
function renderNum(){const B=$('w-num-body');const wb=PL.data.weekly;const w=wb&&wb.payload;$('w-num-at').textContent=w?'周报'+(w.title||'')+(w.range?' · '+w.range:''):'';const rows=[];
  if(w){(w.highlights||[]).filter((x)=>!x.until).forEach((x)=>rows.push(tr(td('指标',x.label||''),td('数',pe('b',null,x.value||'—')))));
    if(w.cost)rows.push(tr(td('指标','花了多少钱'),td('数',w.cost)));if(typeof w.mistakes==='number')rows.push(tr(td('指标','同类错误又犯'),td('数',pe('b',null,w.mistakes+' 次'))));if(w.rules)rows.push(tr(td('指标','公司规则'),td('数',w.rules)));}
  const projs=[...new Set(PL.reports.map((r)=>r.project))].filter((p)=>p!=='公司');
  projs.forEach((pj)=>Object.keys(CFG.METRIC_FROM_REPORT).forEach((name)=>{const r=fromReports(pj,name);if(!r||r.missing)return;const c=[pe('b',null,r.value)];if(r.detail)c.push(' ',pe('span','hint',r.detail));c.push(' ',pe('span','hint','你 '+md(r.at)+' 填的'));rows.push(tr(td('指标',pj+' · '+name),td('数',c)));}));
  const use=PL.reports.filter((r)=>r.name==='Claude 用量').sort((a,b)=>b.at-a.at)[0];
  rows.push(tr(td('指标','Claude 用量'),td('数',use?[pe('b',null,use.value+'%'),' ',pe('span','hint','你 '+md(use.at)+' 填的')]:[pe('span','pill p-warn','还没报'),' ',link('去报 →','#/work/todo')])));
  B.replaceChildren(table(null,rows,['34%','66%']));if(!w)B.prepend(pe('p','lead','还没收到周报'));}
function renderMeet(now){const B=$('w-meet-body');B.replaceChildren();const t=tp(now);let next=Date.UTC(t.y,t.mo-1,t.d+((6-t.wd+7)%7),20,0)-8*HR;if(next<now)next+=7*DY;
  const mb=okBlocks('todo').find((b)=>b.key==='经营会');const open=mb?(mb.payload.items||[]).filter((x,i)=>!isDone('todo:经营会:'+(x.id||'c'+i))).length:0;
  const a=pe('div');a.append(pe('p','hint','下一次'),pe('p',null,dateL(next)),pe('p','hint','还剩 '+dur(next-now)+' · 周报当天 17:00 前到'));
  if(mb)a.append(pe('p','hint','上次会议要你定的事：还有 '+open+' 件没打勾'));
  const r=pe('p');r.style.display='flex';r.style.gap='8px';r.style.flexWrap='wrap';if(mb&&mb.payload.link)r.append(link('看上次会议记录',mb.payload.link,'btn small'));
  const wb=PL.data.weekly;if(wb&&wb.payload&&wb.payload.link)r.append(link('看周报'+(wb.payload.title||''),wb.payload.link,'btn small'));a.append(r);B.append(a);}
// ---- forecast 项目页 ----
function renderProject(pj,all,now){if(!pj)return;const mine=all.filter((x)=>x.proj===pj);const open=fillList('f-todos','f-donelist','f-next-n','f-done-n',mine,now,pj+' 现在没事要做','有新的事会出现在这里。');
  setCnt('s-fnext',open.length);$('f-tools-stamp').textContent='只算 '+pj+' 的';
  const pb=okBlocks('pack').find((b)=>b.key===pj);const p=pb&&pb.payload;renderGuide(p,now);renderPack(p);
  renderCard(pj);renderTools(pj);renderHandoff(pj);}
function renderGuide(p,now){const B=$('f-guide-body');const H=$('f-guide-h');
  if(!p||!(p.steps||[]).length){H.textContent='操作指引';B.replaceChildren(emptyP('本周还没有周包：市场经理交了周包以后，这里一步步列出要你做的事。'));setCnt('s-guide',0);return;}
  const steps=p.steps;const c=steps.filter((s)=>isDone(stepKey(p,s.n))).length;H.replaceChildren('操作指引'+(typeof p.due==='number'?' · '+dateL(p.due):''),pe('span','sp'),pe('span','stamp','周包 '+p.date+' · '+steps.length+' 步'));
  const cur=steps.find((s)=>!isDone(stepKey(p,s.n)));
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
function renderPack(p){const none='本周还没有周包';
  if(!p){$('f-pack-h').textContent='本周帖子';$('f-match-h').textContent='焦点战';$('f-pack-body').replaceChildren(emptyP(none));$('f-match-body').replaceChildren(emptyP(none));return;}
  const d0=Date.parse(p.date+'T12:00:00+08:00');$('f-pack-h').replaceChildren('本周帖子 · '+md(d0)+'～'+md(d0+6*DY),pe('span','sp'),pe('span','stamp',(p.posts||[]).length+' 条'));
  $('f-pack-body').replaceChildren((p.posts||[]).length?table(['第几条','写的什么','几点发','最晚'],p.posts.map((x)=>tr(td('第几条',String(x.n),'num'),td('写的什么',x.title),td('几点发',x.at_text||(x.at?dateL(x.at):'')),td('最晚',x.deadline||''))),['13%','40%','22%','25%']):emptyP('这一包没有帖子'));
  $('f-match-h').replaceChildren('焦点战 · '+(p.matches||[]).length+' 场',pe('span','sp'),pe('span','stamp','导入官网名单页'));
  $('f-match-body').replaceChildren((p.matches||[]).length?table(['联赛','对阵','开赛（台湾）'],p.matches.map((x)=>tr(td('联赛',x.league),td('对阵',[x.home+' vs '+x.away,x.note?pe('br'):null,x.note?pe('span','hint',x.note):null]),td('开赛',x.time,'num'))),['16%','52%','32%']):emptyP('这一包没有焦点战'));}
function renderCard(pj){const b=okBlocks('status').find((x)=>x.key===pj);const B=$('f-card-body');$('f-card-at').textContent=b?'状态卡 '+stampOf(b):'';
  if(!b){B.replaceChildren(emptyP('还没收到 '+pj+' 的状态卡'));return;}const p=b.payload;
  const rows=(p.metrics||[]).map((m)=>{const v=metricNow(pj,m,b.source_at);return tr(td('看什么',m.name),td('现在',v.now),td('目标',m.target||'—'),td('从哪来',v.src));});
  const out=[table(['看什么','现在','目标','从哪来'],rows,['28%','30%','20%','22%'])];const pd=pe('div','pd');pd.style.borderTop='1px solid var(--line)';
  if(p.state)pd.append(pe('p',null,'现在的阶段：'+p.state));if(p.week)pd.append(pe('p',null,'这周：'+p.week));
  const ws=(p.waiting||[]);if(ws.length){const ul=pe('ul','ul');ws.forEach((w)=>ul.append(pe('li',null,'在等你：'+(w.text||''))));pd.append(ul);}
  if(p.link)pd.append(link('看状态卡全文',p.link,'btn small'));out.push(pd);B.replaceChildren(...out);}
function renderTools(pj){const q=PL.qProj[pj];const B=$('f-tools-body');const a=pe('div','toolcard');a.append(pe('h3',null,'副驾驶 · 跟帖评论清单'));
  a.append(pe('p',null,q?'等你回 '+q.total+' 条 · 今天已回 '+q.doneToday+' / '+q.cap:'清单条数暂时读不到'));const r=pe('div','row');r.append(link('去跟帖评论清单 →','#/tools/queue','btn primary'));a.append(r);
  const u=pe('div','toolcard');u.append(pe('h3',null,'AI 用量'),pe('p','hint','额度是所有项目一起用的；每个项目今天各用了多少，看"按项目看用量"。'));const r2=pe('div','row');r2.append(link('按项目看用量 →','#/tools/byproj','btn'),link('用量和限额 →','#/tools/usage','btn'));u.append(r2);B.replaceChildren(a,u);}
function renderHandoff(pj){const hs=okBlocks('handoff').filter((b)=>b.key.indexOf(pj+'/')===0).sort((a,b)=>String(b.payload.date||'').localeCompare(String(a.payload.date||''))||b.source_at-a.source_at);const B=$('f-handoff-body');
  if(!hs.length){B.replaceChildren(emptyP('还没有 '+pj+' 的交接记录'));return;}const ul=pe('ul','hand');
  hs.forEach((b)=>{const p=b.payload;const li=pe('li');const d=pe('div');d.append(pe('div','hint',(p.date||'')+' · '+(p.role||b.key.split('/').pop())),pe('div',null,p.done||''));if(p.next)d.append(pe('div','hint','下一步：'+p.next));li.append(d);
    const g=pe('div');if(p.link)g.append(link('看全文',p.link,'btn small'));li.append(g);ul.append(li);});B.replaceChildren(ul);}
// ---- 读数据、渲染、30 秒刷新 ----
function renderAll(){if(!PL.data)return;const now=Date.now();const all=sorted(items());
  ['w-err','f-err'].forEach((id)=>{$(id).hidden=!PL.err;$(id).textContent=PL.err;});
  try{renderWork(all,now);}catch(e){$('w-err').hidden=false;$('w-err').textContent='工作台这一页出错了：'+e.message;}
  try{renderProject(curProj(),all,now);}catch(e){$('f-err').hidden=false;$('f-err').textContent='项目页出错了：'+e.message;}
  try{renderLive(now);}catch(e){$('w-err').hidden=false;$('w-err').textContent='团队在做什么出错了：'+e.message;}
  if(PL.page){$('app').hidden=false;}
  if(PL.scroll){const el=$(PL.scroll);PL.scroll='';if(el)el.scrollIntoView({block:'start'});}}
async function getJ(u){const r=await fetch(u,{credentials:'same-origin'});if(r.status===401){showLogin('请重新登录');throw new Error('请重新登录');}if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'出错了（'+r.status+'）');}return r.json();}
async function refresh(){if(PL.busy){PL.again=true;return;}PL.busy=true;
  const want=curProj();
  try{const [c,qa,qp,ac]=await Promise.all([getJ('/api/company'),getJ('/api/queue?status=pending').catch(()=>null),want?getJ('/api/queue?status=pending&product='+encodeURIComponent(want)).catch(()=>null):Promise.resolve(null),getJ('/api/active').catch(()=>undefined)]);
    PL.data=c;PL.done=new Map((c.done||[]).map((x)=>[x.key,x.at]));PL.reports=c.reports||[];PL.qAll=qa;if(want)PL.qProj[want]=qp;if(ac!==undefined)PL.active=ac;PL.err='';PL.at=Date.now();
    // 项目名单来自 projects 块：变了就重画一级菜单（setProjects 内部会在需要时重新路由）
    try{setProjects(pagesFrom(c));}catch(e){}}
  catch(e){if(e.message==='请重新登录'){PL.busy=false;return;}PL.err='暂时读不到最新情况：'+e.message+'（过一会儿自动再试）';if(!PL.data)PL.data={blocks:[],done:[],reports:[],weekly:null};
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
/** 第一次读到数据之前，工作台、项目页先不显示（免得看到空的模块） */
var platformReady=function(){return !!PL.data;};
}catch(e){var platformReady=function(){return true;};var platformOpen=function(){['w-err','f-err'].forEach((id)=>{const x=document.getElementById(id);if(x){x.hidden=false;x.textContent='这一页出错了：'+e.message;}});};var platformStop=function(){};var platformPeek=function(){};}
</script>
<script>window.__assetsBase='/api/assets/';window.__ttsBase='/api/tts/';window.__voiceBase='/api/voice/';</script>
<script>${ASSETS_JS}</script>
<script>${TTS_JS}</script>
<script>${VOICE_JS}</script>
<script>${ENGLISH_JS}</script>
</body></html>`;

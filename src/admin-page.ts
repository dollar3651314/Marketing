import { EXTENSION_VERSION } from './extension-download';

/**
 * 网页后台（agents C136；0.3 原型 https://claude.ai/artifact/EwGoS2XRCbMsKxySVXRcxd，Amos 2026-10-30 确认 D-1～D-4）。
 * 四页：跟帖评论清单（原"待回复清单"）、用量和限额、插件下载（Amos 2026-10-30）、公司（运营仪表盘，Amos 2026-11-01 确认原型；
 * agents 产品/marketing/技术方案-运营仪表盘.md 第六节）。没登录显示密码框；手机、电脑都能用。
 * 公司页的脚本单独放在第二个 <script> 里、整段 try/catch，只在打开这一页时读数据和渲染；出错只影响这一页，旧三页的代码不动。
 * 每个按钮都有处理中 / 成功 / 失败的反馈（C135）；删除先在页面上确认（删了不能恢复）。
 * 注意：整页是一个模板字符串，页面脚本里不能用反引号和 ${（只有插件版本号是在这里插进去的）。
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>跟帖评论清单</title>
<style>
:root{--bg:#F4F6F9;--surface:#fff;--ink:#13203A;--muted:#5B6678;--line:#D9DEE7;--navy:#0F1B33;--teal:#14B8A6;--teal-soft:#D5F5F0;--amber:#B26B00;--amber-soft:#FDF1DC;--ok:#15803D;--err:#B91C1C;--err-soft:#FDE8E8;--th:#6B3FA0;--ok-soft:#DCFCE7;--stale:#8A94A6;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme: dark){:root{--bg:#0B1220;--surface:#131C2E;--ink:#E6EBF3;--muted:#9AA6BA;--line:#26324A;--navy:#0A1324;--teal:#2DD4BF;--teal-soft:#0F3B37;--amber:#E9A641;--amber-soft:#3A2C14;--ok:#4ADE80;--err:#F87171;--err-soft:#3A1717;--th:#B993E6;--ok-soft:#14321F;--stale:#6B7689;color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif}
.top{display:flex;align-items:center;gap:10px;padding:12px max(16px,env(safe-area-inset-left));background:var(--navy);color:#fff;flex-wrap:wrap}
.logo{display:flex;gap:3px;align-items:flex-end}.logo i{display:block;width:6px;border-radius:2px}
.top b{font-size:16px}.top .sp{margin-left:auto;font-size:13px;color:#9FB0CC}
.top button{font:inherit;font-size:12px;background:none;border:1px solid #3A4A6A;color:#C9D4E6;border-radius:99px;padding:3px 10px;cursor:pointer}
main{max-width:960px;margin:0 auto;padding:12px max(16px,env(safe-area-inset-right)) 40px max(16px,env(safe-area-inset-left))}
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
</style></head><body>
<header class="top"><span class="logo" aria-hidden="true"><i style="height:16px;background:#2DD4BF"></i><i style="height:10px;background:#FBBF24"></i></span><b id="title">跟帖评论清单</b><span class="sp" id="count"></span><button id="nav" hidden>用量和限额 →</button><button id="extnav" hidden>插件下载</button><button id="conav" hidden>公司</button><button id="logout" hidden>登出</button></header>
<form class="login" id="login" hidden>
  <b>登录</b><label for="pw">密码</label><input id="pw" type="password" autocomplete="current-password" required>
  <button class="btn primary" id="go" type="submit">登录</button><p class="msg" id="lmsg" role="alert"></p>
</form>
<main id="app" hidden>
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
  </section>
  <section id="v-usage" hidden>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>模型</th><th>今天请求</th><th>今天 token（入 / 出）</th><th>每天上限</th><th>用量</th><th>状态</th><th>下次重置（台湾时间）</th></tr></thead><tbody id="u-rows"></tbody></table></div>
      <div class="pad"><p class="sum" style="margin:0"><span id="u-at">还没读取</span><span class="sp"></span><button class="btn small" id="u-refresh" type="button">立即刷新</button></p>
        <button class="btn primary" id="u-save" type="button">保存上限</button><p class="msg" id="u-msg" role="status"></p>
        <p class="hint">Gemini 的真实免费额度 Google 不提供查询，这里是我们自己数的次数和 token；Google 说用完（429）时状态会标出来。到了我们设的上限，这个模型今天先跳过，换下一个。Gemini 按次数（1～10,000），Workers AI 按 neurons（1～9,500；免费额度 10,000，超过不让保存）。"今天"按各家的重置时间算。</p></div></div>
  </section>
  <section id="v-ext" hidden>
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
  </section>
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
function showLogin(m){$('app').hidden=true;$('logout').hidden=true;$('nav').hidden=true;$('extnav').hidden=true;$('conav').hidden=true;$('login').hidden=false;$('count').textContent='';$('lmsg').textContent=m||'';$('pw').focus();}
function showApp(){$('app').hidden=false;$('logout').hidden=false;$('nav').hidden=false;$('extnav').hidden=view==='ext';$('conav').hidden=view==='company';}
$('login').addEventListener('submit',async(e)=>{e.preventDefault();const b=$('go');b.disabled=true;b.textContent='正在登录…';$('lmsg').textContent='';
  try{await call('/api/login',{password:$('pw').value});$('pw').value='';$('login').hidden=true;await load();}catch(err){$('lmsg').textContent=err.message;}finally{b.disabled=false;b.textContent='登录';}});
$('logout').addEventListener('click',async()=>{await call('/api/logout',{}).catch(()=>{});showLogin('已登出');});
const TITLES={list:'跟帖评论清单',usage:'用量和限额',ext:'插件下载',company:'公司'};
function go(v){view=v;$('v-list').hidden=v!=='list';$('v-usage').hidden=v!=='usage';$('v-ext').hidden=v!=='ext';$('v-company').hidden=v!=='company';$('conav').hidden=v==='company';$('title').textContent=TITLES[v];$('nav').textContent=v==='list'?'用量和限额 →':'← 跟帖评论清单';$('extnav').hidden=v==='ext';document.title=TITLES[v];usageTimer(v==='usage');if(v==='usage'){uEditing=false;loadUsage(true);}else if(v==='list')load();else if(v==='company'){try{companyOpen();}catch(e){$('co-at').textContent='这一页出错了：'+e.message;}}}
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
  const full=state.doneToday>=state.cap;
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
      if(full){r.setAttribute('aria-disabled','true');r.textContent='今天已到上限';}
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
  try{const rows=(await call('/api/usage')).rows;if(!uEditing||manual){usage=rows;renderUsage();}uStamp();if(manual)$('u-msg').textContent='';}
  catch(e){$('u-at').textContent='刷新失败：'+e.message+'（30 秒后再试）';}
  finally{if(manual){b.disabled=false;b.textContent='立即刷新';}}}
function usageTimer(on){clearInterval(uTimer);uTimer=on?setInterval(()=>{if(view==='usage'&&document.visibilityState==='visible')loadUsage(false);},30000):null;}
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
$('u-save').addEventListener('click',async()=>{const b=$('u-save'),m=$('u-msg');const caps={};const bad=[];
  usage.forEach((u,i)=>{const el=$('cap-'+i);const v=Number(el.value);const ok=Number.isInteger(v)&&v>=1&&v<=u.max;el.setAttribute('aria-invalid',String(!ok));if(!ok)bad.push(u.label+' 要在 1～'+u.max.toLocaleString()+' 之间');caps[u.model]=v;});
  if(bad.length){m.className='msg';m.textContent='没保存：'+bad.join('；');return;}
  b.disabled=true;b.textContent='正在保存…';m.textContent='';
  try{usage=(await call('/api/usage',{caps})).rows;uEditing=false;renderUsage();uStamp();m.className='msg ok';m.textContent='✓ 已保存，下一次请求开始生效';}catch(e){m.className='msg';m.textContent=e.message;}finally{b.disabled=false;b.textContent='保存上限';}});
call(query()).then(j=>{state=j;showApp();render();}).catch(()=>{});
</script>
<script>
// 公司页（运营仪表盘）：整段 try/catch；这里只定义函数，打开"公司"页（go('company')）时才读数据、渲染，出错只影响这一页
try{
const CO={data:null,latest:null,done:new Map(),week:''};
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
function needItems(){const out=[];const add=(o)=>out.push(o);
  blocks('todo').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).filter(it=>it.type==='confirm').forEach((it,i)=>add({key:'todo:'+b.key+':'+(it.id||'c'+i),who:'决定'+(it.level?' · '+it.level:''),id:it.id,text:it.text,hint:it.hint,link:it.link,linkText:it.link_text})));
  blocks('prs').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).forEach(it=>add({key:'pr:'+b.source+':'+it.number,who:'PR 要你决定',id:'#'+it.number,text:it.title,hint:(SRCN[b.source]||b.source)+(typeof it.days==='number'?' · 开了 '+it.days+' 天':''),link:it.url,linkText:'看 PR'})));
  blocks('status').filter(b=>b.payload).forEach(b=>(b.payload.waiting||[]).forEach(it=>add({key:'wait:'+b.key+':'+(it.id||String(it.text||'').slice(0,80)),who:'在等你',id:it.id,text:it.text,hint:(b.payload.product||b.key)+(it.hint?' · '+it.hint:''),link:it.link||b.payload.link,linkText:it.link?'打开':'看状态卡'})));
  ['action','report'].forEach(t=>blocks('todo').filter(b=>b.payload).forEach(b=>(b.payload.items||[]).filter(it=>it.type===t).forEach((it,i)=>add({key:'todo:'+b.key+':'+(it.id||t[0]+i),who:t==='action'?'操作':'回报',id:it.id,text:it.text,hint:it.hint,link:it.link,linkText:it.link_text}))));
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
    const act=el('span','act');if(it.link){const a=el('a','btn',it.linkText||'打开');a.href=it.link;a.target='_blank';a.rel='noopener';act.append(a);}
    const b=el('button','btn',at?'取消':'我做了');b.type='button';b.addEventListener('click',()=>markDone(it,!at,b));act.append(b);li.append(act);ul.append(li);});
  c.sec.append(ul);return c.sec;}
async function markDone(it,done,b){const label=b.textContent;b.disabled=true;b.textContent='处理中…';const m=$('co-msg');m.className='msg';m.textContent='';
  try{const r=await call('/api/company/done',{key:it.key,done});if(done)CO.done.set(it.key,r.at);else CO.done.delete(it.key);renderCompany();
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
async function loadCompany(week){const b=$('co-refresh');b.disabled=true;b.textContent='正在刷新…';
  try{const j=await call('/api/company'+(week?'?week='+encodeURIComponent(week):''));CO.data=j;CO.week=week||'';if(!week)CO.latest=j.weekly;CO.done=new Map(j.done.map(x=>[x.key,x.at]));
    $('co-at').textContent='读取于 '+tw(j.now).slice(11)+(j.configured?'':'（还没开通，显示的是以前收到的）');renderCompany();}
  catch(e){if(e.message==='请重新登录')return;$('co-at').textContent='暂时读不到：'+e.message+'，点"刷新"再试';
    if(!CO.data){const B=$('co-body');B.replaceChildren();const c=card('co-fail','暂时读不到',null);c.sec.append(el('p','co-empty','暂时读不到：'+e.message));const r=el('button','btn','重试');r.type='button';r.addEventListener('click',()=>loadCompany(''));const p=el('p','co-empty');p.append(r);c.sec.append(p);B.append(c.sec);}}
  finally{b.disabled=false;b.textContent='刷新';}}
var companyOpen=function(){if(!CO.data)$('co-body').replaceChildren(el('p','co-empty','正在读取…'));loadCompany(CO.week);};
$('co-refresh').addEventListener('click',()=>loadCompany(CO.week));
}catch(e){var companyOpen=function(){$('co-at').textContent='这一页出错了：'+e.message;};}
</script></body></html>`;

/**
 * 工作台「带练」的页面片段（工作台 → 带练 `#/work/drill`，模块 `#w-drill`；服务端在 src/drill.ts、
 * 发音 src/drill-audio.ts、复考 src/drill-review.ts，内容在 src/drill-content.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts、english-page.ts、english-memory-page.ts 一样）：
 * 这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * **二级菜单从 7 项变 8 项**（Amos 批的上限就是 8）：工作台加了「带练」这一项；
 * **公共工具那 8 项一个都没动**（T-4 守着上限，第 9 项会撑破手机菜单）。
 *
 * 三步交互（src/drill.ts 文件头写了为什么）：先回想 → 揭晓 → 自己判。
 *   ① 卡片上**只有中文**（第一段中文词义、第三段中文情境）；**第三段另外显示「对方说的那句」英文**——
 *      那是对方的话、不是答案，故意显示，他要接的是答案（答案照旧藏着）；
 *   ② 一个大按钮「看答案」，他先在嘴上说一遍；
 *   ③ 揭晓英文 + **音标（第一段）或重音提示（第二、三段）+ 字面意思 + 什么场合用**（第一段还给关键点）
 *      + **两个大发音按钮（🔊 正常速 / 🐢 慢速 0.7 倍）** + 两个大按钮「会了」「不会」；
 *   ④ 「不会」的排到这一段末尾再考（顺序由服务端算），这一段全部会了才进下一段；
 *   ⑤ 顶上一条进度：第几段 / 这一段第几个 / 还剩几个。
 *
 * **v2 加的三件事**（2026-11-10，Amos 用完 18 项的原话：「没有音标，没有词意解释，做完后不知道该干什么」
 * 「不只是加音标 还得有发音 让我可以照着学」）：
 *   - **音标 / 词意**：揭晓后在英文下面依次是 音标（或重音提示）→ 字面意思 → 什么场合用。
 *     **内容是 null 就整行不显示**（不显示「暂无」、不显示占位符，底线 3）；内容全部来自 src/drill-content.ts。
 *   - **发音**：两个 ≥56px 的大按钮，同一段音频，慢速只是把 `playbackRate` 调成 0.7（**不额外生成**）；
 *     第三段还能单独听「对方说的那句」。**生成不出来就当面说**「发音这次没生成出来……」，不假装有，
 *     **也不自动重试**（不做重试风暴），他再点一次才再试。
 *   - **复考**：三段走完，小结那里一个大按钮「明天再考我这 18 项」；到期后再打开，顶上一句话说明
 *     「今天是复考」，18 项打散走一轮、**只给对错**，最后报「说得出来 N / 18」。没到期也能「现在就复考」。
 *     **复考用的是同一张卡片**，只是把关键点 / 音标 / 词意全藏起来、两个判断按钮改成「说得出来 / 说不出来」。
 *
 * 把用户当小白（agents #92）：
 *   - **一个 `<input>` 都没有**（测试守着），全程不让他打字；页面上不出现任何命令行；
 *   - 按钮都 ≥52px 高（这一块实际全是 56px），手机 390 宽单手够得着；
 *   - 任何时候点「看全部」能回看这一段——**已经过完的才给英文，没练到的不剧透**；复考时整块藏起来（免得剧透）；
 *   - 三段走完给一句话小结（每段"会了几个 / 第一次就会几个"），
 *     并且**明说第四段（对话）还没做**，不假装有（底线 3、9）。
 *   - 出错一律把服务器那两句话（出错 / 怎么办）原样显示出来，**不静默吞掉**。
 *
 * 字号只用全站那几级（30 / 26 / 24 / 22 / 18 / 15 / 13 / 12，控件可以 14；e2e-platform 的 fontOutliers 守着）。
 */
export const DRILL_CSS = `
/* 进度条一行：第几段 / 这一段第几个 / 还剩几个 */
.dr .dr-top{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s3) var(--s4);margin:0 0 var(--s4)}
.dr .dr-steps{display:flex;gap:var(--s2);margin:0 0 var(--s2);flex-wrap:wrap}
.dr .dr-step{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--muted);background:var(--gray-soft);border-radius:99px;padding:3px 10px}
.dr .dr-step.on{background:var(--teal-soft);color:var(--teal-ink)}
.dr .dr-step.ok{background:var(--ok-soft);color:var(--ok)}
.dr .dr-where{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:0}
.dr .dr-bar{height:8px;border-radius:4px;background:var(--gray-soft);overflow:hidden;margin:var(--s2) 0 var(--s1)}
.dr .dr-bar i{display:block;height:100%;background:var(--teal)}
.dr .dr-left{font-size:var(--fs-aux);color:var(--muted);margin:0}
/* 复考那一条：顶上一句话（服务端给，原样显示）+ 一个大按钮 */
.dr .dr-rvtop{border:1px solid var(--teal);background:var(--teal-soft);border-radius:12px;padding:var(--s3) var(--s4);margin:0 0 var(--s4)}
.dr .dr-rvtop .r-t{font-size:var(--fs-body);font-weight:700;color:var(--teal-ink);margin:0 0 var(--s3);overflow-wrap:anywhere}
.dr .dr-rvtop .r-h{font-size:var(--fs-aux);color:var(--ink-2);margin:var(--s2) 0 0}
/* 卡片：先回想（只有中文）→ 揭晓（英文 + 音标 / 重音 + 词意 + 用法 + 关键点） */
.dr .dr-card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s5) var(--s4);margin:0 0 var(--s3);text-align:center}
.dr .dr-ask{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s3)}
/* 第三段：对方先说的那一句（故意显示，这是对方的话，不是答案） */
.dr .dr-pr{border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:10px;background:var(--surface-2);padding:var(--s3);margin:0 0 var(--s4);text-align:left}
.dr .dr-pr .p-who{font-size:12px;font-weight:700;color:var(--muted);margin:0 0 var(--s1)}
.dr .dr-pr .p-en{font-size:18px;font-weight:700;line-height:1.4;color:var(--ink);margin:0;overflow-wrap:anywhere}
.dr .dr-pr .p-zh{font-size:var(--fs-aux);color:var(--muted);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.dr .dr-zh{font-size:26px;font-weight:700;line-height:1.35;margin:0;overflow-wrap:anywhere}
.dr .dr-en{font-size:22px;font-weight:700;line-height:1.4;color:var(--teal-ink);margin:var(--s4) 0 0;overflow-wrap:anywhere}
/* 音标 / 重音提示：答案正下面那一行（内容是 null 就整行不显示） */
.dr .dr-ipa{font-size:18px;color:var(--ink-2);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.dr .dr-zimian{font-size:var(--fs-body);color:var(--ink);margin:var(--s3) 0 0;overflow-wrap:anywhere}
.dr .dr-use{font-size:var(--fs-aux);color:var(--muted);margin:var(--s1) 0 0;overflow-wrap:anywhere}
.dr .dr-key{font-size:var(--fs-body);color:var(--ink-2);margin:var(--s3) 0 0;overflow-wrap:anywhere}
.dr .dr-aumsg{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap;text-align:left}
.dr .dr-hr{height:1px;background:var(--line);margin:var(--s4) 0 0}
/* 大按钮：一律 ≥52px 高（这里全是 56px），手机单手够得着。
   **选择器必须压过 admin-page.ts 那条 :is(#v-work,…) .btn{min-height:38px}**（它带一个 id，算 1-1-0）：
   所以这里写成 #w-drill + 两个类（1-2-0），只写 .dr .dr-one button（0-2-1）会被它盖掉，按钮就只有 38px 高。
   发音那两个按钮、复考那几个按钮**共用 .dr-one / .dr-two 这两个类**，不另开一条规则（省得漏改一处就变小）。 */
#w-drill .dr-one .btn{width:100%;min-height:56px;font-size:17px;font-weight:700}
.dr .dr-one{margin:0 0 var(--s3)}
.dr .dr-two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)}
#w-drill .dr-two .btn{min-height:56px;font-size:17px;font-weight:700}
.dr .dr-au{margin:var(--s4) 0 0}
/* 看全部：这一段 6 项 */
.dr .dr-all{margin:var(--s3) 0 0}
.dr .dr-all>summary{display:inline-flex;align-items:center;gap:var(--s2);list-style:none;cursor:pointer;font-size:14px;font-weight:600;color:var(--ink-2);border:1px solid var(--line);border-radius:var(--r-btn);padding:8px 14px;background:var(--surface);min-height:40px}
.dr .dr-all>summary::-webkit-details-marker{display:none}
.dr .dr-list{list-style:none;margin:var(--s3) 0 0;padding:0;display:grid;gap:var(--s2)}
.dr .dr-list li{border:1px solid var(--line);border-radius:10px;background:var(--surface-2);padding:var(--s3)}
.dr .dr-list .l-zh{font-size:var(--fs-body);font-weight:700;overflow-wrap:anywhere}
.dr .dr-list .l-en{font-size:var(--fs-body);color:var(--teal-ink);margin:var(--s1) 0 0;overflow-wrap:anywhere}
.dr .dr-list .l-key{font-size:var(--fs-aux);color:var(--muted);margin:var(--s1) 0 0;overflow-wrap:anywhere}
.dr .dr-list .l-wait{font-size:var(--fs-aux);color:var(--muted);margin:var(--s1) 0 0}
.dr .dr-list .l-tag{font-size:12px;font-weight:700;border-radius:99px;padding:2px 8px;background:var(--gray-soft);color:var(--ink-2)}
.dr .dr-list .l-tag.ok{background:var(--ok-soft);color:var(--ok)}
/* 小结 + 第四段还没做 */
.dr .dr-sum{border:1px solid var(--ok);background:var(--ok-soft);border-radius:12px;padding:var(--s4);margin:0 0 var(--s3)}
.dr .dr-sum .s-t{font-size:var(--fs-mod);font-weight:700;color:var(--ok);margin:0 0 var(--s2)}
.dr .dr-sum ul{margin:0;padding-left:20px;display:grid;gap:var(--s1)}
.dr .dr-sum li{font-size:var(--fs-body);color:var(--ink)}
.dr .dr-sum .s-h{font-size:var(--fs-aux);color:var(--ink-2);margin:var(--s3) 0 var(--s2)}
.dr .dr-next{border:1px dashed var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s3) var(--s4);margin:0 0 var(--s3);font-size:var(--fs-body);color:var(--ink-2)}
.dr .dr-err{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap}
@media (max-width:420px){.dr .dr-zh{font-size:24px}.dr .dr-en{font-size:18px}.dr .dr-pr .p-en{font-size:17px}}
`;

/** 工作台第 8 个模块：带练（二级菜单第 8 项「带练」，公共工具那 8 项一个没动） */
export const DRILL_MOD = `<section class="card mod dr" id="w-drill"><header class="mh"><h2>带练</h2><span class="sp"></span><span class="aux">场景 0 · 前三段</span></header>
<p class="lead" id="dr-lead"><span class="dot gray" id="dr-dot"></span><span id="dr-lead-t">读取中…</span><span class="soft">先回想 → 看答案 → 自己判「会了 / 不会」。不会的这一段末尾再考一遍，全会了才进下一段。</span></p>
<div class="mbody">
  <div class="dr-top">
    <div class="dr-steps" id="dr-steps" aria-label="三段"><span class="dr-step" data-st="1">1 单词</span><span class="dr-step" data-st="2">2 词组</span><span class="dr-step" data-st="3">3 例句</span></div>
    <p class="dr-where" id="dr-where">读取中…</p>
    <div class="dr-bar"><i id="dr-bar" style="width:0%"></i></div>
    <p class="dr-left" id="dr-left"></p>
  </div>

  <div class="dr-rvtop" id="dr-rvtop" hidden>
    <p class="r-t" id="dr-rvline"></p>
    <div class="dr-one"><button class="btn primary" type="button" id="dr-go">现在就复考</button></div>
    <p class="r-h" id="dr-rvhint"></p>
  </div>

  <div id="dr-play">
    <div class="dr-card">
      <p class="dr-ask" id="dr-ask"></p>
      <div class="dr-pr" id="dr-pr" hidden>
        <p class="p-who">对方说：</p>
        <p class="p-en" id="dr-pren"></p>
        <p class="p-zh" id="dr-przh"></p>
        <div class="dr-one" style="margin-top:12px"><button class="btn" type="button" id="dr-prau">🔊 听他这句</button></div>
      </div>
      <p class="dr-zh" id="dr-zh">—</p>
      <div id="dr-ans" hidden>
        <div class="dr-hr"></div>
        <p class="dr-en" id="dr-en"></p>
        <p class="dr-ipa" id="dr-ipa" hidden></p>
        <div class="dr-two dr-au" id="dr-au">
          <button class="btn" type="button" id="dr-say">🔊 正常速</button>
          <button class="btn" type="button" id="dr-slow">🐢 慢速 0.7 倍</button>
        </div>
        <p class="dr-zimian" id="dr-zimian" hidden></p>
        <p class="dr-use" id="dr-use" hidden></p>
        <p class="dr-key" id="dr-key" hidden></p>
      </div>
      <!-- 发音出错要显示在 #dr-ans **外面**：第三段揭晓前 #dr-ans 还带 hidden，
           报错框在里面就渲染不出来——他点「听他这句」失败时页面一动不动，什么都看不到（2026-11-10 审查 🔴1）。-->
      <div class="dr-aumsg" id="dr-aumsg" hidden></div>
    </div>
    <div class="dr-one" id="dr-one"><button class="btn primary" type="button" id="dr-show">看答案</button></div>
    <div class="dr-two" id="dr-two" hidden>
      <button class="btn primary" type="button" id="dr-yes">会了</button>
      <button class="btn" type="button" id="dr-no">不会</button>
    </div>
  </div>

  <div class="dr-sum" id="dr-sum" hidden>
    <p class="s-t">三段都练完了</p>
    <ul id="dr-sum-b"></ul>
    <p class="s-h" id="dr-rvsum">练过的东西隔一天再考一遍才记得住。</p>
    <div class="dr-one" id="dr-planwrap"><button class="btn primary" type="button" id="dr-plan">明天再考我这 18 项</button></div>
  </div>
  <p class="dr-next" id="dr-next" hidden></p>

  <details class="dr-all" id="dr-all"><summary>看全部（这一段 6 项）</summary><ul class="dr-list" id="dr-all-b"></ul></details>
  <div class="dr-err" id="dr-err" hidden></div>
</div>
<details class="more"><summary>这一块到底在做什么 · 内容和发音各从哪来</summary><div class="in">
  <p>四段结构（单词 → 词组 → 例句 → 对话）没变，变的是<b>载体</b>：前三段的内容是<b>写死的</b>，就是一个"卡片 + 按钮 + 进度"的界面，交给语音反而看不到字、不能回看、没有进度、它还会自由发挥跳步。</p>
  <p>每一项都是三步：<b>先回想</b>（卡片上只有中文）→ <b>揭晓</b>（点「看答案」）→ <b>自己判</b>（「会了 / 不会」）。点「不会」的那一项<b>排到这一段末尾再考一遍</b>，这一段六项全部「会了」才进下一段。</p>
  <p><b>内容</b>（音标、字面意思、什么场合用、第三段对方说的那句）全部写死在内容文件里，<b>判断和进度一个 AI 都不调</b>；只有<b>发音</b>用 Workers AI 的 melotts 念——24 段念一次就<b>存在服务器上永久复用</b>，一共约 20 neurons（免费额度每天 10,000），<b>不新增任何费用</b>。念不出来的时候会当面说，不会假装有声音。</p>
  <p>进度和每一项的"第几次才会"<b>存在服务器上</b>，换一台设备接着练就行。</p>
  <p><b>第三段不是背句子</b>：对方先说一句英文（那句会显示在卡片上，可以点🔊听），你接一整句。原来的第三段是第二段的词组加个尾巴，刚背完立刻考同一句，全对测的是"刚看过"。</p>
  <p>三段走完可以按「明天再考我这 18 项」：到期后再打开，18 项<b>打散</b>走一轮，<b>只考</b>——不给关键点、不给词意，最后报你说得出来几项。那一轮<b>不影响</b>上面的进度。</p></div></details></section>`;

/** 带练那一块的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__drillBase，例如 '/api/drill/' */
export const DRILL_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.drillOpen */
(function(){
try{
var DR={base:(window.__drillBase||'/api/drill/'),cur:null,busy:false,loaded:false,au:{},auBusy:{},player:null,rv:{on:false,list:[],i:0,ok:0},rvs:null};
var dq=function(i){return document.getElementById(i)};
function dText(id,s){var e=dq(id);if(e)e.textContent=s}
function dShow(id,on){var e=dq(id);if(e)e.hidden=!on}
/* 一行内容：有就显示，**null / 空就整行不显示**（不写占位词，底线 3） */
function dLine(id,s){var e=dq(id);if(!e)return;var t=(s===null||s===undefined)?'':String(s);e.textContent=t;e.hidden=!t;}
/* 出错一律把服务器那两句话原样摆出来，不吞掉 */
function dErr(j){var e=dq('dr-err');if(!e)return;
  var s=(j&&(j['出错']||j.error))||'出错了';
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  e.textContent=s;e.hidden=false;}
function dJson(path,init){return fetch(DR.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok){var e=new Error(j['出错']||j.error||('出错了（'+r.status+'）'));e.j=j;throw e;}
    return j;
  });
});}

/* ---- 发音：同一段只取一次，之后复用；**失败就当面说，不自动重试** ---- */
function dAuErr(j,which){
  var m=dq('dr-aumsg');if(!m)return;
  var ipa=dq('dr-ipa');
  var s=(which==='pr'?'对方那句的发音':'这一项的发音')+'没生成出来，'
      +((which!=='pr'&&ipa&&!ipa.hidden)?'先看上面的音标。':'这一次先跳过发音。');
  if(j&&j['出错'])s+='\\n'+j['出错'];
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  m.textContent=s;m.hidden=false;
}
function dPlay(url,rate){
  try{
    if(!DR.player)DR.player=new Audio();
    var a=DR.player;a.pause();a.src=url;a.playbackRate=rate;
    a.onloadedmetadata=function(){a.playbackRate=rate};
    var pr=a.play();
    if(pr&&pr.catch)pr.catch(function(){dAuErr({'出错':'浏览器把这次播放挡住了。','怎么办':'再点一下这个按钮就会响。'});});
  }catch(e){dAuErr({'出错':'这台设备放不了这段声音。'});}
}
function dAudio(id,rate,which){
  if(!id)return;
  var m=dq('dr-aumsg');if(m)m.hidden=true;
  if(DR.au[id]){dPlay(DR.au[id],rate);return;}
  // 第一次要现生成，melotts 要一两秒。这期间他若再点另一个速度按钮，
  // 不拦住就会**再发一个请求、再调一次 melotts、再记一次账**（2026-11-10 审查 🟡2）。
  if(DR.auBusy[id]){return;}
  DR.auBusy[id]=1;
  if(m){m.textContent='第一次要先生成这一段发音，一两秒……';m.hidden=false;}
  var done=function(){delete DR.auBusy[id];};
  fetch(DR.base+'audio/'+encodeURIComponent(id)).then(function(r){
    var ct=r.headers.get('content-type')||'';
    if(!r.ok||ct.indexOf('audio')<0){return r.json().catch(function(){return {}}).then(function(j){done();dAuErr(j,which)});}
    return r.blob().then(function(b){done();if(m)m.hidden=true;var u=URL.createObjectURL(b);DR.au[id]=u;dPlay(u,rate);});
  },function(e){done();dAuErr({'出错':'没连上服务器（'+e.message+'）。','怎么办':'等一下再点一次。'},which);});
}

/* ---- 画一遍 ---- */
function dSteps(st,cur,done){
  [].forEach.call(document.querySelectorAll('#dr-steps .dr-step'),function(e){
    var n=Number(e.dataset.st),s=st[n-1]||{};
    e.className='dr-step'+(s['走完了']?' ok':(n===cur&&!done?' on':''));
    e.textContent=n+' '+(s['名字']||'')+'（'+(s['会了']||0)+'/'+(s['一共']||0)+'）';
  });
}
function dAll(seg){
  var b=dq('dr-all-b');if(!b)return;
  while(b.firstChild)b.removeChild(b.firstChild);
  (seg['六项']||[]).forEach(function(it){
    var li=document.createElement('li');
    var top=document.createElement('p');top.className='l-zh';
    top.appendChild(document.createTextNode(it['中文']+' '));
    var tag=document.createElement('span');tag.className='l-tag'+(it['会了']?' ok':'');
    tag.textContent=it['会了']?(it['第一次就会']?'第一次就会':'会了'):'还没练到';
    top.appendChild(tag);li.appendChild(top);
    if(it['英文']){
      var en=document.createElement('p');en.className='l-en';en.textContent=it['英文'];li.appendChild(en);
      if(it['关键点']){var k=document.createElement('p');k.className='l-key';k.textContent=it['关键点'];li.appendChild(k);}
    }else{
      var w=document.createElement('p');w.className='l-wait';w.textContent='练到这一项才显示答案（现在不剧透）';li.appendChild(w);
    }
    b.appendChild(li);
  });
  var s=dq('dr-all');if(s){var sm=s.querySelector('summary');if(sm)sm.textContent='看全部（第 '+seg['段']+' 段 '+seg['名字']+' 这 '+(seg['一共']||0)+' 项）';}
}
function dSum(rows){
  var b=dq('dr-sum-b');if(!b)return;
  while(b.firstChild)b.removeChild(b.firstChild);
  (rows||[]).forEach(function(r){
    var li=document.createElement('li');
    li.textContent='第 '+r['段']+' 段 '+r['名字']+'：会了 '+r['会了']+' / '+r['一共']+' 个，第一次就会 '+r['第一次就会']+' 个';
    b.appendChild(li);
  });
}
/* 一张卡片（学和复考共用这一张）：复考时把关键点 / 音标 / 词意全藏起来——那就是"只考" */
function dCard(c,quiz){
  dText('dr-zh',c['中文']);
  dText('dr-en',c['英文']);
  var pr=c['对方说的'];
  dShow('dr-pr',!!pr);
  dText('dr-pren',pr||'');
  /* 中文情境已经是下面那行大字（dr-zh），一样就不在框里再写一遍 */
  dLine('dr-przh',c['对方说的中文']===c['中文']?'':c['对方说的中文']);
  dShow('dr-prau',!!c['对方发音']);
  dLine('dr-ipa',quiz?'':(c['音标']||c['重音']));
  dLine('dr-zimian',quiz?'':c['字面意思']);
  dLine('dr-use',quiz?'':c['什么场合用']);
  dLine('dr-key',quiz?'':(c['段']===1?c['关键点']:''));
  var m=dq('dr-aumsg');if(m)m.hidden=true;
  dShow('dr-au',!!c['发音']);
  /* 每换一项都回到"先回想"：只有中文 + 一个「看答案」 */
  dShow('dr-ans',false);dShow('dr-one',true);dShow('dr-two',false);
}
function dPaint(j){
  var seg=j['这一段']||{},st=j['段']||[],done=!!j['全部走完'];
  dSteps(st,seg['段'],done);
  dText('dr-where','第 '+seg['段']+' 段 '+seg['名字']+' · 第 '+seg['第几个']+' 个 / 共 '+seg['一共']);
  var b=dq('dr-bar');if(b)b.style.width=Math.round((seg['会了']||0)*100/(seg['一共']||1))+'%';
  dText('dr-left',done?'三段都练完了':('这一段还剩 '+(seg['还剩']||0)+' 个 · '+(seg['怎么练']||'')));
  /* 一句话结论（和别的模块一样带圆点） */
  var lead=done?'三段都练完了（场景 0 · 共 18 项）':('在第 '+seg['段']+' 段 '+seg['名字']+'，这一段还剩 '+(seg['还剩']||0)+' 个');
  dText('dr-lead-t',lead);
  var dot=dq('dr-dot');if(dot)dot.className='dot '+(done?'ok':'amber');
  dAll(seg);
  DR.cur=j['当前']||null;
  dShow('dr-play',!!DR.cur);
  if(DR.cur){
    dText('dr-ask',seg['怎么练']||'');
    dCard(DR.cur,false);
  }
  dShow('dr-sum',done);
  dSum(j['小结']);
  dShow('dr-all',true);
  /* 第四段还没做，照实说，不假装有 */
  dText('dr-next',j['第四段']||'');
  dShow('dr-next',done&&!!j['第四段']);
}

/* ---- 看答案：本地揭晓，不用再跑一趟接口 ---- */
function dReveal(){
  if(!DR.cur)return;
  dShow('dr-ans',true);dShow('dr-one',false);dShow('dr-two',true);
}

/* ---- 自己判：会了 / 不会（复考时是「说得出来 / 说不出来」，只记对错、不动进度）---- */
function dAnswer(known){
  if(DR.busy||!DR.cur)return;
  if(DR.rv.on){dRvNext(known);return;}
  DR.busy=true;
  dShow('dr-err',false);
  dJson('answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:DR.cur.id,known:known})}).then(function(j){
    DR.busy=false;dPaint(j);
  },function(e){DR.busy=false;dErr(e.j||{'出错':e.message});});
}

/* ---- 复考：顶上一句话 + 一轮 18 项（打散，只给对错）---- */
function dRvTop(s){
  DR.rvs=s||null;
  var on=!!(s&&s['有安排'])&&!DR.rv.on;
  dShow('dr-rvtop',on);
  if(!on)return;
  dText('dr-rvline',s['一句话']||'');
  dText('dr-go',s['到期了']?'开始复考':'现在就复考');
  dText('dr-rvhint',s['中途刷新']||'');
  // 到期当天小结页照旧显示，里面那个「明天再考我这 18 项」一点就把**今天**该做的复考推到明天，
  // 而且没有任何确认。到期时就把它藏起来，只留顶上的「开始复考」（2026-11-10 审查 🟡3）。
  dShow('dr-planwrap',!s['到期了']);
}
function dRvLoad(){return dJson('review').then(dRvTop,function(){dRvTop(null)});}
function dRvPaint(){
  var n=DR.rv.list.length,i=DR.rv.i;
  dText('dr-where','复考 · 第 '+(i+1)+' 项 / 共 '+n);
  var b=dq('dr-bar');if(b)b.style.width=Math.round(i*100/(n||1))+'%';
  dText('dr-left','只考：不给关键点、不给词意，最后报你说得出来几项');
  dText('dr-lead-t','今天是复考（'+n+' 项打散，只给对错）');
  var dot=dq('dr-dot');if(dot)dot.className='dot amber';
  dText('dr-ask','先在嘴上说出来，再点「看答案」对一下');
  DR.cur=DR.rv.list[i];
  dShow('dr-play',true);dShow('dr-sum',false);dShow('dr-next',false);dShow('dr-all',false);dShow('dr-rvtop',false);
  dText('dr-yes','说得出来');dText('dr-no','说不出来');
  dCard(DR.cur,true);
}
function dRvStart(){
  if(DR.busy)return;DR.busy=true;dShow('dr-err',false);
  dJson('review/start',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(j){
    DR.busy=false;
    var list=j['题目']||[];
    if(!list.length){dErr({'出错':'这一轮没有题目。','怎么办':'刷新一下页面再试。'});return;}
    DR.rv={on:true,list:list,i:0,ok:0};
    dRvPaint();
  },function(e){DR.busy=false;dErr(e.j||{'出错':e.message});});
}
function dRvNext(known){
  if(known)DR.rv.ok++;
  DR.rv.i++;
  if(DR.rv.i<DR.rv.list.length){dRvPaint();return;}
  var ok=DR.rv.ok;
  DR.rv={on:false,list:[],i:0,ok:0};
  dText('dr-yes','会了');dText('dr-no','不会');
  DR.busy=true;
  dJson('review/done',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({'对':ok})}).then(function(j){
    DR.busy=false;
    dLoad().then(function(){
      dText('dr-rvsum','这一轮复考：'+(j['这一轮']||'')+'。再按一次下面的按钮，明天还考这些。');
      dRvTop(j);
    });
  },function(e){DR.busy=false;dErr(e.j||{'出错':e.message});dLoad();});
}
function dRvPlan(){
  if(DR.busy)return;DR.busy=true;dShow('dr-err',false);
  dJson('review/plan',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(j){
    DR.busy=false;dRvTop(j);dText('dr-rvsum',j['记下了']||'');
  },function(e){DR.busy=false;dErr(e.j||{'出错':e.message});});
}

function dLoad(){
  return dJson('state').then(function(j){dShow('dr-err',false);dPaint(j);},function(e){
    dText('dr-where','暂时读不到');dText('dr-lead-t','暂时读不到带练的进度');dErr(e.j||{'出错':e.message});
  });
}

var sh=dq('dr-show');if(sh)sh.addEventListener('click',dReveal);
var y=dq('dr-yes');if(y)y.addEventListener('click',function(){dAnswer(true)});
var n=dq('dr-no');if(n)n.addEventListener('click',function(){dAnswer(false)});
var sy=dq('dr-say');if(sy)sy.addEventListener('click',function(){dAudio(DR.cur&&DR.cur['发音'],1,'ans')});
var sl=dq('dr-slow');if(sl)sl.addEventListener('click',function(){dAudio(DR.cur&&DR.cur['发音'],0.7,'ans')});
var pa=dq('dr-prau');if(pa)pa.addEventListener('click',function(){dAudio(DR.cur&&DR.cur['对方发音'],1,'pr')});
var go=dq('dr-go');if(go)go.addEventListener('click',dRvStart);
var pl=dq('dr-plan');if(pl)pl.addEventListener('click',dRvPlan);
window.drillOpen=function(){if(DR.loaded)return;DR.loaded=true;dLoad();dRvLoad();};
}catch(e){}
})();
`;

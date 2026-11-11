/**
 * 工作台「发音训练」的页面片段（工作台 → 发音训练 `#/work/pron`，模块 `#w-pron`；
 * 服务端 src/pron.ts、发音 src/pron-audio.ts，内容 src/pron-content.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * **二级菜单从 8 项变 7 项**：去掉「英语练习」「带练」，加「发音训练」；
 * **公共工具那 8 项一个都没动**（T-4：上限 8，第 9 项会撑破手机菜单）。
 *
 * **四步循环**（Amos 2026-11-11：旧的「只会量不会教」，七轮 56 题正确率 75% → 71%）：
 *   1. **看口型**（不考）：两个音并排，课件原文的中文外号 + 逐条口型定位 ——
 *      这一屏要让他**照着做动作**（"上下齿距离 1cm，可容纳一根食指"是能用手指量的），不是"用心体会"。
 *   2. **对照听**（不考）：这一组的最小对立对，两个词各一个大按钮，**想点几次点几次**；
 *      旁边就是**纠说**（他念、机器听）。**他自己点「我听出来了，开始考」才进第 3 步**。
 *   3. **考**：同一组连考 10 题，**不换别的音**；答错当场把第 2 步的对照听塞回来，点「继续」才出下一题。
 *      保留「两个听着一样」那个按钮和它的全部语义（它是唯一能把"他分不出"和"机器没念出区别"分开的办法）。
 *   4. **过关**：10 题对 8 题（80%）才算过，过了给课件那句绕口令 + 三最法；没过说清楚错在哪几对。
 *
 * **第 7 组（/ʒ/ vs /dʒ/）一对最小对立对都没有** —— 页面上**照实说「这一组只能跟读和纠说」**，
 * 「开始考」那个按钮直接不给，**不硬凑题**；第 4 组只有 1 对，也照实说题会重复（底线 3）。
 *
 * **纠说的措辞永远是「机器听成了什么」**，不许写成「你念对了 / 念错了」（底线 3、9）：
 * 语音识别天生要对口音稳健，它可能把念歪的 /e/ 也认成 bad —— 它听成什么是线索，不是判决。
 * 没有麦克风权限 / 浏览器不支持 / 识别失败：**当面说清楚**，而且**整块的其余部分照常能用**
 * （纠说是加分项，不是前置条件）；**不自动重试**。
 *
 * 把用户当小白（agents #92）：**一个输入框都没有**（录音按钮不是 input），页面上不出现命令行；
 * 按钮都 ≥52px（这里全是 56px），手机 390 宽单手够得着、不横滚；发音生成不出来**当面说**，不假装有。
 * 字号只用全站那几级（30 / 26 / 24 / 22 / 18 / 15 / 13 / 12，控件可以 14；e2e-platform 的 fontOutliers 守着）。
 */
export const PRON_CSS = `
/* 选一组：七个按钮（第 7 组没有听辨题，按钮上照实标出来） */
.pn .pn-pick{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s4)}
#w-pron .pn-pick .btn{display:block;min-height:56px;font-size:14px;font-weight:700;flex:1 1 calc(50% - var(--s2));min-width:0;white-space:normal;overflow-wrap:anywhere;line-height:1.3;padding:8px 10px;text-align:center}
.pn .pn-pick .btn .p-s{display:block;font-size:12px;font-weight:500;color:var(--muted)}
.pn .pn-pick .btn.primary .p-s{color:#fff}
/* 四步条 */
.pn .pn-steps{display:flex;gap:var(--s2);margin:0 0 var(--s4);flex-wrap:wrap}
.pn .pn-step{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--muted);background:var(--gray-soft);border-radius:99px;padding:3px 10px}
.pn .pn-step.on{background:var(--teal-soft);color:var(--teal-ink)}
.pn .pn-step.ok{background:var(--ok-soft);color:var(--ok)}
/* 第 1 步 看口型：两个音并排，各自中文外号 + 逐条口型定位 */
.pn .pn-sounds{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3);margin:0 0 var(--s3)}
.pn .pn-sound{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s4) var(--s3)}
.pn .pn-sound .s-ipa{font-size:26px;font-weight:700;color:var(--teal-ink);margin:0;overflow-wrap:anywhere}
.pn .pn-sound .s-nick{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:var(--s2) 0 var(--s3);overflow-wrap:anywhere}
.pn .pn-sound ul{margin:0;padding-left:18px;display:grid;gap:var(--s2)}
.pn .pn-sound li{font-size:var(--fs-body);color:var(--ink);overflow-wrap:anywhere}
.pn .pn-mouthhint{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s4)}
/* 一句话说明（这一组有几对最小对立对、够不够 10 题）：照实说，不硬凑 */
.pn .pn-note{border:1px solid var(--line);border-left:4px solid var(--teal);border-radius:10px;background:var(--surface-2);padding:var(--s3);margin:0 0 var(--s4);font-size:var(--fs-body);color:var(--ink);overflow-wrap:anywhere}
.pn .pn-h{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:0 0 var(--s3)}
.pn .pn-hint{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s3);overflow-wrap:anywhere}
/* 第 2 步 对照听：一对一行，两个词各一个大按钮 */
.pn .pn-pair{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s3);margin:0 0 var(--s3)}
.pn .pn-pair .q-t{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s2)}
/* 第 3 步 考：进度 + 卡片 */
.pn .pn-top{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s3) var(--s4);margin:0 0 var(--s4)}
.pn .pn-where{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:0}
.pn .pn-bar{height:8px;border-radius:4px;background:var(--gray-soft);overflow:hidden;margin:var(--s2) 0 var(--s1)}
.pn .pn-bar i{display:block;height:100%;background:var(--teal)}
.pn .pn-left{font-size:var(--fs-aux);color:var(--muted);margin:0}
.pn .pn-card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s5) var(--s4);margin:0 0 var(--s3);text-align:center}
.pn .pn-ask{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s3)}
.pn .pn-hear{font-size:22px;font-weight:700;color:var(--ink);margin:0 0 var(--s3)}
.pn .pn-samewrap{margin:var(--s3) 0 0}
.pn .pn-ver{font-size:22px;font-weight:700;line-height:1.4;margin:0;overflow-wrap:anywhere}
.pn .pn-ver.ok{color:var(--ok)}
.pn .pn-ver.no{color:var(--err)}
.pn .pn-ver.same{color:var(--teal-ink)}
/* 答错：把第 2 步的对照听塞回来（这就是"会教"的那一步） */
.pn .pn-back{border:1px solid var(--amber);background:var(--amber-soft);color:var(--amber);border-radius:10px;padding:var(--s3);margin:var(--s4) 0 0;font-size:var(--fs-body);text-align:left;overflow-wrap:anywhere}
.pn .pn-cmp-t{font-size:var(--fs-aux);color:var(--muted);margin:var(--s4) 0 var(--s2)}
.pn .pn-ipa{font-size:18px;color:var(--ink-2);margin:var(--s3) 0 0;overflow-wrap:anywhere}
/* 第 4 步 过关 + 绕口令 */
.pn .pn-sum{border:1px solid var(--line);border-radius:12px;padding:var(--s4);margin:0 0 var(--s3);background:var(--surface-2)}
.pn .pn-sum.pass{border-color:var(--ok);background:var(--ok-soft)}
.pn .pn-sum.fail{border-color:var(--amber);background:var(--amber-soft)}
.pn .pn-sum .s-t{font-size:var(--fs-mod);font-weight:700;color:var(--ink);margin:0 0 var(--s2)}
.pn .pn-sum .s-l{font-size:var(--fs-body);color:var(--ink);margin:0;overflow-wrap:anywhere}
.pn .pn-sum .s-h{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:var(--s4) 0 var(--s2)}
.pn .pn-sum .s-tw{font-size:18px;font-weight:700;line-height:1.5;color:var(--ink);margin:0;overflow-wrap:anywhere}
.pn .pn-sum .s-how{font-size:var(--fs-body);color:var(--ink-2);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.pn .pn-sum ul{margin:0;padding-left:20px;display:grid;gap:var(--s1)}
.pn .pn-sum li{font-size:var(--fs-body);color:var(--ink);overflow-wrap:anywhere}
/* 纠说：他念、机器听 */
.pn .pn-say{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s4);margin:var(--s5) 0 0}
.pn .pn-say .y-t{font-size:var(--fs-mod);font-weight:700;color:var(--ink);margin:0 0 var(--s2)}
.pn .pn-sayver{font-size:18px;font-weight:700;line-height:1.5;margin:var(--s3) 0 0;overflow-wrap:anywhere;text-align:left}
.pn .pn-sayver.ok{color:var(--ok)}
.pn .pn-sayver.no{color:var(--err)}
.pn .pn-sayver.other{color:var(--amber)}
.pn .pn-saynote{font-size:var(--fs-aux);color:var(--muted);margin:var(--s2) 0 0;overflow-wrap:anywhere}
/* 大按钮：一律 ≥52px 高（这里全是 56px），手机单手够得着。
   **选择器必须压过 admin-page.ts 那条 :is(#v-work,…) .btn{min-height:38px}**（它带一个 id，算 1-1-0）：
   所以这里写成 #w-pron + 两个类（1-2-0），只写 .pn .pn-one button（0-2-1）会被它盖掉，按钮就只有 38px 高。 */
#w-pron .pn-one .btn{width:100%;min-height:56px;font-size:17px;font-weight:700}
.pn .pn-one{margin:0 0 var(--s3)}
.pn .pn-two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)}
#w-pron .pn-two .btn{min-height:56px;font-size:17px;font-weight:700}
.pn .pn-au{margin:var(--s4) 0 0}
.pn .pn-aumsg{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap;text-align:left}
.pn .pn-err{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap}
@media (max-width:420px){.pn .pn-sounds{grid-template-columns:1fr}.pn .pn-ver{font-size:18px}.pn .pn-sound .s-ipa{font-size:22px}}
`;

/** 工作台第 7 个模块：发音训练（二级菜单第 7 项「发音训练」，公共工具那 8 项一个没动） */
export const PRON_MOD = `<section class="card mod pn" id="w-pron"><header class="mh"><h2>发音训练</h2><span class="sp"></span><span class="aux" id="pn-aux">七组易错音</span></header>
<p class="lead" id="pn-lead"><span class="dot gray" id="pn-dot"></span><span id="pn-lead-t">读取中…</span><span class="soft" id="pn-soft">看口型 → 对照听 → 同一组连考 10 题 → 对 8 题过关，给绕口令。</span></p>
<div class="mbody">
  <!-- 旧的那两块去哪了（Amos 2026-11-11：「都没用了」）：照实说，并说明历史数据还在 -->
  <details class="more" id="pn-old"><summary>「英语练习」和「带练」去哪了</summary><div class="in"><p id="pn-old-t">读取中…</p>
    <p>新的这一块和它们最大的不同：<b>同一组音连考 10 题</b>，不是每题换一个音；<b>答错当场回到对照听</b>，不是只给对错；
    过关才给绕口令。口型、对比词、绕口令都来自你学过的那套课程（S1 第 10、11 课）。</p></div></details>

  <!-- 选一组（默认 g1 = /e/ vs /æ/，你实测最弱的那一组） -->
  <p class="pn-h">练哪一组</p>
  <div class="pn-pick" id="pn-pick"></div>

  <div class="pn-steps" id="pn-steps" aria-label="四步"><span class="pn-step" data-st="1">1 看口型</span><span class="pn-step" data-st="2">2 对照听</span><span class="pn-step" data-st="3">3 考 10 题</span><span class="pn-step" data-st="4">4 过关</span></div>

  <!-- 第 1 步：看口型（不考） -->
  <div id="pn-s1">
    <p class="pn-h" id="pn-s1-t">照着做：这两个音是用嘴型分开的，不是用耳朵猜的</p>
    <div class="pn-sounds" id="pn-sounds"></div>
    <p class="pn-mouthhint">课件原文的口型定位。"上下齿距离 1cm 左右（可容纳一根食指）"就是拿手指量 —— 对着镜子做一遍再往下走。</p>
    <p class="pn-note" id="pn-note1"></p>
    <div class="pn-one"><button class="btn primary" type="button" id="pn-go2">做完动作了，去对照听</button></div>
  </div>

  <!-- 第 2 步：对照听（不考）+ 纠说 -->
  <div id="pn-s2" hidden>
    <p class="pn-h">对照听：同一对的两个词来回点，想点几次点几次</p>
    <div id="pn-cmp"></div>
    <p class="pn-note" id="pn-note2"></p>
    <div class="pn-one" id="pn-go3wrap"><button class="btn primary" type="button" id="pn-go3">我听出来了，开始考</button></div>

    <div class="pn-say" id="pn-say">
      <p class="y-t">纠说：你念，机器听</p>
      <p class="pn-hint">按一下开始录，念出那个词，再按一次停止。机器会告诉你<b>它听成了哪个词</b> ——
      语音识别天生要对口音稳健，它可能把你念歪的音也认成那个词，<b>它听成什么是线索，不是判决</b>。</p>
      <div id="pn-saywords"></div>
      <p class="pn-sayver" id="pn-sayver" hidden></p>
      <p class="pn-saynote" id="pn-saynote" hidden></p>
      <div class="pn-aumsg" id="pn-saymsg" hidden></div>
    </div>
  </div>

  <!-- 第 3 步：考（同一组连考，不换别的音） -->
  <div id="pn-s3" hidden>
    <div class="pn-top">
      <p class="pn-where" id="pn-where">—</p>
      <div class="pn-bar"><i id="pn-qbar" style="width:0%"></i></div>
      <p class="pn-left" id="pn-qleft"></p>
    </div>
    <div id="pn-q">
      <div class="pn-card">
        <p class="pn-ask">听这个词，选你听到的是哪个</p>
        <p class="pn-hear">🔊</p>
        <div class="pn-one"><button class="btn primary" type="button" id="pn-again1">🔊 再听一次</button></div>
        <div class="pn-two" id="pn-pick2">
          <button class="btn" type="button" id="pn-l">—</button>
          <button class="btn" type="button" id="pn-r">—</button>
        </div>
        <div class="pn-one pn-samewrap"><button class="btn" type="button" id="pn-same">两个听着一样</button></div>
      </div>
    </div>
    <div id="pn-res" hidden>
      <div class="pn-card">
        <p class="pn-ver" id="pn-ver"></p>
        <!-- 答错当场把第 2 步的对照听塞回来：两个词都能点，听完点「继续」才出下一题 -->
        <p class="pn-back" id="pn-back" hidden></p>
        <p class="pn-cmp-t">两个都点来听，对比一下：</p>
        <div class="pn-two pn-au">
          <button class="btn" type="button" id="pn-wa">—</button>
          <button class="btn" type="button" id="pn-wb">—</button>
        </div>
        <p class="pn-ipa" id="pn-ipa"></p>
      </div>
      <div class="pn-one"><button class="btn primary" type="button" id="pn-next">继续</button></div>
    </div>
  </div>

  <!-- 第 4 步：过关 + 绕口令 -->
  <div id="pn-s4" hidden>
    <div class="pn-sum" id="pn-sum">
      <p class="s-t" id="pn-score"></p>
      <p class="s-l" id="pn-line"></p>
      <div id="pn-twwrap" hidden>
        <p class="s-h">绕口令挑战（课件原文）</p>
        <p class="s-tw" id="pn-tw"></p>
        <p class="s-how" id="pn-how"></p>
      </div>
      <div id="pn-wrongwrap" hidden>
        <p class="s-h">错在这几对</p>
        <ul id="pn-wrong"></ul>
      </div>
    </div>
    <div class="pn-two">
      <button class="btn primary" type="button" id="pn-again2">再考一轮</button>
      <button class="btn" type="button" id="pn-toS1">回第 1 步看口型</button>
    </div>
  </div>

  <div class="pn-aumsg" id="pn-msg" hidden></div>
  <div class="pn-err" id="pn-err" hidden></div>
</div>
<details class="more"><summary>这一块到底在做什么 · 内容和发音各从哪来</summary><div class="in">
  <p>七组是你学过的那套课程 S1 <b>第 10 课（易错元音）和第 11 课（易错辅音）</b>的对立音，口型定位、对比词、绕口令都是<b>课件原文</b>，逐张抽出来录进内容文件的。</p>
  <p>一组四步：<b>看口型</b>（能用手指量的定位，不是"用心体会"）→ <b>对照听</b>（两个词来回点，点多少次都行）→ <b>连考 10 题</b>（同一组，不换别的音；答错当场回到对照听）→ <b>10 题对 8 题过关</b>，给那一组的绕口令。</p>
  <p><b>第 7 组（/ʒ/ 和 /dʒ/）一对最小对立对都没有</b>，所以它只能跟读和纠说，没有听辨题 —— 不会给你硬凑的题。第 4 组只有 1 对，10 题会一直考那一对，页面上也写明了。</p>
  <p><b>纠说</b>用的是 Workers AI 的语音识别：你念一个词，它告诉你<b>它听成了哪个词</b>。有几个词（ketch、reen、roose、rove）不是现代常用词，识别基本不会输出它们，拿它们判对错是冤枉人，所以这几个词<b>不给纠说</b>。</p>
  <p><b>发音</b>用 Workers AI 的 aura-2-en 念，一个词念一次就<b>存在服务器上永久复用</b>（56 个词全生成一遍约 820 neurons，免费额度每天 10,000），<b>不新增任何费用</b>。念不出来的时候会当面说，不会假装有声音，也不会自动重试。</p>
  <p>每一轮的成绩（考了几题、对几题、点过几次"两个听着一样"、过没过）<b>存在服务器上</b>，换一台设备接着练就行。</p></div></details></section>`;

/** 发音训练那一块的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__pronBase，例如 '/api/pron/' */
export const PRON_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.pronOpen */
(function(){
try{
var PN={base:(window.__pronBase||'/api/pron/'),zu:[],cur:null,ji:null,step:1,loaded:false,busy:false,
  q:[],i:0,ok:0,same:0,bad:[],au:{},auBusy:{},player:null,rec:null,recId:'',recT0:0,recBtn:null};
var pq=function(i){return document.getElementById(i)};
function pText(id,s){var e=pq(id);if(e)e.textContent=s}
function pShow(id,on){var e=pq(id);if(e)e.hidden=!on}
function pClear(e){while(e&&e.firstChild)e.removeChild(e.firstChild)}
/* 出错一律把服务器那两句话原样摆出来，不吞掉 */
function pErr(j){var e=pq('pn-err');if(!e)return;
  var s=(j&&(j['出错']||j.error))||'出错了';
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  e.textContent=s;e.hidden=false;}
function pJson(path,init){return fetch(PN.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok){var e=new Error(j['出错']||j.error||('出错了（'+r.status+'）'));e.j=j;throw e;}
    return j;
  });
});}
function pPost(path,body){return pJson(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}

/* ---- 发音：同一段只取一次，之后复用；**失败就当面说，不自动重试** ---- */
function pAuErr(j,msgId){
  var m=pq(msgId||'pn-msg');if(!m)return;
  var s='这个词的发音没生成出来，这一次先跳过发音（上面的口型和音标照常看）。';
  if(j&&j['出错'])s+='\\n'+j['出错'];
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  m.textContent=s;m.hidden=false;
}
function pPlay(url,msgId){
  try{
    if(!PN.player)PN.player=new Audio();
    var a=PN.player;a.pause();a.src=url;a.playbackRate=1;
    var pr=a.play();
    // **AbortError 不是错**（2026-11-11 修）：第 2 步就是让他来回点两个词对比，
    // 后一次 play() 必然打断前一次，前一次的 promise 就以 AbortError 被拒
    // （"The play() request was interrupted by a new load request"）。
    // 原来这里不分青红皂白全报「浏览器把这次播放挡住了」——**他照我们设计的动作做，反而蹦出一个假错误**。
    // 只有真被拦住（NotAllowedError）或别的毛病才报。
    if(pr&&pr.catch)pr.catch(function(e){
      if(e&&e.name==='AbortError')return;
      pAuErr({'出错':'浏览器把这次播放挡住了。','怎么办':'再点一下这个按钮就会响。'},msgId);
    });
  }catch(e){pAuErr({'出错':'这台设备放不了这段声音。'},msgId);}
}
function pAudio(id,msgId){
  if(!id)return;
  var m=pq(msgId||'pn-msg');if(m)m.hidden=true;
  if(PN.au[id]){pPlay(PN.au[id],msgId);return;}
  /* 第一次要现生成，aura 要一两秒。这期间他若再点一下，不拦住就会**再发一个请求、再调一次模型、再记一次账** */
  if(PN.auBusy[id])return;
  PN.auBusy[id]=1;
  if(m){m.textContent='第一次要先生成这个词的发音，一两秒……';m.hidden=false;}
  var done=function(){delete PN.auBusy[id];};
  fetch(PN.base+'audio/'+encodeURIComponent(id)).then(function(r){
    var ct=r.headers.get('content-type')||'';
    if(!r.ok||ct.indexOf('audio')<0){return r.json().catch(function(){return {}}).then(function(j){done();pAuErr(j,msgId)});}
    return r.blob().then(function(b){done();if(m)m.hidden=true;var u=URL.createObjectURL(b);PN.au[id]=u;pPlay(u,msgId);});
  },function(e){done();pAuErr({'出错':'没连上服务器（'+e.message+'）。','怎么办':'等一下再点一次。'},msgId);});
}

/* ---- 选一组 ---- */
function pPick(){
  var box=pq('pn-pick');if(!box)return;
  pClear(box);
  PN.zu.forEach(function(z){
    var b=document.createElement('button');
    b.type='button';
    b.className='btn'+(PN.cur&&PN.cur['组']===z['组']?' primary':'');
    b.setAttribute('aria-pressed',PN.cur&&PN.cur['组']===z['组']?'true':'false');
    b.appendChild(document.createTextNode(z['名字']));
    var s=document.createElement('span');s.className='p-s';
    s.textContent=z['能听辨']?(z['元音还是辅音']+' · 第 '+z['第几课']+' 课'):(z['元音还是辅音']+' · 只能跟读纠说');
    b.appendChild(s);
    b.addEventListener('click',function(){pUse(z['组']);});
    box.appendChild(b);
  });
}
function pUse(id){
  var z=null;
  PN.zu.forEach(function(x){if(x['组']===id)z=x;});
  if(!z)return;
  PN.cur=z;PN.q=[];PN.i=0;PN.ok=0;PN.same=0;PN.bad=[];
  pPick();pSound();pCmp();pSayWords();pLead();pStep(1);
}

/* ---- 第 1 步：看口型 ---- */
function pSound(){
  var box=pq('pn-sounds');if(!box||!PN.cur)return;
  pClear(box);
  ['a','b'].forEach(function(k){
    var s=PN.cur[k];
    var d=document.createElement('div');d.className='pn-sound';
    var ipa=document.createElement('p');ipa.className='s-ipa';ipa.textContent=s['音标'];d.appendChild(ipa);
    var nk=document.createElement('p');nk.className='s-nick';nk.textContent=s['外号'];d.appendChild(nk);
    var ul=document.createElement('ul');
    (s['口型']||[]).forEach(function(line){var li=document.createElement('li');li.textContent=line;ul.appendChild(li);});
    d.appendChild(ul);box.appendChild(d);
  });
  pText('pn-note1',PN.cur['听辨说明']||'');
  pText('pn-s1-t','照着做：'+PN.cur['名字']+' 是用嘴型分开的，不是用耳朵猜的');
}

/* ---- 第 2 步：对照听（最小对立对，两个词各一个大按钮）---- */
function pCmp(){
  var box=pq('pn-cmp');if(!box||!PN.cur)return;
  pClear(box);
  var minimal=(PN.cur['对']||[]).filter(function(p){return p['最小对立对']});
  var rows=minimal.length?minimal:(PN.cur['对']||[]);
  rows.forEach(function(p){
    var d=document.createElement('div');d.className='pn-pair';
    var t=document.createElement('p');t.className='q-t';
    t.textContent=minimal.length?('第 '+p['第几对']+' 对：'+p.a['词']+' '+p.a['音标']+'　·　'+p.b['词']+' '+p.b['音标'])
      :('跟读：'+p.a['词']+' '+p.a['音标']+'　·　'+p.b['词']+' '+p.b['音标']);
    d.appendChild(t);
    var two=document.createElement('div');two.className='pn-two';
    ['a','b'].forEach(function(k){
      var b=document.createElement('button');b.type='button';b.className='btn';
      b.textContent='🔊 '+p[k]['词'];
      b.addEventListener('click',function(){pAudio(p[k]['编号'],'pn-msg');});
      two.appendChild(b);
    });
    d.appendChild(two);box.appendChild(d);
  });
  pText('pn-note2',PN.cur['听辨说明']||'');
  /* 这一组没有最小对立对：**不给「开始考」这个按钮**，照实说只能跟读和纠说（不硬凑题） */
  pShow('pn-go3wrap',!!PN.cur['能听辨']);
}

/* ---- 第 2 步里的纠说：他念，机器听 ---- */
function pSayWords(){
  var box=pq('pn-saywords');if(!box||!PN.cur)return;
  pClear(box);
  pShow('pn-sayver',false);pShow('pn-saynote',false);
  var m=pq('pn-saymsg');if(m)m.hidden=true;
  var any=false;
  (PN.cur['对']||[]).forEach(function(p){
    var ks=['a','b'].filter(function(k){return p[k]['能纠说']});
    if(!ks.length)return;
    any=true;
    var two=document.createElement('div');two.className=ks.length>1?'pn-two':'pn-one';
    two.style.marginBottom='12px';
    ks.forEach(function(k){
      var b=document.createElement('button');b.type='button';b.className='btn';
      b.textContent='🎤 念 '+p[k]['词'];
      b.dataset.word=p[k]['编号'];
      b.dataset.say=p[k]['词'];
      b.addEventListener('click',function(){pRec(b);});
      two.appendChild(b);
    });
    box.appendChild(two);
  });
  if(!any){
    var e=document.createElement('p');e.className='pn-hint';
    e.textContent='这一组里没有适合纠说的词（课件给的几个不是现代常用词，语音识别基本不会输出它们，拿它们判对错是冤枉人）。';
    box.appendChild(e);
  }
}
function pSayMsg(s){var m=pq('pn-saymsg');if(!m)return;m.textContent=s;m.hidden=false;}
function pRecStop(){
  try{if(PN.rec&&PN.rec.state!=='inactive')PN.rec.stop();}catch(e){}
}
/* 一个按钮两态：没在录 = 「🎤 念 bad」，正在录 = 「⏹ 停止（录音中）」。手机上单手就能用 */
function pRecLabel(b,on){if(b)b.textContent=(on?'⏹ 停止（录音中）':'🎤 念 '+b.dataset.say);}
function pRec(b){
  if(PN.rec&&PN.recBtn===b){pRecStop();return;}
  if(PN.rec){pRecStop();return;}
  var md=navigator.mediaDevices;
  if(!md||!md.getUserMedia||typeof MediaRecorder==='undefined'){
    pSayMsg('这个浏览器不支持录音，纠说用不了。\\n怎么办：换 Chrome / Safari 的新版本再试；上面的看口型、对照听和考题照常能用。');
    return;
  }
  var m=pq('pn-saymsg');if(m)m.hidden=true;
  pShow('pn-sayver',false);pShow('pn-saynote',false);
  md.getUserMedia({audio:true}).then(function(stream){
    var r;
    try{r=new MediaRecorder(stream);}catch(e){
      stream.getTracks().forEach(function(t){t.stop()});
      pSayMsg('这个浏览器录不了音（'+(e&&e.message||e)+'），纠说用不了。\\n怎么办：换 Chrome / Safari 的新版本再试；其余部分照常能用。');
      return;
    }
    var chunks=[];
    PN.rec=r;PN.recBtn=b;PN.recId=b.dataset.word;PN.recT0=Date.now();
    pRecLabel(b,true);
    r.ondataavailable=function(ev){if(ev.data&&ev.data.size)chunks.push(ev.data);};
    r.onstop=function(){
      var secs=(Date.now()-PN.recT0)/1000;
      stream.getTracks().forEach(function(t){t.stop()});
      PN.rec=null;pRecLabel(b,false);PN.recBtn=null;
      var blob=new Blob(chunks,{type:(r.mimeType||'audio/webm')});
      if(!blob.size){pSayMsg('没录到声音（0 字节）。\\n怎么办：确认麦克风没被静音，再按一次「🎤 念」。');return;}
      var fr=new FileReader();
      fr.onerror=function(){pSayMsg('这段录音读不出来。\\n怎么办：再按一次「🎤 念」重录一次（不会自动重试）。');};
      fr.onload=function(){
        var s=String(fr.result||'');
        var i=s.indexOf(',');
        pSayGo(b,s.slice(i+1),secs);
      };
      fr.readAsDataURL(blob);
    };
    r.start();
  },function(e){
    /* 没给麦克风权限：当面说清楚，**其余部分照常能用** */
    pSayMsg('没拿到麦克风权限（'+(e&&e.name||e)+'），纠说用不了。\\n怎么办：在浏览器地址栏左边的图标里允许麦克风，再按一次「🎤 念」。不给也没关系 —— 上面的看口型、对照听和考题照常能用。');
  });
}
function pSayGo(b,audio,secs){
  if(PN.busy)return;
  PN.busy=true;
  pRecLabel(b,false);
  b.textContent='机器正在听……';
  pPost('say',{'组':PN.cur['组'],'词':b.dataset.word,audio:audio,seconds:secs}).then(function(j){
    PN.busy=false;pRecLabel(b,false);
    var v=pq('pn-sayver');
    if(v)v.className='pn-sayver '+(j['判定']===1?'ok':(j['判定']===0?'no':'other'));
    pText('pn-sayver',j['一句话']||'');
    pShow('pn-sayver',true);
    pText('pn-saynote',(j['这是线索不是判决']||'')+'（今天已经纠了 '+j['今天已经纠了几次']+' 次，一天最多 '+j['一天最多']+' 次）');
    pShow('pn-saynote',true);
  },function(e){
    PN.busy=false;pRecLabel(b,false);
    var j=e.j||{'出错':e.message};
    pSayMsg((j['出错']||'没听成')+(j['怎么办']?'\\n怎么办：'+j['怎么办']:''));
  });
}

/* ---- 第 3 步：考（同一组连考，不换别的音）---- */
function pMix(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
function pCoin(){return Math.random()<0.5?'a':'b';}
function pOther(x){return x==='a'?'b':'a';}
function pRound(){
  if(!PN.cur||!PN.cur['能听辨'])return;
  var minimal=(PN.cur['对']||[]).filter(function(p){return p['最小对立对']});
  if(!minimal.length)return;
  /* 不够 10 对就重复抽（页面上已经照实说过"同一对会考到好几次"）；放哪个词、左右位置都随机 */
  var list=[];
  var pool=[];
  while(list.length<10){
    if(!pool.length)pool=pMix(minimal.slice());
    var p=pool.pop();
    list.push({p:p,say:pCoin(),left:pCoin()});
  }
  PN.q=list;PN.i=0;PN.ok=0;PN.same=0;PN.bad=[];
  pStep(3);pQ();
}
function pQ(){
  var x=PN.q[PN.i];if(!x)return;
  pText('pn-l',x.p[x.left]['词']);
  pText('pn-r',x.p[pOther(x.left)]['词']);
  pText('pn-where','第 '+(PN.i+1)+' 题 / 共 '+PN.q.length+'（'+PN.cur['名字']+'）');
  var b=pq('pn-qbar');if(b)b.style.width=Math.round(PN.i*100/(PN.q.length||1))+'%';
  pText('pn-qleft','这一轮只考这一组的两个音，不换别的；分不出来就点「两个听着一样」。');
  pShow('pn-q',true);pShow('pn-res',false);pShow('pn-err',false);
  var m=pq('pn-msg');if(m)m.hidden=true;
  /* 进这一题自动放一次（按钮上**只有「🔊 再听一次」**，绝不出现那个词） */
  pAudio(x.p[x.say]['编号'],'pn-msg');
}
/* 选完：**对错由服务端算**（页面不自己判） */
function pAnswer(k){
  if(PN.busy)return;
  var x=PN.q[PN.i];if(!x)return;
  var 选的=k==='same'?'same':(k==='left'?x.left:pOther(x.left));
  PN.busy=true;pShow('pn-err',false);
  pPost('answer',{'组':PN.cur['组'],'第几对':x.p['第几对'],'放的':x.say,'选的':选的}).then(function(j){
    PN.busy=false;pRes(x,j);
  },function(e){PN.busy=false;pErr(e.j||{'出错':e.message});});
}
function pRes(x,j){
  var was=(j['放的是']||{})['词']||'';
  var v=pq('pn-ver');
  if(j['两个听着一样']){
    PN.same++;
    if(v)v.className='pn-ver same';
    pText('pn-ver','你说两个听着一样 —— 刚才放的是 '+was);
  }else if(j['对']){
    PN.ok++;
    if(v)v.className='pn-ver ok';
    pText('pn-ver','✅ 对了 —— 刚才放的就是 '+was);
  }else{
    if(v)v.className='pn-ver no';
    pText('pn-ver','❌ 不对 —— 刚才放的是 '+was+'，你点的是 '+(j['你选的']||''));
  }
  if(!j['对'])PN.bad.push(x.p);
  /* 答错（含「两个听着一样」）当场把第 2 步的对照听塞回来 */
  var back=!j['对'];
  pText('pn-back',j['两个听着一样']
    ?'分不出来 —— 先回到对照听：两个词各点几次，听不出区别就是机器没念出来，说一声我们换模型。听完再点「继续」。'
    :'答错了 —— 先回到对照听：两个词都点一遍，听出差别再点「继续」。这一步才是学的地方。');
  pShow('pn-back',back);
  pText('pn-wa','🔊 '+x.p.a['词']);
  pText('pn-wb','🔊 '+x.p.b['词']);
  pText('pn-ipa',x.p.a['词']+' '+x.p.a['音标']+'　·　'+x.p.b['词']+' '+x.p.b['音标']);
  pText('pn-next',PN.i+1<PN.q.length?'继续':'看这一轮过没过');
  pShow('pn-q',false);pShow('pn-res',true);
  var m=pq('pn-msg');if(m)m.hidden=true;
}
function pNext(){
  PN.i++;
  if(PN.i<PN.q.length){pQ();return;}
  pDone();
}
/* ---- 第 4 步：过关 + 绕口令 ---- */
function pDone(){
  if(PN.busy)return;
  PN.busy=true;pShow('pn-err',false);
  pPost('round',{'组':PN.cur['组'],'考了':PN.q.length,'对':PN.ok,'两个听着一样':PN.same}).then(function(j){
    PN.busy=false;PN.ji=j['记录']?{'记录':j['记录']}:PN.ji;
    var box=pq('pn-sum');
    if(box)box.className='pn-sum '+(j['过关']?'pass':'fail');
    pText('pn-score',(j['过关']?'✅ 过关了：':'还没过：')+'10 题对 '+j['对']+' 题'+(j['两个听着一样']?('，点过 '+j['两个听着一样']+' 次「两个听着一样」'):''));
    pText('pn-line',j['一句话']||'');
    pShow('pn-twwrap',!!j['绕口令']);
    pText('pn-tw',j['绕口令']||'');
    pText('pn-how',j['怎么读']||'');
    var ul=pq('pn-wrong');
    if(ul){
      pClear(ul);
      var seen={};
      PN.bad.forEach(function(p){
        var key=p.a['词']+'/'+p.b['词'];
        if(seen[key])return;seen[key]=1;
        var li=document.createElement('li');
        li.textContent=p.a['词']+' '+p.a['音标']+' / '+p.b['词']+' '+p.b['音标'];
        ul.appendChild(li);
      });
      pShow('pn-wrongwrap',PN.bad.length>0);
    }
    pStep(4);pLead();
  },function(e){PN.busy=false;pErr(e.j||{'出错':e.message});});
}

/* ---- 四步之间切换 ---- */
function pStep(n){
  PN.step=n;
  pShow('pn-s1',n===1);pShow('pn-s2',n===2);pShow('pn-s3',n===3);pShow('pn-s4',n===4);
  [].forEach.call(document.querySelectorAll('#pn-steps .pn-step'),function(e){
    var k=Number(e.dataset.st);
    e.className='pn-step'+(k<n?' ok':(k===n?' on':''));
  });
  if(n===2){pSayWords();}
}
function pLead(){
  var rec=null;
  ((PN.ji&&PN.ji['记录'])||[]).forEach(function(r){if(PN.cur&&r['组']===PN.cur['组'])rec=r;});
  var 过=0,考=0;
  ((PN.ji&&PN.ji['记录'])||[]).forEach(function(r){考+=r['考过几轮'];if(r['过关几轮']>0)过++;});
  pText('pn-lead-t','七组里过关过 '+过+' 组；一共考过 '+考+' 轮。现在练 '+((PN.cur&&PN.cur['名字'])||'')+'。');
  var dot=pq('pn-dot');if(dot)dot.className='dot '+(过>=7?'ok':(过>0?'amber':'gray'));
  pText('pn-aux',(PN.cur&&PN.cur['名字'])||'七组易错音');
  if(rec&&rec['最近一轮'])pText('pn-soft','这一组最近一轮：10 题对 '+rec['最近一轮']['对']+' 题，'+(rec['最近一轮']['过关']?'过了':'没过')+'。');
}

function pLoad(){
  return pJson('state').then(function(j){
    PN.zu=j['组']||[];PN.ji=j;
    pText('pn-old-t',j['旧的去哪了']||'');
    if(!PN.zu.length){pErr({'出错':'发音训练这一轮没有内容。','怎么办':'刷新一下页面再试。'});return;}
    pUse(PN.zu[0]['组']);
    pShow('pn-err',false);
  },function(e){
    pText('pn-lead-t','暂时读不到发音训练的记录');pErr(e.j||{'出错':e.message});
  });
}

var g2=pq('pn-go2');if(g2)g2.addEventListener('click',function(){pStep(2)});
var g3=pq('pn-go3');if(g3)g3.addEventListener('click',pRound);
var a1=pq('pn-again1');if(a1)a1.addEventListener('click',function(){var x=PN.q[PN.i];if(x)pAudio(x.p[x.say]['编号'],'pn-msg')});
var bl=pq('pn-l');if(bl)bl.addEventListener('click',function(){pAnswer('left')});
var br=pq('pn-r');if(br)br.addEventListener('click',function(){pAnswer('right')});
var bs=pq('pn-same');if(bs)bs.addEventListener('click',function(){pAnswer('same')});
var wa=pq('pn-wa');if(wa)wa.addEventListener('click',function(){var x=PN.q[PN.i];if(x)pAudio(x.p.a['编号'],'pn-msg')});
var wb=pq('pn-wb');if(wb)wb.addEventListener('click',function(){var x=PN.q[PN.i];if(x)pAudio(x.p.b['编号'],'pn-msg')});
var nx=pq('pn-next');if(nx)nx.addEventListener('click',pNext);
var ag=pq('pn-again2');if(ag)ag.addEventListener('click',pRound);
var b1=pq('pn-toS1');if(b1)b1.addEventListener('click',function(){pStep(1)});
window.pronOpen=function(){if(PN.loaded)return;PN.loaded=true;pLoad();};
}catch(e){}
})();
`;

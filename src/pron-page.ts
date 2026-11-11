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
/* 口型示意图（2026-11-11）：两个音并排，**画面上每一处可见差别都指回课件 mouth 的某一条**（依据表 src/pron-mouth.ts）。
   画不出差别的那几组（/f/ /v/、/n/ /l/、/ʒ/ /dʒ/）两张图逐像素一样，差别照实写在说明里，不画假的。 */
.pn .pn-draw{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2);margin:0 0 var(--s3)}
.pn .pn-mo{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s3) var(--s2);min-width:0}
.pn .pn-mo.lit{border-color:var(--teal);background:var(--teal-soft)}
.pn .pn-mo .m-ipa{font-size:22px;font-weight:700;color:var(--teal-ink);margin:0 0 var(--s2);overflow-wrap:anywhere}
.pn .pn-mo svg{display:block;width:100%;height:auto;color:var(--ink)}
.pn .pn-mo .m-cap{font-size:12px;color:var(--muted);margin:var(--s1) 0 var(--s2);overflow-wrap:anywhere}
.pn .pn-mo .m-why{font-size:12px;color:var(--ink-2);margin:0;overflow-wrap:anywhere}
.pn .pn-mo .m-no{font-size:12px;color:var(--muted);margin:var(--s1) 0 0;overflow-wrap:anywhere}
/* 镜子里那张目标图只留图：依据就在同一屏上面，不重复第二遍，宽度让给他自己的嘴 */
.pn .pn-mo.mini .m-why,.pn .pn-mo.mini .m-no{display:none}
/* 照镜子：左边目标口型图、右边他自己的嘴。**画面不上传、不保存、不录**（只有 srcObject，关掉时 track.stop()） */
.pn .pn-mirror{border:1px solid var(--teal);border-radius:12px;background:var(--surface-2);padding:var(--s3);margin:0 0 var(--s3)}
.pn .pn-mirrow{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2);margin:0 0 var(--s3)}
.pn .pn-mircell{min-width:0}
.pn .pn-mircell .m-cap{font-size:12px;color:var(--muted);margin:0 0 var(--s1);overflow-wrap:anywhere}
.pn .pn-mircell video{display:block;width:100%;height:200px;object-fit:cover;background:#000;border-radius:10px;transform:scaleX(-1)}
.pn .pn-privacy{font-size:var(--fs-aux);font-weight:700;color:var(--teal-ink);margin:0 0 var(--s3);overflow-wrap:anywhere}
/* 慢速对照 + 他自己的录音回放（**录过才出现**，没录过不画占位、不画灰按钮） */
.pn .pn-my{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s3);margin:var(--s3) 0 0}
.pn .pn-my .y-t{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:0 0 var(--s2)}
#w-pron .pn-my .btn[aria-pressed="true"]{background:var(--teal-soft);border-color:var(--teal);font-weight:700}
/* 这几个按钮的字比别处长（「🐢 慢速开着（0.7 倍）」）：允许换行、min-width:0，否则格子被撑开、整块横着溢出 */
#w-pron .pn-my .btn{font-size:15px;white-space:normal;overflow-wrap:anywhere;min-width:0;line-height:1.3;padding:8px 10px}
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
@media (max-width:420px){.pn .pn-sounds{grid-template-columns:1fr}.pn .pn-ver{font-size:18px}.pn .pn-sound .s-ipa{font-size:22px}
  /* 390 宽：**口型图和镜子仍然并排**（并排才看得出差别、才对得上自己的嘴），只有下面两段文字改成单列 */
  .pn .pn-draw,.pn .pn-mirrow{grid-template-columns:1fr 1fr}}
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

  <!-- 第 1 步：看口型（不考）：口型示意图 + 来回切换 + 照镜子 -->
  <div id="pn-s1">
    <p class="pn-h" id="pn-s1-t">照着做：这两个音是用嘴型分开的，不是用耳朵猜的</p>
    <!-- 口型示意图：画什么全部由 src/pron-mouth.ts 从课件 mouth 原文翻译出来，页面只负责照着画（底线 3） -->
    <div class="pn-draw" id="pn-draw"></div>
    <p class="pn-note" id="pn-drawnote"></p>
    <div class="pn-two">
      <button class="btn" type="button" id="pn-anim" aria-pressed="false">▶ 来回切换</button>
      <button class="btn" type="button" id="pn-mir" aria-pressed="false">🪞 照镜子</button>
    </div>
    <!-- 照镜子：左边目标口型图、右边前置摄像头。**画面只在这台手机上，不上传、不保存、不录** -->
    <div class="pn-mirror" id="pn-mirwrap" hidden>
      <div class="pn-mirrow">
        <div class="pn-mircell"><p class="m-cap" id="pn-mircap">要做的口型</p><div id="pn-mirtarget"></div></div>
        <div class="pn-mircell"><p class="m-cap">你自己的嘴（像照镜子一样左右反过来）</p><video id="pn-cam" autoplay playsinline muted></video></div>
      </div>
      <p class="pn-privacy">这个画面不会离开你的手机 —— 不上传、不保存、不录像。关掉镜子，摄像头指示灯就灭。</p>
      <div class="pn-two">
        <button class="btn" type="button" id="pn-mirswap">换另一个音的图</button>
        <button class="btn" type="button" id="pn-miroff">关掉镜子</button>
      </div>
    </div>
    <div class="pn-aumsg" id="pn-mirmsg" hidden></div>
    <div class="pn-sounds" id="pn-sounds"></div>
    <p class="pn-mouthhint" id="pn-mouthhint"></p>
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

      <!-- 慢速对照 + 他自己的录音回放：**录过才出现**（没录过这一块整个不画，不留灰按钮） -->
      <div class="pn-my" id="pn-my" hidden>
        <p class="y-t" id="pn-my-t">挨着听：标准音和你刚才念的</p>
        <div class="pn-two">
          <button class="btn" type="button" id="pn-std">🔊 标准音</button>
          <button class="btn" type="button" id="pn-mine">🎧 我刚才念的</button>
        </div>
        <div class="pn-two" style="margin-top:12px">
          <button class="btn" type="button" id="pn-slow" aria-pressed="false">🐢 慢速 0.7 倍</button>
          <button class="btn" type="button" id="pn-chain">▶ 连着放</button>
        </div>
        <p class="pn-saynote">「连着放」= 标准音 → 停 0.3 秒 → 你的录音，对比最清楚。这段录音<b>留在这个页面里，不另外上传</b>（纠说那一次本来就要把录音送去给机器听，那是原来就有的），<b>刷新页面就没了</b>。</p>
      </div>
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
  <p><b>口型图</b>是照着课件那几句口型定位画的 —— <b>画面上每一处不一样的地方，都指得回课件原文的某一条</b>；课件没说的（舌位、气流、唇形变化）一笔都不画。有三组（/f/ 和 /v/、/n/ 和 /l/、/ʒ/ 和 /dʒ/）<b>嘴外面根本看不出差别</b>，那两张图就画成一模一样，并写明差别在喉咙还是气流 —— 不给你编一个假的嘴型差别。</p>
  <p><b>照镜子</b>用的是手机的前置摄像头：画面<b>只在这台手机上显示，不上传、不保存、不录像</b>，关掉镜子摄像头就停（指示灯灭）。<b>「我刚才念的」</b>是纠说那一次录的那段，留在浏览器里<b>不另外上传</b>，<b>刷新就没了</b>；慢速 0.7 倍对标准音和你的录音都管用，「连着放」是标准音 → 停 0.3 秒 → 你的录音。</p>
  <p>每一轮的成绩（考了几题、对几题、点过几次"两个听着一样"、过没过）<b>存在服务器上</b>，换一台设备接着练就行。</p></div></details></section>`;

/** 发音训练那一块的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__pronBase，例如 '/api/pron/' */
export const PRON_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.pronOpen */
(function(){
try{
var PN={base:(window.__pronBase||'/api/pron/'),zu:[],cur:null,ji:null,step:1,loaded:false,busy:false,
  q:[],i:0,ok:0,same:0,bad:[],au:{},auBusy:{},player:null,rec:null,recId:'',recT0:0,recBtn:null,
  /* 口型图的来回切换动画：on 开着没、t 第几拍、timer 计时器、side 镜子里看哪个音 */
  mo:{on:false,t:0,timer:null,side:'a'},
  /* 镜子拿到的摄像头流：**只赋给 video.srcObject**，关掉时 getTracks().stop()。不录、不传、不存。
     camSeq 是请求序号：getUserMedia 要等他点权限弹窗，这中间他可能已经关掉镜子、
     走到第 2 步、或者又点了一下。流回来时序号对不上就**当场 stop 掉**，绝不留一个没人管的流亮着。 */
  cam:null,camSeq:0,camWant:0,
  /* 播放：rate 这一次的倍速（放完回 1）、onEnd 这一次放完做什么（「连着放」用）、slow 慢速按钮按下没。
     chainT 是「连着放」中间那 0.3 秒的定时器——**必须存起来**，换组、换步、开考时要掐掉它。 */
  rate:1,onEnd:null,slow:false,chainT:null,
  /* 他刚才那段录音：只在这个页面里（URL.createObjectURL），刷新就没了 */
  myUrl:'',myWord:'',mySay:''};
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
    var a=PN.player;a.pause();a.src=url;
    /* 慢速 0.7 倍和「连着放」都**用同一个播放器**（不另写一个）：倍速和"放完做什么"都只管这一次，用完就还原 */
    a.playbackRate=PN.rate||1;PN.rate=1;
    var on=PN.onEnd;PN.onEnd=null;
    a.onended=null;
    if(on)a.onended=function(){a.onended=null;on();};
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
  /* 换一组：上一组录的那段是**另一个词**，留着会误导 —— 当场丢掉（底线 3） */
  pPlayReset();pMyDrop();
  PN.mo.side='a';
  pPick();pSound();pCmp();pSayWords();pLead();pStep(1);
  pAnimStop();
}
/* 丢掉上一段录音（换组、刷新都会丢；它本来就只活在这个页面里） */
function pMyDrop(){
  if(PN.myUrl)try{URL.revokeObjectURL(PN.myUrl);}catch(e){}
  PN.myUrl='';PN.myWord='';PN.mySay='';PN.slow=false;
  var b=pq('pn-slow');if(b){b.setAttribute('aria-pressed','false');b.textContent='🐢 慢速 0.7 倍';}
  pShow('pn-my',false);
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
  /* **这句不能写死**（2026-11-11 审查 🔴4）。原来对七组都说"是用嘴型分开的"，
     可是 /f/ /v/、/n/ /l/ 的口型课件写的一模一样，/ʒ/ /dʒ/ 课件一句口型都没给——
     对这三组它是**假的**，而且和同一屏下面那段"嘴外面看不出来"当场打架。
     更糟的是他会照着这句去镜子里找一个**根本不存在**的嘴型差别。按这一组的实际情况说。 */
  var tu0=PN.cur['口型图'];
  var 没图=tu0&&!((tu0['a']&&(tu0['a']['画了']||[]).length)||(tu0['b']&&(tu0['b']['画了']||[]).length));
  pText('pn-s1-t',
    没图 ? ('先看清楚：课件没给 '+PN.cur['名字']+' 的口型 —— 这一组不是用嘴型分开的')
    : (tu0&&tu0['画得出差别']===false)
      ? ('先看清楚：'+PN.cur['名字']+' 的口型课件写的一样，不是用嘴型分开的 —— 下面说清楚差在哪')
      : ('照着做：'+PN.cur['名字']+' 是用嘴型分开的，不是用耳朵猜的'));
}

/* ====================================================================
   第 1 步的口型示意图（2026-11-11）
   **画面上每一处可见差别，都能指回课件 mouth 数组里的某一条**（底线 3）：
   画什么不是这里决定的，是 src/pron-mouth.ts 从 mouth 原文逐条翻译出来的（接口字段「口型图」）。
   这里只做两件事：照着翻译结果画线，并把那一条**原文**写进元素的 data-y（测试逐个核对，见 test/pron.test.ts 第 10、11 组）。
   图框（嘴的轮廓、剖面的上下颚）带 data-frame="1"：两个音**完全一样**，不表示任何差别。
   逐组实况（哪几组画得出、哪几组画不出）写在 src/pron-mouth.ts 的文件头。
   ==================================================================== */
var PNS='http://www.w3.org/2000/svg';
function pEl(tag,at,y,frame,f,gv){
  var e=document.createElementNS(PNS,tag);
  for(var k in at)if(at[k]!=='')e.setAttribute(k,String(at[k]));
  if(y)e.setAttribute('data-y',y);          /* 依据：课件 mouth 里的那一条原文 */
  if(frame)e.setAttribute('data-frame','1');/* 图框，不是特征 */
  /* data-f = 这一笔画的是哪个特征，data-g = **由这个特征决定的那个数**（审查 🟡5）。
     光有 data-y 堵不住洞：嘴唇那一笔的 data-y 里本来就带着开口那条原文，
     所以在嘴唇上凭空画一个差别，"依据里有 2cm"这条断言照样过。
     有了 data-f + data-g，测试就能核"不该不一样的特征，两张图的数必须一样"。 */
  if(f)e.setAttribute('data-f',f);
  if(gv!==undefined&&gv!==null)e.setAttribute('data-g',String(gv));
  return e;
}
/* 这个音的某个可见特征是依据哪一条原文画的；没有这个特征就回空字符串 */
function pWhy(sp,k){var y='';((sp&&sp['画了'])||[]).forEach(function(f){if(f['特征']===k&&!y)y=f['依据'];});return y;}

/* 正面：嘴唇 + 上下齿的开口 +（课件给了尺寸才有的）食指参照。ph = 第几帧（课件写「由…到…」的音才有第 2 帧） */
function pFront(sp,ph){
  var f=sp['正面'];if(!f)return null;
  var yL=pWhy(sp,'唇'),yO=pWhy(sp,'开口'),yF=pWhy(sp,'手指');
  var s=pEl('svg',{viewBox:'0 0 140 100','aria-hidden':'true'});
  var cx=56,cy=50;
  if(f['唇']==='上齿轻咬下唇'){
    /* /f/ /v/：课件只说了「上齿轻咬下唇」—— 画上齿搭在下唇上，**两个音逐笔一样**（差别在喉咙，看不出来） */
    s.appendChild(pEl('path',{d:'M 12 62 Q 56 42 100 62 Q 56 82 12 62 Z',fill:'none',stroke:'currentColor','stroke-width':3},yL,0,'唇','咬唇'));
    for(var i=0;i<4;i++)s.appendChild(pEl('rect',{x:26+i*15,y:50,width:12,height:12,rx:2,fill:'none',stroke:'currentColor','stroke-width':2},yL,0,'唇','咬唇'));
    return s;
  }
  /* 嘴角拉开多少：课件的三种说法（「扁平咧嘴」比「咧嘴」更扁更宽；「先张嘴后咧嘴」第 1 帧是张嘴、第 2 帧才咧开） */
  var hw=f['唇']==='扁平咧嘴'?46:(f['唇']==='先张嘴后咧嘴'?(ph?44:30):44);
  var bulge=f['唇']==='扁平咧嘴'?2:6;
  var mm=f['开口毫米'];
  if(f['到毫米']!==null&&f['到毫米']!==undefined&&ph)mm=f['到毫米'];
  var gap=(mm||0)*2.2;              /* 1mm = 2.2px：1cm → 22px、2cm → 44px，两张图同一把尺 */
  var oh=gap+18;
  /* 嘴唇这一笔的依据有两条：横着拉多开看「咧嘴」那一条，竖着张多大跟着上下齿的开口走
     （嘴总得张到容得下那个齿缝）—— 所以 data-y 里**两条原文都写上**，测试按"至少有一条两边不一样"来核对 */
  s.appendChild(pEl('path',{d:'M '+(cx-hw)+' '+cy+' Q '+cx+' '+(cy-oh/2-bulge)+' '+(cx+hw)+' '+cy+' Q '+cx+' '+(cy+oh/2+bulge)+' '+(cx-hw)+' '+cy+' Z',
    fill:'none',stroke:'currentColor','stroke-width':3},yO?(yL+' | '+yO):yL,0,'唇',hw+','+bulge));
  if(yO){
    /* 课件没给尺寸的（「微张」「张开」）画虚线：示意"开着一点"，**不代表任何厘米数**，说明里也写着 */
    var dash=f['有尺寸']?'':'5 4';
    var gk=gap+'/'+(f['有尺寸']?'实':'虚');
    s.appendChild(pEl('rect',{x:cx-hw*0.55,y:cy-gap/2-9,width:hw*1.1,height:9,rx:2,fill:'none',stroke:'currentColor','stroke-width':2,'stroke-dasharray':dash},yO,0,'开口',gk));
    s.appendChild(pEl('rect',{x:cx-hw*0.55,y:cy+gap/2,width:hw*1.1,height:9,rx:2,fill:'none',stroke:'currentColor','stroke-width':2,'stroke-dasharray':dash},yO,0,'开口',gk));
    if(f['有尺寸']){
      s.appendChild(pEl('line',{x1:108,y1:cy-gap/2,x2:108,y2:cy+gap/2,stroke:'currentColor','stroke-width':2},yO,0,'开口',gk));
      s.appendChild(pEl('line',{x1:103,y1:cy-gap/2,x2:113,y2:cy-gap/2,stroke:'currentColor','stroke-width':2},yO,0,'开口',gk));
      s.appendChild(pEl('line',{x1:103,y1:cy+gap/2,x2:113,y2:cy+gap/2,stroke:'currentColor','stroke-width':2},yO,0,'开口',gk));
    }
  }
  /* 食指参照：课件原文说「可容纳一根食指 / 两根食指」，所以 n 根手指正好填满这个开口 */
  var n=f['手指']||0;
  for(var k=0;k<n;k++)s.appendChild(pEl('rect',{x:120,y:cy-gap/2+k*(gap/n),width:16,height:gap/n,rx:5,fill:'none',stroke:'currentColor','stroke-width':2},yF,0,'手指',n));
  return s;
}
/* 剖面：只画舌头那一笔（课件给了舌位才画）。上下颚和牙是图框，两个音一样 */
function pSide(sp){
  var t=sp['剖面'];if(!t)return null;
  var y=pWhy(sp,'舌');
  var s=pEl('svg',{viewBox:'0 0 140 100','aria-hidden':'true'});
  s.appendChild(pEl('path',{d:'M 18 38 L 32 36 Q 70 24 126 30',fill:'none',stroke:'currentColor','stroke-width':2,opacity:'.45'},'',1));
  s.appendChild(pEl('rect',{x:16,y:38,width:11,height:13,rx:2,fill:'none',stroke:'currentColor','stroke-width':2,opacity:'.45'},'',1));
  s.appendChild(pEl('rect',{x:16,y:59,width:11,height:13,rx:2,fill:'none',stroke:'currentColor','stroke-width':2,opacity:'.45'},'',1));
  s.appendChild(pEl('path',{d:'M 18 72 Q 70 84 126 78',fill:'none',stroke:'currentColor','stroke-width':2,opacity:'.45'},'',1));
  var d=t['舌']==='平躺抵下齿'?'M 28 70 Q 30 62 44 61 L 104 62 Q 122 66 104 74 L 32 75 Z'
    :(t['舌']==='舌尖抵上齿龈'?'M 30 55 Q 29 40 40 37 Q 52 39 52 53 L 104 62 Q 122 66 104 74 L 32 75 Z'
    :'M 46 62 Q 38 44 56 38 Q 68 41 60 50 Q 53 56 58 64 L 104 62 Q 122 66 104 74 L 44 75 Z');
  s.appendChild(pEl('path',{d:d,fill:'none',stroke:'currentColor','stroke-width':3},y,0,'舌',t['舌']));
  return s;
}
/* 一个音一块：音标 + （画得出来的）图 + 「图上画的是哪几条原文」+「没画的是哪几条、为什么」 */
function pMo(sp,ph,box){
  pClear(box);
  var ipa=document.createElement('p');ipa.className='m-ipa';ipa.textContent=sp['音标']+'　'+sp['外号'];box.appendChild(ipa);
  var fr=pFront(sp,ph),sd=pSide(sp);
  if(fr){box.appendChild(fr);var c1=document.createElement('p');c1.className='m-cap';c1.textContent='正面（嘴唇和上下齿）';box.appendChild(c1);}
  if(sd){box.appendChild(sd);var c2=document.createElement('p');c2.className='m-cap';c2.textContent='剖面（舌头在嘴里面，镜子里看不到）';box.appendChild(c2);}
  var why=document.createElement('p');why.className='m-why';
  var 条=[];(sp['画了']||[]).forEach(function(f){if(条.indexOf(f['依据'])<0)条.push(f['依据']);});
  why.textContent=条.length?('图上画的：'+条.join(' · ')+'（都是课件原文）'):'课件没给这个音的口型，所以这里一张图都不画。';
  box.appendChild(why);
  if((sp['没画']||[]).length){
    var no=document.createElement('p');no.className='m-no';
    no.textContent='没画：'+(sp['没画']||[]).map(function(x){return x['原文']+'（'+x['为什么']+'）';}).join(' ');
    box.appendChild(no);
  }
}
/* 两个音并排重画一次（ph = 第几帧；lit = 高亮哪一个，来回切换动画用，-1 = 都不高亮） */
function pDrawAll(ph,lit){
  var box=pq('pn-draw');if(!box||!PN.cur)return;
  var tu=PN.cur['口型图'];
  pClear(box);
  if(!tu){pText('pn-drawnote','');return;}
  ['a','b'].forEach(function(k,i){
    var d=document.createElement('div');d.className='pn-mo'+(lit===i?' lit':'');
    d.setAttribute('data-s',k);
    pMo(tu[k],ph,d);
    box.appendChild(d);
  });
  pText('pn-drawnote',tu['说明']||'');
  /* 「拿手指量」这句**只在课件真给了食指参照的组**上说（2026-11-11 主会话改）：
     原来是写死在模板里的，于是 /f/ /v/、/ʒ/ /dʒ/ 这些课件压根没给开口尺寸的组，
     底下也照样挂着「上下齿距离 1cm（可容纳一根食指）」—— **那是第 1 组的原文串到了别人头上**，
     等于拿一条课件没说的话当这一组的做法，是底线 3 的事。 */
  var fi=[];var cn={1:'一',2:'两',3:'三'};
  ['a','b'].forEach(function(k){
    var f=tu[k]&&tu[k]['正面'];var n=f&&f['手指'];
    /* 两个音的根数可能不一样（第 1 组就是 1 根 vs 2 根），**两个都要说**，不许只留一个 */
    if(n)fi.push({ipa:tu[k]['音标'],n:n});
  });
  /* **只有一个音有食指参照时，必须把音标带上**（审查 🟡7）：第 3 组课件只对 /æ/ 写了两根食指，
     /aɪ/ 是"张开后慢慢闭合"、没给尺寸。光说"可容纳两根食指"会让他以为两个音都这么量。 */
  pText('pn-mouthhint',fi.length
    ?('课件原文的口型定位。'+fi.map(function(x){
        return (fi.length===1?(x.ipa+' 的'):'')+'"可容纳'+(cn[x.n]||x.n)+'根食指"';
      }).join(' / ')+'就是拿手指量 —— 对着镜子做一遍再往下走。'
      +(fi.length===1?'（另一个音课件没给厘米数，别拿手指量。）':''))
    :'课件没给这一组开口的厘米数，别拿手指量 —— 照着上面写的做一遍，再往下走。');
  pMirTarget();
}
/* 来回切换：每 450ms 一拍，同一个音看两帧（课件写「由…到…」的音才会动），两拍换一个音 */
function pAnimStop(){
  if(PN.mo.timer){clearInterval(PN.mo.timer);PN.mo.timer=null;}
  PN.mo.on=false;PN.mo.t=0;
  var b=pq('pn-anim');if(b){b.textContent='▶ 来回切换';b.setAttribute('aria-pressed','false');}
  pDrawAll(0,-1);
}
function pAnim(){
  if(PN.mo.on){pAnimStop();return;}
  PN.mo.on=true;PN.mo.t=0;
  var b=pq('pn-anim');if(b){b.textContent='⏸ 停下';b.setAttribute('aria-pressed','true');}
  pDrawAll(0,0);
  PN.mo.timer=setInterval(function(){
    PN.mo.t++;
    pDrawAll(PN.mo.t%2,Math.floor(PN.mo.t/2)%2);
  },450);
}

/* ====================================================================
   照镜子：前置摄像头当镜子（Amos 2026-11-11 最想要的那一样）
   **画面绝对不上传、不保存、不录**：拿到的流只做两件事 —— 赋给 video.srcObject、关掉时 track.stop()。
   这一整段里**没有录像机、没有画布、没有任何一种截帧的做法**，一次网络请求都不发
   （那些 API 的名字连写都不许写进这个文件 —— test/pron.test.ts 第 12 组逐个名字守着）。
   ==================================================================== */
function pMirMsg(s){var m=pq('pn-mirmsg');if(!m)return;m.textContent=s;m.hidden=false;}
/* 镜子左边那张目标口型图：跟着当前这一组走，按钮可以换看另一个音 */
function pMirTarget(){
  var box=pq('pn-mirtarget');if(!box||!PN.cur)return;
  var tu=PN.cur['口型图'];if(!tu)return;
  var sp=tu[PN.mo.side]||tu.a;
  var d=document.createElement('div');d.className='pn-mo mini';
  pMo(sp,0,d);
  pClear(box);box.appendChild(d);
  /* **mini 把"依据"和"没画"用 CSS 藏起来了**（审查 🟡6）。于是第 7 组开镜子，
     他脸旁边是一个写着"要做的口型：/ʒ/"的**空框**——那句"课件没给这个音的口型"恰好被藏掉了。
     所以这里自己补一行，照实说。 */
  if(!(sp['画了']||[]).length){
    var e=document.createElement('p');e.className='pn-hint';e.style.margin='0';
    e.textContent='课件没给这个音的口型，这里没有图可以照着做。';
    box.appendChild(e);
  }
  pText('pn-mircap','要做的口型：'+sp['音标']);
  /* 两个音画出来一模一样时，「换另一个音的图」换出来的是**同一张图配另一个音标**，
     等于暗示有差别——**那个按钮就不该在**（审查 🟡6）。 */
  pShow('pn-mirswap',tu['画得出差别']!==false&&(sp['画了']||[]).length>0);
}
function pMirOff(){
  try{
    /* 关掉时**必须 stop()**，不然摄像头指示灯一直亮着 */
    if(PN.cam&&PN.cam.getTracks)PN.cam.getTracks().forEach(function(t){t.stop();});
  }catch(e){}
  PN.cam=null;
  /* **撤销还在路上的那次请求**（审查 🔴2）：序号一往前走，流回来时就对不上，会被当场 stop 掉 */
  PN.camWant=0;PN.camSeq++;
  var v=pq('pn-cam');if(v)try{v.srcObject=null;}catch(e){}
  pShow('pn-mirwrap',false);
  var b=pq('pn-mir');if(b){b.textContent='🪞 照镜子';b.setAttribute('aria-pressed','false');}
}
/* 按钮字样还原（「正在开摄像头……」这个中间态要收得回来） */
function pMirReset(){var b=pq('pn-mir');if(b){b.textContent='🪞 照镜子';b.setAttribute('aria-pressed','false');}}
/* 一个流到了，但已经没人要它了：**立刻掐掉**，绝不留着亮指示灯 */
function pCamDrop(stream){try{stream.getTracks().forEach(function(t){t.stop();});}catch(e){}}
function pMirOn(){
  if(PN.cam){pMirOff();return;}
  /* 已经在等权限弹窗了，再点一下不许再发一个请求（审查 🔴2 复现 C：
     手机上第一次要等弹窗，连点两下就会开出**两个流**，而 PN.cam 只记得住后一个，
     前一个永远没人 stop ——「关掉镜子」按下去指示灯也不灭） */
  if(PN.camWant)return;
  var md=navigator.mediaDevices;
  if(!md||!md.getUserMedia){
    pMirMsg('这个浏览器用不了摄像头，镜子打不开。\\n怎么办：换 Chrome / Safari 的新版本再试；上面的口型图、对照听和考题照常能用。');
    return;
  }
  var m=pq('pn-mirmsg');if(m)m.hidden=true;
  var seq=++PN.camSeq;PN.camWant=seq;
  var b0=pq('pn-mir');if(b0)b0.textContent='🪞 正在开摄像头……';
  md.getUserMedia({video:{facingMode:'user'},audio:false}).then(function(stream){
    /* 等权限的这段时间里他可能已经关掉镜子、走到第 2 步、或者整个切走了。
       **这三种情况一律把流掐掉**，不显示、不保留（审查 🔴2 复现 A / B）。 */
    if(seq!==PN.camSeq||PN.camWant!==seq||PN.step!==1){PN.camWant=0;pCamDrop(stream);pMirReset();return;}
    PN.camWant=0;
    PN.cam=stream;
    var v=pq('pn-cam');
    if(v)try{v.srcObject=stream;}catch(e){}
    pShow('pn-mirwrap',true);
    pMirTarget();
    var b=pq('pn-mir');if(b){b.textContent='🪞 镜子开着';b.setAttribute('aria-pressed','true');}
  },function(e){
    PN.camWant=0;pMirReset();
    /* 没给权限 / 没有摄像头：当面说清楚，**整屏其余部分照常能用** */
    pMirMsg('没拿到摄像头权限（'+(e&&e.name||e)+'），镜子用不了。\\n怎么办：在浏览器地址栏左边的图标里允许摄像头，再按一次「🪞 照镜子」。不给也没关系 —— 口型图、对照听和考题照常能用。');
  });
}

/* ---- 第 2 步：慢速对照 + 他自己的录音回放（录过才出现）---- */
/* 这一次用什么倍速：慢速按钮按下去就是 0.7 倍（标准音和他的录音都慢） */
function pRate(){return PN.slow?0.7:1;}
function pSetNext(rate,onEnd){PN.rate=rate||1;PN.onEnd=onEnd||null;}
/* **把"这一次播放"的意图清空**（2026-11-11 审查 🔴3）。
   pSetNext() 把倍速和"放完做什么"写进 PN，由下一次 pPlay() 取走。可是 pAudio() 有两条路**根本走不到 pPlay**：
   这个词正在生成（auBusy 早退）、或者取发音失败。那 0.7 倍和那个回调就**留在枪膛里**，
   被后面某一次毫不相干的播放打出去——**考题会被 0.7 倍慢放，他自己录的那个词会在考题上面再响一遍**，
   然后揭晓时页面说"刚才放的是 leather"。那是当面给他一个和事实不符的交代（底线 3）。
   所以换组、换步、开考之前一律清空，连「连着放」那 0.3 秒的定时器也掐掉。 */
function pPlayReset(){
  PN.rate=1;PN.onEnd=null;
  if(PN.chainT){clearTimeout(PN.chainT);PN.chainT=null;}
  if(PN.player)PN.player.onended=null;
}
function pMyShow(){
  pShow('pn-my',!!PN.myUrl);
  if(PN.myUrl)pText('pn-my-t','挨着听：标准音和你刚才念的「'+PN.mySay+'」');
}
function pMyStd(){if(!PN.myWord)return;pSetNext(pRate(),null);pAudio(PN.myWord,'pn-msg');}
function pMyMine(){if(!PN.myUrl)return;pSetNext(pRate(),null);pPlay(PN.myUrl,'pn-msg');}
function pMySlow(){
  PN.slow=!PN.slow;
  var b=pq('pn-slow');if(b){b.setAttribute('aria-pressed',PN.slow?'true':'false');b.textContent=PN.slow?'🐢 慢速开着（0.7 倍）':'🐢 慢速 0.7 倍';}
}
/* 连着放：标准音 → 停 0.3 秒 → 他的录音。对比效果最好的那一个形式 */
function pMyChain(){
  if(!PN.myWord||!PN.myUrl)return;
  pPlayReset();
  pSetNext(pRate(),function(){
    PN.chainT=setTimeout(function(){
      PN.chainT=null;
      /* 这 0.3 秒里他可能已经换组了（pMyDrop() 会 revoke 掉这个 url）。
         不再确认一次就 pPlay('')，play() 会以 NotSupportedError 被拒，
         于是当面蹦出一个「浏览器把这次播放挡住了」的**假错误**——
         和 11/11 刚修掉的 AbortError 是同一类毛病（审查 🟡8）。 */
      if(!PN.myUrl)return;
      pSetNext(pRate(),null);pPlay(PN.myUrl,'pn-msg');
    },300);
  });
  pAudio(PN.myWord,'pn-msg');
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
      /* **把这段录音留在浏览器里**给他回放用（不另外上传；纠说那一次本来就要传，照旧）。刷新就没了，页面上写着 */
      pMyDrop();
      try{PN.myUrl=URL.createObjectURL(blob);PN.myWord=b.dataset.word;PN.mySay=b.dataset.say;pMyShow();}catch(e){}
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
  /* 开考：把第 2 步留下的倍速和「连着放」的尾巴掐干净，**考题只能原速、只能放考题那个词**（审查 🔴3） */
  pPlayReset();
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
  /* 换一步就把上一步没打出去的播放意图清掉（审查 🔴3） */
  pPlayReset();
  /* 离开第 1 步：**镜子一定关掉**（track.stop()，指示灯灭），切换动画也停掉，不在后台空转 */
  if(n!==1){pMirOff();if(PN.mo.on)pAnimStop();}
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
var an=pq('pn-anim');if(an)an.addEventListener('click',pAnim);
var mi=pq('pn-mir');if(mi)mi.addEventListener('click',pMirOn);
var mf=pq('pn-miroff');if(mf)mf.addEventListener('click',pMirOff);
var ms=pq('pn-mirswap');if(ms)ms.addEventListener('click',function(){PN.mo.side=PN.mo.side==='a'?'b':'a';pMirTarget();});
var ys=pq('pn-std');if(ys)ys.addEventListener('click',pMyStd);
var ym=pq('pn-mine');if(ym)ym.addEventListener('click',pMyMine);
var yw=pq('pn-slow');if(yw)yw.addEventListener('click',pMySlow);
var yc=pq('pn-chain');if(yc)yc.addEventListener('click',pMyChain);
window.pronOpen=function(){if(PN.loaded)return;PN.loaded=true;pLoad();};
/* **离开这一块时必须叫一次**（2026-11-11 审查 🔴1）。
   admin-page.ts 的 route() 切走一级菜单时只把 #v-work 藏起来，
   **不会通知这一块**——于是他点完「照镜子」随手切到「基金观察」，
   手机上的摄像头指示灯一直亮着，页面上却什么都看不见；450ms 的切换动画也在后台空转。
   页面上那句「关掉镜子，摄像头指示灯就灭」必须是真的，所以切走 = 关掉。 */
window.pronStop=function(){
  if(!PN.loaded)return;
  pMirOff();if(PN.mo.on)pAnimStop();
  pPlayReset();
  try{if(PN.player)PN.player.pause();}catch(e){}
};
/* 切到别的标签页 / 锁屏 / 最小化：同样关掉（兜底，route() 管不到这些） */
try{document.addEventListener('visibilitychange',function(){
  if(document.hidden&&window.pronStop)window.pronStop();
});}catch(e){}
}catch(e){}
})();
`;

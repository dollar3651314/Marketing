/**
 * 英语练习"跨轮记忆"的页面片段（工作台 → 英语练习 #/work/english 最下面一块；服务端在 src/english-memory.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts、english-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 为什么另起一块、不并进 ENGLISH_MOD：那一块是**纯静态**的 8 条提示词（test/english.test.ts 第 6 组守着
 * "不调接口、没有 /api/"），一个字都不动；记忆这块要读写 D1，所以分开，id 是 w-engmem。
 * 二级菜单**一个位子都不加**（还是 7 项；公共工具还是 8 项，T-4 的上限）。
 *
 * 把用户当小白（agents #92）：
 *   - 三步就是三块，编号 1 / 2 / 3 摆在标题上，做完的那一步自己收起来；
 *   - **全程不用打字**：测词汇线一次一个词、两个大按钮（手机单手够得着，最小 44px 高）；
 *     第 3 步只要"粘"，粘多粘少都行；页面上不出现任何命令行。
 *   - **一个数**（跨轮回收成功率）单独一块摆在最上面，别的都放次要位置；
 *     还没有数据时写"还没有数据"，**不写 0%**（底线 3：不编造）。
 *   - 出错一律把服务器那两句话（出错 / 怎么办）原样显示出来，**不静默吞掉**（2026-11-03 的坑）。
 */
export const EM_CSS = `
.em .em-hero{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s4);margin:0 0 var(--s4);text-align:center}
.em .em-num{font-size:var(--fs-num);font-weight:700;line-height:1.1;color:var(--ink)}
.em .em-num.none{font-size:var(--fs-mod);color:var(--muted)}
.em .em-cap{font-size:var(--fs-aux);color:var(--muted);margin:var(--s1) 0 0}
.em .em-step{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s3) var(--s4);margin:0 0 var(--s3)}
.em .em-step.on{border-color:var(--teal);background:var(--teal-soft)}
.em .em-sh{display:flex;align-items:baseline;gap:var(--s2);flex-wrap:wrap;margin:0 0 var(--s2)}
.em .em-n{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--ink-2);background:var(--gray-soft);border-radius:6px;padding:2px 7px}
.em .em-t{font-size:var(--fs-body);font-weight:700}
.em .em-sub{font-size:var(--fs-aux);color:var(--muted)}
.em .em-word{font-size:26px;font-weight:700;text-align:center;margin:var(--s4) 0 var(--s1);word-break:break-word}
.em .em-zh{font-size:var(--fs-aux);color:var(--muted);text-align:center;margin:0 0 var(--s4)}
.em .em-two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)}
.em .em-two button{min-height:52px;font-size:var(--fs-body);font-weight:700}
.em .em-bar{height:6px;border-radius:3px;background:var(--gray-soft);overflow:hidden;margin:var(--s3) 0 var(--s1)}
.em .em-bar i{display:block;height:100%;background:var(--teal)}
.em .em-pre{font-family:var(--mono);font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;margin:var(--s3) 0 0;padding:var(--s3);background:var(--surface-2);border:1px solid var(--line);border-radius:8px;max-height:40vh;overflow:auto;max-width:100%}
.em textarea{width:100%;min-height:110px;font-family:var(--mono);font-size:12px;padding:var(--s3);border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);resize:vertical}
.em .em-row{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap;margin:var(--s2) 0 0}
.em .em-err{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap}
.em .em-ok{border:1px solid var(--ok);background:var(--ok-soft);color:var(--ok);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap}
.em .em-tip{font-size:var(--fs-aux);color:var(--muted);margin:var(--s2) 0 0}
.em .em-fmt{font-family:var(--mono);font-size:12px;line-height:1.6;white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:var(--s3);margin:var(--s2) 0 0;overflow-wrap:anywhere}
@media (max-width:420px){.em .em-two{grid-template-columns:1fr}}
`;

/** 工作台"英语练习"下面那一块：跨轮记忆（id 不进二级菜单，菜单还是 7 项） */
export const EM_MOD = `<section class="card mod em" id="w-engmem"><header class="mh"><h2>它记得住你</h2><span class="sp"></span><span class="aux">跨轮记忆</span></header>
<p class="lead"><span class="dot gray"></span><span>Gemini Live 每轮都从零开始——<b>上一轮你靠提示才说出来的句子，它永远不会再考你第二次</b>。</span><span class="soft">这一块补的就是这个。对话还是在 Gemini Live 里聊，我们只负责记住和出题。</span></p>
<div class="mbody">
  <div class="em-hero">
    <div class="em-num none" id="em-rate">读取中…</div>
    <p class="em-cap" id="em-rate-cap">跨轮回收成功率 · 到期被考、而且不给提示自己说对了的比例</p>
  </div>

  <div class="em-step" id="em-s1">
    <div class="em-sh"><span class="em-n">1</span><span class="em-t">先测一条词汇线</span><span class="sp"></span><span class="em-sub" id="em-s1-sub">只做一次</span></div>
    <p class="em-tip">一个一个看，<b>认识就点认识</b>，说不出中文意思就点不认识。不用打字，错了也没关系——它只是用来告诉 AI 该用哪些词。</p>
    <div id="em-quiz">
      <p class="em-word" id="em-word">—</p>
      <p class="em-zh" id="em-zh"></p>
      <div class="em-two">
        <button class="btn primary" type="button" id="em-yes">认识</button>
        <button class="btn" type="button" id="em-no">不认识</button>
      </div>
      <div class="em-bar"><i id="em-bar" style="width:0%"></i></div>
      <p class="em-sub" id="em-prog">0 / 0</p>
    </div>
    <div class="em-ok" id="em-s1-done" hidden></div>
  </div>

  <div class="em-step" id="em-s2">
    <div class="em-sh"><span class="em-n">2</span><span class="em-t">开始这一轮</span><span class="sp"></span><span class="em-sub" id="em-s2-sub"></span></div>
    <p class="em-tip">点一下，生成一段<b>带着你的记忆</b>的提示词：你的词汇线、今天该回收的句子、今天要教的 3～5 个新词，再加上原来那套规则。复制走，粘进 Gemini Live。</p>
    <div class="em-row">
      <button class="btn primary" type="button" id="em-start">开始这一轮</button>
      <button class="btn small primary" type="button" id="em-copy" data-for="em-prompt" hidden>复制</button>
      <span class="msg" id="em-s2-msg" role="status"></span>
    </div>
    <pre class="em-pre" id="em-prompt" hidden></pre>
    <div class="em-err" id="em-s2-err" hidden></div>
  </div>

  <div class="em-step" id="em-s3">
    <div class="em-sh"><span class="em-n">3</span><span class="em-t">聊完，把对话粘回来</span><span class="sp"></span><span class="em-sub">粘多粘少都行</span></div>
    <p class="em-tip">在 Gemini Live 里说一句 <code>done</code>，等它吐完收尾，然后<b>整段原样粘进下面的框</b>。我们只认里面 <code>#LOG</code> 到 <code>#END</code> 那一小块，别的内容一律忽略。</p>
    <textarea id="em-paste" placeholder="在这里粘整段对话（长按 → 粘贴）"></textarea>
    <div class="em-row"><button class="btn primary" type="button" id="em-save">存进来</button><span class="msg" id="em-s3-msg" role="status"></span></div>
    <div class="em-err" id="em-s3-err" hidden></div>
    <div class="em-ok" id="em-s3-ok" hidden></div>
    <details><summary class="em-sub">它该吐出来的那一块长什么样</summary><div class="em-fmt" id="em-fmt">#LOG
stuck: pitch, solidify, scope
helped: "I was wondering if you could cover the meeting." | "It requires a lot of time and money."
recalled: "I was wondering if you could cover the meeting." = yes | "It requires a lot of time and money." = no
new: mitigate, prioritize
counts: A=12 B=9 C=4
#END</div></details>
  </div>

  <p class="em-sub" id="em-mini"></p>
</div>
<details class="more"><summary>这一块到底在做什么 · 为什么是 1 / 3 / 7 轮</summary><div class="in">
  <p>这里<b>不做语音、不做对话引擎</b>，对话仍然在 Gemini Live 里进行。我们只做两件事：把你的词汇线和"欠考的句子"<b>留在轮与轮之间</b>，再把它们写进下一轮的提示词。</p>
  <p>你靠提示才说出来的句子，<b>第 1 次隔 1 轮、再隔 3 轮、再隔 7 轮</b>各考一次，三次都不给提示说对了才算学会。说不出来就退回第一档，下一轮重来。</p>
  <p>上面那个数只看<b>跨轮</b>：同一轮之内回收说对了，只能证明你刚才记住了，证明不了你学会了。</p>
  <p>全程不花钱：这一块不调任何 AI，只是存和拼字符串。</p></div></details></section>`;

/** 跨轮记忆那一块的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__engmemBase，例如 '/api/english/' */
export const EM_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.engmemOpen */
(function(){
try{
var EM={base:(window.__engmemBase||'/api/english/'),word:'',busy:false,loaded:false};
var eq=function(i){return document.getElementById(i)};
function eText(id,s){var e=eq(id);if(e)e.textContent=s}
function eShow(id,on){var e=eq(id);if(e)e.hidden=!on}
/* 出错一律把服务器那两句话原样摆出来，不吞掉（2026-11-03：报错被盖掉，他以为是额度用光） */
function eErr(id,j){var e=eq(id);if(!e)return;
  var s=(j&&(j['出错']||j.error))||'出错了';
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  e.textContent=s;e.hidden=false;}
function eJson(path,init){return fetch(EM.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok){var e=new Error(j['出错']||j.error||('出错了（'+r.status+'）'));e.j=j;throw e;}
    return j;
  });
});}
function ePost(path,body){return eJson(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});}

/* ---- 第 1 步：词汇线 ---- */
function eAsk(p){
  if(!p||!p['下一个']){EM.word='';return;}
  EM.word=p['下一个']['词'];
  eText('em-word',p['下一个']['词']);
  eText('em-zh',p['下一个']['中文']);
}
function eProgress(p){
  var 已=p['已答']||0,共=p['一共']||1;
  eText('em-prog',已+' / '+共);
  var b=eq('em-bar');if(b)b.style.width=Math.round(已*100/共)+'%';
  var 完=!!p['测完了'];
  eShow('em-quiz',!完);
  eShow('em-s1-done',完);
  if(完)eText('em-s1-done','词汇线测完了：你的线在「'+(p['线说明']||'')+'」这一档。往后每一轮的提示词都会告诉 AI 只用这个范围里的词。');
  var s1=eq('em-s1');if(s1)s1.classList.toggle('on',!完);
  var s2=eq('em-s2');if(s2)s2.classList.toggle('on',完);
  eText('em-s1-sub',完?'已完成':'只做一次 · 还剩 '+(共-已)+' 个');
}
function eAnswer(known){
  if(EM.busy||!EM.word)return;EM.busy=true;
  ePost('word',{word:EM.word,known:known}).then(function(j){
    EM.busy=false;eAsk(j);eProgress(j);if(j['测完了'])eState();
  },function(e){EM.busy=false;eErr('em-s2-err',e.j||{'出错':e.message});});
}

/* ---- 一个数 ---- */
function eRate(r){
  var e=eq('em-rate');if(!e)return;
  if(!r||r.rate===null||r.rate===undefined){
    e.className='em-num none';e.textContent='还没有数据';
    eText('em-rate-cap','跨轮回收成功率 · 跑完一轮、到期的句子被考过以后才会有这个数');
    return;
  }
  e.className='em-num';e.textContent=Math.round(r.rate*100)+'%';
  eText('em-rate-cap','跨轮回收成功率 · 到期被考 '+r.asked+' 句，不给提示说对 '+r.passed+' 句');
}

/* ---- 第 2 步 ---- */
function eStart(){
  if(EM.busy)return;EM.busy=true;
  eShow('em-s2-err',false);eText('em-s2-msg','生成中…');
  ePost('start',{}).then(function(j){
    EM.busy=false;eText('em-s2-msg','');
    eText('em-prompt',j['提示词']||'');
    eShow('em-prompt',true);eShow('em-copy',true);
    eText('em-s2-sub','第 '+j.n+' 轮 · 场景 '+(j['场景']||'')+(j['这轮要回收']?' · 回收 '+j['这轮要回收']+' 句':''));
  },function(e){EM.busy=false;eText('em-s2-msg','');eErr('em-s2-err',e.j||{'出错':e.message});});
}

/* ---- 第 3 步 ---- */
function eSave(){
  if(EM.busy)return;
  var t=eq('em-paste');if(!t)return;
  EM.busy=true;eShow('em-s3-err',false);eShow('em-s3-ok',false);eText('em-s3-msg','存进来…');
  ePost('log',{text:t.value||''}).then(function(j){
    EM.busy=false;eText('em-s3-msg','');
    var s=j['存下来了']||{};
    var lines=['第 '+j['轮次']+' 轮存好了：新句子 '+(s['新句子']||0)+' 句，生词 '+(s['生词']||0)+' 个，到期考了 '+(s['到期考了']||0)+' 句、说对 '+(s['说对了']||0)+' 句。'];
    (j['提醒']||[]).forEach(function(w){lines.push('· '+w)});
    var e=eq('em-s3-ok');if(e){e.textContent=lines.join('\\n');e.hidden=false;}
    t.value='';eRate(j['跨轮回收成功率']);eState();
  },function(e){EM.busy=false;eText('em-s3-msg','');eErr('em-s3-err',e.j||{'出错':e.message});});
}

/* ---- 复制：和 8 条提示词那块同一套兜底（先 clipboard，拿不到就隐藏 textarea + execCommand） ---- */
function emFallback(text){
  var ta=document.createElement('textarea');
  ta.value=text;ta.setAttribute('readonly','');
  ta.style.position='fixed';ta.style.top='0';ta.style.left='0';ta.style.opacity='0';ta.style.pointerEvents='none';
  document.body.appendChild(ta);
  ta.select();ta.setSelectionRange(0,text.length);
  var ok=false;
  try{ok=document.execCommand('copy');}catch(e){ok=false;}
  document.body.removeChild(ta);
  return ok;
}
function emFlash(btn,ok){
  if(btn.dataset.busy==='1')return;
  btn.dataset.busy='1';
  var old=btn.dataset.label||btn.textContent;
  btn.dataset.label=old;
  btn.textContent=ok?'已复制 \\u2713':'复制不了，长按选';
  setTimeout(function(){btn.textContent=old;btn.dataset.busy='';},2000);
}
function emCopy(btn){
  var src=document.getElementById(btn.dataset.for);
  if(!src)return;
  var text=src.textContent||'';
  var done=function(ok){emFlash(btn,ok);};
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){done(true);},function(){done(emFallback(text));});
      return;
    }
  }catch(e){}
  done(emFallback(text));
}

/* ---- 打开这一页时读一次 ---- */
function eState(){
  return eJson('state').then(function(j){
    eRate(j['跨轮回收成功率']);
    var v=j['词汇线']||{};eAsk(v);eProgress(v);
    var r=j['轮次']||{};
    var open=r['开着的轮'];
    if(open){
      eText('em-prompt',open['提示词']||'');eShow('em-prompt',true);eShow('em-copy',true);
      eText('em-s2-sub','第 '+open.n+' 轮开着 · 场景 '+(open['场景']||'')+' · 聊完回到第 3 步');
    }else{
      eText('em-s2-sub',v['测完了']?('下一轮是第 '+r['这一轮']+' 轮 · 到期要考 '+(j['到期要考']||0)+' 句'):'先把上面的词汇线测完');
    }
    eText('em-mini','已经跑过 '+(r['已经跑过']||0)+' 轮 · 库里 '+((j['句子']||{})['一共']||0)+' 句（毕业 '+((j['句子']||{})['毕业']||0)+' 句） · 还不认识 '+(j['不认识的词']||0)+' 个词');
  },function(e){eErr('em-s2-err',e.j||{'出错':e.message});});
}

var y=eq('em-yes');if(y)y.addEventListener('click',function(){eAnswer(true)});
var n=eq('em-no');if(n)n.addEventListener('click',function(){eAnswer(false)});
var st=eq('em-start');if(st)st.addEventListener('click',eStart);
var sv=eq('em-save');if(sv)sv.addEventListener('click',eSave);
var cp=eq('em-copy');if(cp)cp.addEventListener('click',function(){emCopy(cp)});
window.engmemOpen=function(){if(EM.loaded)return;EM.loaded=true;eState();};
}catch(e){}
})();
`;

/* S2 句子训练台的那一屏。
 *
 * 和 S1「跟我做」同一个规矩，Amos 2026-11-12 原话：
 * 「不要让我思考 不要让我自己组装 你要带着我做 把用户当成小白」
 *   —— 一屏只有一步，他做完点一下才给下一句。
 *
 * **页面上的每一句话，要么来自 LESSON 的字段，要么是纯界面用语（按钮名、第几步）。**
 * 不许在这里写任何一句关于语法的讲解 —— 那些字全部来自课件，由 s2-lesson.ts 生成。
 *
 * 样式用工作台整站的设计变量（:root 的 --ink / --line / --teal / --fs-* 那一套），深浅色跟着全站走。
 * 2026-11-13 从 Practical 仓库搬进来（Amos：「把它合并到 marketing 项目中吧」）；拆分清单在 src/english.ts。
 */
import { audioKey, 是英文, 中文声音, 英文声音, 指令文本 } from './en-audio';
import { 生成, type 步 } from './s2-lesson';

/**
 * 页面要的那份阶梯：课件生成的每一步，再挂两个**语音的键**（打包时就算好，和脚本生成用的是同一个 audioKey）。
 *  - `说键`：这一句中文指令（晓晓念）；
 *  - `大键`：大字那一行**只有是英文时**才有（课件的英文例句，Sonia 念）；中文的大字标题没有键，页面上也就没有那个按钮。
 * 取不到声音时页面**照实说**，不假装在念（底线 3）。
 */
export const S2_DATA = 生成().map((课) => ({
  ...课,
  步: 课.步.map((s) => ({
    ...s,
    说键: audioKey(指令文本(s), 中文声音),
    大键: s.大 && 是英文(s.大) ? audioKey(s.大, 英文声音) : '',
  })),
}));

/**
 * 句子训练那一块的**样式和结构**（工作台 → Practical 项目页 `#/Practical/s2`，模块 `#f-s2`）。
 *
 * 2026-11-13 从 Practical 仓库整块搬进 Marketing（Amos：「把它合并到 marketing 项目中吧」
 * 「学习内容和进度无缝的显示在 工作台 Practical项目页面中」）。搬过来只改了两件事：
 *  ① 外面套上工作台的模块壳（`.card.mod` → `header.mh` → `.lead` → `.mbody` → `details.more`），和项目页别的模块同一个形状；
 *  ② 字号、颜色改用工作台的设计变量和字号阶梯（12 / 13 / 15 / 17 / 18，控件 14），
 *     深浅色跟着整站的 `:root` 走，不再自己写一套 `prefers-color-scheme`。
 * **一句关于语法的话都没有动**：屏幕上的字还是只有三种来源（课件原文 / 按课件规则推出 / 界面用语）。
 *
 * 写法上的约定（和 admin-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 */
export const S2_MOD = `
<section class="card mod" id="f-s2">
<header class="mh"><h2>句子训练</h2><span class="sp"></span><span class="aux">S2 · 13 课</span></header>
<p class="lead"><span class="dot gray"></span><span>13 课 · 一屏一步 · 每一句都标出处</span></p>
<div class="mbody">
<style>
.s2{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:var(--s3);line-height:1.65;color:var(--ink)}
.s2 .s2-pick{display:flex;align-items:center;gap:var(--s2);font-size:var(--fs-aux);color:var(--muted)}
.s2 .s2-pick #s2-now{font-weight:600;color:inherit}
.s2 .s2-swap{margin-left:auto;font:inherit;font-size:13px;padding:7px 12px;border-radius:var(--r-btn);
  border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;min-height:40px}
.s2 .s2-swap:hover{border-color:var(--teal);color:var(--teal-ink)}
.s2 .s2-cards{display:flex;flex-wrap:wrap;gap:var(--s2)}
/* [hidden] 的 UA 默认是 display:none，但上面那条 .s2-cards{display:flex} 具体度更高，会把它盖掉
   —— 属性设了、人还看得见。2026-11-12 就是这么漏过去的，截图里课卡片明明收起了却还在屏幕上。 */
.s2 .s2-cards[hidden]{display:none}
/* 13 课清单（2026-11-15）：一行一课，带这一课走完几步、走完的打勾。
   点一行**落到那一课第一个没走完的步**，不是第 1 步 —— 走到一半的课不用自己往前翻。 */
.s2 .s2-cards{flex-direction:column;flex-wrap:nowrap}
.s2 .s2-card{flex:1 1 auto;min-width:0;border:1px solid var(--line);border-radius:11px;
  background:var(--surface);color:inherit;padding:11px 12px;cursor:pointer;min-height:56px;text-align:left;font:inherit;
  display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 10px}
.s2 .s2-card .s2-c-tick{grid-row:1/3;font-size:18px;line-height:1;width:22px;text-align:center;color:var(--muted)}
.s2 .s2-card.s2-c-done .s2-c-tick{color:var(--ok)}
.s2 .s2-card .s2-c-n{font-weight:700;white-space:nowrap}
.s2 .s2-card .s2-c-k{font-size:12px;color:var(--muted);white-space:nowrap}
.s2 .s2-card .s2-c-name{grid-column:2/4;font-size:12px;color:var(--muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s2 .s2-card b{display:block;font-size:var(--fs-body)}
.s2 .s2-card span{display:block;font-size:12px;color:var(--muted);margin-top:2px}
.s2 .s2-card[aria-pressed="true"]{border-color:var(--teal);color:var(--teal-ink)}
.s2 .s2-box{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);
  padding:18px 16px;display:flex;flex-direction:column;gap:var(--s3);min-width:0}
.s2 .s2-lv{font-size:12px;color:var(--teal-ink);font-weight:600;margin:0}
.s2 .s2-ask{font-size:var(--fs-mod);font-weight:600;line-height:1.5;margin:0;overflow-wrap:anywhere}
.s2 .s2-big{font-size:18px;line-height:1.6;margin:0;overflow-wrap:anywhere}
.s2 .s2-li{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-size:var(--fs-body)}
.s2 .s2-t{width:100%;border-collapse:collapse;font-size:var(--fs-aux)}
.s2 .s2-t th,.s2 .s2-t td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.s2 .s2-tw{overflow-x:auto;min-width:0}
.s2 .s2-src{background:var(--surface-2);border-left:3px solid var(--teal);border-radius:0 8px 8px 0;
  padding:9px 11px;font-size:12px;color:var(--muted);margin:0;overflow-wrap:anywhere}
.s2 .s2-src b{color:var(--ink-2);font-weight:600}
.s2 .s2-btns{display:flex;flex-direction:column;gap:9px}
/* 声音那两个按钮：一行放得下就并排，放不下就换行（字长的「这一句的朗读还没生成」允许换行） */
.s2 .s2-say{display:flex;flex-wrap:wrap;gap:9px}
.s2 .s2-say .s2-b{flex:1 1 calc(50% - 9px);min-width:0;font-size:15px;min-height:52px;text-align:center}
.s2 .s2-saymsg{font-size:12px;color:var(--err);line-height:1.6;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.s2 .s2-b{font:inherit;font-size:17px;padding:14px 16px;border-radius:11px;border:1px solid var(--line);
  background:var(--surface);color:inherit;cursor:pointer;min-height:52px;text-align:left;
  white-space:normal;overflow-wrap:anywhere;line-height:1.3}
.s2 .s2-b:hover{border-color:var(--teal)}
.s2 .s2-b:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.s2 .s2-b.p{background:var(--teal);border-color:var(--teal);color:#06302B;font-weight:700;text-align:center}
.s2 .s2-b.g{font-size:14px;min-height:44px;color:var(--muted);text-align:center}
/* 门面：一打开先看见"接着练到哪"，不是第 1 课第 1 步（2026-11-15 加存档那一批） */
.s2 .s2-go{border:1px solid var(--line);border-radius:var(--r-card);background:var(--surface);
  padding:14px 16px;display:flex;flex-direction:column;gap:var(--s2)}
.s2 .s2-go-t{margin:0;font-size:18px;font-weight:700;line-height:1.4}
.s2 .s2-go-s{margin:0;font-size:12px;color:var(--muted)}
/* 存档没取到时照实说，**不装作存上了**（底线 3、底线 9） */
.s2 .s2-go-w{margin:0;font-size:13px;color:var(--ink-2)}
.s2 .s2-go-b{display:flex;flex-wrap:wrap;gap:var(--s2)}
.s2 .s2-go-b .s2-b{flex:1 1 auto}
.s2 .s2-meter{display:flex;align-items:center;gap:var(--s3);font-size:12px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.s2 .s2-bar{flex:1;height:5px;border-radius:3px;background:var(--gray-soft);overflow:hidden;min-width:0}
.s2 .s2-bar i{display:block;height:100%;background:var(--teal)}
.s2 .s2-bad{border:1.5px solid var(--err)}
.s2 .s2-bad .s2-ask{color:var(--err)}
.s2 .s2-done .s2-ask{color:var(--ok)}
</style>
<div class="s2" id="s2">
  <!-- 门面：接着练到第几步 + 总进度 + 错题重练。**存档取到之前整块藏着**，不先闪一个假数字 -->
  <div class="s2-go" id="s2-go" hidden>
    <p class="s2-go-t" id="s2-go-t"></p>
    <div class="s2-meter"><span id="s2-all">—</span><span class="s2-bar"><i id="s2-allf" style="width:0%"></i></span></div>
    <div class="s2-go-b"><button type="button" class="s2-b p" id="s2-go-on"></button><button type="button" class="s2-b g" id="s2-go-err" hidden></button></div>
    <p class="s2-go-w" id="s2-go-w" hidden></p>
  </div>
  <div class="s2-pick"><span id="s2-now">第 1 课</span><button type="button" class="s2-swap" id="s2-swap" aria-expanded="false">13 课清单</button></div>
  <div class="s2-cards" id="s2-cards" hidden></div>
  <div class="s2-box" id="s2-step"></div>
  <p class="s2-saymsg" id="s2-saymsg" hidden></p>
  <div class="s2-meter"><span id="s2-num">—</span><span class="s2-bar"><i id="s2-barf" style="width:0%"></i></span></div>
</div>
</div>
<details class="more"><summary>这些字是哪来的</summary><div class="in">
<p>两种出处：<b>课件原文</b>；<b>按课件规则推出</b>。</p>
<p>课件 182 道练习，一道答案都没给（老师课上口头讲）。</p>
<p>推不出来的，不出题。</p>
<p><b>念给我听</b>和<b>听这一句</b>用的是微软 Edge「大声朗读」背后的神经网络语音（中文 晓晓、英文 Sonia，语速都慢 5%），<b>提前生成好存在服务器上</b>，点一下就放，<b>一次 AI 都不调、一分钱不花</b>。还没生成的那几句会<b>当面说"还没生成"</b>，不会假装在念。</p>
</div></details>
</section>`;

/**
 * 句子训练那一块的脚本。整段包在一个函数里：**和后台那几段脚本共用一个全局作用域**，
 * 名字不能和别人重复声明（和 PRON_JS 同一个做法）；只往外露一个 window.s2Draw。
 * 阶梯是 `src/s2-lesson.ts` 按课件原文生成的**静态课件内容**，打包时序列化成 JSON 拼进来：不走接口、不读库、不调 AI、不花一分钱。
 */
export const S2_JS = `
(function(){try{
var S2 = ${JSON.stringify(S2_DATA)};
var s2 = { 课: 1, i: 0, 错: null, 完: false, 存: null, 存坏了: '', 重练: null };
var s2sbase=(window.__s2Base||'/api/en/s2/');
function s2q(id){return document.getElementById(id);}
function s2el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function s2btn(t,c,fn){var b=s2el('button',c||'s2-b',t);b.type='button';b.addEventListener('click',fn);return b;}
function s2本(){for(var i=0;i<S2.length;i++)if(S2[i]['课']===s2.课)return S2[i];return S2[0];}
function s2步(){return s2本()['步'][s2.i]||null;}

/* ---- 存档（2026-11-15）。在这之前这一屏**什么都不记**：关掉页面下次从第 1 课第 1 步重来，
   126 步的东西没有存档是硬伤。现在每走完一步就存一行，打开先看见「接着练到第几步」。
   存的是 D1 的 en_done 表（和发音训练同一张，靠键前缀 s2: / s2x: 分家），不新建表。
   **存不上就当面说**，不假装存上了（底线 3、底线 9）。 ---- */
function s2存坏(什么,j){
  var t=什么;
  if(j&&j['出错'])t+=' '+j['出错'];
  if(j&&j['怎么办'])t+=' 怎么办：'+j['怎么办'];
  s2.存坏了=t;s2门面();
}
function s2收存(x){
  if(!x.ok){s2存坏(s2.存?'这一步没存上。屏幕上的进度可能不准，刷新一下再看。':'存档没取到。还能照常练，但这一次的进度不会存。',x.j);return;}
  s2.存=x.j;s2.存坏了='';s2门面();s2画课();
  /* 最后一步的存档是**后**到的：这时正停在"走完了"那一屏，上面「接着练：第 N 课 第 M 步」
     写的还是旧的一步。只在这一屏重画（重练那一屏不碰，免得他正答到一半被刷掉）。 */
  if(s2.完&&!s2.重练)s2画();
}
function s2拿(路,选){
  return fetch(s2sbase+路,选).then(function(r){
    return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});
  });
}
function s2取存(){
  s2拿('state',{headers:{'accept':'application/json'}}).then(s2收存,function(e){
    s2存坏('存档没取到。还能照常练，但这一次的进度不会存。',{'出错':'没连上服务器（'+e.message+'）。'});
  });
}
/* 走完一步 / 答错一题就记一笔。规则步不传"对"（规则答不了错）。 */
function s2记(课,步,对,来自){
  if(!s2.存&&s2.存坏了)return;            /* 开场就没取到，不反复去撞 */
  var b={'课':课,'步':步};
  if(对===true||对===false)b['对']=对;
  if(来自)b['来自']=来自;
  s2拿('step',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})
    .then(s2收存,function(e){s2存坏('这一步没存上。屏幕上的进度可能不准，刷新一下再看。',{'出错':'没连上服务器（'+e.message+'）。'});});
}
/* 门面：接着练到第几步、总进度、错题重练。**存档取到之前整块藏着**，不先闪一个假的 0%。 */
function s2门面(){
  var box=s2q('s2-go');if(!box)return;
  var t=s2q('s2-go-t'),all=s2q('s2-all'),f=s2q('s2-allf'),on=s2q('s2-go-on'),er=s2q('s2-go-err'),w=s2q('s2-go-w');
  if(!s2.存&&!s2.存坏了){box.hidden=true;return;}
  box.hidden=false;
  if(w){if(s2.存坏了){w.textContent=s2.存坏了;w.hidden=false;}else{w.textContent='';w.hidden=true;}}
  if(!s2.存){
    t.textContent='存档没取到';
    all.textContent='—';f.style.width='0%';
    on.textContent='从第 1 课开始练';on.onclick=function(){s2跳(1,1);};
    er.hidden=true;return;
  }
  var j=s2.存['小结']||{},接=s2.存['接着练'],错=s2.存['错题']||[];
  all.textContent='走完 '+(j['走完了']||0)+' / '+(j['一共']||0)+' 步';
  f.style.width=(j['百分之几']||0)+'%';
  if(接){
    t.textContent='接着练：第 '+接['课']+' 课 第 '+接['步']+' 步';
    on.textContent='接着练';   /* 第几步已经在上面那行标题和进度条里写过了，按钮不重复第三遍 */
    on.onclick=function(){s2跳(接['课'],接['步']);};
  }else{
    t.textContent='13 课 '+(j['一共']||0)+' 步全走完了。';
    on.textContent='从第 1 课再走一遍';on.onclick=function(){s2跳(1,1);};
  }
  if(错.length){er.hidden=false;er.textContent='错题重练（'+错.length+' 道）';er.onclick=s2重练开始;}
  else{er.hidden=true;er.textContent='';}
}
function s2跳(课,步){
  s2.重练=null;s2.错=null;s2.完=false;s2.课=课;s2.i=步-1;s2画();
  try{s2q('s2-step').scrollIntoView({block:'start'});}catch(e){}
}

/* 课的卡片**默认收起**：一打开屏幕上先是"要做的那一步"，不是让他先挑课。
   （Amos 2026-11-12：「不要让我思考 不要让我自己组装 你要带着我做」） */
/* 这一课的进度（存档里的那份）。没取到存档就回 null —— **不假装他走完了几步** */
function s2课进度(课){
  var m=(s2.存&&s2.存['每课'])||[];
  for(var i=0;i<m.length;i++)if(m[i]['课']===课)return m[i];
  return null;
}
function s2画课(){
  var now=s2q('s2-now');
  if(now)now.textContent='第 '+s2.课+' 课 · 共 '+s2本()['步'].length+' 步';
  var box=s2q('s2-cards');if(!box)return;box.textContent='';
  S2.forEach(function(c){
    var p=s2课进度(c['课']),走完=p?p['走完了']:0,一共=c['步'].length;
    var 整课走完了=!!p&&p['下一步']===null;
    var b=s2el('button','s2-card'+(整课走完了?' s2-c-done':''));b.type='button';
    /* 勾只在**真走完整课**时给。取不到存档时一律空框，不画一个看着像做完的勾（底线 3） */
    b.appendChild(s2el('span','s2-c-tick',整课走完了?'☑':'☐'));
    b.appendChild(s2el('span','s2-c-n','第 '+c['课']+' 课'));
    b.appendChild(s2el('span','s2-c-k',p?(走完+' / '+一共+' 步'):(一共+' 步')));
    if(c['名'])b.appendChild(s2el('span','s2-c-name',c['名']));
    b.setAttribute('aria-pressed',c['课']===s2.课?'true':'false');
    b.setAttribute('aria-label','第 '+c['课']+' 课'+(c['名']?'，'+c['名']:'')+(p?('，走完 '+走完+' / '+一共+' 步'):('，共 '+一共+' 步')));
    b.addEventListener('click',function(){
      s2收起();
      /* **落到这一课第一个没走完的步**，不是第 1 步。整课走完了就从头重走。 */
      var 到=(p&&p['下一步'])||1;
      s2跳(c['课'],到);
    });
    box.appendChild(b);
  });
}
function s2收起(){
  var box=s2q('s2-cards'),sw=s2q('s2-swap');
  if(box)box.hidden=true;
  if(sw)sw.setAttribute('aria-expanded','false');
}
function s2换课(){
  var box=s2q('s2-cards'),sw=s2q('s2-swap');
  if(!box)return;
  box.hidden=!box.hidden;
  if(sw)sw.setAttribute('aria-expanded',box.hidden?'false':'true');
}

/* 出处那一行：先标这句话是哪一类（课件原文 / 按课件规则推出），再把依据原文照抄。
   依据本身就是那几个字开头的（"课件原文（第 1 课 · 第 4 页）"）就不写第二遍 ——
   屏幕上出现过"课件原文 课件原文（第 1 课 · 第 4 页）"。 */
/* ---- 声音：全部是**预先生成好**存在 D1 里的（中文 晓晓、英文 Sonia，语速 -5%），
   这里只取、只放，**一次 AI 都不调**。库里没有那一条 → **当面照实说**，不假装在念（底线 3）。
   2026-11-13 之前 S2 这一屏根本没有声音，S1「跟我做」那边用的是浏览器自带的朗读
   —— Amos 原话嫌手机朗读太机械，所以两边一起换成了同一套预先生成的语音。 ---- */
var s2au={},s2busy={},s2player=null;
var s2base=(window.__enAudioBase||'/api/en/audio/');
function s2msg(t){var m=s2q('s2-saymsg');if(!m)return;if(!t){m.hidden=true;m.textContent='';return;}m.textContent=t;m.hidden=false;}
function s2放(url){
  try{
    if(!s2player)s2player=new Audio();
    var a=s2player;a.pause();a.src=url;
    var pr=a.play();
    /* 连着点两下必然打断前一次，前一次以 AbortError 被拒 —— **那不是错**，不许蹦假错误 */
    if(pr&&pr.catch)pr.catch(function(e){if(e&&e.name==='AbortError')return;s2msg('浏览器把这次播放挡住了。再点一下这个按钮就会响。');});
  }catch(e){s2msg('这台设备放不了这段声音。');}
}
function s2声(key,什么){
  if(!key){s2msg(什么+'还没生成（这一步没有对应的语音编号）。照着屏幕上的字做就行。');return;}
  s2msg('');
  if(s2au[key]){s2放(s2au[key]);return;}
  if(s2busy[key])return;
  s2busy[key]=1;
  var done=function(){delete s2busy[key];};
  fetch(s2base+encodeURIComponent(key)).then(function(r){
    var ct=r.headers.get('content-type')||'';
    if(!r.ok||ct.indexOf('audio')<0){
      return r.json().catch(function(){return {}}).then(function(j){
        done();
        var t=什么+'还没生成，这一次先跳过声音（上面的字照常看）。';
        if(j&&j['出错'])t+='\\n'+j['出错'];
        if(j&&j['怎么办'])t+='\\n怎么办：'+j['怎么办'];
        s2msg(t);
      });
    }
    return r.blob().then(function(b){done();s2msg('');var u=URL.createObjectURL(b);s2au[key]=u;s2放(u);});
  },function(e){done();s2msg(什么+'没取到：没连上服务器（'+e.message+'）。等一下再点一次。');});
}
/* 这一步的两个声音按钮：中文那一句永远有；英文大字那一句只有大字真是英文时才给（中文标题不给） */
function s2声按钮(box,s){
  var row=s2el('div','s2-say');
  row.appendChild(s2btn('🔈 念给我听','s2-b',function(){s2声(s['说键'],'这一句的朗读');}));
  if(s['大键'])row.appendChild(s2btn('🔊 听这一句英文','s2-b',function(){s2声(s['大键'],'这一句英文的发音');}));
  box.appendChild(row);
}

function s2依据(box,s){
  var p=s2el('p','s2-src');
  if(s['依据'].indexOf(s['类'])!==0)p.appendChild(s2el('b',null,s['类']+'　'));
  p.appendChild(document.createTextNode(s['依据']));
  box.appendChild(p);
}

function s2画(){
  if(s2.重练){s2画重练();return;}
  s2画课();
  /* 换一步就把上一步那条"还没生成"的话收掉：留着会让人以为说的是这一步 */
  s2msg('');
  var box=s2q('s2-step');if(!box)return;
  box.className='s2-box';box.textContent='';
  var c=s2本(),n=c['步'].length;

  if(!n){
    box.appendChild(s2el('p','s2-ask','这一课课件里没有能出成题的内容。'));
    box.appendChild(s2el('p','s2-src','课件这一课全是空格练习，一道答案都没给 —— 不替它编。换一课。'));
    s2q('s2-num').textContent='这一课 0 步';s2q('s2-barf').style.width='0%';
    return;
  }
  if(s2.完){
    box.className='s2-box s2-done';
    box.appendChild(s2el('p','s2-ask','第 '+s2.课+' 课走完了。'));
    /* **接着练下一步**：不给这个按钮的话，第 1 课（4 步全是规则）走完只剩「再走一遍」，
       他得自己去点「换一课」—— 126 步就连不起来了。接着练去哪由存档算（跨课）。 */
    var 接=s2.存&&s2.存['接着练'];
    if(接)box.appendChild(s2btn('接着练：第 '+接['课']+' 课 第 '+接['步']+' 步','s2-b p',function(){s2跳(接['课'],接['步']);}));
    else if(s2.存)box.appendChild(s2el('p','s2-src','13 课 '+((s2.存['小结']||{})['一共']||0)+' 步全走完了。'));
    box.appendChild(s2btn('这一课再走一遍',接?'s2-b g':'s2-b p',function(){s2.i=0;s2.完=false;s2.错=null;s2画();}));
    s2q('s2-num').textContent='第 '+n+' / 共 '+n+' 步';s2q('s2-barf').style.width='100%';
    return;
  }

  var s=s2步();
  if(s2.错){
    box.className='s2-box s2-bad';
    box.appendChild(s2el('p','s2-lv','选错了'));
    box.appendChild(s2el('p','s2-ask',s2.错));
    s2依据(box,s);
    box.appendChild(s2btn('再看一遍规则，重选','s2-b p',function(){s2.错=null;s2画();}));
  } else if(s['类型']==='规则'){
    box.appendChild(s2el('p','s2-lv','第 '+s2.课+' 课 · 规则'));
    box.appendChild(s2el('p','s2-ask',s['说']));
    box.appendChild(s2el('p','s2-big',s['大']));
    if(s['条']&&s['条'].length){
      var ul=s2el('ul','s2-li');
      s['条'].forEach(function(t){ul.appendChild(s2el('li',null,t));});
      box.appendChild(ul);
    }
    if(s['表'])box.appendChild(s2表(s['表']));
    s2声按钮(box,s);
    s2依据(box,s);
    box.appendChild(s2btn('记住了，下一步','s2-b p',s2下));
  } else {
    box.appendChild(s2el('p','s2-lv','第 '+s2.课+' 课 · 做一道'));
    box.appendChild(s2el('p','s2-ask',s['说']));
    box.appendChild(s2el('p','s2-big',s['大']));
    var btns=s2el('div','s2-btns');
    s['选'].forEach(function(o){
      btns.appendChild(s2btn(o,'s2-b',function(){
        if(o===s['答']){s2下();}
        else{s2记(s2.课,s2.i+1,false,null);s2.错='这个不对。按课件那条规则再看一遍：'+s['依据'];s2画();}
      }));
    });
    box.appendChild(btns);
    s2声按钮(box,s);
    s2依据(box,s);
  }
  if(s2.i>0&&!s2.错)box.appendChild(s2btn('上一步','s2-b g',function(){s2.i--;s2画();}));
  s2q('s2-num').textContent='第 '+(s2.i+1)+' / 共 '+n+' 步';
  s2q('s2-barf').style.width=Math.round((s2.i+1)*100/n)+'%';
}

function s2表(t){
  var w=s2el('div','s2-tw'),tb=s2el('table','s2-t');
  if(t['表头']&&t['表头'].length){
    var tr=s2el('tr');
    t['表头'].forEach(function(h){tr.appendChild(s2el('th',null,h));});
    tb.appendChild(tr);
  }
  (t['行']||[]).forEach(function(r){
    var tr=s2el('tr');
    r.forEach(function(d){tr.appendChild(s2el('td',null,d));});
    tb.appendChild(tr);
  });
  w.appendChild(tb);return w;
}

/* ---- 错题重练：**第一次就答错**的那些题，隔一阵再考一次。
   为什么只认"第一次"：代练里答错会退回去重看规则、重选，他最后一定是选对才往下走的，
   要是答对就销账，这一组永远是空的。只有在这一屏里再答对才销（服务端 来自:'错题重练'）。 ---- */
function s2重练本(){var r=s2.重练;return (r&&r.队[r.j])||null;}
function s2重练开始(){
  var 错=(s2.存&&s2.存['错题'])||[];
  if(!错.length)return;
  s2.重练={队:错.slice(),j:0};s2.错=null;s2.完=false;
  s2画();
  try{s2q('s2-step').scrollIntoView({block:'start'});}catch(e){}
}
/* 从错题重练回来：**回到接着练那一步**。不这么写的话，他会被留在最后那道错题所在的课中间，
   莫名其妙停在第 6 课，而门面上写着接着练第 2 课 —— 两边对不上。 */
function s2收工(){
  s2.重练=null;s2.错=null;s2.完=false;
  var 接=s2.存&&s2.存['接着练'];
  if(接){s2.课=接['课'];s2.i=接['步']-1;}
  s2画();
}
function s2画重练(){
  var box=s2q('s2-step');if(!box)return;
  s2msg('');
  var r=s2.重练,一共=r.队.length,当=s2重练本();
  box.className='s2-box';box.textContent='';
  if(!当){
    box.className='s2-box s2-done';
    box.appendChild(s2el('p','s2-ask','错题重练走完了，'+一共+' 道都过了一遍。'));
    box.appendChild(s2btn('回去接着练','s2-b p',s2收工));
    s2q('s2-num').textContent='错题重练 '+一共+' / '+一共+' 道';
    s2q('s2-barf').style.width='100%';
    return;
  }
  s2.课=当['课'];s2.i=当['步']-1;
  s2画课();
  var s=s2步();
  /* 不该发生（服务端已经滤过规则步）。真碰上就跳过这一道，**不在屏幕上编一道题出来**（底线 3） */
  if(!s||s['类型']!=='题'){r.j++;s2画重练();return;}
  if(s2.错){
    box.className='s2-box s2-bad';
    box.appendChild(s2el('p','s2-lv','还是不对'));
    box.appendChild(s2el('p','s2-ask',s2.错));
    s2依据(box,s);
    box.appendChild(s2btn('再看一遍规则，重选','s2-b p',function(){s2.错=null;s2画();}));
  }else{
    box.appendChild(s2el('p','s2-lv','错题重练 · 第 '+(r.j+1)+' / '+一共+' 道（第 '+当['课']+' 课）'));
    box.appendChild(s2el('p','s2-ask',s['说']));
    box.appendChild(s2el('p','s2-big',s['大']));
    var btns=s2el('div','s2-btns');
    s['选'].forEach(function(o){
      btns.appendChild(s2btn(o,'s2-b',function(){
        if(o===s['答']){s2记(当['课'],当['步'],true,'错题重练');r.j++;s2.错=null;s2画();}
        else{s2记(当['课'],当['步'],false,'错题重练');s2.错='这个不对。按课件那条规则再看一遍：'+s['依据'];s2画();}
      }));
    });
    box.appendChild(btns);
    s2声按钮(box,s);
    s2依据(box,s);
  }
  box.appendChild(s2btn('先不练了，回去','s2-b g',s2收工));
  s2q('s2-num').textContent='错题重练 第 '+(r.j+1)+' / '+一共+' 道';
  s2q('s2-barf').style.width=Math.round(r.j*100/一共)+'%';
}

function s2下(){
  var n=s2本()['步'].length,s=s2步();
  /* 走完这一步就存一笔。题步顺带告诉服务端"这次是答对的"，规则步不传对错（规则答不了错） */
  if(s)s2记(s2.课,s2.i+1,s['类型']==='题'?true:null,null);
  s2.错=null;
  if(s2.i+1<n){s2.i++;}else{s2.完=true;}
  s2画();
}
var s2sw=s2q('s2-swap');if(s2sw)s2sw.addEventListener('click',s2换课);
window.s2Draw=s2画;
/* 存档只在**项目页真的打开时**拉一次（和 window.pronOpen 同一个做法）：
   工作台别的页面不该为这一块多跑一趟接口 */
window.s2Open=function(){if(s2.loaded)return;s2.loaded=true;s2取存();};
}catch(e){}})();
`;

export type { 步 };

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
.s2 .s2-card{flex:1 1 150px;min-width:0;border:1px solid var(--line);border-radius:11px;
  background:var(--surface);color:inherit;padding:11px 12px;cursor:pointer;min-height:56px;text-align:left;font:inherit}
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
.s2 .s2-meter{display:flex;align-items:center;gap:var(--s3);font-size:12px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.s2 .s2-bar{flex:1;height:5px;border-radius:3px;background:var(--gray-soft);overflow:hidden;min-width:0}
.s2 .s2-bar i{display:block;height:100%;background:var(--teal)}
.s2 .s2-bad{border:1.5px solid var(--err)}
.s2 .s2-bad .s2-ask{color:var(--err)}
.s2 .s2-done .s2-ask{color:var(--ok)}
</style>
<div class="s2" id="s2">
  <div class="s2-pick"><span id="s2-now">第 1 课</span><button type="button" class="s2-swap" id="s2-swap" aria-expanded="false">换一课</button></div>
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
var s2 = { 课: 1, i: 0, 错: null, 完: false };
function s2q(id){return document.getElementById(id);}
function s2el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function s2btn(t,c,fn){var b=s2el('button',c||'s2-b',t);b.type='button';b.addEventListener('click',fn);return b;}
function s2本(){for(var i=0;i<S2.length;i++)if(S2[i]['课']===s2.课)return S2[i];return S2[0];}
function s2步(){return s2本()['步'][s2.i]||null;}

/* 课的卡片**默认收起**：一打开屏幕上先是"要做的那一步"，不是让他先挑课。
   （Amos 2026-11-12：「不要让我思考 不要让我自己组装 你要带着我做」） */
function s2画课(){
  var now=s2q('s2-now');
  if(now)now.textContent='第 '+s2.课+' 课 · 共 '+s2本()['步'].length+' 步';
  var box=s2q('s2-cards');if(!box)return;box.textContent='';
  S2.forEach(function(c){
    var b=s2el('button','s2-card');b.type='button';
    b.appendChild(s2el('b',null,'第 '+c['课']+' 课'));
    b.appendChild(s2el('span',null,c['步'].length+' 步'));
    b.setAttribute('aria-pressed',c['课']===s2.课?'true':'false');
    b.addEventListener('click',function(){
      s2收起();
      if(s2.课===c['课'])return;
      s2.课=c['课'];s2.i=0;s2.错=null;s2.完=false;s2画();
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
    box.appendChild(s2btn('再走一遍','s2-b p',function(){s2.i=0;s2.完=false;s2.错=null;s2画();}));
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
        else{s2.错='这个不对。按课件那条规则再看一遍：'+s['依据'];s2画();}
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

function s2下(){
  var n=s2本()['步'].length;
  s2.错=null;
  if(s2.i+1<n){s2.i++;}else{s2.完=true;}
  s2画();
}
var s2sw=s2q('s2-swap');if(s2sw)s2sw.addEventListener('click',s2换课);
window.s2Draw=s2画;
}catch(e){}})();
`;

export type { 步 };

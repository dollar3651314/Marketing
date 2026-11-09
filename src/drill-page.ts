/**
 * 工作台「带练」的页面片段（工作台 → 带练 `#/work/drill`，模块 `#w-drill`；服务端在 src/drill.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts、english-page.ts、english-memory-page.ts 一样）：
 * 这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * **二级菜单从 7 项变 8 项**（Amos 批的上限就是 8）：工作台加了「带练」这一项；
 * **公共工具那 8 项一个都没动**（T-4 守着上限，第 9 项会撑破手机菜单）。
 *
 * 三步交互（src/drill.ts 文件头写了为什么）：先回想 → 揭晓 → 自己判。
 *   ① 卡片上**只有中文**（第一段中文词义、第三段中文情境）；
 *   ② 一个大按钮「看答案」，他先在嘴上说一遍；
 *   ③ 揭晓英文（第一段还给关键点）+ 两个大按钮「会了」「不会」；
 *   ④ 「不会」的排到这一段末尾再考（顺序由服务端算），这一段全部会了才进下一段；
 *   ⑤ 顶上一条进度：第几段 / 这一段第几个 / 还剩几个。
 *
 * 把用户当小白（agents #92）：
 *   - **一个 `<input>` 都没有**（测试守着），全程不让他打字；页面上不出现任何命令行；
 *   - 按钮都 ≥52px 高，手机 390 宽单手够得着；
 *   - 任何时候点「看全部」能回看这一段——**已经过完的才给英文，没练到的不剧透**；
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
/* 卡片：先回想（只有中文）→ 揭晓（英文 + 关键点） */
.dr .dr-card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s5) var(--s4);margin:0 0 var(--s3);text-align:center}
.dr .dr-ask{font-size:var(--fs-aux);color:var(--muted);margin:0 0 var(--s3)}
.dr .dr-zh{font-size:26px;font-weight:700;line-height:1.35;margin:0;overflow-wrap:anywhere}
.dr .dr-en{font-size:22px;font-weight:700;line-height:1.4;color:var(--teal-ink);margin:var(--s4) 0 0;overflow-wrap:anywhere}
.dr .dr-key{font-size:var(--fs-body);color:var(--ink-2);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.dr .dr-hr{height:1px;background:var(--line);margin:var(--s4) 0 0}
/* 大按钮：一律 ≥52px 高，手机单手够得着。
   **选择器必须压过 admin-page.ts 那条 :is(#v-work,…) .btn{min-height:38px}**（它带一个 id，算 1-1-0）：
   所以这里写成 #w-drill + 两个类（1-2-0），只写 .dr .dr-one button（0-2-1）会被它盖掉，按钮就只有 38px 高。 */
#w-drill .dr-one .btn{width:100%;min-height:56px;font-size:17px;font-weight:700}
.dr .dr-two{display:grid;grid-template-columns:1fr 1fr;gap:var(--s3)}
#w-drill .dr-two .btn{min-height:56px;font-size:17px;font-weight:700}
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
.dr .dr-next{border:1px dashed var(--line);border-radius:12px;background:var(--surface-2);padding:var(--s3) var(--s4);margin:0 0 var(--s3);font-size:var(--fs-body);color:var(--ink-2)}
.dr .dr-err{border:1px solid var(--err);background:var(--err-soft);color:var(--err);border-radius:8px;padding:var(--s3);margin:var(--s3) 0 0;font-size:var(--fs-aux);white-space:pre-wrap}
@media (max-width:420px){.dr .dr-zh{font-size:24px}.dr .dr-en{font-size:18px}}
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

  <div id="dr-play">
    <div class="dr-card">
      <p class="dr-ask" id="dr-ask"></p>
      <p class="dr-zh" id="dr-zh">—</p>
      <div id="dr-ans" hidden>
        <div class="dr-hr"></div>
        <p class="dr-en" id="dr-en"></p>
        <p class="dr-key" id="dr-key" hidden></p>
      </div>
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
  </div>
  <p class="dr-next" id="dr-next" hidden></p>

  <details class="dr-all" id="dr-all"><summary>看全部（这一段 6 项）</summary><ul class="dr-list" id="dr-all-b"></ul></details>
  <div class="dr-err" id="dr-err" hidden></div>
</div>
<details class="more"><summary>这一块到底在做什么 · 为什么前三段不用 AI</summary><div class="in">
  <p>四段结构（单词 → 词组 → 例句 → 对话）没变，变的是<b>载体</b>：前三段的内容是<b>写死的</b>，就是一个"卡片 + 按钮 + 进度"的界面，交给语音反而看不到字、不能回看、没有进度、它还会自由发挥跳步。</p>
  <p>所以这一块<b>一个 AI 都不调</b>：没有延迟、不听话、额度、解析失败这些问题，也<b>不花一分钱</b>。</p>
  <p>每一项都是三步：<b>先回想</b>（卡片上只有中文）→ <b>揭晓</b>（点「看答案」）→ <b>自己判</b>（「会了 / 不会」）。点「不会」的那一项<b>排到这一段末尾再考一遍</b>，这一段六项全部「会了」才进下一段。</p>
  <p>进度和每一项的"第几次才会"<b>存在服务器上</b>，换一台设备接着练就行。</p>
  <p>这一段的内容来自 agents《项目/Practical/语块库-第一批50条.md》，<b>一个字没改</b>。</p></div></details></section>`;

/** 带练那一块的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__drillBase，例如 '/api/drill/' */
export const DRILL_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.drillOpen */
(function(){
try{
var DR={base:(window.__drillBase||'/api/drill/'),cur:null,busy:false,loaded:false};
var dq=function(i){return document.getElementById(i)};
function dText(id,s){var e=dq(id);if(e)e.textContent=s}
function dShow(id,on){var e=dq(id);if(e)e.hidden=!on}
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
    dText('dr-zh',DR.cur['中文']);
    dText('dr-en',DR.cur['英文']);
    dText('dr-key',DR.cur['关键点']||'');
    dShow('dr-key',!!DR.cur['关键点']);
    /* 每换一项都回到"先回想"：只有中文 + 一个「看答案」 */
    dShow('dr-ans',false);dShow('dr-one',true);dShow('dr-two',false);
  }
  dShow('dr-sum',done);
  dSum(j['小结']);
  /* 第四段还没做，照实说，不假装有 */
  dText('dr-next',j['第四段']||'');
  dShow('dr-next',done&&!!j['第四段']);
}

/* ---- 看答案：本地揭晓，不用再跑一趟接口 ---- */
function dReveal(){
  if(!DR.cur)return;
  dShow('dr-ans',true);dShow('dr-one',false);dShow('dr-two',true);
}

/* ---- 自己判：会了 / 不会 ---- */
function dAnswer(known){
  if(DR.busy||!DR.cur)return;DR.busy=true;
  dShow('dr-err',false);
  dJson('answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item:DR.cur.id,known:known})}).then(function(j){
    DR.busy=false;dPaint(j);
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
window.drillOpen=function(){if(DR.loaded)return;DR.loaded=true;dLoad();};
}catch(e){}
})();
`;

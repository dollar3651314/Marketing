/**
 * 「听辨小测」的页面片段（工作台 → 带练 `#/work/drill` 里的**第二个模式**，和「复考」并列；
 * 服务端 src/ear.ts，内容 src/ear-content.ts，发音复用 src/drill-audio.ts）。
 * 拆成样式 / 结构 / 脚本三段导出：结构 `EAR_MOD` 由 src/drill-page.ts 拼进 `#w-drill` 那一段里，
 * 样式和脚本由 admin-page.ts 和带练那两段并排插。
 * 写法上的约定（和 admin-page.ts、drill-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * **为什么放进带练里、不新开菜单项**：工作台二级菜单已经 8 项满了（T-4，第 9 项会撑破手机菜单），
 * 公共工具那 8 项更是一个都不许动。所以这里只多了一行两个按钮的模式开关：「带练」/「听辨小测」。
 *
 * **为什么有这一块**（Amos 2026-11-10 原话）：「自然拼读有很多我都不会，读的不标准，那也就意味着
 * 我听出来的声音也就有问题，**所以可能会听不懂别人在说什么**」。所以不背拼读规则，直接练耳朵。
 *
 * 一轮 8 组，每组三步：
 *   ① 进这一组**自动放一次**那个词，可以重放；按钮上**只有「🔊 再听一次」——绝不出现那个词**；
 *   ② 三个一样高的大按钮：两个词的拼写并排 + 下面一整条「两个听着一样」；
 *   ③ 选完当场给结果：对 / 错 + **点名刚才放的是哪个词** + **两个词都能单独点来听**（学习就发生在这一刻）
 *      + 一行"这两个音差在哪" + 两个词的音标 → 「下一组」。
 *
 * **「两个听着一样」不是凑数**：那 16 段发音是 melotts 现生成的，到现在没人听过。
 * 如果机器根本没念出区别，他会以为是自己耳朵坏了。这个按钮是**唯一能把"他分不出"和"机器没念出来"
 * 分开**的办法，所以和另外两个按钮**一样高、一样大的字**（它占满一整行，比另外两个还宽一点）。
 *
 * **哪个词随机、8 组的顺序随机、两个选项的左右也随机**（都在下面的脚本里）：别让他靠位置猜。
 * 代价说清楚（底线 9）：发音的地址里带编号（`/api/drill/audio/p1a`），开发者工具里能看出放的是 a 还是 b；
 * **界面上一个字都没有**，但那不是加密。
 *
 * 把用户当小白（agents #92）：**一个输入框都没有**、页面上不出现命令行；按钮都 ≥52px（这里全是 56px）；
 * 手机 390 宽单手够得着、不横滚；发音生成不出来**当面说**（走的就是带练那一套 `dAudio`，含连点闸和
 * 「正在生成」提示），**不假装有声音、也不自动重试**。
 *
 * 字号只用全站那几级（30 / 26 / 24 / 22 / 18 / 15 / 13 / 12，控件可以 14；e2e-platform 的 fontOutliers 守着）。
 */
export const EAR_CSS = `
/* 模式开关：带练 / 听辨小测（两个按钮并排，共用带练那条 ≥56px 的 .dr-two 规则） */
.dr .dr-mode{margin:0 0 var(--s4)}
/* 听音那一张卡：中间就一个🔊，下面三个一样高的大按钮 */
.dr .dr-ear-hear{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:0 0 var(--s3)}
.dr .dr-ear-same{margin:var(--s3) 0 0}
/* 答完那一张卡：对 / 错 + 刚才放的是哪个词 */
.dr .dr-ear-ver{font-size:22px;font-weight:700;line-height:1.4;margin:0;overflow-wrap:anywhere}
.dr .dr-ear-ver.ok{color:var(--ok)}
.dr .dr-ear-ver.no{color:var(--err)}
.dr .dr-ear-ver.same{color:var(--teal-ink)}
.dr .dr-ear-cmp{font-size:var(--fs-aux);color:var(--muted);margin:var(--s3) 0 0}
.dr .dr-ear-ex{font-size:var(--fs-body);color:var(--ink);margin:var(--s4) 0 0;overflow-wrap:anywhere}
.dr .dr-ear-ipa{font-size:18px;color:var(--ink-2);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.dr .dr-ear-human{font-size:var(--fs-aux);color:var(--ink-2);margin:var(--s3) 0 0}
.dr .dr-ear-human a{color:var(--teal-ink);font-weight:700;text-decoration:underline;display:inline-block;line-height:18px;padding:13px 6px}
/* 小结：听对几组 / 错的几组 / 点过「两个听着一样」的几组 */
.dr .dr-ear-sum{border:1px solid var(--teal);background:var(--teal-soft);border-radius:12px;padding:var(--s4);margin:0 0 var(--s3)}
.dr .dr-ear-sum .e-t{font-size:var(--fs-mod);font-weight:700;color:var(--teal-ink);margin:0 0 var(--s3)}
.dr .dr-ear-sum .e-h{font-size:var(--fs-body);font-weight:700;color:var(--ink);margin:var(--s4) 0 var(--s2)}
.dr .dr-ear-sum ul{margin:0;padding-left:20px;display:grid;gap:var(--s1)}
.dr .dr-ear-sum li{font-size:var(--fs-body);color:var(--ink);overflow-wrap:anywhere}
.dr .dr-ear-sum .e-n{font-size:var(--fs-aux);color:var(--ink-2);margin:var(--s2) 0 0;overflow-wrap:anywhere}
.dr .dr-ear-sum .e-tot{font-size:var(--fs-aux);color:var(--muted);margin:var(--s4) 0 var(--s3);overflow-wrap:anywhere}
@media (max-width:420px){.dr .dr-ear-ver{font-size:18px}}
`;

/** 听辨小测那一块（由 src/drill-page.ts 拼进 `#w-drill` 的 `.mbody` 里，默认藏着——打开带练先看到的还是带练） */
export const EAR_MOD = `<div id="dr-ear" hidden>
  <div class="dr-top">
    <p class="dr-where" id="dr-ear-where">读取中…</p>
    <div class="dr-bar"><i id="dr-ear-bar" style="width:0%"></i></div>
    <p class="dr-left" id="dr-ear-left">放一段音，你选听到的是哪个词。一轮 8 组。</p>
  </div>

  <div id="dr-ear-play">
    <div class="dr-card">
      <p class="dr-ask" id="dr-ear-ask">听这个词，选你听到的是哪个</p>
      <p class="dr-ear-hear">🔊</p>
      <div class="dr-one"><button class="btn primary" type="button" id="dr-ear-say">🔊 再听一次</button></div>
      <div class="dr-two" id="dr-ear-pick">
        <button class="btn" type="button" id="dr-ear-l">—</button>
        <button class="btn" type="button" id="dr-ear-r">—</button>
      </div>
      <div class="dr-one dr-ear-same"><button class="btn" type="button" id="dr-ear-same">两个听着一样</button></div>
    </div>
  </div>

  <div id="dr-ear-res" hidden>
    <div class="dr-card">
      <p class="dr-ear-ver" id="dr-ear-ver"></p>
      <p class="dr-ear-cmp">两个都点来听听，对比一下：</p>
      <div class="dr-two dr-au">
        <button class="btn" type="button" id="dr-ear-wa">—</button>
        <button class="btn" type="button" id="dr-ear-wb">—</button>
      </div>
      <p class="dr-ear-ex" id="dr-ear-ex"></p>
      <p class="dr-ear-ipa" id="dr-ear-ipa"></p>
      <!-- 上面那两个🔊是 melotts 合成的。合成音可能**把元音念歪**——他听得很清楚、却选错，
           那是机器的错不是他的耳朵，而「两个听着一样」那个按钮**分不出这一种**（2026-11-10 他第一轮
           三个元音组全错、辅音组全对，一次都没点那个按钮）。所以这里给真人录音做对照：
           地址就是内容文件里那个词的「出处」（剑桥词条页，页面上有真人发音），不花一分钱。-->
      <p class="dr-ear-human">机器念得对不对？<span id="dr-ear-human"></span></p>
    </div>
    <div class="dr-one"><button class="btn primary" type="button" id="dr-ear-next">下一组</button></div>
  </div>

  <div class="dr-ear-sum" id="dr-ear-sum" hidden>
    <p class="e-t" id="dr-ear-score"></p>
    <div id="dr-ear-badwrap" hidden>
      <p class="e-h">选错的几组（这就是你现在还分不出来的音）</p>
      <ul id="dr-ear-bad"></ul>
    </div>
    <div id="dr-ear-smwrap" hidden>
      <p class="e-h">你点了「两个听着一样」的几组</p>
      <ul id="dr-ear-sm"></ul>
      <p class="e-n">这几组要么是你还分不出来，<b>要么是机器没念出区别</b> —— 说一声，我们换模型。</p>
    </div>
    <p class="e-tot" id="dr-ear-tot"></p>
    <div class="dr-one"><button class="btn primary" type="button" id="dr-ear-again">再来一轮</button></div>
  </div>

  <div class="dr-aumsg" id="dr-ear-msg" hidden></div>
  <div class="dr-err" id="dr-ear-err" hidden></div>
</div>`;

/** 听辨小测那一块的脚本（整段 try/catch，出错只影响这一块）。发音复用带练露出来的 window.drillAudio */
export const EAR_JS = `
/* 整段包在一个函数里：和后台那几段脚本共用一个全局作用域，名字不能重复声明 */
(function(){
try{
var EA={base:(window.__drillBase||'/api/drill/'),zu:[],ji:null,order:[],i:0,say:'a',left:'a',res:[],loaded:false,busy:false,on:false,keep:null};
var eq=function(i){return document.getElementById(i)};
function eText(id,s){var e=eq(id);if(e)e.textContent=s}
function eShow(id,on){var e=eq(id);if(e)e.hidden=!on}
/* 出错一律把服务器那两句话原样摆出来，不吞掉 */
function eErr(j){var e=eq('dr-ear-err');if(!e)return;
  var s=(j&&(j['出错']||j.error))||'出错了';
  if(j&&j['怎么办'])s+='\\n怎么办：'+j['怎么办'];
  e.textContent=s;e.hidden=false;}
function eJson(path,init){return fetch(EA.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok){var e=new Error(j['出错']||j.error||('出错了（'+r.status+'）'));e.j=j;throw e;}
    return j;
  });
});}
/* 打散：Fisher-Yates。每一轮都重新打散（组的顺序、放 a 还是 b、两个选项的左右，三样都随机） */
function eMix(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
function eCoin(){return Math.random()<0.5?'a':'b';}
function eOther(x){return x==='a'?'b':'a';}
function eWord(p,k){return (k==='a'?p.a:p.b)['词'];}
/* 发音：**复用带练那一套**（同一个 dAudio：同一段只取一次、连点闸、「正在生成」提示、失败当面说、不自动重试）。
   报错和提示写进听辨自己的那条 #dr-ear-msg——带练那条在另一个模式里，这会儿是藏着的。*/
function ePlay(编号){if(编号&&window.drillAudio)window.drillAudio(编号,1,'ear','dr-ear-msg');}

/* ---- 一组 ---- */
function eGroup(){
  var p=EA.order[EA.i];if(!p)return;
  EA.say=eCoin();EA.left=eCoin();
  eText('dr-ear-l',eWord(p,EA.left));
  eText('dr-ear-r',eWord(p,eOther(EA.left)));
  eText('dr-ear-where','第 '+(EA.i+1)+' 组 / 共 '+EA.order.length);
  var b=eq('dr-ear-bar');if(b)b.style.width=Math.round(EA.i*100/(EA.order.length||1))+'%';
  eText('dr-ear-left','听这一段，选你听到的是哪个词；分不出来就点「两个听着一样」。');
  eShow('dr-ear-play',true);eShow('dr-ear-res',false);eShow('dr-ear-sum',false);eShow('dr-ear-err',false);
  var m=eq('dr-ear-msg');if(m)m.hidden=true;
  /* 进这一组自动放一次（按钮上**只有「🔊 再听一次」**，绝不出现那个词） */
  ePlay(p[EA.say]['编号']);
}
/* 选完：**对错由服务端算**（页面不自己判、也不自己记分） */
function ePick(k){
  if(EA.busy)return;
  var p=EA.order[EA.i];if(!p)return;
  var 选的=k==='same'?'same':(k==='left'?EA.left:eOther(EA.left));
  EA.busy=true;eShow('dr-ear-err',false);
  eJson('ear/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({'组':p['组'],'放的':EA.say,'选的':选的})}).then(function(j){
    EA.busy=false;EA.ji=j['记着了']||EA.ji;eRes(p,j);
  },function(e){EA.busy=false;eErr(e.j||{'出错':e.message});});
}
/* 答完：对 / 错 + 点名刚才放的是哪个词 + 两个词都能单独听 + 差在哪 + 两个音标 */
function eRes(p,j){
  var was=(j['放的是']||{})['词']||'';
  var v=eq('dr-ear-ver');
  if(j['两个听着一样']){
    if(v)v.className='dr-ear-ver same';
    eText('dr-ear-ver','你说两个听着一样 —— 刚才放的是 '+was);
  }else if(j['对']){
    if(v)v.className='dr-ear-ver ok';
    eText('dr-ear-ver','✅ 对了 —— 刚才放的就是 '+was);
  }else{
    if(v)v.className='dr-ear-ver no';
    eText('dr-ear-ver','❌ 不对 —— 刚才放的是 '+was+'，你点的是 '+(j['你选的']||''));
  }
  eText('dr-ear-wa','🔊 '+p.a['词']);
  eText('dr-ear-wb','🔊 '+p.b['词']);
  eText('dr-ear-ex',j['差在哪']||p['差在哪']||'');
  eText('dr-ear-ipa',p.a['词']+' '+p.a['音标']+'　·　'+p.b['词']+' '+p.b['音标']);
  eHuman(p);
  EA.res.push({p:p,对:!!j['对'],一样:!!j['两个听着一样']});
  eText('dr-ear-next',EA.i+1<EA.order.length?'下一组':'看这一轮的小结');
  eShow('dr-ear-play',false);eShow('dr-ear-res',true);
  var m=eq('dr-ear-msg');if(m)m.hidden=true;
}
/* 两个词各给一个「听真人念」的链接，跳内容文件里那个词的出处（剑桥词条页，有真人录音）。
   用 createElement 建，不拼 HTML 字符串。没有出处就不画那个链接。*/
function eHuman(p){
  var box=eq('dr-ear-human');if(!box)return;
  box.textContent='';
  ['a','b'].forEach(function(k,i){
    var w=p[k];if(!w||!w['出处'])return;
    if(i&&box.childNodes.length)box.appendChild(document.createTextNode('　·　'));
    var a=document.createElement('a');
    a.href=w['出处'];a.target='_blank';a.rel='noopener noreferrer';
    a.textContent='听真人念 '+w['词'];
    box.appendChild(a);
  });
}
function eNext(){EA.i++;if(EA.i<EA.order.length){eGroup();return;}eSum();}
/* 一行：bad / bed —— 在分 /æ/ 和 /e/ */
function eLi(ul,x){
  var li=document.createElement('li');
  li.textContent=x.p.a['词']+' / '+x.p.b['词']+' —— 在分 '+x.p['在分什么音'];
  ul.appendChild(li);
}
function eFill(id,rows){
  var ul=eq(id);if(!ul)return;
  while(ul.firstChild)ul.removeChild(ul.firstChild);
  rows.forEach(function(x){eLi(ul,x)});
}
function eSum(){
  var n=EA.order.length;
  var ok=EA.res.filter(function(x){return x.对}).length;
  var bad=EA.res.filter(function(x){return !x.对&&!x.一样});
  var sm=EA.res.filter(function(x){return x.一样});
  eText('dr-ear-score','听对 '+ok+' / '+n);
  eFill('dr-ear-bad',bad);eShow('dr-ear-badwrap',bad.length>0);
  eFill('dr-ear-sm',sm);eShow('dr-ear-smwrap',sm.length>0);
  var t=(EA.ji&&EA.ji['累计'])||null;
  eText('dr-ear-tot',t?('服务器上记着这 8 组的累计：考过 '+t['考过']+' 次，对 '+t['对']+' 次，点过「两个听着一样」'+t['两个听着一样']+' 次。'):'');
  eText('dr-ear-where','这一轮走完了（'+n+' 组）');
  eText('dr-lead-t','这一轮听对 '+ok+' / '+n+'（听辨小测）');
  var b=eq('dr-ear-bar');if(b)b.style.width='100%';
  eText('dr-ear-left','再来一轮会重新打散：顺序、放哪个词、左右位置都换。');
  eShow('dr-ear-play',false);eShow('dr-ear-res',false);eShow('dr-ear-sum',true);
}
function eRound(){EA.order=eMix(EA.zu.slice());EA.i=0;EA.res=[];eGroup();}
function eLoad(){
  return eJson('ear/state').then(function(j){
    EA.zu=j['组']||[];EA.ji=j;
    if(!EA.zu.length){eErr({'出错':'听辨小测这一轮没有题目。','怎么办':'刷新一下页面再试。'});return;}
    eRound();
  },function(e){eText('dr-ear-where','暂时读不到');eErr(e.j||{'出错':e.message});});
}

/* ---- 两个模式：带练 / 听辨小测（二级菜单已经 8 项满了，所以不新开菜单项）---- */
function eMode(on){
  EA.on=on;
  /* 顶上那一句话和模块副标题是带练的（"三段都练完了…"），切过来要跟着换，**走的时候原样放回去** */
  var lt=eq('dr-lead-t'),dot=eq('dr-dot'),ax=eq('dr-aux'),sf=eq('dr-soft');
  if(on){
    if(!EA.keep)EA.keep={t:lt?lt.textContent:'',d:dot?dot.className:'',a:ax?ax.textContent:'',s:sf?sf.textContent:''};
    if(lt)lt.textContent='听辨小测：一轮 8 组 —— 放一段音，你从只差一个音的两个词里选听到哪个';
    if(dot)dot.className='dot amber';
    if(ax)ax.textContent='听辨小测 · 8 组';
    if(sf)sf.textContent='分不出来就点「两个听着一样」—— 那可能是你还分不出来，也可能是机器根本没念出区别。';
  }else if(EA.keep){
    if(lt)lt.textContent=EA.keep.t;
    if(dot)dot.className=EA.keep.d;
    if(ax)ax.textContent=EA.keep.a;
    if(sf)sf.textContent=EA.keep.s;
    EA.keep=null;
  }
  eShow('dr-main',!on);eShow('dr-ear',on);
  var a=eq('dr-m-drill'),b=eq('dr-m-ear');
  if(a){a.className='btn'+(on?'':' primary');a.setAttribute('aria-pressed',on?'false':'true');}
  if(b){b.className='btn'+(on?' primary':'');b.setAttribute('aria-pressed',on?'true':'false');}
  if(on&&!EA.loaded){EA.loaded=true;eLoad();}
}

var ma=eq('dr-m-drill');if(ma)ma.addEventListener('click',function(){eMode(false)});
var mb=eq('dr-m-ear');if(mb)mb.addEventListener('click',function(){eMode(true)});
var sy=eq('dr-ear-say');if(sy)sy.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p[EA.say]['编号'])});
var bl=eq('dr-ear-l');if(bl)bl.addEventListener('click',function(){ePick('left')});
var br=eq('dr-ear-r');if(br)br.addEventListener('click',function(){ePick('right')});
var bs=eq('dr-ear-same');if(bs)bs.addEventListener('click',function(){ePick('same')});
var wa=eq('dr-ear-wa');if(wa)wa.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p.a['编号'])});
var wb=eq('dr-ear-wb');if(wb)wb.addEventListener('click',function(){var p=EA.order[EA.i];if(p)ePlay(p.b['编号'])});
var nx=eq('dr-ear-next');if(nx)nx.addEventListener('click',eNext);
var ag=eq('dr-ear-again');if(ag)ag.addEventListener('click',eRound);
}catch(e){}
})();
`;

/**
 * 语音生成的页面片段（后台"公共工具 → 语音生成"；服务端在 src/tts.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 按"把操作员当小白"做（agents #92）：粘字 → 选模型 → **先看这次要花多少、今天还剩多少** → 生成 → 当场试听 → 下载。
 * 贵的那个模型（aura-2-en）在界面上直接把"贵多少倍"写出来，不只给模型名。
 */
import { VOICE_MOD } from './voice-page';

export const TTS_CSS = `
.tv .box{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:var(--s4);margin:0 0 var(--s3)}
.tv textarea{width:100%;height:5em;font:var(--fs-body)/1.6 inherit;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:inherit;padding:8px 10px}
.tv .row{display:flex;flex-wrap:wrap;gap:var(--s2);align-items:center;margin:var(--s2) 0}
.tv .cost{font-weight:600}
.tv .warn{color:var(--err);font-weight:700}
.tv label.pick{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:var(--r-btn);padding:6px 12px;cursor:pointer;font-size:14px}
.tv label.pick:has(input:checked){border-color:var(--teal);background:var(--teal-soft)}
.tv label.pick input{margin:0}
.tv audio{width:100%;height:36px;margin-top:var(--s2)}
.tv .st{font-size:var(--fs-aux);color:var(--muted);margin:var(--s1) 0}
.tv .tolab{margin:var(--s3) 0 0;font-size:var(--fs-aux);color:var(--muted)}
`;

/**
 * 公共工具里的"语音生成"模块（id 和二级菜单 #/tools/tts 对应：t-tts）。
 * 界面改版·批 B（2026-11-04）：卡片 = 标题行 → 一句话结论（#tv-cost，脚本按字数现算）→ 主内容（写字、选模型、生成）→ 底部折叠；
 * "语音对话实测"（#t-voice）并进这一块的折叠 #tts-more 里，不再单独一块、不占二级菜单（T-4 上限 8 项）；
 * 打开 #/tools/voice 时 route() 先把折叠打开再滚过去。
 */
export const TTS_MOD = `<section class="card mod tv" id="t-tts">
  <header class="mh"><h2>语音生成</h2><span class="sp"></span><span class="aux">给一段英文 · 生成一段发音</span></header>
  <p class="lead"><span class="dot gray" aria-hidden="true"></span><span class="cost" id="tv-cost">还没写字。</span><span class="soft">推荐 melotts：一句话约 0.8 neurons。</span></p>
  <div class="mbody">
    <label for="tv-text"><b>要读的英文</b></label>
    <textarea id="tv-text" maxlength="500" placeholder="Grab an apple and put it on the table."></textarea>
    <p class="st" id="tv-len">0 / 500 个字符</p>
    <div class="row" role="radiogroup" aria-label="选模型">
      <label class="pick"><input type="radio" name="tv-m" value="melotts" checked> <span><b>melotts</b>（默认，推荐）</span></label>
      <label class="pick"><input type="radio" name="tv-m" value="aura"> <span><b>aura-2-en</b> <span class="warn" id="tv-x">贵很多</span></span></label>
    </div>
    <div class="row"><button class="btn primary" id="tv-go" type="button">生成并试听</button><span class="msg" id="tv-msg" role="status"></span></div>
    <audio id="tv-audio" controls hidden></audio>
    <div class="row"><a class="btn" id="tv-dl" download hidden>下载这段 MP3</a></div>
    <p class="st" id="tv-spec"></p>
    <p class="tolab">要试"说一句英文、让 AI 回你"？<a class="btn text small" href="#/tools/voice">语音对话实测台 ↓</a>（在这一块最下面的折叠里）</p>
  </div>
  <details class="more" id="tts-more"><summary>两个模型差多少 · 语音对话实测台（不占菜单）</summary><div class="in">
    <p>melotts 是 2026-11-03 实测判"地道"的那个，一句话（38 个字符）约 0.8 neurons。aura-2-en 音色更好，但同样一句话约 103.6 neurons
      —— <b class="warn">实测贵约 129.5 倍</b>（按 Cloudflare 价格表算是 131.8 倍，上面那行按你写的字数现算）。确实需要再点它。</p>
    <p>额度是你自己管的：这里只把"要花多少、还剩多少"摆出来，不替你设上限，也不改"用量和限额"里的数。
      整批跑 Practical 那 30 个场景请用上面的"素材生成器"，那个带场景台账和断点续传。</p>
    <p>"说一句英文、让 AI 回你"的语音对话实测台就在下面：它不放进二级菜单，是因为菜单上限 8 项已经满了（agents 工作平台/工具台账.md 的 T-4：第 9 项会撑破手机菜单）。</p>
    ${VOICE_MOD}
  </div></details>
</section>`;

/** 语音生成的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__ttsBase，例如 '/api/tts/' */
export const TTS_JS = `
/* 整段包在一个函数里：和后台自己那段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.ttsOpen */
(function(){
try{
var TV={base:(window.__ttsBase||'/api/tts/'),url:'',timer:0,busy:false};
var tvq=function(i){return document.getElementById(i)};
function tvModel(){var r=document.querySelector('input[name="tv-m"]:checked');return r?r.value:'melotts'}
function tvJson(path,init){return fetch(TV.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok)throw new Error(j['出错']||j.error||('出错了（'+r.status+'）'));
    return j;
  });
});}

/* 先把钱摆出来：写字或换模型就重算（300 毫秒防抖，不每敲一下就发一次） */
function tvPlan(){
  var t=tvq('tv-text').value;
  tvq('tv-len').textContent=t.length+' / 500 个字符';
  if(!t.trim()){tvq('tv-cost').textContent='还没写字。';tvq('tv-spec').textContent='';return}
  tvJson('plan?m='+encodeURIComponent(tvModel())+'&text='+encodeURIComponent(t)).then(function(j){
    var 贵=j['贵多少倍'];
    tvq('tv-x').textContent=贵?('贵约 '+贵+' 倍'):'贵很多';
    tvq('tv-cost').textContent='这一次大概要 '+j['这次要花neurons']+' neurons（'+j['选中的模型']+'）；今天已用 '+j['今天已用']+' / '+j['今天上限']+'，还剩 '+j['今天还剩']+'。'+(j['够不够']?'':' 额度不够了，生成会被挡下。');
    tvq('tv-cost').className=j['够不够']?'cost':'cost warn';
    tvq('tv-spec').textContent=j['规格提示'];
  }).catch(function(e){tvq('tv-cost').textContent='算不出这次要花多少：'+e.message});
}
function tvLater(){clearTimeout(TV.timer);TV.timer=setTimeout(tvPlan,300)}

function tvGen(){
  if(TV.busy)return;
  var t=tvq('tv-text').value.trim();
  if(!t){tvq('tv-msg').textContent='先粘一段英文进来。';return}
  TV.busy=true;var b=tvq('tv-go');b.disabled=true;b.textContent='正在生成…';
  tvq('tv-msg').textContent='';tvq('tv-msg').className='msg';
  tvJson('gen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t,model:tvModel()})})
  .then(function(j){
    var bin=atob(j.base64),arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    if(TV.url)URL.revokeObjectURL(TV.url);
    TV.url=URL.createObjectURL(new Blob([arr],{type:j.mime}));
    var a=tvq('tv-audio');a.src=TV.url;a.hidden=false;
    var d=tvq('tv-dl');d.href=TV.url;d.download=j['文件名'];d.hidden=false;
    tvq('tv-msg').textContent='生成好了：'+j['模型']+'，'+j['字节']+' 字节，用了 '+j['毫秒']+' 毫秒，这次约 '+j['本次估算neurons']+' neurons（今天已用 '+j['今天已用']+' / '+j['今天上限']+'）。';
    tvq('tv-msg').className='msg ok';
    tvq('tv-spec').textContent=j['规格提示'];
  })
  .catch(function(e){tvq('tv-msg').textContent=e.message;tvq('tv-msg').className='msg';})
  .then(function(){TV.busy=false;b.disabled=false;b.textContent='生成并试听';tvPlan();});
}

tvq('tv-text').addEventListener('input',tvLater);
var picks=document.querySelectorAll('input[name="tv-m"]');
for(var i=0;i<picks.length;i++)picks[i].addEventListener('change',tvPlan);
tvq('tv-go').addEventListener('click',tvGen);

/* 打开这一页时算一次（文字可能还留着） */
window.ttsOpen=function(){tvPlan()};
}catch(e){try{document.getElementById('tv-msg').textContent='语音生成这一块出错了：'+e.message}catch(e2){}}
})();
`;

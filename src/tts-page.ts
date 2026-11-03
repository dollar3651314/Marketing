/**
 * 语音生成的页面片段（后台"公共工具 → 语音生成"；服务端在 src/tts.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 按"把操作员当小白"做（agents #92）：粘字 → 选模型 → **先看这次要花多少、今天还剩多少** → 生成 → 当场试听 → 下载。
 * 贵的那个模型（aura-2-en）在界面上直接把"贵多少倍"写出来，不只给模型名。
 */
export const TTS_CSS = `
.tv .box{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px;margin:10px 0}
.tv textarea{width:100%;height:5em;font:14px/1.6 inherit;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;padding:8px}
.tv .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.tv .cost{font-weight:700;margin:6px 0}
.tv .warn{color:var(--err);font-weight:700}
.tv label.pick{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
.tv label.pick input{margin:0}
.tv audio{width:100%;height:36px;margin-top:8px}
.tv .st{font-size:12px;color:var(--muted)}
`;

/** 公共工具里的"语音生成"模块（id 和二级菜单 #/tools/tts 对应：t-tts） */
export const TTS_MOD = `<section class="mod tv" id="t-tts"><h2 class="mh">语音生成<span class="sp"></span><span class="hint">给一段英文 · 生成一段发音</span></h2>
  <p class="lead">任何项目都能用：粘一段英文 → 选模型 → 看清楚这次要花多少 → 生成 → 当场听 → 存下来。
  （整批跑 Practical 那 30 个场景请用上面的"素材生成器"，那个带场景台账和断点续传。）</p>
  <div class="box">
    <label for="tv-text"><b>要读的英文</b></label>
    <textarea id="tv-text" maxlength="500" placeholder="Grab an apple and put it on the table."></textarea>
    <p class="st" id="tv-len">0 / 500 个字符</p>
    <div class="row" role="radiogroup" aria-label="选模型">
      <label class="pick"><input type="radio" name="tv-m" value="melotts" checked> <span><b>melotts</b>（默认，推荐）</span></label>
      <label class="pick"><input type="radio" name="tv-m" value="aura"> <span><b>aura-2-en</b> <span class="warn" id="tv-x">贵很多</span></span></label>
    </div>
    <p class="st">melotts 是 2026-11-03 实测判"地道"的那个，一句话（38 个字符）约 0.8 neurons。aura-2-en 音色更好，但同样一句话约 103.6 neurons
      —— <b class="warn">实测贵约 129.5 倍</b>（按 Cloudflare 价格表算是 131.8 倍，上面那行按你写的字数现算）。确实需要再点它。</p>
    <p class="cost" id="tv-cost">还没写字。</p>
    <p class="st">额度是你自己管的：这里只把"要花多少、还剩多少"摆出来，不替你设上限，也不改"用量和限额"里的数。</p>
    <div class="row"><button class="btn primary" id="tv-go" type="button">生成并试听</button><span class="msg" id="tv-msg" role="status"></span></div>
    <audio id="tv-audio" controls hidden></audio>
    <div class="row"><a class="btn" id="tv-dl" download hidden>下载这段 MP3</a></div>
    <p class="st" id="tv-spec"></p>
  </div>
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

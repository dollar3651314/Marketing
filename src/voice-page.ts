/**
 * 语音对话实测台的页面片段（后台"公共工具 → 语音对话实测"；服务端在 src/voice.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 插这三段。
 * 写法上的约定（和 admin-page.ts、tts-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 按"把操作员当小白"做（agents #92）：**操作手册直接印在页面上**（折叠的"怎么用"一节），
 * 每步写清"在哪点、会看到什么、什么算成功"——不让 Amos 为了跑一次实测先去翻另一个仓库的文档。
 * 页面上**不出现任何命令行**。
 *
 * 三件事必须摆在他眼前（N-4 任务书）：
 *   ① 每一步各花了多少**毫秒**（延迟是对话产品的生死线，超 2～3 秒人就不想说了）；
 *   ② 每一步各花了多少 **neurons**，以及哪个数是算出来的、哪个数是估的；
 *   ③ 今天还能跑几轮（实测台一天最多 3 轮，免得一次把额度烧光）。
 */
export const VOICE_CSS = `
.vc .box{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px;margin:10px 0}
.vc .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.vc label.pick{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
.vc label.pick input{margin:0}
.vc .st{font-size:12px;color:var(--muted)}
.vc .warn{color:var(--err);font-weight:700}
.vc .cost{font-weight:700;margin:6px 0}
.vc audio{width:100%;height:36px;margin-top:8px}
.vc table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}
.vc th,.vc td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.vc th{background:var(--surface)}
.vc .big{font-size:22px;font-weight:700}
.vc .rec{background:#C0392B;color:#fff;border-color:#C0392B}
.vc details{border:1px solid var(--line);border-radius:10px;padding:10px;margin:10px 0;background:var(--surface)}
.vc details summary{cursor:pointer;font-weight:700}
.vc ol{padding-left:20px}
.vc .said{background:var(--surface);border-left:3px solid var(--line);padding:8px;margin:6px 0;border-radius:6px}
`;

/** 公共工具里的"语音对话实测"模块（id 和二级菜单 #/tools/voice 对应：t-voice） */
export const VOICE_MOD = `<section class="mod vc" id="t-voice"><h2 class="mh">语音对话实测<span class="sp"></span><span class="hint">说一句 · 转文字 · AI 回 + 改写 · 读出来</span></h2>
  <p class="lead">核一件事：<b>Practical 新方向那条实时语音对话链路，能不能跑在 Cloudflare Workers AI 的免费额度里，延迟能不能接受。</b>
  下面每跑一轮，都会把<b>每一步花了多少毫秒、多少 neurons</b> 摆出来。</p>

  <details id="vc-how"><summary>怎么用（点开看，4 步，不用输任何东西）</summary>
    <ol>
      <li><b>戴耳机</b>，找个安静的地方，用 Chrome。</li>
      <li>选一个<b>场景</b>（默认"需求撕逼"），看一眼上面那句<b>开场白</b>——你等一下就是在回答它。</li>
      <li>按 <b>● 开始录音</b>，浏览器问麦克风点<b>允许</b>；用平常语速<b>说一句英文</b>回答它（10～20 个词），说完<b>再按一次</b>结束。</li>
      <li>按 <b>跑一轮</b>，等几秒。<b>算成功</b>：下面出现"机器听到你说"、AI 的回答、一段能播的语音，以及一张"每一步花了多少"的表。</li>
    </ol>
    <p class="st"><b>看什么</b>：① 表最底下的<b>端到端毫秒</b>——超过 3,000 就是太慢；② "机器听到你说"和你真说的差多少——这是口音能不能认的证据；
    ③ "哪句不地道 / 母语者会怎么说"——这是产品的核心卖点，质量你自己判。</p>
    <p class="st"><b>卡住了怎么办</b>：出红字就把红字<b>原样</b>发回来，别反复点（每点一次都花额度）。
    "打不开麦克风"→ 点地址栏左边的小图标允许麦克风，刷新再来。额度用完的那句话会直接写出来，等台湾时间<b>早上 8 点</b>清零。</p>
    <p class="st"><b>一天最多 3 轮</b>就停，这是页面自己的闸，免得一次把当天额度烧光。</p>
  </details>

  <div class="box">
    <div class="row" id="vc-scenes" role="radiogroup" aria-label="选场景"></div>
    <p class="said" id="vc-open">开场白读取中…</p>
    <div class="row">
      <button class="btn" id="vc-rec" type="button">● 开始录音</button>
      <span class="st" id="vc-recst">还没录。</span>
    </div>
    <audio id="vc-mine" controls hidden></audio>
    <div class="row"><button class="btn primary" id="vc-go" type="button" disabled>跑一轮</button><span class="msg" id="vc-msg" role="status"></span></div>
    <p class="cost" id="vc-left">额度读取中…</p>
  </div>

  <div class="box" id="vc-out" hidden>
    <p class="big" id="vc-e2e"></p>
    <p><b>机器听到你说：</b><span id="vc-heard"></span></p>
    <p><b>AI 回答：</b><span id="vc-reply"></span></p>
    <p><b>哪句不地道：</b><span id="vc-bad"></span></p>
    <p><b>母语者会怎么说：</b><span id="vc-nat"></span></p>
    <p class="st" id="vc-why"></p>
    <audio id="vc-audio" controls hidden></audio>
    <table id="vc-steps"><thead><tr><th>这一步</th><th>模型</th><th>毫秒</th><th>neurons</th><th>这个数是算的还是估的</th></tr></thead><tbody></tbody></table>
    <p class="st" id="vc-note"></p>
  </div>

  <details id="vc-budget"><summary>算术：一轮 10 分钟对话要多少 neurons（按官方价格表，不是实测）</summary>
    <p class="st" id="vc-typ"></p>
    <table id="vc-combos"><thead><tr><th>搭配</th><th>一轮 neurons</th><th>其中 ASR / LLM / TTS</th><th>一天 10,000 能跑几轮</th></tr></thead><tbody></tbody></table>
    <p class="st" id="vc-scale"></p>
  </details>
</section>`;

/** 语音对话实测的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__voiceBase，例如 '/api/voice/' */
export const VOICE_JS = `
/* 整段包在一个函数里：和后台自己那段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.voiceOpen */
(function(){
try{
var VC={base:(window.__voiceBase||'/api/voice/'),scene:'',rec:null,chunks:[],b64:'',mime:'',sec:0,t0:0,url:'',busy:false,loaded:false};
var vq=function(i){return document.getElementById(i)};
function vJson(path,init){return fetch(VC.base+path,init||{}).then(function(r){
  return r.json().catch(function(){return {}}).then(function(j){
    if(!r.ok)throw new Error(j['出错']||j.error||('出错了（'+r.status+'）'));
    return j;
  });
});}
function vText(id,s){var e=vq(id);if(e)e.textContent=s}

/* ---- 开场：把价格表、场景、额度读进来 ---- */
function vPlan(){
  return vJson('plan').then(function(j){
    /* 场景按钮 */
    var box=vq('vc-scenes');box.replaceChildren();
    (j['场景']||[]).forEach(function(s,i){
      var l=document.createElement('label');l.className='pick';
      var r=document.createElement('input');r.type='radio';r.name='vc-s';r.value=s.key;if(i===0){r.checked=true;VC.scene=s.key}
      r.addEventListener('change',function(){VC.scene=s.key;vText('vc-open',s['开场'])});
      var t=document.createElement('span');t.textContent=s['名字'];
      l.append(r,t);box.append(l);
      if(i===0)vText('vc-open',s['开场']);
    });
    /* 额度和轮数 */
    var 轮=j['今天已跑轮数'],最多=j['实测台一天最多'];
    var e=vq('vc-left');
    e.textContent='今天已跑 '+轮+' / '+最多+' 轮；Workers AI 今天已用 '+j['今天已用']+' / '+j['今天上限']+'，还剩 '+j['今天还剩']+' neurons。'+(轮>=最多?' 今天不能再跑了。':'');
    e.className=(轮>=最多||j['今天还剩']<=0)?'cost warn':'cost';
    /* 算术表 */
    var t=j['典型一轮口径']||{};
    vText('vc-typ','口径（'+(j['口径来源']||'')+'）：一轮 10 分钟 = '+t['往返轮次']+' 个往返、用户累计说 '+t['用户说话分钟']+' 分钟、AI 回复合计 '+t['AI回复字符']+' 个英文字符、LLM 约 '+t['LLM输入token']+' 输入 token + '+t['LLM输出token']+' 输出 token。免费额度 '+j['免费额度']+' neurons/天（00:00 UTC 清零 = 台湾早上 8 点）。');
    var tb=vq('vc-combos').querySelector('tbody');tb.replaceChildren();
    (j['搭配']||[]).forEach(function(c){
      var tr=document.createElement('tr');
      [c['组合'],String(c['一轮neurons']),c['明细'].asr+' / '+c['明细'].llm+' / '+c['明细'].tts,String(c['一天能跑几轮'])].forEach(function(v){
        var td=document.createElement('td');td.textContent=v;tr.append(td);
      });
      tb.append(tr);
    });
    var sc=j['一百个用户']||[];
    if(sc.length){
      vText('vc-scale','按最省的那档（'+(j['最省的那档']||{})['组合']+'）：100 个用户每人每天 1 轮 = '+sc[0]['一天neurons']+' neurons/天，是免费额度的 '+sc[0]['是免费额度的几倍']+' 倍，超出部分按官方 $0.011/1,000 neurons 算约 $'+sc[0]['超出部分每月美元']+'/月；每人每天 2 轮 = '+sc[1]['一天neurons']+' neurons/天（'+sc[1]['是免费额度的几倍']+' 倍，约 $'+sc[1]['超出部分每月美元']+'/月）。这些是价格表算术，不是实测。');
    }
    vq('vc-go').disabled=(!VC.b64)||轮>=最多;
    VC.loaded=true;
  }).catch(function(e){vText('vc-left','读不到额度和价格表：'+e.message)});
}

/* ---- 录音：MediaRecorder，自己挑浏览器支持的格式并照实报出来 ---- */
function vPickMime(){
  var want=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus',''];
  for(var i=0;i<want.length;i++){
    try{if(!want[i]||(window.MediaRecorder&&MediaRecorder.isTypeSupported(want[i])))return want[i]}catch(e){}
  }
  return '';
}
function vStart(){
  if(!navigator.mediaDevices||!window.MediaRecorder){vText('vc-recst','这个浏览器不支持录音，换 Chrome。');return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    var m=vPickMime();
    VC.rec=m?new MediaRecorder(stream,{mimeType:m}):new MediaRecorder(stream);
    VC.mime=VC.rec.mimeType||m||'（浏览器没报）';
    VC.chunks=[];VC.t0=Date.now();
    VC.rec.addEventListener('dataavailable',function(e){if(e.data&&e.data.size)VC.chunks.push(e.data)});
    VC.rec.addEventListener('stop',function(){
      stream.getTracks().forEach(function(t){t.stop()});
      VC.sec=(Date.now()-VC.t0)/1000;
      var blob=new Blob(VC.chunks,{type:VC.mime});
      if(VC.url)URL.revokeObjectURL(VC.url);
      VC.url=URL.createObjectURL(blob);
      var a=vq('vc-mine');a.src=VC.url;a.hidden=false;
      var fr=new FileReader();
      fr.onload=function(){
        var s=String(fr.result||'');var i=s.indexOf(',');
        VC.b64=i>=0?s.slice(i+1):'';
        vText('vc-recst','录好了：'+VC.sec.toFixed(1)+' 秒、'+blob.size+' 字节、格式 '+VC.mime+'。听一下，不满意就再录一次。');
        vq('vc-go').disabled=!VC.b64;
      };
      fr.onerror=function(){vText('vc-recst','读不出录音，重录一次。')};
      fr.readAsDataURL(blob);
    });
    VC.rec.start();
    var b=vq('vc-rec');b.textContent='■ 结束录音';b.className='btn rec';
    vText('vc-recst','正在录…说一句英文，说完再按一次。最多 30 秒。');
  }).catch(function(e){vText('vc-recst','打不开麦克风：'+e.message+'。点地址栏左边的小图标允许麦克风，刷新再来。')});
}
function vStop(){
  try{if(VC.rec&&VC.rec.state!=='inactive')VC.rec.stop()}catch(e){}
  VC.rec=null;
  var b=vq('vc-rec');b.textContent='● 开始录音';b.className='btn';
}
function vRecToggle(){if(VC.rec&&VC.rec.state==='recording')vStop();else vStart()}

/* ---- 跑一轮 ---- */
function vRun(){
  if(VC.busy)return;
  if(!VC.b64){vText('vc-msg','先录一句。');return}
  VC.busy=true;var b=vq('vc-go');b.disabled=true;b.textContent='正在跑…（几秒）';
  var m=vq('vc-msg');m.textContent='';m.className='msg';
  vJson('run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({audio:VC.b64,mime:VC.mime,seconds:VC.sec,scene:VC.scene})})
  .then(function(j){
    vq('vc-out').hidden=false;
    var ms=j['端到端毫秒'];
    var e=vq('vc-e2e');
    e.textContent='端到端 '+ms+' 毫秒（'+(ms/1000).toFixed(1)+' 秒）'+(ms>3000?' —— 超过 3 秒，对话会卡壳':(ms>2000?' —— 2～3 秒，勉强':' —— 2 秒以内'));
    e.className=ms>3000?'big warn':'big';
    vText('vc-heard',j['听到的']);
    vText('vc-reply',j['回答']);
    vText('vc-bad',j['哪句不地道']);
    vText('vc-nat',j['母语者会怎么说']);
    vText('vc-why',j['为什么']);
    if(j['回答音频base64']){
      var bin=atob(j['回答音频base64']),arr=new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      var a=vq('vc-audio');a.src=URL.createObjectURL(new Blob([arr],{type:j['回答音频mime']}));a.hidden=false;
    }
    var tb=vq('vc-steps').querySelector('tbody');tb.replaceChildren();
    (j['步骤']||[]).forEach(function(s){
      var tr=document.createElement('tr');
      [s['这一步'],s['模型'],String(s['毫秒']),String(s['neurons']),s['neurons是估的']].forEach(function(v){
        var td=document.createElement('td');td.textContent=v;tr.append(td);
      });
      tb.append(tr);
    });
    vText('vc-note','这一轮（只说了一句话）共 '+j['这一轮neurons']+' neurons；录音格式 '+j['录音格式']+'、'+j['录音秒数']+' 秒。'+(j['提醒']||''));
    m.textContent='跑完了。今天已跑 '+j['今天已跑轮数']+' / '+j['实测台一天最多']+' 轮。';
    m.className='msg ok';
  })
  .catch(function(e){
    var m2=vq('vc-msg');m2.textContent=e.message;m2.className='msg';
  })
  .then(function(){VC.busy=false;b.textContent='跑一轮';vPlan()});
}

vq('vc-rec').addEventListener('click',vRecToggle);
vq('vc-go').addEventListener('click',vRun);

/* 打开这一页时读一次价格表和额度 */
window.voiceOpen=function(){if(!VC.loaded)vPlan()};
}catch(e){try{document.getElementById('vc-msg').textContent='语音对话实测这一块出错了：'+e.message}catch(e2){}}
})();
`;

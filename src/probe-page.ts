/**
 * Workers AI 探针页（只在测试版；路由和服务端在 src/probe.ts）。
 * 给 Amos 本人用：打开网址 → 点四个大按钮 → 听 / 录 → 按「复制结果」把 JSON 发回来。
 * 写法上的约定：
 * - 这是模板字符串，HTML 里不能出现没转义的反引号或 ${（和 admin-page.ts 一样）。
 * - 页面上不显示任何密钥、账号 ID（底线 1）：结果 JSON 里只有模型名、毫秒、字节、neurons 估算。
 * - 录音只在浏览器和本服务之间传，不落库、不转发第三方；转成 16kHz 单声道 WAV 再传（Whisper 一定吃得下）。
 */

/** 探针页的样式。收进后台"公共工具"以后，每条选择器前面都加了 `.probe`，不会串到后台别的模块（admin-page.ts 把它接在自己那段样式后面）。 */
export const PROBE_CSS = `
.probe *{box-sizing:border-box}
.probe{overflow-x:hidden}
.probe .heard{overflow-wrap:anywhere}
.probe{font:17px/1.75 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:40em;margin:0 auto;padding:1.2em 1em 4em}
.probe h1{font-size:1.5em;margin:.2em 0}
.probe h2{font-size:1.15em;margin:.1em 0 .4em}
.probe .note{background:#eef4ff;border-left:4px solid #3b6ef6;padding:.7em .9em;border-radius:6px}
@media (prefers-color-scheme:dark){.probe .note{background:#1b2436}}
.probe li{list-style:none;border:1px solid #c9ced8;border-radius:10px;padding:1em;margin:1em 0}
.probe ol{padding:0;margin:0}
.probe .why{margin:.2em 0 .8em}
.probe button.big{display:block;width:100%;padding:1em;font-size:1.1em;font-weight:600;border-radius:10px;border:0;background:#3b6ef6;color:#fff;cursor:pointer}
.probe button.big:disabled{background:#9aa6bd;cursor:default}
.probe button.rec{background:#c0392b}
.probe .rate{margin:.6em 0 0}
.probe .rate button{padding:.45em .9em;margin:.25em .4em .25em 0;border-radius:8px;border:1px solid #9aa6bd;background:transparent;color:inherit;cursor:pointer;font-size:.95em}
.probe .rate button[aria-pressed="true"]{background:#3b6ef6;color:#fff;border-color:#3b6ef6}
.probe .out{margin-top:.7em;padding:.6em .8em;border-radius:8px;background:#f1f3f7;white-space:pre-wrap;word-break:break-word;min-height:1.6em}
@media (prefers-color-scheme:dark){.probe .out{background:#20242d}}
.probe .heard{font-size:1.15em;font-weight:600}
.probe input[type=text]{width:100%;padding:.5em;font-size:1em;border-radius:8px;border:1px solid #9aa6bd;background:transparent;color:inherit}
.probe textarea{width:100%;height:9em;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;border-radius:8px;border:1px solid #9aa6bd;background:transparent;color:inherit;padding:.5em}
.probe audio{width:100%;margin-top:.6em}
.probe .small{font-size:.9em;opacity:.8}
`;

/**
 * 探针页的正文（结构 + 脚本）。后台"公共工具 → 发音探针"和测试版那个受限入口都插这一段，**只写一遍**。
 * 宿主页面先设 window.__probeBase：后台是 '/api/probe/'，受限入口是 ''（相对当前地址）。
 */
export const PROBE_BODY = `<div class="probe">
<h1>Practical 发音实测</h1>
<p class="note"><b>这一页只在测试版有，测完就下线。</b>你不用安装任何东西，也不用填任何密码。
照着 1 → 2 → 3 → 4 的顺序各点一次（录音那两步要允许浏览器用麦克风），每一步下面选一下你的感受，
最后按最底下的<b>「复制结果」</b>，把复制到的那段文字发回给团队就行。全程约 10 分钟。</p>

<p class="small">要读的英文句子（不用改，想换别的也行）：</p>
<p><input type="text" id="sentence" value="Grab an apple and put it on the table."></p>

<ol>
<li>
  <h2>第 1 步　听 A 的声音</h2>
  <p class="why"><b>在测什么：</b>免费那个发音引擎读英文够不够地道。<br>
  <b>你要注意听：</b>像不像英语母语的人在说话？有没有读错词、吞字、机器味特别重？<b>建议戴耳机。</b></p>
  <button class="big" id="b1">▶ 播放 A 的声音</button>
  <div class="rate" data-for="1"><button data-v="地道">听着地道</button><button data-v="一般">一般</button><button data-v="不行">不行</button></div>
  <div class="out" id="o1">还没点。</div>
</li>
<li>
  <h2>第 2 步　听 B 的声音（同一句话）</h2>
  <p class="why"><b>在测什么：</b>另一个更贵的发音引擎，读的是同一句话。<br>
  <b>你要注意听：</b>和第 1 步比，明显更像真人吗？如果差不多，就没有多花钱的理由。</p>
  <button class="big" id="b2">▶ 播放 B 的声音</button>
  <div class="rate" data-for="2"><button data-v="明显更好">明显比 A 好</button><button data-v="差不多">差不多</button><button data-v="更差">比 A 差</button></div>
  <div class="out" id="o2">还没点。</div>
</li>
<li>
  <h2>第 3 步　录你自己说一句英文</h2>
  <p class="why"><b>在测什么：</b>你的英文发音，机器能不能听准。这是整个产品最关键的一条假设。<br>
  <b>怎么做：</b>点下面的按钮 → 浏览器问"是否允许使用麦克风"点<b>允许</b> → 用正常语速念一句英文（6～12 个词，念那句示例也行）→ 再点一次按钮结束。<br>
  <b>你要看：</b>下面显示出来的文字，和你念的是不是一样。可以多录几句（建议 10 句）。</p>
  <button class="big" id="b3">● 开始录音</button>
  <div class="rate" data-for="3"><button data-v="基本全对">基本全对</button><button data-v="错几个词">错几个词</button><button data-v="错得多">错得多 / 听不出来</button></div>
  <div class="out" id="o3">还没点。</div>
</li>
<li>
  <h2>第 4 步　和 AI 说一句，听它怎么接</h2>
  <p class="why"><b>在测什么：</b>完整的一轮对话要多久、AI 会不会忍不住纠正你的语法。<br>
  <b>怎么做：</b>点按钮，故意念一句<b>有语法错的</b>英文，例如
  <span class="heard">I goed to the office yesterday.</span>，再点一次结束。<br>
  <b>你要看两件事：</b>① AI 的回答里<b>不应该</b>出现"你说错了""应该说…"这类纠正；② 下面显示的总耗时，超过 3 秒就偏慢。可以重复 5 次。</p>
  <button class="big" id="b4">● 开始录音（整条链路）</button>
  <div class="rate" data-for="4"><button data-v="没纠错且够快">没纠错，也够快</button><button data-v="纠错了">它纠正我了</button><button data-v="太慢">太慢</button></div>
  <div class="out" id="o4">还没点。</div>
</li>
</ol>

<audio id="au" controls></audio>

<h2>最后一步　把结果发回去</h2>
<p class="small">按下面的按钮，内容会复制到剪贴板；如果提示复制失败，就手动选中下面方框里的全部文字复制。</p>
<button class="big" id="copy">复制结果</button>
<p class="small" id="copymsg"></p>
<textarea id="json" readonly></textarea>
<p class="small">这一页不显示、也不保存任何密码和账号信息；录音只在你的浏览器和这个测试版服务之间传，不会存下来。</p>

<script>
/* 整段包在一个函数里：收进后台以后和后台自己那段脚本共用一个全局作用域，\$ 这类名字不能重复声明 */
(function(){
var PB=(window.__probeBase===undefined?'':window.__probeBase);
var $=function(i){return document.getElementById(i)};
var results=[],rates={},spent=0,busy=false;
var au=$('au');

function dump(){
  $('json').value=JSON.stringify({
    时间:new Date().toISOString(),
    句子:$('sentence').value,
    我的感受:rates,
    累计估算neurons:Math.round(spent*10)/10,
    每一次的结果:results
  },null,2);
}
function note(id,text){$(id).textContent=text}
function add(o){results.push(o);if(typeof o.本次估算neurons==='number')spent+=o.本次估算neurons;dump()}
function fail(id,e){note(id,'出错了：'+e+'\\n（把这句话一起发回给团队就行）')}

function lock(b,text){busy=true;b.disabled=true;b.dataset.old=b.textContent;b.textContent=text}
function unlock(b){busy=false;b.disabled=false;if(b.dataset.old)b.textContent=b.dataset.old}

async function playTts(which,btn,outId){
  if(busy)return;
  lock(btn,'生成中，请稍候…');
  try{
    var r=await fetch(PB+'tts?m='+which+'&text='+encodeURIComponent($('sentence').value));
    if(!r.ok){fail(outId,(await r.text()).slice(0,300));return}
    var ms=Number(r.headers.get('x-ms')),by=Number(r.headers.get('x-bytes')),ne=Number(r.headers.get('x-neurons')),mo=r.headers.get('x-model')||which;
    var blob=await r.blob();
    au.src=URL.createObjectURL(blob);
    try{await au.play()}catch(e){note(outId,'已生成：浏览器挡住了自动播放，请点页面下方那条播放条播放。')}
    add({步骤:outId==='o1'?'1 听A':'2 听B',模型:mo,生成毫秒:ms,音频字节:by,本次估算neurons:ne});
    note(outId,'已播放。生成用了 '+ms+' 毫秒。听完在上面选一下你的感受。');
  }catch(e){fail(outId,String(e&&e.message||e))}
  finally{unlock(btn)}
}

var rec=null,chunks=[],recBtn=null,recMode='';
async function toggleRec(btn,mode,outId){
  if(rec&&rec.state==='recording'){rec.stop();return}
  if(busy)return;
  try{
    var s=await navigator.mediaDevices.getUserMedia({audio:true});
    rec=new MediaRecorder(s);chunks=[];recBtn=btn;recMode=mode;
    rec.ondataavailable=function(e){chunks.push(e.data)};
    rec.onstop=async function(){
      s.getTracks().forEach(function(x){x.stop()});
      btn.classList.remove('rec');lock(btn,'正在识别，请稍候…');btn.dataset.old=btn.dataset.start;
      try{
        var wav=await toWav(await new Blob(chunks).arrayBuffer());
        var r=await fetch(PB+(mode==='chain'?'chain':'asr'),{method:'POST',body:wav,headers:{'content-type':'audio/wav'}});
        var j=await r.json();
        if(!r.ok){fail(outId,JSON.stringify(j).slice(0,300));return}
        if(mode==='chain'){
          if(j.audioBase64){au.src='data:audio/mpeg;base64,'+j.audioBase64;delete j.audioBase64;try{await au.play()}catch(e){}}
          note(outId,'机器听到你说：'+(j.听到||'（没听出来）')+'\\nAI 回答：'+(j.AI回答||'（没有回答）')+
            '\\n一共用了 '+(j.用时毫秒&&j.用时毫秒.端到端)+' 毫秒（听懂 '+(j.用时毫秒&&j.用时毫秒.听懂)+
            ' + 想回答 '+(j.用时毫秒&&j.用时毫秒.想回答)+' + 说出来 '+(j.用时毫秒&&j.用时毫秒.说出来)+'）');
        }else{
          note(outId,'机器听到你说：\\n'+(j.转出来的文字||'（没听出来）')+'\\n识别用了 '+j.毫秒+' 毫秒。');
        }
        j.步骤=mode==='chain'?'4 整条链路':'3 听我说';
        add(j);
      }catch(e){fail(outId,String(e&&e.message||e))}
      finally{unlock(btn);rec=null}
    };
    rec.start();btn.classList.add('rec');btn.dataset.start=btn.dataset.start||btn.textContent;btn.textContent='■ 说完了，点这里结束';
    note(outId,'正在录音…说完再点一次上面的按钮。');
  }catch(e){fail(outId,'打不开麦克风：'+String(e&&e.message||e)+'\\n请在浏览器地址栏左边允许使用麦克风，然后再点一次。')}
}

async function toWav(buf){
  var ac=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
  var ab=await ac.decodeAudioData(buf);
  var d=ab.getChannelData(0),n=d.length,v=new DataView(new ArrayBuffer(44+n*2));
  var w=function(o,s){for(var i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,16000,true);v.setUint32(28,32000,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);
  w(36,'data');v.setUint32(40,n*2,true);
  for(var i=0;i<n;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,d[i]))*32767,true);
  ac.close();
  return v.buffer;
}

$('b1').onclick=function(){playTts('a',this,'o1')};
$('b2').onclick=function(){playTts('b',this,'o2')};
$('b3').onclick=function(){toggleRec(this,'asr','o3')};
$('b4').onclick=function(){toggleRec(this,'chain','o4')};

Array.prototype.forEach.call(document.querySelectorAll('.rate'),function(box){
  Array.prototype.forEach.call(box.querySelectorAll('button'),function(b){
    b.onclick=function(){
      Array.prototype.forEach.call(box.querySelectorAll('button'),function(x){x.setAttribute('aria-pressed','false')});
      b.setAttribute('aria-pressed','true');
      rates['第'+box.dataset.for+'步']=b.dataset.v;dump();
    };
  });
});

$('copy').onclick=async function(){
  dump();
  try{await navigator.clipboard.writeText($('json').value);$('copymsg').textContent='已复制，直接粘贴发回去就行。'}
  catch(e){$('json').select();$('copymsg').textContent='自动复制没成功：请手动选中下面方框里的全部文字复制。'}
};
dump();
})();
</script>
</div>`;

export const PROBE_PAGE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Practical 发音实测（测试版）</title>
<style>
:root{color-scheme:light dark}
body{margin:0}
${PROBE_CSS}
</style></head><body>
${PROBE_BODY}
</body></html>`;

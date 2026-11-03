/**
 * 素材生成器的页面片段（后台"公共工具 → 素材生成器"；服务端在 src/assets.ts）。
 * 拆成样式 / 结构 / 脚本三段导出，`admin-page.ts` 和测试版那个受限入口（src/probe.ts）都插这三段，**只写一遍**。
 * 写法上的约定（和 admin-page.ts 一样）：这是模板字符串，里面**不能出现没转义的反引号或 ${**。
 *
 * 素材放在哪：图片和音频只存在 Amos 这台电脑的浏览器里（IndexedDB），服务端一个字节都不存；
 * 关掉页面再打开还在（断点续传），生成完按"打包下载"在浏览器里压成 zip。
 * 30 个场景的清单和提示词**不写在本仓库**（C147）：页面上粘贴或上传 JSON 带进来。
 */
export const ASSETS_CSS = `
.ag .box{border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:12px;margin:10px 0}
.ag textarea{width:100%;height:8em;font:12px/1.5 var(--mono);border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;padding:8px}
.ag .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.ag .cost{font-weight:700}
.ag .warn{color:var(--err);font-weight:700}
.ag .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:8px}
.ag figure{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg)}
.ag figure img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
.ag figcaption{font-size:12px;padding:4px 6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ag .sc{border-top:1px solid var(--line);padding:10px 0}
.ag .sc h4{margin:0 0 4px;font-size:14px}
.ag .st{font-size:12px;color:var(--muted)}
.ag audio{width:100%;height:32px}
.ag .bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}
.ag .bar i{display:block;height:100%;background:var(--teal)}
`;

/** 公共工具里的"素材生成器"模块（id 和二级菜单 #/tools/assets 对应：t-assets） */
export const ASSETS_MOD = `<section class="mod ag" id="t-assets"><h2 class="mh">素材生成器<span class="sp"></span><span class="hint">Practical 盲听卡 · 图片和音频</span></h2>
  <div class="box"><p class="lead" style="margin-top:0">一句话：粘一份场景 JSON 进来 → 看清楚这次大概要花多少 neurons → <b>先生成 6 个样片</b>看看出图行不行 → 行再"全部生成" → 最后"打包下载"。
  素材只存在<b>你这台电脑的浏览器里</b>，服务端一个字节都不存；关掉再打开接着跑，已经生成过的不会重来。</p>
  <details><summary>场景 JSON 长什么样（点开看格式）</summary>
    <pre class="st" style="white-space:pre-wrap">{
  "stylePrefix": "（《生产包》第二节那段固定不变的风格前缀）",
  "sample": ["01","03","09","15","21","26"],
  "scenes": [
    { "id": "01", "name": "递订书机", "phrase": "Hand me the stapler",
      "prompts": { "correct": "…", "d1-phoneme": "…", "d2-action": "…", "d3-function": "…" } }
  ]
}</pre>
    <p class="hint">prompts 留空的场景只生成音频，图片这一格会标"还没有提示词"——提示词按《素材方案-交给Amos的生产包》第二节由产品经理补齐，不放在代码里（C147）。</p>
  </details>
  <div class="row"><input type="file" id="ag-file" accept=".json,application/json"><button class="btn small" id="ag-load" type="button">读入这份 JSON</button><span class="msg" id="ag-lmsg" role="status"></span></div>
  <textarea id="ag-json" placeholder="也可以直接把 JSON 粘在这里"></textarea>
  </div>

  <div class="box"><div class="row"><label for="ag-steps">出图步数</label><input type="number" id="ag-steps" value="4" min="1" max="8" style="width:5em">
    <span class="hint">步数越多越贵（每步 9.6 neurons），flux-1-schnell 默认 4、最多 8</span></div>
    <p class="cost" id="ag-cost">还没读入场景。</p>
    <p class="hint" id="ag-quota">额度是你自己管的：这里只把"要花多少、还剩多少"摆出来，不替你设上限，也不改"用量和限额"里的数。</p>
    <div class="row"><button class="btn primary" id="ag-six" type="button">先生成 6 个样片</button><button class="btn" id="ag-all" type="button">全部生成</button><button class="btn danger" id="ag-stop" type="button" hidden>停下</button>
      <button class="btn" id="ag-zip" type="button">打包下载 zip</button></div>
    <div class="bar" id="ag-barwrap" hidden><i id="ag-bar" style="width:0"></i></div>
    <p class="msg" id="ag-msg" role="status"></p>
  </div>

  <div class="box"><p class="st" id="ag-stat">还没生成过。</p><div id="ag-list"></div></div>
</section>`;

/** 素材生成器的脚本（整段 try/catch，出错只影响这一块）。宿主页面先设 window.__assetsBase，例如 '/api/assets/' */
export const ASSETS_JS = `
/* 整段包在一个函数里：和后台自己那段脚本共用一个全局作用域，名字不能重复声明；只往外露一个 window.assetsOpen */
(function(){
try{
var AG={base:(window.__assetsBase||'/api/assets/'),data:null,files:{},stop:false,running:false,db:null};
var agq=function(i){return document.getElementById(i)};
var SLOTS=['audio','correct','d1-phoneme','d2-action','d3-function'];
var SLOTNAME={audio:'音频','correct':'正确图','d1-phoneme':'干扰·音素','d2-action':'干扰·动作','d3-function':'干扰·虚词数字'};

/* 浏览器里的素材库：key = 场景/格子，value = {scene,slot,name,mime,bytes} */
function agOpenDb(){return new Promise(function(res,rej){
  if(AG.db)return res(AG.db);
  var r=indexedDB.open('qc-assets',1);
  r.onupgradeneeded=function(){r.result.createObjectStore('f',{keyPath:'k'})};
  r.onsuccess=function(){AG.db=r.result;res(AG.db)};r.onerror=function(){rej(r.error)};
})}
function agTx(mode){return agOpenDb().then(function(db){return db.transaction('f',mode).objectStore('f')})}
function agPut(v){return agTx('readwrite').then(function(s){return new Promise(function(res,rej){var q=s.put(v);q.onsuccess=function(){res()};q.onerror=function(){rej(q.error)}})})}
function agAll(){return agTx('readonly').then(function(s){return new Promise(function(res,rej){var q=s.getAll();q.onsuccess=function(){res(q.result||[])};q.onerror=function(){rej(q.error)}})})}
function agDel(k){return agTx('readwrite').then(function(s){return new Promise(function(res){var q=s.delete(k);q.onsuccess=function(){res()};q.onerror=function(){res()}})})}

function agMsg(t,err){var e=agq('ag-msg');e.textContent=t||'';e.className='msg'+(err?'':' ok')}
function agCall(path,body){return fetch(AG.base+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'})
  .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.出错||j.error||('出错了（'+r.status+'）'));return j})})}

/* 读入场景 JSON：只认我们要的字段，场景编号限 1～16 位字母数字 */
function agParse(text){
  var o=JSON.parse(text);
  var list=(o&&o.scenes)||[];
  if(!list.length)throw new Error('这份 JSON 里没有 scenes');
  var out=[];
  for(var i=0;i<list.length;i++){
    var s=list[i]||{};
    var id=String(s.id||'').trim();
    if(!/^[A-Za-z0-9_-]{1,16}$/.test(id))throw new Error('第 '+(i+1)+' 个场景的 id 不对：'+id);
    out.push({id:id,name:String(s.name||''),phrase:String(s.phrase||''),prompts:s.prompts||{}});
  }
  return {stylePrefix:String(o.stylePrefix||''),sample:(o.sample||[]).map(String),scenes:out};
}
function agSetData(d){
  AG.data=d;
  agq('ag-lmsg').textContent='读入 '+d.scenes.length+' 个场景'+(d.stylePrefix?'':'（没有 stylePrefix，图片会少了统一风格前缀）');
  agCost();agRender();
}
agq('ag-load').onclick=function(){
  var f=agq('ag-file').files[0];
  var go=function(t){try{agq('ag-json').value=t;agSetData(agParse(t))}catch(e){agq('ag-lmsg').textContent='读不了：'+e.message}};
  if(f){var fr=new FileReader();fr.onload=function(){go(String(fr.result||''))};fr.readAsText(f)}
  else go(agq('ag-json').value);
};

function agPick(six){
  var d=AG.data;if(!d)return [];
  if(!six)return d.scenes;
  if(d.sample&&d.sample.length){return d.scenes.filter(function(s){return d.sample.indexOf(s.id)>=0})}
  return d.scenes.slice(0,6);
}
function agJobs(list){
  var jobs=[],d=AG.data;
  for(var i=0;i<list.length;i++){var s=list[i];
    if(s.phrase)jobs.push({scene:s.id,slot:'audio',text:s.phrase});
    for(var k=1;k<SLOTS.length;k++){var sl=SLOTS[k];var p=s.prompts&&s.prompts[sl];
      if(p)jobs.push({scene:s.id,slot:sl,text:(d.stylePrefix?d.stylePrefix+', ':'')+p});}
  }
  return jobs;
}
function agTodo(jobs){return jobs.filter(function(j){return !AG.files[j.scene+'/'+j.slot]})}

/* 生成前把钱摆出来：这次要花多少、今天还剩多少 */
function agCost(){
  var d=AG.data;if(!d){agq('ag-cost').textContent='还没读入场景。';return}
  var steps=Math.max(1,Math.min(8,Number(agq('ag-steps').value)||4));
  var six=agJobs(agPick(true)),all=agJobs(agPick(false));
  var sixLeft=agTodo(six).length,allLeft=agTodo(all).length;
  var chars=0,n=0;for(var i=0;i<d.scenes.length;i++){if(d.scenes[i].phrase){chars+=d.scenes[i].phrase.length;n++}}
  var q=new URLSearchParams({scenes:String(n),images:String(all.filter(function(j){return j.slot!=='audio'}).length),steps:String(steps),tries:'1',chars:String(n?Math.round(chars/n):30)});
  agCall('plan?'+q).then(function(p){
    agq('ag-cost').innerHTML='全部 '+all.length+' 个文件（还差 '+allLeft+' 个）大约 <b>'+p.需要neurons+'</b> neurons；6 个样片还差 '+sixLeft+' 个，大约 <b>'+Math.round(sixLeft*(p.perImage))+'</b> neurons 以内。'+
      ' 今天已用 <b>'+p.今天已用+'</b> / '+p.今天上限+'，还剩 <b>'+p.今天还剩+'</b>。'+(p.够不够?'':' <span class="warn">今天剩下的额度跑不完全部，可以先跑一批，明天接着跑。</span>');
  }).catch(function(e){agq('ag-cost').textContent='算不出这次要花多少：'+e.message});
}
agq('ag-steps').addEventListener('change',agCost);

function agBar(done,total){agq('ag-barwrap').hidden=!total;agq('ag-bar').style.width=(total?Math.round(done*100/total):0)+'%'}

function agRun(six){
  if(AG.running)return;
  if(!AG.data){agMsg('先读入场景 JSON',true);return}
  var jobs=agTodo(agJobs(agPick(six)));
  if(!jobs.length){agMsg('这一批都已经生成过了，不用再跑一遍。');return}
  var steps=Math.max(1,Math.min(8,Number(agq('ag-steps').value)||4));
  if(!confirm('这一批还要生成 '+jobs.length+' 个文件，大概要花掉今天的一部分 neurons（上面那行写着具体数）。确定开始吗？'))return;
  AG.running=true;AG.stop=false;agq('ag-stop').hidden=false;agq('ag-six').disabled=true;agq('ag-all').disabled=true;
  var done=0;
  var next=function(){
    if(AG.stop||!jobs.length){AG.running=false;agq('ag-stop').hidden=true;agq('ag-six').disabled=false;agq('ag-all').disabled=false;
      agMsg(AG.stop?('停下了，已经生成 '+done+' 个；下次点同一个按钮会接着没生成的跑。'):('这一批 '+done+' 个生成完了。看一遍，不行的点"重做"；都行就"打包下载"。'));
      agCost();agStat();return}
    var j=jobs.shift();
    agMsg('正在生成 '+j.scene+' · '+SLOTNAME[j.slot]+'（还剩 '+(jobs.length+1)+' 个）…');
    agCall('gen',{scene:j.scene,slot:j.slot,text:j.text,steps:steps}).then(function(r){
      var rec={k:j.scene+'/'+j.slot,scene:j.scene,slot:j.slot,name:r.文件名,mime:r.mime,b64:r.base64,neurons:r.本次估算neurons,at:Date.now(),prompt:j.text};
      AG.files[rec.k]=rec;done++;agBar(done,done+jobs.length);agRender();
      return agPut(rec).catch(function(){agMsg('这台电脑存不下素材（浏览器拦了本地存储），生成的东西关掉页面就没了，请先打包下载。',true)});
    }).then(function(){setTimeout(next,120)})
      .catch(function(e){AG.stop=true;agMsg('停在 '+j.scene+' · '+SLOTNAME[j.slot]+'：'+e.message,true);setTimeout(next,0)});
  };
  next();
}
agq('ag-six').onclick=function(){agRun(true)};
agq('ag-all').onclick=function(){agRun(false)};
agq('ag-stop').onclick=function(){AG.stop=true;agMsg('正在停…')};

function agRedo(k){
  var r=AG.files[k];if(!r)return;
  delete AG.files[k];agDel(k);
  agCall('kept',{scene:r.scene,slot:r.slot,kept:false}).catch(function(){});
  agRender();agCost();agMsg('已经删掉这一张，点"先生成 6 个样片"或"全部生成"就会重新生成它。');
}
function agKeep(k){
  var r=AG.files[k];if(!r)return;
  agCall('kept',{scene:r.scene,slot:r.slot,kept:true}).then(agStat).catch(function(){});
}

function agUrl(r){return 'data:'+r.mime+';base64,'+r.b64}
function agRender(){
  var box=agq('ag-list');box.replaceChildren();
  var d=AG.data;if(!d)return;
  for(var i=0;i<d.scenes.length;i++){
    var s=d.scenes[i];
    var sec=document.createElement('div');sec.className='sc';
    var h=document.createElement('h4');h.textContent=s.id+' '+s.name+(s.phrase?'　'+s.phrase:'');sec.appendChild(h);
    var a=AG.files[s.id+'/audio'];
    var p=document.createElement('div');p.className='st';
    if(a){var au=document.createElement('audio');au.controls=true;au.src=agUrl(a);sec.appendChild(au)}
    else p.textContent=s.phrase?'音频还没生成':'没有 phrase，这个场景不生成音频';
    sec.appendChild(p);
    var g=document.createElement('div');g.className='grid';
    for(var k=1;k<SLOTS.length;k++){
      var sl=SLOTS[k],key=s.id+'/'+sl,r=AG.files[key];
      var fig=document.createElement('figure');
      if(r){var im=document.createElement('img');im.src=agUrl(r);im.alt=s.id+' '+SLOTNAME[sl];im.loading='lazy';fig.appendChild(im)}
      var cap=document.createElement('figcaption');cap.append(SLOTNAME[sl]);
      if(r){
        var b1=document.createElement('button');b1.type='button';b1.className='btn small danger';b1.textContent='重做';b1.dataset.k=key;b1.onclick=function(){agRedo(this.dataset.k)};
        var b2=document.createElement('button');b2.type='button';b2.className='btn small';b2.textContent='留用';b2.dataset.k=key;b2.onclick=function(){agKeep(this.dataset.k);this.textContent='已留用'};
        cap.append(b1,b2);
      }else{
        var sp=document.createElement('span');sp.className='st';sp.textContent=(s.prompts&&s.prompts[sl])?'还没生成':'还没有提示词';cap.append(sp);
      }
      fig.appendChild(cap);g.appendChild(fig);
    }
    sec.appendChild(g);box.appendChild(sec);
  }
}
function agStat(){
  return agCall('progress').then(function(p){
    agq('ag-stat').textContent='台账：图片一共生成 '+p.生成次数+' 次，点过"留用"的 '+p.留用张数+' 张，真实出图成功率 '+
      (p.出图成功率===null?'还算不出来':(Math.round(p.出图成功率*100)+'%'))+'。今天已用 '+p.今天已用+' / '+p.今天上限+' neurons。'+
      '（这台电脑现在存着 '+Object.keys(AG.files).length+' 个文件）';
  }).catch(function(e){agq('ag-stat').textContent='台账读不到：'+e.message});
}

/* ---- 打包成 zip（不压缩，图片音频本来就压过了）---- */
var AGCRC=(function(){var t=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function agCrc(u){var c=0xFFFFFFFF;for(var i=0;i<u.length;i++)c=AGCRC[(c^u[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function agBin(b64){var s=atob(b64),u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
function agZip(items){
  var enc=new TextEncoder(),parts=[],central=[],off=0;
  var u16=function(v){return [v&255,(v>>8)&255]},u32=function(v){return [v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255]};
  for(var i=0;i<items.length;i++){
    var nm=enc.encode(items[i].name),data=items[i].data,crc=agCrc(data);
    var lh=new Uint8Array([].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nm.length),u16(0)));
    parts.push(lh,nm,data);
    central.push(new Uint8Array([].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nm.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off))),nm);
    off+=lh.length+nm.length+data.length;
  }
  var cs=0;for(var j=0;j<central.length;j++)cs+=central[j].length;
  var eo=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(items.length),u16(items.length),u32(cs),u32(off),u16(0)));
  return new Blob(parts.concat(central,[eo]),{type:'application/zip'});
}
agq('ag-zip').onclick=function(){
  var keys=Object.keys(AG.files);
  if(!keys.length){agMsg('还没有生成任何素材，没什么可打包的。',true);return}
  var items=[],meta={生成时间:new Date().toISOString(),图片模型:'@cf/black-forest-labs/flux-1-schnell',音频模型:'@cf/myshell-ai/melotts',出图步数:Number(agq('ag-steps').value)||4,风格前缀:(AG.data&&AG.data.stylePrefix)||'',文件:[]};
  keys.sort();
  for(var i=0;i<keys.length;i++){
    var r=AG.files[keys[i]];
    items.push({name:'scene-'+r.scene+'/'+r.name,data:agBin(r.b64)});
    meta.文件.push({场景:r.scene,格子:r.slot,文件:'scene-'+r.scene+'/'+r.name,提示词:r.prompt||'',估算neurons:r.neurons});
  }
  var enc=new TextEncoder();
  items.push({name:'scenes.json',data:enc.encode(JSON.stringify(meta,null,2))});
  items.push({name:'meta.txt',data:enc.encode('模型：flux-1-schnell（图）/ melotts（音频）\\n生成日期：'+new Date().toISOString().slice(0,10)+'\\n完整提示词原文见 scenes.json\\n')});
  var url=URL.createObjectURL(agZip(items));
  var a=document.createElement('a');a.href=url;a.download='practical-素材-'+new Date().toISOString().slice(0,10)+'.zip';document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url)},60000);
  agMsg('已打包 '+items.length+' 个文件。');
};

/* 打开这一页时：先把这台电脑上已经生成的读回来（断点续传），再读台账 */
window.assetsOpen=function(){
  agAll().then(function(rows){
    for(var i=0;i<rows.length;i++)AG.files[rows[i].k]=rows[i];
    if(!AG.data&&agq('ag-json').value.trim()){try{agSetData(agParse(agq('ag-json').value))}catch(e){}}
    agRender();agStat();if(AG.data)agCost();
  }).catch(function(e){agq('ag-stat').textContent='读不到这台电脑上存的素材：'+e.message});
};
}catch(e){try{document.getElementById('ag-msg').textContent='素材生成器这一块出错了：'+e.message}catch(e2){}}
})();
`;

/**
 * 受限入口（只在测试版 marketing-staging，`/probe-<随机串>/assets/`）单独一页。
 * 后台登录不了的时候用它跑《产品方案》M-3 的 6 个样片；样式和脚本和后台里那一块是同一份。
 * 这里的按钮样式是最小一套（后台那套 .btn 在这一页没有），只求能点。
 */
export const ASSETS_PAGE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>素材生成器（测试版）</title>
<style>
:root{color-scheme:light dark;--line:#c9ced8;--surface:transparent;--bg:transparent;--ink:inherit;--muted:#6b7280;--teal:#14B8A6;--err:#B91C1C;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}[hidden]{display:none!important}
body{font:16px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:52em;margin:0 auto;padding:1em 1em 4em}
h2{font-size:1.25em}.mh{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.sp{flex:1}
.hint,.lead,.st{color:var(--muted);font-size:.92em}
.btn{padding:.5em 1em;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer;font-size:.95em}
.btn.primary{background:#3b6ef6;color:#fff;border-color:#3b6ef6}.btn.danger{border-color:var(--err);color:var(--err)}
.btn:disabled{opacity:.5;cursor:default}.btn.small{padding:.25em .6em;font-size:.85em}
.msg{min-height:1.4em}.msg.ok{color:#15803d}
${ASSETS_CSS}
</style></head><body>
<p class="hint"><b>这一页只在测试版有。</b>后台现在还没填密码（Cloudflare 控制台的 COPILOT_PASSWORD），登录不了，所以暂时保留这个入口：
同一分钟点太快会被挡，而且这个入口自己每天只能用一小份额度，够跑 6 个样片；要跑完 30 个场景，请先把密码填上，再从后台"公共工具 → 素材生成器"进来。</p>
${ASSETS_MOD}
<script>window.__assetsBase='';</script>
<script>${ASSETS_JS}</script>
<script>window.assetsOpen();</script>
</body></html>`;

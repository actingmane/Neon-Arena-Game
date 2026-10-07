const $ = id => document.getElementById(id);
let socket=null, meId=null, code=null, host=false, lobbyPlayers=[], selected='blade';
let state={players:[],effects:[],projectiles:[],time:0};
const keys={w:false,a:false,s:false,d:false,shift:false};
const classes={
 blade:{name:'Blade Knight',icon:'⚔️',desc:'Fast melee striker. No block — build Momentum by landing hits.',meta:'175 HP • 275 SPD • Lunge Strike • 4 hits to charge'},
 ranger:{name:'Ranger',icon:'🏹',desc:'Fast ranged fighter. Arrows and Volley.',meta:'165 HP • 285 SPD • Volley'},
 mystic:{name:'Arc Mystic',icon:'✦',desc:'Mobile magic fighter. Bouncing orbs hurt everyone — lightly to yourself, fully to enemies.',meta:'180 HP • 265 SPD • 3 active orbs • Phase Burst • 4 hits to charge'}
};
const canvas=$('canvas'),ctx=canvas.getContext('2d');
function panel(id){document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');}
function toast(msg){$('serverAction').textContent=msg;}
function send(msg){if(socket&&socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(msg));}
function connect(){
 const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
 socket=new WebSocket(url);
 socket.onopen=()=>{$('status').textContent='Connected';document.querySelector('.conn').classList.add('online');};
 socket.onclose=()=>{$('status').textContent='Offline';document.querySelector('.conn').classList.remove('online');setTimeout(connect,1200);};
 socket.onmessage=e=>{const m=JSON.parse(e.data);onMessage(m);};
}
function onMessage(m){
 if(m.type==='created'||m.type==='joined'){meId=m.id;code=m.code;panel('lobby');}
 else if(m.type==='lobby'){code=m.code;lobbyPlayers=m.players;host=!!lobbyPlayers.find(p=>p.id===meId)?.host;keys.w=keys.a=keys.s=keys.d=keys.shift=false;panel('lobby');renderLobby();}
 else if(m.type==='error'){alert(m.message);}
 else if(m.type==='match:start'){panel('battle');state.players=m.players.map(p=>({id:p.id,name:p.name,classId:p.classId,className:p.className,icon:p.icon,x:550,y:340,rot:0,hp:classes[p.classId].hp,maxHp:classes[p.classId].hp,energy:100,specialCharge:0,blocking:false,action:'IDLE',actionTimer:0,dashTimer:0,specialReady:false,dead:false,kills:0,damageDone:0}));state.effects=[];state.projectiles=[];state.time=0;$('matchTitle').textContent=m.players.length===2?'DUEL':'LAST FIGHTER STANDING';}
 else if(m.type==='state'){state.players=m.players;state.effects=m.effects||[];state.projectiles=m.projectiles||[];state.time=m.t;render();}
 else if(m.type==='action'){ $('lastInput').textContent=m.action.toUpperCase(); $('serverAction').textContent=m.ok?'ACCEPTED':'REJECTED'; }
 else if(m.type==='feed'){toast(m.message);}
 else if(m.type==='end'){showEnd(m);}
}
function renderLobby(){
 $('roomCode').textContent=code||'----';$('hostBadge').style.display=host?'inline-block':'none';
 $('classes').innerHTML=Object.entries(classes).map(([id,c])=>`<button class="fighter ${id===selected?'sel':''}" data-class="${id}"><div class="icon">${c.icon}</div><div class="fname">${c.name}</div><div class="desc">${c.desc}</div><div class="meta">${c.meta}</div></button>`).join('');
 document.querySelectorAll('.fighter').forEach(b=>b.onclick=()=>{selected=b.dataset.class;send({type:'class',classId:selected});});
 $('players').innerHTML=lobbyPlayers.map(p=>`<div class="player"><b>${p.icon} ${escape(p.name)}</b><div>${escape(p.className)} • ${p.ready?'READY':'NOT READY'}${p.host?' • HOST':''}</div></div>`).join('');
 $('startBtn').disabled=!(host&&lobbyPlayers.length>=2&&lobbyPlayers.every(p=>p.ready));
}
function escape(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function me(){return state.players.find(p=>p.id===meId);}
function canvasPoint(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
let pointer={x:550,y:340};canvas.addEventListener('pointermove',e=>{pointer=canvasPoint(e);});
function aimRotation(){const f=me();return f?Math.atan2(pointer.y-f.y,pointer.x-f.x):0;}
function dashVector(){let x=(keys.d?1:0)-(keys.a?1:0),y=(keys.s?1:0)-(keys.w?1:0),m=Math.hypot(x,y);if(m<.01)return{x:0,y:0};return{x:x/m,y:y/m};}
function sendInput(){const f=me();if(!f||f.dead||!$('battle').classList.contains('active'))return;send({type:'input',rot:aimRotation(),input:{up:keys.w,down:keys.s,left:keys.a,right:keys.d,block:keys.shift}});}
setInterval(sendInput,50);
function action(name){const f=me();if(!f||f.dead||!$('battle').classList.contains('active'))return; $('lastInput').textContent=name.toUpperCase()+' → SENT';send({type:'action',action:name,rot:aimRotation()});}
window.addEventListener('keydown',e=>{
 // Never steal keyboard input from text fields. This lets names such as "Eve" or "Alex" be typed normally.
 const tag=(e.target?.tagName||'').toLowerCase();
 const editing=tag==='input'||tag==='textarea'||tag==='select'||e.target?.isContentEditable;
 if(editing) return;
 const battleActive=$('battle').classList.contains('active');
 if(!battleActive) return;
 if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','Space','KeyE','KeyQ'].includes(e.code)) e.preventDefault();
 if(e.code==='KeyW')keys.w=true;
 else if(e.code==='KeyA')keys.a=true;
 else if(e.code==='KeyS')keys.s=true;
 else if(e.code==='KeyD')keys.d=true;
 else if(e.code==='ShiftLeft'||e.code==='ShiftRight')keys.shift=true;
 else if(e.code==='Space'&&!e.repeat)action('attack');
 else if(e.code==='KeyE'&&!e.repeat)action('dash');
 else if(e.code==='KeyQ'&&!e.repeat)action('special');
},{passive:false});
window.addEventListener('keyup',e=>{if(e.code==='KeyW')keys.w=false;else if(e.code==='KeyA')keys.a=false;else if(e.code==='KeyS')keys.s=false;else if(e.code==='KeyD')keys.d=false;else if(e.code==='ShiftLeft'||e.code==='ShiftRight')keys.shift=false;});
window.addEventListener('blur',()=>{keys.w=keys.a=keys.s=keys.d=keys.shift=false;});
canvas.addEventListener('pointerdown',e=>{if(e.button===0)action('attack');if(e.button===2){e.preventDefault();keys.shift=true;sendInput();}});window.addEventListener('pointerup',e=>{if(e.button===2)keys.shift=false;});canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.querySelectorAll('[data-action]').forEach(b=>{const a=b.dataset.action;b.addEventListener('click',e=>{e.preventDefault();action(a);});});
$('createBtn').onclick=()=>send({type:'create',name:$('createName').value.trim()||'Player 1'});
$('joinBtn').onclick=()=>send({type:'join',name:$('joinName').value.trim()||'Player',code:$('joinCode').value.trim().toUpperCase()});
$('readyBtn').onclick=()=>{const p=lobbyPlayers.find(x=>x.id===meId);send({type:'ready',value:!p?.ready});};
$('startBtn').onclick=()=>send({type:'start'});$('restartBtn').onclick=()=>send({type:'restart'});
function drawArena(){ctx.fillStyle='#070910';ctx.fillRect(0,0,1100,680);ctx.strokeStyle='#26334d';ctx.lineWidth=6;ctx.strokeRect(55,55,990,570);ctx.strokeStyle='#152038';ctx.lineWidth=1;for(let x=75;x<1040;x+=32){ctx.beginPath();ctx.moveTo(x,55);ctx.lineTo(x,625);ctx.stroke();}for(let y=75;y<625;y+=32){ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(1045,y);ctx.stroke();}ctx.strokeStyle='#1d2a46';ctx.lineWidth=2;ctx.beginPath();ctx.arc(550,340,105,0,Math.PI*2);ctx.stroke();}
function drawFighter(f){const c=classes[f.classId],me=f.id===meId;if(f.dead){ctx.strokeStyle='#6f7788';ctx.lineWidth=3;ctx.beginPath();ctx.arc(f.x,f.y,26,0,Math.PI*2);ctx.stroke();return;}ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rot);if(f.blocking){ctx.fillStyle='rgba(100,220,255,.15)';ctx.strokeStyle='#d9f6ff';ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,48,-1.15,1.15);ctx.fill();ctx.stroke();ctx.strokeStyle='#7edcff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,38,-1.0,1.0);ctx.stroke();}ctx.fillStyle=c===classes.blade?'#5fe0ff':c===classes.ranger?'#64e6a0':'#c7a8ff';ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.fill();ctx.strokeStyle=me?'#fff':'#202939';ctx.lineWidth=me?3:2;ctx.stroke();if(f.classId==='blade'){ctx.strokeStyle='#fff';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(20,6);ctx.lineTo(66,-22);ctx.stroke();ctx.strokeStyle='#9d815e';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(15,6);ctx.lineTo(28,16);ctx.stroke();}else if(f.classId==='ranger'){ctx.strokeStyle='#f2c269';ctx.lineWidth=3;ctx.beginPath();ctx.arc(26,0,20,-1.2,1.2);ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(26,-18);ctx.lineTo(26,18);ctx.stroke();}else{ctx.fillStyle='#efe2ff';ctx.shadowBlur=14;ctx.shadowColor='#c5a6ff';ctx.beginPath();ctx.arc(40,0,9,0,Math.PI*2);ctx.fill();}ctx.restore();
 if(f.action==='ATTACK'){ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rot);ctx.strokeStyle='#e8fbff';ctx.shadowBlur=15;ctx.shadowColor='#5fe0ff';ctx.lineWidth=9;ctx.beginPath();ctx.arc(0,0,f.classId==='blade'?78:45,-1.0,.65);ctx.stroke();ctx.restore();}
 if(f.action==='SPECIAL'){ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(f.x,f.y,55,0,Math.PI*2);ctx.stroke();}
 if(f.classId==='blade' && f.momentumStacks){ctx.fillStyle='#6de8ff';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillText('MOMENTUM ×'+f.momentumStacks,f.x,f.y+57);}
 ctx.fillStyle='#080b12';ctx.fillRect(f.x-34,f.y+34,68,7);ctx.fillStyle='#64e6a0';ctx.fillRect(f.x-34,f.y+34,68*Math.max(0,f.hp/f.maxHp),7);ctx.fillStyle='#eef3ff';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillText(f.name,f.x,f.y-42);
}
function drawProjectiles(){for(const p of state.projectiles){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx));if(p.type==='arrow'){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-14,0);ctx.lineTo(14,0);ctx.stroke();}else if(p.type==='shard'){ctx.fillStyle='#f2e8ff';ctx.shadowBlur=16;ctx.shadowColor='#d3b8ff';ctx.beginPath();ctx.moveTo(13,0);ctx.lineTo(-8,-5);ctx.lineTo(-8,5);ctx.closePath();ctx.fill();}else{ctx.fillStyle='#dbc6ff';ctx.shadowBlur=18;ctx.shadowColor='#caa7ff';ctx.beginPath();ctx.arc(0,0,10,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}ctx.restore();}}
function drawEffects(){for(const e of state.effects){ctx.save();ctx.globalAlpha=Math.min(1,e.ttl*4);if(e.type==='sword'||e.type==='whirlwind'){ctx.translate(e.x,e.y);ctx.rotate(e.rot);ctx.strokeStyle='#eaffff';ctx.shadowBlur=18;ctx.shadowColor='#6de8ff';ctx.lineWidth=e.type==='whirlwind'?10:8;ctx.beginPath();ctx.arc(0,0,e.type==='whirlwind'?95:72,-1.25,.8);ctx.stroke();}else if(e.type==='bladeLunge'){ctx.strokeStyle='#eaffff';ctx.shadowBlur=18;ctx.shadowColor='#5fe0ff';ctx.lineWidth=11;ctx.beginPath();ctx.moveTo(e.from.x,e.from.y);ctx.lineTo(e.x,e.y);ctx.stroke();ctx.translate(e.x,e.y);ctx.rotate(e.rot);ctx.strokeStyle='#fff';ctx.lineWidth=7;ctx.beginPath();ctx.arc(0,0,78,-1.1,.7);ctx.stroke();}else if(e.type==='dash'){ctx.strokeStyle='#fff';ctx.shadowBlur=14;ctx.shadowColor='#5fe0ff';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(e.from.x,e.from.y);ctx.lineTo(e.x,e.y);ctx.stroke();}else if(e.type==='hit'||e.type==='guardbreak'){ctx.strokeStyle=e.type==='guardbreak'?'#ffcd6a':'#fff';ctx.lineWidth=4;for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(e.x+Math.cos(a)*5,e.y+Math.sin(a)*5);ctx.lineTo(e.x+Math.cos(a)*26,e.y+Math.sin(a)*26);ctx.stroke();}}else if(e.type==='blink'){ctx.strokeStyle='#c9adff';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(e.from.x,e.from.y);ctx.lineTo(e.x,e.y);ctx.stroke();}else if(e.type==='orbBounce'){ctx.strokeStyle='#d9c4ff';ctx.shadowBlur=12;ctx.shadowColor='#b38cff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,17,0,Math.PI*2);ctx.stroke();}else if(e.type==='orbExpire'){ctx.strokeStyle='#aa91d4';ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,12,0,Math.PI*2);ctx.stroke();}else if(e.type==='nova'){ctx.strokeStyle='#e5d1ff';ctx.lineWidth=7;ctx.beginPath();ctx.arc(e.x,e.y,65,0,Math.PI*2);ctx.stroke();}else if(e.type==='phaseBurst'){ctx.strokeStyle='#f0dcff';ctx.shadowBlur=18;ctx.shadowColor='#b58cff';ctx.lineWidth=6;ctx.beginPath();ctx.arc(e.x,e.y,72,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,36,0,Math.PI*2);ctx.stroke();}ctx.restore();}}
function render(){drawArena();drawProjectiles();drawEffects();state.players.forEach(drawFighter);$('timer').textContent=Math.max(0,MATCH_TIME-state.time).toFixed(1);const f=me();if(f){$('meName').textContent=f.name;$('meClass').textContent=f.className;$('hp').style.width=(100*f.hp/f.maxHp)+'%';$('hpText').textContent=Math.max(0,Math.round(f.hp))+' / '+f.maxHp+' HP';$('energy').textContent=f.energy+' ST';$('action').textContent=f.action;$('specialName').textContent=classes[f.classId].name+' • '+({blade:'Lunge Strike',ranger:'Volley',mystic:'Phase Burst'}[f.classId]);$('specialState').textContent=(f.specialCharge>=100)?'READY':`${Math.round(f.specialCharge||0)}%`;$('blockState').textContent=f.classId==='blade'?'UNAVAILABLE':(f.blocking?'ACTIVE':(f.blockCooldown>0?`${f.blockCooldown.toFixed(1)}s`:'READY'));
 const blockBtn=document.querySelector('[data-action="block"]'); if(blockBtn){ blockBtn.disabled=f.classId==='blade'; blockBtn.textContent=f.classId==='blade'?'🚫 NO BLOCK':'🛡 BLOCK SHIFT'; } const specialBtn=document.querySelector('[data-action="special"]'); if(specialBtn){ specialBtn.disabled=(f.specialCharge||0)<100; specialBtn.textContent=(f.specialCharge||0)>=100?'✨ SPECIAL Q • READY':`✨ SPECIAL Q • ${Math.round(f.specialCharge||0)}%`; }$('orbLabel').textContent=f.classId==='mystic'?'Mystic Orbs':f.classId==='blade'?'Momentum':'Projectile';$('orbState').textContent=f.classId==='mystic'?`${f.orbCount||0}/3`:f.classId==='blade'?`${f.momentumStacks||0}/3`:'—';$('myDamage').textContent=f.damageDone||0;}$('board').innerHTML=state.players.map((p,i)=>`<div class="row ${p.id===meId?'me':''} ${p.dead?'out':''}"><span>${i+1}</span><span>${p.icon}</span><b>${escape(p.name)}</b><small>${p.dead?'OUT':p.hp+' HP'} • ${p.kills} KO</small></div>`).join('');}
const MATCH_TIME=90;
function showEnd(m){panel('result');$('resultTitle').textContent=m.tie?'🤝 TIE':'🏆 '+(m.winner?.id===meId?'YOU WIN':'MATCH OVER');$('resultText').textContent=m.reason==='time'?(m.combat?'Time expired — higher remaining HP wins.':'No successful attacks landed — the match is a tie.'):(m.reason==='double-ko'?'Double KO — tie.':'Elimination.');$('winner').textContent=m.tie?'No winner':(m.winner?.name||'—');$('final').innerHTML=m.standings.map(s=>`<div class="finalRow"><span>#${s.rank}</span><b>${escape(s.name)}</b><span>${classes[s.classId].name}</span><span>${s.hp} HP</span></div>`).join('');}
connect();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const clients = new Set();

const ARENA = { w: 1100, h: 680, margin: 55 };
const MATCH_TIME = 90;
const TICK = 50;
const MAX_PLAYERS = 3;
const BLOCK_ACTIVE_TIME = 1.0;
const BLOCK_COOLDOWN = 1.0;
const BLOCK_RESET_TIME = 2.0;
const SPECIAL_MAX = 100;
const SPECIAL_HIT_CHARGE = 25;
const MYSTIC_SELF_ORB_DAMAGE = 0.2;

const CLASSES = {
  blade: { name: 'Blade Knight', icon: '⚔️', weapon: 'sword', hp: 175, speed: 275, attackDamage: 20, attackRange: 118, attackCooldown: .45, energyRegen: 20, special: 'Lunge Strike', specialCost: 35, specialCooldown: 5.0 },
  ranger: { name: 'Ranger', icon: '🏹', weapon: 'bow', hp: 165, speed: 285, attackDamage: 18, attackRange: 520, attackCooldown: 1.0, energyRegen: 20, special: 'Volley', specialCost: 40, specialCooldown: 5.5 },
  mystic: { name: 'Arc Mystic', icon: '✦', weapon: 'staff', hp: 180, speed: 265, attackDamage: 21, attackRange: 400, attackCooldown: 1.0, energyRegen: 19, special: 'Phase Burst', specialCost: 42, specialCooldown: 5.2 }
};

const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
const len = (x,y) => Math.hypot(x,y) || 1;
const norm = (x,y) => { const m = len(x,y); return {x:x/m,y:y/m}; };
const safe = s => String(s || 'Player').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,18) || 'Player';
const id = () => crypto.randomBytes(4).toString('hex');
function roomCode(){ let c; do c=crypto.randomBytes(2).toString('hex').toUpperCase(); while(rooms.has(c)); return c; }

function send(client, msg){
  if (!client || client.socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(msg));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header=Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(data.length,2); }
  else { header=Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(data.length),2); }
  client.socket.write(Buffer.concat([header,data]));
}
function broadcast(room,msg){ for (const p of room.players.values()) send(p.client,msg); }

function publicLobby(p, room){ const c=CLASSES[p.classId]; return {id:p.id,name:p.name,host:p.id===room.hostId,ready:p.ready,classId:p.classId,className:c.name,icon:c.icon}; }
function lobby(room){ return [...room.players.values()].map(p=>publicLobby(p,room)); }

function spawnFor(n,i){
  const cx=ARENA.w/2, cy=ARENA.h/2, radius=Math.min(255,170+n*12); const a=-Math.PI/2+i*(Math.PI*2/n);
  return {x:cx+Math.cos(a)*radius,y:cy+Math.sin(a)*radius,rot:a+Math.PI/2};
}
function fighter(p, spawn){
  const d=CLASSES[p.classId];
  return { id:p.id, name:p.name, classId:p.classId, def:d,
    x:spawn.x,y:spawn.y,rot:spawn.rot,hp:d.hp,maxHp:d.hp,energy:100,
    input:{up:false,down:false,left:false,right:false}, blockHeld:false, blocking:false,
    action:'IDLE', actionTimer:0, attackCooldown:0, specialCooldown:0, dashCooldown:0,
    specialCharge:0,
    vx:0,vy:0, dashTimer:0, hitStun:0, flash:0, shieldBreak:0,
    blockActiveTimer:0, blockCooldown:0, blockSequence:0, blockQuiet:BLOCK_RESET_TIME, wasBlocking:false, blockMoveMultiplier:.55, dead:false,
    damageDone:0,kills:0, successfulHits:0, momentumStacks:0, momentumTimer:0
  };
}

function startMatch(room){
  const ps=[...room.players.values()];
  const fighters=new Map(ps.map((p,i)=>[p.id,fighter(p,spawnFor(ps.length,i))]));
  room.phase='match';
  room.match={start:Date.now(),last:Date.now(),fighters,effects:[],projectiles:[],nextProjectileId:1,ended:false,combat:false,timer:null};
  broadcast(room,{type:'match:start',duration:MATCH_TIME,players:ps.map(p=>publicLobby(p,room))});
  room.match.timer=setInterval(()=>tick(room),TICK);
}
function alive(match){ return [...match.fighters.values()].filter(f=>!f.dead); }
function setAction(f,name,duration){ f.action=name; f.actionTimer=Math.max(f.actionTimer,duration); }
function addEffect(match,e){ match.effects.push(e); }
function applyDamage(match,attacker,target,raw,source,grantSpecialCharge=true){
  const selfOrb=!!attacker && !!target && attacker.id===target.id && source==='orb';
  if(!attacker || !target || (attacker.id===target.id && !selfOrb) || target.dead || raw<=0) return 0;
  let damage=raw;
  if(selfOrb) damage*=MYSTIC_SELF_ORB_DAMAGE;
  if(target.blocking){
    damage*=.2;
    target.energy=Math.max(0,target.energy-raw*.9);
    if(target.energy<=0){
      target.blocking=false; target.blockHeld=false; target.shieldBreak=.45; target.blockQuiet=0; target.hitStun=.28; setAction(target,'GUARD BREAK',.45);
      addEffect(match,{type:'guardbreak',x:target.x,y:target.y,ttl:.5}); damage=raw*.75;
    }
  }
  target.hp=Math.max(0,target.hp-damage); target.hitStun=Math.max(target.hitStun,target.blocking?.03:.12); target.flash=.18;
  if(!selfOrb){ attacker.damageDone+=damage; attacker.successfulHits+=1; match.combat=true; if(grantSpecialCharge) attacker.specialCharge=Math.min(SPECIAL_MAX, attacker.specialCharge+SPECIAL_HIT_CHARGE); }
  else { match.combat=true; }
  if(target.classId==='blade' && !selfOrb){ target.momentumStacks=0; target.momentumTimer=0; }
  addEffect(match,{type:'hit',x:target.x,y:target.y,ttl:.28,damage:Math.round(damage)});
  if(target.hp<=0){ target.dead=true; target.blocking=false; if(!selfOrb) attacker.kills+=1; setAction(target,'KO',1); addEffect(match,{type:'ko',x:target.x,y:target.y,ttl:1}); if(!selfOrb){ const room=findRoom(match); if(room) broadcast(room,{type:'feed',message:`${attacker.name} eliminated ${target.name}!`}); } }
  return damage;
}
function doBladeHit(match,f,damage,range,cosine,grantSpecialCharge=true){
  const fx=Math.cos(f.rot), fy=Math.sin(f.rot);
  let hits=0;
  for(const t of alive(match)){
    if(t.id===f.id) continue;
    const dx=t.x-f.x,dy=t.y-f.y,d=Math.hypot(dx,dy);
    if(d>range) continue;
    const u=norm(dx,dy); if(fx*u.x+fy*u.y<cosine) continue;
    if(applyDamage(match,f,t,damage,'melee',grantSpecialCharge)>0) hits++;
  }
  return hits;
}
function doBladeLungeHit(match,f,from,to,damage){
  const sx=to.x-from.x, sy=to.y-from.y;
  const segLen2=sx*sx+sy*sy || 1;
  let hits=0;
  for(const t of alive(match)){
    if(t.id===f.id) continue;
    const px=t.x-from.x, py=t.y-from.y;
    const u=clamp((px*sx+py*sy)/segLen2,0,1);
    const cx=from.x+sx*u, cy=from.y+sy*u;
    const segmentDist=Math.hypot(t.x-cx,t.y-cy);
    const endDist=Math.hypot(t.x-to.x,t.y-to.y);
    // The special is a reliable lunge strike: enemies hit along the travel
    // path OR caught in the impact zone at the destination take damage once.
    if(segmentDist>50 && endDist>92) continue;
    if(applyDamage(match,f,t,damage,'melee',false)>0) hits++;
  }
  return hits;
}
function projectile(match,f,angle,damage,type,isSpecial=false){
  const x=f.x+Math.cos(angle)*30,y=f.y+Math.sin(angle)*30,speed=type==='arrow'?840:type==='shard'?760:620;
  if(type==='orb'){
    const owned=match.projectiles.filter(p=>p.type==='orb'&&p.owner===f.id);
    if(owned.length>=3){
      const oldest=owned.sort((a,b)=>a.created-b.created)[0];
      match.projectiles=match.projectiles.filter(p=>p!==oldest);
      addEffect(match,{type:'orbExpire',x:oldest.x,y:oldest.y,ttl:.2});
    }
  }
  match.projectiles.push({id:match.nextProjectileId++,x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,owner:f.id,damage,type,isSpecial,chargeOnHit:!isSpecial,ttl:type==='orb'?8:1.5,radius:type==='arrow'?6:type==='shard'?7:10,created:match.nextProjectileId,bounces:0});
  addEffect(match,{type:type==='arrow'?'arrowFire':'magicFire',x:f.x,y:f.y,rot:angle,ttl:.22});
}
function attack(room,f){
  const m=room.match,d=f.def;
  if(f.dead||f.hitStun>0||f.attackCooldown>0||f.blocking||f.dashTimer>0) return false;
  f.attackCooldown=d.attackCooldown; f.energy=Math.max(0,f.energy-6); f.flash=.08; setAction(f,'ATTACK',.26);
  if(f.classId==='blade'){
    const boostedDamage=d.attackDamage*(1+0.15*f.momentumStacks);
    const hits=doBladeHit(m,f,boostedDamage,d.attackRange,.12);
    if(hits>0){ f.momentumStacks=Math.min(3,f.momentumStacks+1); f.momentumTimer=2.2; }
    addEffect(m,{type:'sword',x:f.x,y:f.y,rot:f.rot,ttl:.3,playerId:f.id,damage:Math.round(boostedDamage),momentum:f.momentumStacks});
  }else if(f.classId==='ranger') projectile(m,f,f.rot,d.attackDamage,'arrow',false);
  else projectile(m,f,f.rot,d.attackDamage,'orb',false);
  return true;
}
function special(room,f){
  const m=room.match;
  if(f.dead||f.hitStun>0||f.specialCharge<SPECIAL_MAX||f.blocking||f.dashTimer>0) return false;
  f.specialCharge=0; f.flash=.2; setAction(f,'SPECIAL',.55);
  if(f.classId==='blade'){
    const old={x:f.x,y:f.y}; f.x=clamp(f.x+Math.cos(f.rot)*145,ARENA.margin,ARENA.w-ARENA.margin); f.y=clamp(f.y+Math.sin(f.rot)*145,ARENA.margin,ARENA.h-ARENA.margin);
    const boostedDamage=44*(1+0.10*f.momentumStacks);
    const hits=doBladeLungeHit(m,f,old,{x:f.x,y:f.y},boostedDamage);
    if(hits>0){ f.momentumStacks=Math.min(3,f.momentumStacks+1); f.momentumTimer=2.2; }
    addEffect(m,{type:'bladeLunge',from:old,x:f.x,y:f.y,rot:f.rot,ttl:.45,playerId:f.id,damage:Math.round(boostedDamage)});
  }else if(f.classId==='ranger'){
    for(const off of [-.30,-.15,0,.15,.30]) projectile(m,f,f.rot+off,13,'arrow',true);
    addEffect(m,{type:'volley',x:f.x,y:f.y,rot:f.rot,ttl:.58,playerId:f.id});
  }else{
    const old={x:f.x,y:f.y};
    f.x=clamp(f.x-Math.cos(f.rot)*105,ARENA.margin,ARENA.w-ARENA.margin);
    f.y=clamp(f.y-Math.sin(f.rot)*105,ARENA.margin,ARENA.h-ARENA.margin);
    addEffect(m,{type:'blink',from:old,x:f.x,y:f.y,ttl:.55});
    for(let i=0;i<8;i++) projectile(m,f,(Math.PI*2*i)/8,12,'shard',true);
    addEffect(m,{type:'phaseBurst',x:f.x,y:f.y,ttl:.6,playerId:f.id});
  }
  return true;
}
function dash(room,f){
  if(f.dead||f.hitStun>0||f.dashCooldown>0||f.energy<18||f.blocking) return false;
  let dx=f.input.right?1:0, dy=f.input.down?1:0; if(f.input.left)dx-=1; if(f.input.up)dy-=1;
  if(Math.hypot(dx,dy)<.1){dx=-Math.cos(f.rot);dy=-Math.sin(f.rot);} else {const n=norm(dx,dy);dx=n.x;dy=n.y;}
  f.energy-=18;f.dashCooldown=.75;f.dashTimer=.20;f.vx=dx*820;f.vy=dy*820;setAction(f,'DASH',.22);
  addEffect(room.match,{type:'dash',from:{x:f.x,y:f.y},x:clamp(f.x+dx*150,ARENA.margin,ARENA.w-ARENA.margin),y:clamp(f.y+dy*150,ARENA.margin,ARENA.h-ARENA.margin),ttl:.28});
  return true;
}
function updateProjectiles(room,dt){
  const m=room.match,next=[];
  const minX=ARENA.margin+10,maxX=ARENA.w-ARENA.margin-10,minY=ARENA.margin+10,maxY=ARENA.h-ARENA.margin-10;
  for(const p of m.projectiles){
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.ttl-=dt;
    if(p.ttl<=0) continue;
    if(p.type==='orb'){
      let bounced=false;
      if(p.x<=minX){p.x=minX;p.vx=Math.abs(p.vx);bounced=true;}
      else if(p.x>=maxX){p.x=maxX;p.vx=-Math.abs(p.vx);bounced=true;}
      if(p.y<=minY){p.y=minY;p.vy=Math.abs(p.vy);bounced=true;}
      else if(p.y>=maxY){p.y=maxY;p.vy=-Math.abs(p.vy);bounced=true;}
      if(bounced){p.bounces=(p.bounces||0)+1;addEffect(m,{type:'orbBounce',x:p.x,y:p.y,ttl:.16});}
    }else if(p.x<ARENA.margin||p.x>ARENA.w-ARENA.margin||p.y<ARENA.margin||p.y>ARENA.h-ARENA.margin){
      continue;
    }
    let hit=false;
    for(const t of alive(m)){
      if(t.id===p.owner && p.type!=='orb')continue;
      if(Math.hypot(t.x-p.x,t.y-p.y)<p.radius+22){ const a=m.fighters.get(p.owner);if(a)applyDamage(m,a,t,p.damage,p.type,p.chargeOnHit);addEffect(m,{type:'hit',x:p.x,y:p.y,ttl:.22});hit=true;break; }
    }
    if(!hit)next.push(p);
  }
  m.projectiles=next;
}
function tick(room){
  const m=room.match;if(!m||room.phase!=='match'||m.ended)return;
  const now=Date.now(),dt=Math.min(.1,(now-m.last)/1000);m.last=now;m.elapsed=(now-m.start)/1000;
  for(const f of m.fighters.values()){
    f.def=CLASSES[f.classId];
    f.momentumTimer=Math.max(0,f.momentumTimer-dt);
    if(f.momentumTimer<=0) f.momentumStacks=0;
    if(f.classId==='blade'){ f.blockHeld=false; f.blocking=false; f.blockActiveTimer=0; f.blockCooldown=0; }
    f.attackCooldown=Math.max(0,f.attackCooldown-dt);f.specialCooldown=Math.max(0,f.specialCooldown-dt);f.dashCooldown=Math.max(0,f.dashCooldown-dt);f.dashTimer=Math.max(0,f.dashTimer-dt);f.hitStun=Math.max(0,f.hitStun-dt);f.flash=Math.max(0,f.flash-dt);f.shieldBreak=Math.max(0,f.shieldBreak-dt);f.actionTimer=Math.max(0,f.actionTimer-dt);f.blockCooldown=Math.max(0,f.blockCooldown-dt);
    if(f.dead){f.action='KO';continue;}
    if(f.blockQuiet < BLOCK_RESET_TIME) f.blockQuiet += dt;
    if(!f.blockHeld && !f.blocking && f.blockQuiet >= BLOCK_RESET_TIME) f.blockSequence=0;

    if(f.blocking){
      const blockedCanContinue=f.blockHeld && f.hitStun<=0 && f.shieldBreak<=0 && f.energy>0 && f.blockActiveTimer>0;
      if(!blockedCanContinue){
        f.blocking=false;
        f.blockActiveTimer=0;
        f.blockCooldown=Math.max(f.blockCooldown,BLOCK_COOLDOWN);
        if(f.energy<=0) f.blockHeld=false;
        if(f.shieldBreak>0) f.blockHeld=false;
        setAction(f,'BLOCK RECOVER',.16);
      }else{
        f.blockActiveTimer=Math.max(0,f.blockActiveTimer-dt);
        f.energy=Math.max(0,f.energy-12*dt);
        setAction(f,'BLOCK',.04);
        if(f.blockActiveTimer<=0){
          f.blocking=false;
          f.blockCooldown=BLOCK_COOLDOWN;
          setAction(f,'BLOCK RECOVER',.16);
        }
      }
    }

    const canStartBlock=f.classId!=='blade'&&f.blockHeld&&f.blockCooldown<=0&&f.blockActiveTimer<=0&&f.hitStun<=0&&f.actionTimer<=0&&f.shieldBreak<=0&&f.dashTimer<=0&&f.energy>0;
    if(!f.blocking && canStartBlock){
      f.blockSequence=Math.min(3,f.blockSequence+1);
      f.blockQuiet=0;
      f.blockActiveTimer=BLOCK_ACTIVE_TIME;
      f.blockMoveMultiplier=[0,.55,.40,.28][f.blockSequence] || .28;
      f.blocking=true;
      setAction(f,'BLOCK',.04);
    }

    if(!f.blocking) f.energy=Math.min(100,f.energy+f.def.energyRegen*dt);
    f.wasBlocking=f.blocking;
    if(f.dashTimer>0){f.x=clamp(f.x+f.vx*dt,ARENA.margin,ARENA.w-ARENA.margin);f.y=clamp(f.y+f.vy*dt,ARENA.margin,ARENA.h-ARENA.margin);}
    else if(f.hitStun<=0&&(f.actionTimer<=0||f.blocking)){
      let mx=(f.input.right?1:0)-(f.input.left?1:0),my=(f.input.down?1:0)-(f.input.up?1:0);const n=Math.hypot(mx,my);
      if(n>0){mx/=n;my/=n;const mult=f.blocking?f.blockMoveMultiplier:1;f.x=clamp(f.x+mx*f.def.speed*mult*dt,ARENA.margin,ARENA.w-ARENA.margin);f.y=clamp(f.y+my*f.def.speed*mult*dt,ARENA.margin,ARENA.h-ARENA.margin);if(!f.blocking)setAction(f,'MOVE',.08);}
      else if(f.actionTimer<=0&&!f.blocking)f.action='IDLE';
    }
    if(f.actionTimer<=0&&!f.blocking&&!f.dashTimer&&!f.hitStun&&!(f.input.up||f.input.down||f.input.left||f.input.right)) f.action='IDLE';
  }
  updateProjectiles(room,dt);m.effects=m.effects.filter(e=>(e.ttl-=dt)>0);
  const living=alive(m);
  if((living.length<=1)||(m.elapsed>=MATCH_TIME)){finish(room);return;}
  broadcast(room,{type:'state',t:m.elapsed,players:[...m.fighters.values()].map(f=>publicFighter(f,m)),effects:m.effects,projectiles:m.projectiles});
}
function publicFighter(f,match){const orbCount=match?match.projectiles.filter(p=>p.type==='orb'&&p.owner===f.id).length:0;return{id:f.id,name:f.name,classId:f.classId,className:f.def.name,icon:f.def.icon,x:f.x,y:f.y,rot:f.rot,hp:Math.round(f.hp*10)/10,maxHp:f.maxHp,energy:Math.round(f.energy),specialCharge:Math.round(f.specialCharge),blocking:f.blocking,blockCooldown:Math.round(f.blockCooldown*100)/100,blockActiveTimer:Math.round(f.blockActiveTimer*100)/100,action:f.action,actionTimer:f.actionTimer,dashTimer:f.dashTimer,specialReady:f.specialCharge>=SPECIAL_MAX,dead:f.dead,kills:f.kills,damageDone:Math.round(f.damageDone),successfulHits:f.successfulHits,orbCount,momentumStacks:f.momentumStacks};}
function findRoom(match){for(const r of rooms.values())if(r.match===match)return r;return null;}
function finish(room){
  const m=room.match;if(!m||m.ended)return;m.ended=true;if(m.timer)clearInterval(m.timer);m.timer=null;
  const living=alive(m);let winner=null,tie=false,reason='elimination';
  if(m.elapsed>=MATCH_TIME){reason='time'; if(!m.combat)tie=true; else {const max=Math.max(...living.map(f=>f.hp));const tops=living.filter(f=>Math.abs(f.hp-max)<.01);if(tops.length===1)winner=tops[0];else tie=true;}}
  else if(living.length===1)winner=living[0]; else tie=true,reason='double-ko';
  const standings=[...m.fighters.values()].sort((a,b)=>b.hp-a.hp||b.damageDone-a.damageDone||b.kills-a.kills).map((f,i)=>({rank:i+1,name:f.name,classId:f.classId,hp:Math.max(0,Math.round(f.hp)),kills:f.kills,damage:Math.round(f.damageDone)}));
  room.phase='result';broadcast(room,{type:'end',winner:winner?publicFighter(winner,m):null,tie,reason,combat:m.combat,standings});
}

function handle(client,msg){
  let m;try{m=JSON.parse(msg)}catch{return;}
  let room=client.room?rooms.get(client.room):null;const p=client.player;
  if(m.type==='create'){
    let code=roomCode();const pl={id:client.id,name:safe(m.name),client,ready:false,classId:'blade'};const r={code,hostId:pl.id,players:new Map([[pl.id,pl]]),phase:'lobby',match:null};rooms.set(code,r);client.room=code;client.player=pl;send(client,{type:'created',code,id:pl.id});broadcast(r,{type:'lobby',code,players:lobby(r)});
  } else if(m.type==='join'){
    const code=safe(m.code).toUpperCase();room=rooms.get(code);if(!room)return send(client,{type:'error',message:'Room not found.'});if(room.phase!=='lobby')return send(client,{type:'error',message:'Match already started.'});if(room.players.size>=MAX_PLAYERS)return send(client,{type:'error',message:`Room is full. Maximum ${MAX_PLAYERS} players.`});const pl={id:client.id,name:safe(m.name),client,ready:false,classId:'blade'};room.players.set(pl.id,pl);client.room=code;client.player=pl;send(client,{type:'joined',code,id:pl.id});broadcast(room,{type:'lobby',code,players:lobby(room)});
  } else if(m.type==='class'){
    if(room&&p&&room.phase==='lobby'&&CLASSES[m.classId]){p.classId=m.classId;p.ready=false;broadcast(room,{type:'lobby',code:room.code,players:lobby(room)});}
  } else if(m.type==='ready'){
    if(room&&p&&room.phase==='lobby'){p.ready=!!m.value;broadcast(room,{type:'lobby',code:room.code,players:lobby(room)});}
  } else if(m.type==='start'){
    if(!room||!p||room.hostId!==p.id||room.players.size<2||[...room.players.values()].some(x=>!x.ready))return send(client,{type:'error',message:'Need 2+ players and everyone ready.'});startMatch(room);
  } else if(m.type==='input'){
    if(!room||!p||room.phase!=='match')return;const f=room.match.fighters.get(p.id);if(!f||f.dead)return;const i=m.input||{};f.input.up=!!i.up;f.input.down=!!i.down;f.input.left=!!i.left;f.input.right=!!i.right;f.blockHeld=!!i.block;if(Number.isFinite(m.rot))f.rot=m.rot;
  } else if(m.type==='action'){
    if(!room||!p||room.phase!=='match')return;const f=room.match.fighters.get(p.id);if(!f||f.dead)return;if(Number.isFinite(m.rot))f.rot=m.rot;let ok=false; if(m.action==='attack')ok=attack(room,f);else if(m.action==='dash')ok=dash(room,f);else if(m.action==='special')ok=special(room,f);else if(m.action==='block')ok=f.classId!=='blade';send(client,{type:'action',action:m.action,ok});
  } else if(m.type==='restart'){
    // Any player can return the group to the lobby from the results screen.
    // This fixes the old silent no-op when a non-host clicked the button.
    if(room&&p&&(room.phase==='result'||room.phase==='match')){
      if(room.match?.timer)clearInterval(room.match.timer);
      room.phase='lobby';
      room.match=null;
      for(const x of room.players.values())x.ready=false;
      broadcast(room,{type:'lobby',code:room.code,players:lobby(room)});
    }
  }
}

function parseFrames(client,chunk){
  client.buffer=Buffer.concat([client.buffer||Buffer.alloc(0),chunk]);
  while(client.buffer.length>=2){const b1=client.buffer[0],b2=client.buffer[1];if((b1&0xf)===8){client.socket.end();return;}let len=b2&0x7f,off=2;if(len===126){if(client.buffer.length<4)return;len=client.buffer.readUInt16BE(2);off=4;}else if(len===127){if(client.buffer.length<10)return;len=Number(client.buffer.readBigUInt64BE(2));off=10;}const masked=(b2&0x80)!==0;if(masked)off+=4;if(client.buffer.length<off+len)return;let payload=client.buffer.subarray(off,off+len);if(masked){const mask=client.buffer.subarray(off-4,off),out=Buffer.alloc(len);for(let i=0;i<len;i++)out[i]=payload[i]^mask[i%4];payload=out;}client.buffer=client.buffer.subarray(off+len);if((b1&0xf)===1)handle(client,payload.toString('utf8'));}
}
function upgrade(req,socket){
  const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c={socket,id:id(),room:null,player:null,buffer:Buffer.alloc(0)};clients.add(c);socket.on('data',d=>parseFrames(c,d));socket.on('close',()=>disconnect(c));socket.on('error',()=>disconnect(c));send(c,{type:'hello'});
}
function disconnect(c){if(!clients.has(c))return;clients.delete(c);const r=c.room&&rooms.get(c.room);if(!r)return;if(c.player)r.players.delete(c.player.id);if(!r.players.size){if(r.match?.timer)clearInterval(r.match.timer);rooms.delete(r.code);return;}if(r.hostId===c.player?.id)r.hostId=r.players.keys().next().value;if(r.phase==='lobby')broadcast(r,{type:'lobby',code:r.code,players:lobby(r)});}

http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,version:'12.0.0'}));}let file=req.url.split('?')[0];if(file==='/')file='/index.html';const fp=path.join(PUBLIC,path.normalize(file));if(!fp.startsWith(PUBLIC)){res.writeHead(403);return res.end();}fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found');}const ext=path.extname(fp);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream','Cache-Control':'no-store'});res.end(d);});}).on('upgrade',upgrade).listen(PORT,HOST,()=>console.log(`Neon Clash Arena v11 running on http://localhost:${PORT}`));

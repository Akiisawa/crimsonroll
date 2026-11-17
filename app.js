/* ==================== FIREBASE ==================== */
const firebaseConfig={
  apiKey:"AIzaSyDxlo3ZJcjJLohpvP3oG4JMqlXPFZy5QII",
  authDomain:"sacolao-extra.firebaseapp.com",
  databaseURL:"https://sacolao-extra-default-rtdb.firebaseio.com",
  projectId:"sacolao-extra",
  storageBucket:"sacolao-extra.firebasestorage.app",
  messagingSenderId:"716321304746",
  appId:"1:716321304746:web:6cbf895671096b2a0de0d3"
};
firebase.initializeApp(firebaseConfig);

// Refs ficam nulos até autenticar
let cloudRef = null;
let cloudConnected = null;
let cloudReady = false;
let localWriteTime = 0;
let _firebaseAuthed = false;

// 1) Autentica anonimamente PRIMEIRO
firebase.auth().signInAnonymously()
  .then(()=>{
    _firebaseAuthed = true;
    // 2) Só DEPOIS cria as refs e conecta
    cloudRef = firebase.database().ref('xK9mP2qW7zR4v/state');
    cloudConnected = firebase.database().ref('.info/connected');
    attachFirebaseListeners();
  })
  .catch(err=>{
    console.error('Auth anônima falhou:', err);
    const el=$('#syncStatus');
    if(el){ el.classList.add('offline'); $('#syncText').textContent='auth falhou'; }
  });

function attachFirebaseListeners(){
  cloudConnected.on('value',snap=>{
    if(snap.val()===true){updateSyncStatus('online','sincronizado');cloudReady=true;}
    else updateSyncStatus('offline','offline');
  });

  cloudRef.on('value',snap=>{
    const data=snap.val();
    if(!data){
      // Servidor vazio: envia o estado completo
      localWriteTime=Date.now();
      const toSend={...state};
      delete toSend.activeId;
      const init={};
      ['profiles','npcs','messages','mural','events','calls','taro','customSounds','soundEvents','ingame'].forEach(k=>{
        if(toSend[k]!==undefined) init[k]=toSend[k];
      });
      init._meta={time:localWriteTime};
      cloudRef.set(init);
      return;
    }
    const remoteTime=data._meta?.time||0;
    if(remoteTime>localWriteTime){
      delete data._meta;
      const myActiveId=state.activeId;

      // Snapshot do meu perfil ANTES da atualização
      const myProfileBefore = myActiveId
        ? _hash(JSON.stringify(state.profiles.find(p=>p.id===myActiveId) || null))
        : 0;

      Object.keys(data).forEach(k=>{ state[k]=data[k]; });
      state=migrateState(state);
      state.activeId=myActiveId;

      // Snapshot do meu perfil DEPOIS
      const myProfileAfter = myActiveId
        ? _hash(JSON.stringify(state.profiles.find(p=>p.id===myActiveId) || null))
        : 0;

      // Só fecha o app aberto se o MEU perfil (ficha/inventário/notas/retrato/wallpaper)
      // mudou de verdade. Se foi mensagem, tiro, tarô, mural, evento — nada de fechar.
      const myProfileChanged = myProfileBefore !== myProfileAfter;

      Object.keys(data).forEach(k=>{
        _lastHashes[k]=_hash(JSON.stringify(state[k]||null));
      });
      try{localStorage.setItem('crimsonRollMobile_v1',JSON.stringify(state));}catch{}

      if(state.activeId){
        applyWallpaper();
        renderHome();
        updateSanityEffects();
        if(myProfileChanged && screen.classList.contains('app-open')){
          closeApp();
        }
      }
      checkPending();
    }
  });
}

/* ==================== HELPERS ==================== */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
/* ============ LISTA DE SONS CUSTOMIZÁVEIS ============ */
const SOUND_LIST=[
  {key:'click',     label:'Clique',            icon:'fa-hand-pointer'},
  {key:'roll',      label:'Rolagem de dado',   icon:'fa-dice'},
  {key:'crit',      label:'Crítico',           icon:'fa-star'},
  {key:'fumble',    label:'Falha crítica',     icon:'fa-triangle-exclamation'},
  {key:'message',   label:'Mensagem recebida', icon:'fa-comment'},
  {key:'damage',    label:'Dano',              icon:'fa-heart-crack'},
  {key:'heal',      label:'Cura de vida',      icon:'fa-heart'},
  {key:'healSan',   label:'Cura de sanidade',  icon:'fa-brain'},
  {key:'ring',      label:'Chamada recebida',  icon:'fa-phone'},
  {key:'gunshot',   label:'Tiro',              icon:'fa-gun'},
  {key:'reload',    label:'Recarga',           icon:'fa-rotate-right'},
  {key:'emptyClick',label:'Gatilho vazio',     icon:'fa-ban'}
];
// Retorna true se tocou um som customizado (e o procedimental deve ser ignorado)
function playCustomSound(name){
  try{
    if(typeof state==='undefined'||!state||!state.customSounds) return false;
    const src=state.customSounds[name];
    if(!src) return false;
    const a=new Audio(src);
    a.volume=0.7*SFX_VOLUME;
    a.play().catch(()=>{});
    return true;
  }catch{ return false; }
}
/* ==================== SOUND / HAPTIC ==================== */
const Sound={
  ctx:null,
  get(){if(!this.ctx){try{this.ctx=new (window.AudioContext||window.webkitAudioContext)();}catch{}}return this.ctx;},
    tone(f,d,t='sine',v=.08){const c=this.get();if(!c)return;if(c.state==='suspended')c.resume();const vol=v*SFX_VOLUME;if(vol<=0.0001)return;const o=c.createOscillator(),g=c.createGain();o.type=t;o.frequency.value=f;g.gain.setValueAtTime(vol,c.currentTime);g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+d);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+d);},
  noise(d,v=.08){const c=this.get();if(!c)return;if(c.state==='suspended')c.resume();const vol=v*SFX_VOLUME;if(vol<=0.0001)return;const b=c.createBuffer(1,c.sampleRate*d,c.sampleRate);const dd=b.getChannelData(0);for(let i=0;i<dd.length;i++)dd[i]=(Math.random()*2-1)*(1-i/dd.length);const s=c.createBufferSource();s.buffer=b;const g=c.createGain();g.gain.value=vol;s.connect(g);g.connect(c.destination);s.start();},
  roll(){if(playCustomSound('roll'))return;this.tone(200,.06,'triangle',.06);setTimeout(()=>this.tone(140,.05,'triangle',.05),40);},
  crit(){if(playCustomSound('crit'))return;this.tone(220,.12,'sine',.1);setTimeout(()=>this.tone(330,.2,'sine',.11),80);setTimeout(()=>this.tone(440,.3,'sine',.1),180);},
  fumble(){if(playCustomSound('fumble'))return;this.noise(.5,.1);this.tone(70,.35,'sawtooth',.07);},
  message(){if(playCustomSound('message'))return;this.tone(660,.08,'sine',.07);setTimeout(()=>this.tone(880,.12,'sine',.06),90);},
  damage(){if(playCustomSound('damage'))return;this.tone(55,.25,'square',.08);this.noise(.15,.05);},
  heal(){
    if(playCustomSound('heal'))return;
    this.tone(520,.12,'sine',.1);
    setTimeout(()=>this.tone(660,.15,'sine',.09),100);
    setTimeout(()=>this.tone(880,.22,'sine',.08),200);
  },
  healSan(){
    if(playCustomSound('healSan'))return;
    // Tom etéreo e DESCENDENTE (o oposto da cura de vida, que sobe)
    this.tone(660,.18,'triangle',.09);
    setTimeout(()=>this.tone(440,.24,'triangle',.08),160);
    setTimeout(()=>this.tone(330,.38,'triangle',.07),380);
    // Brilho agudo tipo "sininho" pra dar toque sobrenatural
    this.tone(1760,.06,'sine',.04);
    setTimeout(()=>this.tone(1320,.09,'sine',.03),90);
  },
  click(){if(playCustomSound('click'))return;this.tone(420,.025,'square',.02);},
  ring(){if(playCustomSound('ring'))return;this.tone(880,.25,'sine',.1);setTimeout(()=>this.tone(660,.25,'sine',.1),300);setTimeout(()=>this.tone(880,.25,'sine',.1),600);},
  gunshot(){
    if(playCustomSound('gunshot'))return;
    const c=this.get(); if(!c) return;
    if(c.state==='suspended') c.resume();
    const o1=c.createOscillator(); o1.type='square';
    o1.frequency.setValueAtTime(180,c.currentTime);
    o1.frequency.exponentialRampToValueAtTime(40,c.currentTime+0.15);
    const g1=c.createGain();
    g1.gain.setValueAtTime(0.35,c.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.22);
    o1.connect(g1); g1.connect(c.destination);
    o1.start(); o1.stop(c.currentTime+0.22);
    const dur=0.18;
    const buf=c.createBuffer(1,Math.floor(c.sampleRate*dur),c.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){const t=i/d.length; d[i]=(Math.random()*2-1)*Math.pow(1-t,3);}
    const src=c.createBufferSource(); src.buffer=buf;
    const g2=c.createGain(); g2.gain.value=0.45;
    src.connect(g2); g2.connect(c.destination);
    src.start();
  },
  reload(){
    if(playCustomSound('reload'))return;
    this.tone(2000,0.05,'square',0.08);
    setTimeout(()=>this.tone(1500,0.06,'square',0.07),130);
    setTimeout(()=>this.tone(900,0.08,'square',0.09),320);
    setTimeout(()=>this.tone(1400,0.05,'square',0.06),480);
  },
    emptyClick(){if(playCustomSound('emptyClick'))return;this.tone(1800,0.03,'square',0.06);}
};
const Haptic={
  short(){if(navigator.vibrate)navigator.vibrate(10);},
  med(){if(navigator.vibrate)navigator.vibrate(28);},
  long(){if(navigator.vibrate)navigator.vibrate([40,50,40]);},
  roll(){if(navigator.vibrate)navigator.vibrate([15,25,15,25]);},
  crit(){if(navigator.vibrate)navigator.vibrate([50,30,60,30,120]);},
  fumble(){if(navigator.vibrate)navigator.vibrate([30,80,30,80,30]);},
  damage(){if(navigator.vibrate)navigator.vibrate([80,40,80]);},
  heal(){if(navigator.vibrate)navigator.vibrate([20,15,20,15,40]);},
  shoot(){if(navigator.vibrate)navigator.vibrate([80,30,120]);}
};
/* ==================== DATA ==================== */
const SKILLS_DATA=[
  {name:'Acrobacia',attr:'Agilidade'},{name:'Adestramento',attr:'Presença',trainedOnly:true},
  {name:'Artes',attr:'Presença',trainedOnly:true},{name:'Atletismo',attr:'Força'},
  {name:'Atualidades',attr:'Intelecto'},{name:'Ciências',attr:'Intelecto',trainedOnly:true},
  {name:'Crime',attr:'Agilidade',trainedOnly:true},{name:'Diplomacia',attr:'Presença'},
  {name:'Enganação',attr:'Presença'},{name:'Fortitude',attr:'Vigor'},
  {name:'Furtividade',attr:'Agilidade'},{name:'Iniciativa',attr:'Agilidade'},
  {name:'Intimidação',attr:'Presença'},{name:'Intuição',attr:'Presença'},
  {name:'Investigação',attr:'Intelecto'},{name:'Luta',attr:'Força'},
  {name:'Medicina',attr:'Intelecto'},{name:'Ocultismo',attr:'Intelecto',trainedOnly:true},
  {name:'Percepção',attr:'Presença'},{name:'Pilotagem',attr:'Agilidade',trainedOnly:true},
  {name:'Pontaria',attr:'Agilidade'},{name:'Profissão',attr:'Intelecto',trainedOnly:true},
  {name:'Reflexos',attr:'Agilidade'},{name:'Religião',attr:'Presença',trainedOnly:true},
  {name:'Sobrevivência',attr:'Intelecto/Vigor'},{name:'Tática',attr:'Intelecto',trainedOnly:true},
  {name:'Tecnologia',attr:'Intelecto',trainedOnly:true},{name:'Vontade',attr:'Presença'}
];
const TRAIN_BONUS=[0,5,10,15];
const TRAIN_ABBR=['D','T','V','E'];
const ATTRS=['Agilidade','Força','Intelecto','Presença','Vigor'];
/* ============ CLASSES E ORIGENS (Ordem Paranormal) ============ */
const CLASSES = {
  mundano:     {label:'Mundano',     icon:'fa-user', color:'#95a5a6'},
  combatente:  {label:'Combatente',  icon:'fa-shield-halved', color:'#e74c3c'},
  especialista:{label:'Especialista',icon:'fa-screwdriver-wrench', color:'#3498db'},
  ocultista:   {label:'Ocultista',   icon:'fa-eye', color:'#9b59b6'}
};
const ORIGENS = [
  'Acadêmico','Agente de Saúde','Amnésico','Artista','Atleta','Chef',
  'Criminoso','Desgarrado','Engenheiro','Escritor','Executivo','Investigador',
  'Lutador','Magnata','Mercenário','Militar','Motorista','Nômade',
  'Operário','Policial','Religioso','Servidor Público','Teórico da Conspiração',
  'T.I.','Trabalhador Rural','Vítima'
];
/* ============ RITUAIS ============ */
const RITUAL_ELEMENTS = {
  conhecimento:{label:'Conhecimento', icon:'fa-brain',          color:'#3498db'},
  energia:     {label:'Energia',      icon:'fa-bolt',           color:'#f1c40f'},
  morte:       {label:'Morte',        icon:'fa-skull',          color:'#95a5a6'},
  sangue:      {label:'Sangue',       icon:'fa-droplet',        color:'#e74c3c'},
  medo:        {label:'Medo',         icon:'fa-eye',            color:'#9b59b6'}
};
const RITUAL_CIRCLES = {
  1: {label:'1º Círculo', short:'I'},
  2: {label:'2º Círculo', short:'II'},
  3: {label:'3º Círculo', short:'III'},
  4: {label:'4º Círculo', short:'IV'}
};
const RITUAL_CIRCLE_PLACEHOLDER = {label:'1º Círculo', short:'I'};  // ← sobe pra cá
const PROFILE_COLORS=['#e74c3c','#9b59b6','#3498db','#f1c40f','#2ecc71','#e67e22','#1abc9c','#e84393'];
const CATEGORIES={
  consumivel:{label:'Consumível',icon:'fa-flask',color:'#2ecc71'},
  municao:{label:'Munição',icon:'fa-gun',color:'#e67e22'},
  armadura:{label:'Armadura',icon:'fa-shield-halved',color:'#3498db'},
  arma:{label:'Arma',icon:'fa-khanda',color:'#e74c3c'},
  outro:{label:'Outro',icon:'fa-box',color:'#8e8e93'}
};
const CAT_ORDER=['arma','armadura','municao','consumivel','outro'];
const WALLPAPERS=[
  'linear-gradient(160deg,#1a0000,#3a0a0a 55%,#6a1a1a)','linear-gradient(160deg,#0f0f14,#1a1a26 50%,#2a0a0a)',
  'linear-gradient(160deg,#0a0a0a,#1a1a1a 60%,#2a1a1a)','linear-gradient(160deg,#141e30,#243b55)',
  'linear-gradient(160deg,#0f2027,#203a43 50%,#2c5364)','linear-gradient(160deg,#1a1a2e,#16213e 50%,#0f3460)',
  'linear-gradient(160deg,#3a1c1c,#6a2a2a 55%,#8a3a3a)','linear-gradient(160deg,#232526,#414345)'
];
/* ============ TIPOS DE MUNIÇÃO ============ */
const AMMO_TYPES={
  pistol:  {label:'Pistola',        icon:'fa-gun',         color:'#e67e22'},
  revolver:{label:'Revólver',       icon:'fa-gun',         color:'#d35400'},
  rifle:   {label:'Fuzil',          icon:'fa-gun',         color:'#c0392b'},
  smg:     {label:'Submetralhadora',icon:'fa-gun',         color:'#e74c3c'},
  shotgun: {label:'Espingarda',     icon:'fa-gun',         color:'#a0522d'},
  sniper:  {label:'Sniper',         icon:'fa-crosshairs',  color:'#8e44ad'},
  special: {label:'Especial',       icon:'fa-star',        color:'#f0c674'}
};
const GLOBAL_APPS=[
  {id:'ficha',name:'Ficha',icon:'fa-clipboard-list',color:'#e74c3c',dock:true},
  {id:'inventario',name:'Inventário',icon:'fa-briefcase',color:'#e67e22',dock:true},
  {id:'mensagens',name:'Mensagens',icon:'fa-comments',color:'#3498db',dock:true},
  {id:'notas',name:'Notas',icon:'fa-pen-to-square',color:'#9b59b6',dock:true},
   {id:'rituais',name:'Rituais',icon:'fa-book-skull',color:'#9b59b6',dock:false,ocultistOnly:true},
  {id:'taro',name:'Tarô',icon:'fa-moon',color:'#9b59b6',dock:false,taroOnly:true},
  {id:'mural',name:'Mural',icon:'fa-diagram-project',color:'#f0c674',dock:false},
  {id:'dados',name:'Dados',icon:'fa-dice-d20',color:'#f1c40f',dock:false},
  {id:'perfis',name:'Perfis',icon:'fa-users',color:'#2ecc71',dock:false,adminOnly:true},
  {id:'ajustes',name:'Ajustes',icon:'fa-gear',color:'#8e8e93',dock:false}
];
/* ============ TARÔ ============ */
const TAROT_DECK=[
  {n:0,name:'O Louco',icon:'fa-shoe-prints',meaning:'Um salto no desconhecido. Novos caminhos se abrem — mas cuidado com o precipício.',rev:'Imprudência, medo de avançar, decisões precipitadas.'},
  {n:1,name:'O Mago',icon:'fa-hat-wizard',meaning:'Vontade manifesta. Você tem os recursos — basta usá-los.',rev:'Manipulação, talentos desperdiçados, arrogância.'},
  {n:2,name:'A Sacerdotisa',icon:'fa-hands-praying',meaning:'Intuição profunda. Segredos revelados aos olhos atentos.',rev:'Ilusão, segredos ocultos, desconexão do próprio eu.'},
  {n:3,name:'A Imperatriz',icon:'fa-seedling',meaning:'Abundância, criação, crescimento. Algo floresce.',rev:'Negligência, esterilidade, dependência.'},
  {n:4,name:'O Imperador',icon:'fa-crown',meaning:'Estrutura, autoridade, ordem. Um líder se ergue.',rev:'Tirania, rigidez, abuso de poder.'},
  {n:5,name:'O Hierofante',icon:'fa-book-bible',meaning:'Tradição, ensinamento, orientação espiritual.',rev:'Dogma, rebeldia, hipocrisia.'},
  {n:6,name:'Os Amantes',icon:'fa-heart-pulse',meaning:'União, escolha, harmonia entre dualidades.',rev:'Desarmonia, escolha errada, tentação.'},
  {n:7,name:'O Carro',icon:'fa-chess-rook',meaning:'Triunfo pela força de vontade. Vitória em movimento.',rev:'Direção perdida, obstáculos, derrota.'},
  {n:8,name:'A Força',icon:'fa-hand-fist',meaning:'Coragem interior. Domar o que parece indomável.',rev:'Fragilidade, insegurança, força mal direcionada.'},
  {n:9,name:'O Eremita',icon:'fa-mountain-sun',meaning:'Introspecção, sabedoria, busca solitária.',rev:'Isolamento excessivo, solidão, fuga.'},
  {n:10,name:'A Roda',icon:'fa-circle-half-stroke',meaning:'Ciclos, destino, mudança inevitável.',rev:'Má sorte, resistência à mudança, ciclo quebrado.'},
  {n:11,name:'A Justiça',icon:'fa-scale-balanced',meaning:'Equilíbrio, verdade, causa e efeito.',rev:'Injustiça, desonestidade, desequilíbrio.'},
  {n:12,name:'O Enforcado',icon:'fa-arrow-down-long',meaning:'Pausa necessária. Sacrifício que traz clareza.',rev:'Estagnação, martírio inútil, resistência.'},
  {n:13,name:'A Morte',icon:'fa-skull',meaning:'Fim de um ciclo. Transformação radical.',rev:'Resistência à transformação, medo, estagnação.'},
  {n:14,name:'A Temperança',icon:'fa-flask',meaning:'Equilíbrio, paciência, moderação.',rev:'Excesso, desequilíbrio, impaciência.'},
  {n:15,name:'O Diabo',icon:'fa-fire-flame-curved',meaning:'Tentação, apego, corrente que você mesmo forjou.',rev:'Libertação, reconhecimento, quebra de vício.'},
  {n:16,name:'A Torre',icon:'fa-tower-broadcast',meaning:'Ruptura súbita. O que era sólido desmorona.',rev:'Desastre evitado, mudança gradual, medo.'},
  {n:17,name:'A Estrela',icon:'fa-star',meaning:'Esperança, inspiração, fé renovada.',rev:'Desesperança, fé perdida, ceticismo.'},
  {n:18,name:'A Lua',icon:'fa-moon',meaning:'Ilusão, medo, o inconsciente emerge.',rev:'Verdade revelada, medo superado, clareza.'},
  {n:19,name:'O Sol',icon:'fa-sun',meaning:'Vitória, alegria, vitalidade radiante.',rev:'Sucesso temporário, tristeza, cansaço.'},
  {n:20,name:'O Julgamento',icon:'fa-bullhorn',meaning:'Despertar, chamado, renascimento.',rev:'Dúvida, autocrítica excessiva, surdez ao chamado.'},
  {n:21,name:'O Mundo',icon:'fa-globe',meaning:'Realização, completude, ciclo concluído.',rev:'Incompletude, atraso, falta de fechamento.'}
];
function buildDefaultSkills(){const o={};SKILLS_DATA.forEach(s=>o[s.name]=0);return o;}
function newChar(){return{name:'',profession:'',classe:'',origem:'',attributes:{Agilidade:1,Força:1,Intelecto:1,Presença:1,Vigor:1},hp:{current:15,max:15},san:{current:15,max:15},pe:{current:5,max:5},nex:5,skills:buildDefaultSkills(),abilities:[],rituais:[]};}
/* ==================== STATE ==================== */
function buildDefaultState(){
  return {
    profiles:[
      {id:'mestre',name:'Mestre',pin:'1234',isAdmin:true,color:'#f0c674',portrait:'',
       wallpaper:WALLPAPERS[0],wallpaperImage:'',
       char:Object.assign(newChar(),{name:'Mestre'}),
       inventory:[],weightLimit:20,notes:[]},
      {id:'agente1',name:'Agente',pin:'0000',isAdmin:false,color:'#e74c3c',portrait:'',
       wallpaper:WALLPAPERS[2],wallpaperImage:'',
       char:Object.assign(newChar(),{name:'Agente'}),
       inventory:[],weightLimit:20,
       notes:[{id:uid(),text:'Diário do Agente\n\nDia 1 — O caso começou com um telefonema estranho...',date:Date.now(),attachments:[]}]}
    ],
    npcs:[],
    messages:[{id:uid(),from:'mestre',fromName:'Mestre',to:'all',
      text:'Bem-vindos à Ordem. Este canal é compartilhado entre todos os agentes.',time:Date.now()-3600000}],
    mural:[],events:[],calls:[],
    taro:{enabled:false,history:[]},
    customSounds:{},
    soundEvents:[],
    ingame:{day:1,hour:22,minute:0}
  };
}
function migrateEffect(eff){
  if(!eff) return '';
  const m=String(eff).match(/^(hp|san|pe):\+?(\d+)$/);
  if(m) return `${m[1]}:${m[2]}`;
  return eff;
}
function migrateProfile(p){
  const ch=Object.assign(newChar(),p.char||{});
  ch.abilities=Array.isArray(ch.abilities)?ch.abilities:[];
  if(!ch.pe) ch.pe={current:5,max:5};
  if(typeof ch.classe!=='string') ch.classe='';
  if(typeof ch.origem!=='string') ch.origem='';
  if(typeof ch.nex!=='number') ch.nex=5;
  ch.rituais=Array.isArray(ch.rituais)?ch.rituais:[];
  const inv=(Array.isArray(p.inventory)?p.inventory:[]).map(it=>{
    const base={
      ...it,
      category: it.category && CATEGORIES[it.category] ? it.category : 'outro',
      weight: typeof it.weight === 'number' ? it.weight : 0,
      damage: it.damage || '',
      effect: migrateEffect(it.effect)
    };
    if(base.category==='arma'){
      if(typeof base.isFirearm==='undefined') base.isFirearm=!!base.ammoType;
      if(base.isFirearm){
        if(typeof base.magazineSize!=='number') base.magazineSize=0;
        if(typeof base.currentAmmo!=='number'&&base.currentAmmo!==null) base.currentAmmo=0;
        if(!base.ammoType) base.ammoType='pistol';
      }
    }
    if(base.category==='municao'){
      if(!base.ammoType) base.ammoType='pistol';
    }
    return base;
  });
  const notes=(Array.isArray(p.notes)?p.notes:[]).map(n=>({...n,attachments:Array.isArray(n.attachments)?n.attachments:[]}));
  return {...p,portrait:p.portrait||'',char:ch,inventory:inv,notes,weightLimit:typeof p.weightLimit==='number'?p.weightLimit:20};
}
function migrateState(s){
  if(!s||!Array.isArray(s.profiles)||s.profiles.length===0) return buildDefaultState();
  s.profiles=s.profiles.map(migrateProfile);
  s.npcs=Array.isArray(s.npcs)?s.npcs:[];
  s.messages=Array.isArray(s.messages)?s.messages:[];
  s.mural=Array.isArray(s.mural)?s.mural:[];
  s.events=Array.isArray(s.events)?s.events:[];
  s.calls=Array.isArray(s.calls)?s.calls:[];
  s.taro=s.taro&&typeof s.taro==='object'?s.taro:{enabled:false,history:[]};
  if(!Array.isArray(s.taro.history)) s.taro.history=[];
  s.customSounds=(s.customSounds&&typeof s.customSounds==='object')?s.customSounds:{};
  s.soundEvents=Array.isArray(s.soundEvents)?s.soundEvents:[];
  s.ingame=s.ingame||{day:1,hour:22,minute:0};
  s.profiles.forEach(p=>{if(p.name==='Administrador') p.name='Mestre';});
  return s;
}
let state=loadLocalState()||buildDefaultState();
// activeId vive separado, só localmente, NUNCA sincroniza
let activeId=localStorage.getItem('crimsonRollActiveId')||null;
state.activeId=activeId;
// Volume global dos sons — local, NÃO sincroniza entre dispositivos
let SFX_VOLUME=parseFloat(localStorage.getItem('crimsonRollVolume'));
if(isNaN(SFX_VOLUME)||SFX_VOLUME<0||SFX_VOLUME>1) SFX_VOLUME=1;
function loadLocalState(){
  try{
    const raw=localStorage.getItem('crimsonRollMobile_v1')||localStorage.getItem('phoneOrdenRPG_v4');
    if(!raw) return null;
    return migrateState(JSON.parse(raw));
  }catch{return null;}
}

/* ==================== FIREBASE SYNC ==================== */
function updateSyncStatus(status,text){
  const el=$('#syncStatus');if(!el) return;
  el.classList.remove('offline','syncing');
  if(status==='offline') el.classList.add('offline');
  if(status==='syncing') el.classList.add('syncing');
  $('#syncText').textContent=text;
}
/* ============ SYNC OTIMIZADO ============ */
const _lastHashes = {};
function _hash(str){
  let h=0;
  for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; }
  return h;
}

let _saveTimer=null;
let _savePending=false;

function saveState(){
  // Salva local sempre (instantâneo)
  try{ localStorage.setItem('crimsonRollMobile_v1', JSON.stringify(state)); }catch{}
  if(state.activeId){
    try{ localStorage.setItem('crimsonRollActiveId', state.activeId); }catch{}
  }else{
    try{ localStorage.removeItem('crimsonRollActiveId'); }catch{}
  }

  // Sem auth ou sem ref? Salva só local e retorna.
  if(!_firebaseAuthed || !cloudRef){
    return true;
  }

  updateSyncStatus('syncing','enviando');
  _savePending=true;
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(()=>{
    if(!_savePending) return;
    _savePending=false;
    localWriteTime=Date.now();

    // Compara hash de cada chave com o último enviado
    const keysToSync=['profiles','npcs','messages','mural','events','calls','taro','customSounds','soundEvents','ingame'];
    const updates={};
    keysToSync.forEach(key=>{
      const json=JSON.stringify(state[key]||null);
      const h=_hash(json);
      if(_lastHashes[key]!==h){
        _lastHashes[key]=h;
        updates[key]=state[key];
      }
    });

    // Limita o tamanho das listas que crescem
    if(updates.messages && updates.messages.length>150) updates.messages=updates.messages.slice(-150);
    if(updates.soundEvents && updates.soundEvents.length>20) updates.soundEvents=updates.soundEvents.slice(-20);
    if(updates.events && updates.events.length>50) updates.events=updates.events.slice(-50);

    // Se nada mudou, não escreve nada
    if(Object.keys(updates).length===0){
      updateSyncStatus('online','sincronizado');
      return;
    }

    updates._meta={time:localWriteTime};
    cloudRef.update(updates)
      .then(()=>updateSyncStatus('online','sincronizado'))
      .catch(()=>updateSyncStatus('offline','falha'));
  }, 400);
  return true;
}
const activeProfile=()=>state.profiles.find(p=>p.id===state.activeId)||state.profiles[0];
const agentProfiles=()=>state.profiles.filter(p=>!p.isAdmin);
const profileById=id=>state.profiles.find(p=>p.id===id);

/* ==================== FORMULA / EFFECT ==================== */
function rollFormula(formula){
  if(!formula) return null;
  formula=String(formula).trim();
  if(/^[+-]?\d+$/.test(formula)){
    const n=parseInt(formula);
    return {rolls:[],total:n,sides:0,mod:n,n:0,isFlat:true};
  }
  const m=formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if(!m) return null;
  const n=parseInt(m[1]),sides=parseInt(m[2]),mod=m[3]?parseInt(m[3]):0;
  let total=mod,rolls=[];
  for(let i=0;i<n;i++){const r=Math.floor(Math.random()*sides)+1;rolls.push(r);total+=r;}
  return {rolls,total,sides,mod,n};
}
function parseEffect(str){
  if(!str) return null;
  const m=String(str).trim().match(/^(hp|san|pe):(.+)$/);
  if(!m) return null;
  return {target:m[1],formula:m[2].trim()};
}
function applyEffect(char,effectStr){
  const parsed=parseEffect(effectStr);
  if(!parsed) return null;
  const roll=rollFormula(parsed.formula);
  if(!roll) return null;
  const tgt=char[parsed.target];
  const old=tgt.current;
  tgt.current=clamp(tgt.current+roll.total,0,tgt.max);
  const healed=tgt.current-old;
  return {healed,roll,target:parsed.target};
}

/* ==================== ANIMAÇÕES ==================== */
function flashScreen(color){
  const el=document.createElement('div');
  el.className='flash-overlay '+color;
  screen.appendChild(el);
  requestAnimationFrame(()=>el.classList.add('active'));
  setTimeout(()=>el.remove(),700);
}
function floatNumber(text,color){
  const el=document.createElement('div');
  el.className='float-num';
  el.textContent=text;
  el.style.color=color;
  screen.appendChild(el);
  setTimeout(()=>el.remove(),1500);
}
function animateUse(healed,target){
  const colorMap={hp:'#2ecc71',san:'#9b59b6',pe:'#2ecc71'};
  const flashMap={hp:'green',san:'purple',pe:'green'};
  flashScreen(flashMap[target]||'green');
  floatNumber((healed>=0?'+':'')+healed,colorMap[target]||'#2ecc71');
  if(target==='san'){
    Sound.healSan();
  } else {
    Sound.heal();   // vida e PE compartilham o som "vital"
  }
  Haptic.heal();
}
/* ============ SANIDADE ZERO — ENLOUQUECENDO ============ */
let _insanityInterval = null;
let _insanityOverlay = null;

const INSANITY_LINES = [
  'VOCÊ ESTÁ ENLOUQUECENDO',
  'NÃO HÁ SAÍDA',
  'ELES ESTÃO TE VENDO',
  'VOCÊ NÃO DEVERIA ESTAR AQUI',
  'A REALIDADE ESTÁ RASGANDO',
  'ACORDE. ACORDE. ACORDE.',
  'VOCÊ É UM DELES AGORA',
  'ISSO NÃO É REAL',
  'PARE DE OLHAR',
  'NÃO CONFIE EM NINGUÉM',
  'A PORTA ESTÁ ATRÁS DE VOCÊ',
  'VOCÊ NUNCA SAIU DE LÁ'
];

function showInsanityOverlay(force = false){
  if(!state.activeId) return;
  const p = activeProfile();
  if(p.char.san.current > 0) return;

  // Se já tá aberto e não é force, não recria
  if(_insanityOverlay && _insanityOverlay.classList.contains('show') && !force) return;

  // Cria o overlay na primeira vez
  if(!_insanityOverlay){
    _insanityOverlay = document.createElement('div');
    _insanityOverlay.className = 'insanity-overlay';
    _insanityOverlay.innerHTML = `
      <div class="insanity-text" id="insanityMain">VOCÊ ESTÁ ENLOUQUECENDO</div>
      <div class="insanity-text small" id="insanitySub">sanidade 0 / ${p.char.san.max}</div>
      <button class="insanity-skip" id="insanitySkip">continuar mesmo assim</button>
    `;
    screen.appendChild(_insanityOverlay);
    $('#insanitySkip', _insanityOverlay).onclick = ()=>{
      _insanityOverlay.classList.remove('show');
    };
  }

  // Sorteia uma frase (a primeira é sempre a "oficial" na 1ª aparição)
  const mainEl = $('#insanityMain', _insanityOverlay);
  const subEl  = $('#insanitySub', _insanityOverlay);
  const phrase = force ? INSANITY_LINES[Math.floor(Math.random()*INSANITY_LINES.length)] : 'VOCÊ ESTÁ ENLOUQUECENDO';
  if(mainEl) mainEl.textContent = phrase;
  if(subEl)  subEl.textContent  = `sanidade 0 / ${p.char.san.max}`;

  requestAnimationFrame(()=>_insanityOverlay.classList.add('show'));

  // Som + vibração
  try{
    Sound.tone(90, .5, 'sawtooth', .12);
    setTimeout(()=>Sound.tone(50, .8, 'sawtooth', .1), 200);
    Sound.noise(.6, .08);
  }catch{}
  Haptic.long();
  setTimeout(()=>Haptic.long(), 500);
  setTimeout(()=>Haptic.med(), 1200);
}

function stopInsanityOverlay(){
  if(_insanityOverlay){
    _insanityOverlay.classList.remove('show');
  }
  if(_insanityInterval){
    clearInterval(_insanityInterval);
    _insanityInterval = null;
  }
}

function updateInsanityOverlay(){
  if(!state.activeId){ stopInsanityOverlay(); return; }
  const p = activeProfile();
  if(p.char.san.current <= 0){
    if(!_insanityInterval){
      showInsanityOverlay();
      // Re-aparece a cada 45s enquanto SAN estiver zerada
      _insanityInterval = setInterval(()=>{
        if(!state.activeId){ stopInsanityOverlay(); return; }
        const pp = activeProfile();
        if(pp.char.san.current > 0){ stopInsanityOverlay(); return; }
        showInsanityOverlay(true);
      }, 45000);
    }
  } else {
    stopInsanityOverlay();
  }
}
/* ==================== SANIDADE ==================== */
function updateSanityEffects(){
  const sc=$('#screen');
  sc.classList.remove('san-low','san-critical');
  const wOwner=$('#wOwner');wOwner.classList.remove('glitch');
  if(!state.activeId){wOwner.textContent='';stopInsanityOverlay();return;}
  const p=activeProfile();
  const pct=p.char.san.current/Math.max(1,p.char.san.max);
  if(p.char.san.current <= 0){
    // ZERO ABSOLUTO — enlouqueceu
    sc.classList.add('san-critical');
    wOwner.classList.add('glitch');
    wOwner.textContent=glitchName(p.name);
    updateInsanityOverlay();
  } else if(pct<0.10){
    sc.classList.add('san-critical');
    wOwner.classList.add('glitch');
    wOwner.textContent=glitchName(p.name);
    stopInsanityOverlay();
  } else if(pct<0.25){
    sc.classList.add('san-low');
    wOwner.textContent=p.name;
    stopInsanityOverlay();
  } else {
    wOwner.textContent=p.name;
    stopInsanityOverlay();
  }
}
function glitchName(name){
  const chars=name.split('');
  const g=['?','…','#','█','̷','̸'];
  const out=chars.map(c=>Math.random()<0.35?g[Math.floor(Math.random()*g.length)]:c).join('');
  return Math.random()<0.5?out:name+'?';
}
setInterval(()=>{if(state.activeId) updateSanityEffects();},2500);

/* ==================== LOCK ==================== */
const lockScreen=$('#lockScreen');
const pinDots=$('#pinDots');
const lockError=$('#lockError');
let pinBuffer='';
function renderLockHint(){
  $('#lockHint').textContent='Digite seu PIN de 4 dígitos';
}
function updatePinDots(){$$('#pinDots span').forEach((el,i)=>el.classList.toggle('filled',i<pinBuffer.length));}
function pressPin(d){
  if(pinBuffer.length>=4) return;
  pinBuffer+=d;lockError.textContent='';updatePinDots();Sound.click();Haptic.short();
  if(pinBuffer.length===4) setTimeout(()=>tryLogin(pinBuffer),180);
}
function tryLogin(pin){
  const p=state.profiles.find(x=>x.pin===pin);
  if(p){state.activeId=p.id;enterPhone();}
  else{
    lockError.textContent='PIN incorreto';
    lockScreen.classList.add('shake');Haptic.med();Sound.tone(120,.2,'square',.08);
    setTimeout(()=>{pinBuffer='';updatePinDots();lockScreen.classList.remove('shake');},420);
  }
}
function enterPhone(){
  pinBuffer='';updatePinDots();lockError.textContent='';
  lockScreen.classList.add('hidden');
  state.activeId=state.activeId||state.profiles[0].id;
  applyWallpaper();renderHome();updateSanityEffects();
  // Reseta o marcador de tiros: o próximo tick vai resincronizar com o estado atual
  _shotWatchReady=false;
  _lastShotTime=0;
  setTimeout(checkPending,500);
}
function lockPhone(){
  state.activeId=null;closeApp();
  stopInsanityOverlay();
  renderLockHint();lockScreen.classList.remove('hidden');
  applyWallpaper(true);
  $('#screen').classList.remove('san-low','san-critical');
} 
$('#pinPad').addEventListener('click',e=>{
  const btn=e.target.closest('button');
  if(!btn||btn.classList.contains('empty')) return;
  if(btn.dataset.del){pinBuffer=pinBuffer.slice(0,-1);updatePinDots();return;}
  pressPin(btn.dataset.d);
});

/* ==================== HOME ==================== */
const screen=$('#screen');
const appView=$('#appView');
const appBody=$('#appBody');
const appTitle=$('#appTitle');
function applyWallpaper(force=false){
  const wp=$('#wallpaper');
  if(!state.activeId&&!force){
    const p=state.profiles[0];
    wp.style.background=p.wallpaperImage?`#000 url("${p.wallpaperImage}") center/cover no-repeat`:p.wallpaper;
    return;
  }
  const p=activeProfile();
  wp.style.background=p.wallpaperImage?`#000 url("${p.wallpaperImage}") center/cover no-repeat`:p.wallpaper;
  updateSanityEffects();
}
function makeAppEl(app){
  const btn=document.createElement('button');
  btn.className='app';
  const badge=(app.id==='mensagens')?`<span class="badge" id="msgBadge"></span>`:'';
  const evBadge=(app.id==='ficha')?`<span class="badge" id="evtBadge" style="display:none;background:#f0c674;color:#000"></span>`:'';
  btn.innerHTML=`<span class="icon" style="--c:${app.color}"><i class="fa-solid ${app.icon}"></i>${badge}${evBadge}</span><span class="label">${esc(app.name)}</span>`;
  btn.addEventListener('click',()=>openApp(app.id));
  return btn;
}
function renderHome(){
  const p=activeProfile();
  const grid=$('#grid'),dock=$('#dock');
  grid.innerHTML='';dock.innerHTML='';
  GLOBAL_APPS.forEach(app=>{
    if(app.adminOnly&&!p.isAdmin) return;
    if(app.taroOnly){
      const visible=p.isAdmin||(state.taro&&state.taro.enabled);
      if(!visible) return;
    }
    if(app.ocultistOnly){
      // Só aparece pra Ocultista — Mestre também vê pra testar
      const visible = p.isAdmin || (p.char && p.char.classe === 'ocultista');
      if(!visible) return;
    }
    (app.dock?dock:grid).appendChild(makeAppEl(app));
  });
  updateBadges();
}
function updateBadges(){
  const p=activeProfile();
  const msgBadge=$('#msgBadge');
  if(msgBadge){
    const seen=parseInt(localStorage.getItem('msgSeen_'+p.id)||'0');
    const unread=state.messages.filter(m=>{
      if(m.isLog) return false;
      if(m.time<=seen) return false;
      if(m.whisperTo&&m.whisperTo!==p.id&&m.from!==p.id) return false;
      if(m.fromNPC){
        // mensagem de NPC visível se to === 'all' ou to === p.id
        return m.to==='all'||m.to===p.id;
      }
      if(m.to==='all') return m.from!==p.id;
      return m.to===p.id||m.from===p.id;
    }).length;
    if(unread>0){msgBadge.textContent=unread>9?'9+':unread;msgBadge.style.display='grid';}
    else msgBadge.style.display='none';
  }
  const evBadge=$('#evtBadge');
  if(evBadge){
    const pend=state.events.filter(e=>!e.seenBy.includes(p.id)&&(e.target==='all'||e.target===p.id)).length;
    if(pend>0){evBadge.textContent=pend;evBadge.style.display='grid';}
    else evBadge.style.display='none';
  }
}

/* ==================== APP VIEW ==================== */
let cleanups=[];
const onCleanup=fn=>cleanups.push(fn);
function runCleanups(){cleanups.forEach(f=>{try{f();}catch{}});cleanups=[];}
let appOptions={};
function openApp(id,options={}){
  if(!state.activeId) return;
  runCleanups();
  appOptions=options||{};
  const app=GLOBAL_APPS.find(a=>a.id===id);
  appTitle.textContent=app?app.name:'App';
  appBody.innerHTML='';appBody.scrollTop=0;
  const render=APPS[id];
  if(render){try{render(appBody,appOptions);}catch(e){appBody.innerHTML='<div class="empty">Erro.</div>';console.error(e);}}
  else appBody.innerHTML='<div class="empty">App indisponível.</div>';
  screen.classList.add('app-open');
  appView.setAttribute('aria-hidden','false');
  Sound.click();
}
function closeApp(){
  screen.classList.remove('app-open');
  appView.setAttribute('aria-hidden','true');
  runCleanups();
  appOptions={};
  if(state.activeId) updateBadges();
}
$('#backBtn').addEventListener('click',closeApp);
$('#homeBar').addEventListener('click',()=>{if(screen.classList.contains('app-open')) closeApp();});
$('#lockBtn').addEventListener('click',lockPhone);

/* ==================== RELÓGIO REAL ==================== */
function tick(){
  const d=new Date();
  const hm=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  $('#sbTime').textContent=hm;$('#wTime').textContent=hm;
  $('#wDate').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
}
tick();setInterval(tick,1000);

/* ==================== MODAL ROLAGEM ==================== */
function showRollModal({skillName,attrName,dice,train,total,bonusSkipped}){
  const overlay=document.createElement('div');
  overlay.className='roll-overlay';
  const best=Math.max(...dice),nDice=dice.length;
  const isCrit=best===20,isFumble=best===1&&nDice===1;
  let tag='';
  if(isCrit) tag='<div class="roll-crit-tag">CRÍTICO!</div>';
  if(isFumble) tag='<div class="roll-crit-tag fumble">FALHA CRÍTICA</div>';

  const bonusNote = bonusSkipped
    ? '<div class="roll-bonus-skip"><i class="fa-solid fa-triangle-exclamation"></i> Rolou o mínimo — bônus de treino não se aplica</div>'
    : '';

  overlay.innerHTML=`
    <div class="roll-card">
      ${tag}
      <div class="roll-skill">${esc(skillName)}</div>
      <div class="roll-attr">${esc(attrName)}</div>
      <div class="roll-dice-row">
        ${dice.map(d=>`<span class="die ${d===best?'best':''} ${d===20?'crit':''} ${d===1?'fumble':''}">${d}</span>`).join('')}
      </div>
      ${bonusNote}
      <div class="roll-breakdown">Rolou <b>${nDice}d20</b> (${esc(attrName)}) → melhor: <b>${best}</b><br>Bônus de treino: <b>${train>=0?'+'+train:train}</b></div>
      <div class="roll-total-wrap"><div class="roll-total-label">Resultado</div><div class="roll-total">${total}</div></div>
      <button class="roll-close">Fechar</button>
    </div>`;
  screen.appendChild(overlay);
  if(isCrit){Sound.crit();Haptic.crit();}
  else if(isFumble){Sound.fumble();Haptic.fumble();}
  else{Sound.roll();Haptic.roll();}
  const close=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay) close();});
  $('.roll-close',overlay).onclick=close;
  onCleanup(close);
}

/* ==================== EVENTOS / CHAMADAS ==================== */
/* ============ CACHE LOCAL DE CHAMADAS/EVENTOS VISTOS ============ */
// Protege contra race condition com Firebase: mesmo que o seenBy seja
// sobrescrito por um snapshot antigo, o cache local impede reabrir.
function _seenKey(kind){ return 'crimsonRollSeen_'+kind+'_'+(state.activeId||''); }
function _markLocalSeen(kind, id){
  try{
    const key=_seenKey(kind);
    const arr=JSON.parse(localStorage.getItem(key)||'[]');
    if(!arr.includes(id)) arr.push(id);
    if(arr.length>200) arr.splice(0, arr.length-200);
    localStorage.setItem(key, JSON.stringify(arr));
  }catch{}
}
function _hasLocalSeen(kind, id){
  try{
    const arr=JSON.parse(localStorage.getItem(_seenKey(kind))||'[]');
    return arr.includes(id);
  }catch{ return false; }
}
let _activeCallId = null;

function checkPending(){
  if(!state.activeId) return;
  const p=activeProfile();

  // Se já tem chamada aberta, não abre outra por cima
  if(_activeCallId) return;

  const evt=state.events.find(e=>
    !e.seenBy.includes(p.id) &&
    !_hasLocalSeen('evt', e.id) &&
    e.createdBy !== p.id &&
    (e.target==='all'||e.target===p.id)
  );
  if(evt){ showEventOverlay(evt); return; }

  const call=state.calls.find(c=>
    !c.seenBy.includes(p.id) &&
    !_hasLocalSeen('call', c.id) &&
    (c.target==='all'||c.target===p.id)
  );
  if(call){ showCallScreen(call); return; }

  updateBadges();
}
setInterval(checkPending,4000);

function showEventOverlay(evt){
  const p=activeProfile();
  // Marca como visto imediatamente pra não reabrir em loop
  if(!evt.seenBy.includes(p.id)){ evt.seenBy.push(p.id); }
  _markLocalSeen('evt', evt.id);
  saveState();

  const ov=document.createElement('div');
  ov.className='event-screen';
  const hasImg=evt.image;
  ov.innerHTML=`
    <div class="event-img" ${hasImg?`style="background-image:url('${evt.image}')"`:''}>${hasImg?'':'<i class="fa-solid fa-eye"></i>'}</div>
    <div class="event-title">${esc(evt.title)}</div>
    ${evt.desc?`<div class="event-desc">${esc(evt.desc)}</div>`:''}
    <button class="event-btn" id="evtRoll">Rolar ${evt.diceType||'d20'}</button>`;
  screen.appendChild(ov);
  Sound.tone(150,.3,'sawtooth',.08);Haptic.long();
  $('#evtRoll',ov).onclick=()=>{
    const dt=evt.diceType||'d20';
    const m=dt.match(/d(\d+)/);const sides=m?parseInt(m[1]):20;
    const roll=Math.floor(Math.random()*sides)+1;
    const isCrit=(sides===20&&roll===20),isFumble=(roll===1);
    if(isCrit){Sound.crit();Haptic.crit();}
    else if(isFumble){Sound.fumble();Haptic.fumble();}
    else{Sound.roll();Haptic.roll();}
    let dcTxt='';
    if(evt.dc){
      const passed=roll>=evt.dc;
      dcTxt=`<div class="event-result-lbl">${passed?'<span style="color:#2ecc71">Sucesso</span>':'<span style="color:#e74c3c">Falha</span>'} · DT ${evt.dc}</div>`;
    }
    ov.innerHTML=`
      <div class="event-img" ${hasImg?`style="background-image:url('${evt.image}')"`:''}>${hasImg?'':'<i class="fa-solid fa-eye"></i>'}</div>
      <div class="event-title">${esc(evt.title)}</div>
      <div class="event-result-lbl">${dt.toUpperCase()}</div>
      <div class="event-result ${isCrit?'crit':''} ${isFumble?'fumble':''}">${roll}</div>
      ${dcTxt}
      <button class="event-btn" id="evtDone" style="animation:none;margin-top:3cqw">Continuar</button>`;
      $('#evtDone',ov).onclick=()=>{
      ov.remove();updateBadges();
    };
  };
}

function showCallScreen(call){
  // Trava: se já tem uma chamada na tela, ignora essa (evita loop)
  if(_activeCallId) return;
  _activeCallId = call.id;

  const p=activeProfile();
  // Marca como visto IMEDIATAMENTE (cache local + seenBy)
  _markLocalSeen('call', call.id);
  if(!call.seenBy.includes(p.id)){ call.seenBy.push(p.id); saveState(); }

  const ov=document.createElement('div');
  ov.className='call-screen';
  const declineHTML=call.unrefusable?'':'<button class="decline" id="callDec"><i class="fa-solid fa-phone-slash"></i></button>';
  const acceptClass=call.unrefusable?'accept only-accept':'accept';
  ov.innerHTML=`
    <div class="call-avatar" ${call.npcAvatar?`style="background-image:url('${call.npcAvatar}')"`:''}>${call.npcAvatar?'':'<i class="fa-solid fa-user-secret"></i>'}</div>
    <div class="call-name">${esc(call.npcName)}</div>
    <div class="call-sub">${call.unrefusable?'📞 Chamada obrigatória':'Chamada recebida...'}</div>
    <div class="call-btns">
      ${declineHTML}
      <button class="${acceptClass}" id="callAcc"><i class="fa-solid fa-phone"></i></button>
    </div>`;
  screen.appendChild(ov);
  Sound.ring();Haptic.long();
  let ringInt=setInterval(()=>{Sound.ring();Haptic.med();},3000);

  const cleanup=()=>{
    clearInterval(ringInt);
    ov.remove();
    if(_activeCallId === call.id) _activeCallId = null;
  };
  onCleanup(cleanup);

  const dec=$('#callDec',ov);
  if(dec){
    dec.onclick=()=>{
      cleanup();
      showToast('Chamada recusada.');
      updateBadges();
    };
  }
  $('#callAcc',ov).onclick=()=>{
    clearInterval(ringInt);
    Sound.tone(520,.15,'sine',.1);
    Haptic.short();
    playCallDialog(ov, call, ()=>{
      cleanup();
      updateBadges();
    });
  };
} 
function playCallDialog(ov,call,onDone){
  const script=call.script&&call.script.length?call.script:[{who:call.npcName,line:'...'}];
  ov.innerHTML=`<div class="call-dialog" id="callDlg"></div>
    <button id="callEndBtn" style="margin-top:5cqw;background:#e74c3c;color:#fff;border:0;border-radius:3cqw;padding:3cqw 8cqw;font-family:inherit;font-weight:900;letter-spacing:.1em;cursor:pointer">DESLIGAR</button>`;
  const dlg=$('#callDlg',ov);
  let i=0;
  const next=()=>{
    if(i>=script.length){$('#callEndBtn',ov).onclick=()=>{Sound.tone(300,.2,'sawtooth',.08);Haptic.med();onDone();};return;}
    const line=script[i];
    const el=document.createElement('div');
    el.className='call-line'+(line.who==='you'||line.who==='você'?' you':'');
    el.textContent=((line.who==='you'||line.who==='você')?'Você: ':(line.who+': '))+line.line;
    dlg.appendChild(el);Sound.message();Haptic.short();
    i++;setTimeout(next,1800);
  };
  next();
  $('#callEndBtn',ov).onclick=onDone;
}

/* ==================== APPS ==================== */
const APPS={};

/* ==================== FICHA ==================== */
APPS.ficha=function(body,options){
  const p=activeProfile();
  const isMaster=p.isAdmin;
  const target=options&&options.targetProfile?options.targetProfile:p;
  const isEditingTarget=target.id!==p.id;
  const c=target.char;

  // ── Permissões ──
  const isOwnSheet      = target.id === p.id;
  const canEditStats    = isMaster;                       // máximos, atributos, NEX, habilidades
  const canEditCurrent  = isMaster || isOwnSheet;         // mexe no HP/SAN/PE atual
  const canDecrease     = canEditCurrent;                 // sempre que pode mexer, pode perder
  const canIncrease     = isMaster;                       // só Mestre pode curar
  const canEdit         = canEditStats;                   // compat com o resto do código
  const canEditTarget   = isMaster && isEditingTarget;
  const showMestrePanel = isMaster && !isEditingTarget;
  const showSkills      = !(isMaster && !isEditingTarget);

  function getAttrValue(a){if(a==='Intelecto/Vigor') return Math.max(c.attributes.Intelecto||0,c.attributes.Vigor||0);return c.attributes[a]||0;}
  function getBonus(n){const lvl=c.skills[n]||0;const sd=SKILLS_DATA.find(s=>s.name===n);const attr=getAttrValue(sd.attr);return{attr,train:TRAIN_BONUS[lvl]||0,total:attr+(TRAIN_BONUS[lvl]||0),lvl};}
  function draw(){
    const {hp,san,pe}=c;
    const hpPct=clamp(hp.current/Math.max(1,hp.max),0,1);
    const sanPct=clamp(san.current/Math.max(1,san.max),0,1);
    const pePct=clamp(pe.current/Math.max(1,pe.max),0,1);
    const ARC=251.33;
    const ig=state.ingame;

    const portraitHTML=target.portrait
      ? `<div class="ficha-avatar" style="--c:${target.color}"><div class="portrait" style="background-image:url('${target.portrait}')"></div></div>`
      : `<div class="ficha-avatar" style="--c:${target.color}">${esc((c.name||'?').slice(0,1).toUpperCase())}</div>`;

    body.innerHTML=`
      ${isEditingTarget?`<div class="editing-banner"><i class="fa-solid fa-user-pen ic"></i><div class="txt"><b>Editando: ${esc(target.name)}</b><span>Você está alterando a ficha deste agente</span></div></div>`:''}
      ${portraitHTML}
      <input class="char-name ${canEdit?'':'readonly'}" id="charName" value="${esc(c.name)}" placeholder="Nome" maxlength="28" ${canEdit?'':'readonly'}>
      ${(()=>{
        const cls = c.classe && CLASSES[c.classe] ? CLASSES[c.classe] : null;
        const org = c.origem ? c.origem : null;
        return `<div class="char-class-row">
          <div class="char-badge classe ${cls?'':'empty'} ${canEdit?'editable':''}"
               ${canEdit?'data-edit-classe="1"':''}
               ${cls?`style="--bc-color:${cls.color};--bc-border:${cls.color}66;--bc-bg:${cls.color}22"`:''}>
            <i class="fa-solid ${cls?cls.icon:'fa-plus'}"></i>
            ${cls?esc(cls.label):'Definir classe'}
          </div>
          <div class="char-badge origem ${org?'':'empty'} ${canEdit?'editable':''}"
               ${canEdit?'data-edit-origem="1"':''}>
            <i class="fa-solid ${org?'fa-map-pin':'fa-plus'}"></i>
            ${org?esc(org):'Definir origem'}
          </div>
        </div>`;
      })()}
      ${!isEditingTarget?`<div class="ingame-clock">
        <i class="fa-solid fa-clock ic"></i>
        <div><div class="t">Dia ${ig.day} · ${String(ig.hour).padStart(2,'0')}:${String(ig.minute).padStart(2,'0')}</div><div class="d">Tempo da campanha</div></div>
        ${isMaster?`
          <button data-adv="-60" title="-1h"><i class="fa-solid fa-backward"></i></button>
          <button data-adv="-10">-10m</button>
          <button data-adv="10">+10m</button>
          <button data-adv="60" title="+1h"><i class="fa-solid fa-forward"></i></button>
          <button data-adv="1440" title="+1 dia"><i class="fa-solid fa-sun"></i></button>
        `:''}
      </div>`:''}
      ${showMestrePanel?renderMestrePanel():''}
      <div class="bars">
        <div class="bar-wrap hp"><svg viewBox="0 0 200 120" class="arc-svg">
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-bg"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-fg" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC*(1-hpPct)}"/>
          <text x="100" y="78" class="arc-text">${hp.current}</text><text x="100" y="96" class="arc-sub">/ ${hp.max}</text>
        </svg><div class="bar-label ${canEdit?'editable':''}" ${canEdit?'data-edit-max="hp"':''}>❤ Vida</div>
          ${canEditCurrent?`<div class="bar-controls">
    <button data-hp="-1">−</button>
    ${canIncrease?`<button data-hp="1">+</button>`:''}
    <button class="quick-dmg" data-quick="hp" title="${canIncrease?'Dano/Cura rápida':'Dano rápido'}"><i class="fa-solid fa-bolt"></i></button>
  </div>`:''}</div>
        <div class="bar-wrap san"><svg viewBox="0 0 200 120" class="arc-svg">
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-bg"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-fg" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC*(1-sanPct)}"/>
          <text x="100" y="78" class="arc-text">${san.current}</text><text x="100" y="96" class="arc-sub">/ ${san.max}</text>
        </svg><div class="bar-label ${canEdit?'editable':''}" ${canEdit?'data-edit-max="san"':''}>🧠 SAN</div>
        ${canEditCurrent?`<div class="bar-controls">
  <button data-san="-1">−</button>
  ${canIncrease?`<button data-san="1">+</button>`:''}
  <button class="quick-dmg" data-quick="san" title="${canIncrease?'Dano/Cura rápida':'Dano rápido'}"><i class="fa-solid fa-bolt"></i></button>
</div>`:''}</div>
        <div class="bar-wrap pe"><svg viewBox="0 0 200 120" class="arc-svg">
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-bg"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" class="arc-fg" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC*(1-pePct)}"/>
          <text x="100" y="78" class="arc-text">${pe.current}</text><text x="100" y="96" class="arc-sub">/ ${pe.max}</text>
        </svg><div class="bar-label ${canEdit?'editable':''}" ${canEdit?'data-edit-max="pe"':''}>⚡ PE</div>
        ${canEditCurrent?`<div class="bar-controls">
  <button data-pe="-1">−</button>
  ${canIncrease?`<button data-pe="1">+</button>`:''}
  <button class="quick-dmg" data-quick="pe" title="${canIncrease?'Dano/Cura rápida':'Dano rápido'}"><i class="fa-solid fa-bolt"></i></button>
</div>`:''}</div>
      </div>
      <div class="nex-badge ${c.nex === 0 ? 'zero' : ''}">
        <span class="nex-label">NEX</span>
        <span class="nex-pill">${c.nex}%</span>
        ${canEdit && c.classe !== 'mundano' ? `<button class="btn" id="nexEdit" style="padding:1.5cqw 3cqw;font-size:.7em">Editar</button>` : ''}
        ${c.classe === 'mundano' ? `<span style="font-size:.62em;color:rgba(255,255,255,.4);letter-spacing:.08em;text-transform:uppercase">Mundano</span>` : ''}
      </div>
      <div class="section-title">Atributos · nº de dados</div>
      <div class="attrs">
        ${ATTRS.map(a=>`
          <div class="attr-box">
            <div class="attr-label">${a.slice(0,3).toUpperCase()}</div>
            <div class="attr-val">${c.attributes[a]}</div>
            ${canEdit?`<div class="attr-btns"><button data-attr-dec="${a}">−</button><button data-attr-inc="${a}">+</button></div>`:''}
          </div>`).join('')}
      </div>
      <div class="section-title">Habilidades</div>
      <div class="abilities-list" id="abList">
        ${c.abilities.length===0?'<div class="empty" style="padding:3cqw 0">Nenhuma habilidade registrada.</div>'
          :c.abilities.map(ab=>{
            const peCost = (typeof ab.peCost === 'number' && ab.peCost > 0) ? ab.peCost : 0;
            const hasEnough = c.pe.current >= peCost;
            const locked = peCost > 0 && !hasEnough;
            return `
            <div class="ability-card ${locked?'locked':''}" data-ab="${ab.id}">
              <div class="ability-head">
                <div class="ability-name">${esc(ab.name)}</div>
                ${peCost > 0
                  ? `<div class="ability-cost-badge"><i class="fa-solid fa-bolt"></i> ${peCost} PE</div>`
                  : `<div class="ability-cost-badge free">livre</div>`}
              </div>
              ${ab.cost?`<div class="ability-extra">${esc(ab.cost)}</div>`:''}
              ${ab.desc?`<div class="ability-desc">${esc(ab.desc)}</div>`:''}
              <div class="ability-footer">
                ${peCost > 0
                  ? (hasEnough
                      ? `<button class="ability-use-btn" data-useab="${ab.id}"><i class="fa-solid fa-bolt"></i> Usar</button>`
                      : `<button class="ability-use-btn no-pe" disabled><i class="fa-solid fa-bolt"></i> Sem PE (${c.pe.current}/${peCost})</button>`)
                  : ''}
                ${canEdit?`<button class="ability-del-btn" data-abdel="${ab.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>`:''}
              </div>
            </div>`;
          }).join('')}
      </div>
      ${canEdit?`<button class="add-ability-btn" id="addAbility"><i class="fa-solid fa-plus"></i> Adicionar habilidade</button>`:''}
      ${showSkills?`
        <div class="section-title">Perícias</div>
        <div class="skills-list">
          ${SKILLS_DATA.map(s=>{
            const b=getBonus(s.name);
            const locked=s.trainedOnly&&b.lvl===0;
            const bonusText=(b.total>=0?'+':'')+b.total;
            return `
              <div class="skill-row ${locked?'locked':''}" data-skill="${esc(s.name)}">
                <div class="skill-info">
                  <div class="skill-name">${esc(s.name)}${s.trainedOnly?' <span class="skill-lock">★</span>':''}</div>
                  <div class="skill-attr">${esc(s.attr)} · ${b.attr}d20</div>
                </div>
                <div class="skill-bonus">${bonusText}</div>
                <button class="skill-train t${b.lvl}" data-train="${esc(s.name)}">${TRAIN_ABBR[b.lvl]}</button>
              </div>`;
          }).join('')}
        </div>`:''}`;

    // Botões do relógio in-game
    body.querySelectorAll('[data-adv]').forEach(b=>b.onclick=()=>{
      const m=parseInt(b.dataset.adv);
      let mins=state.ingame.hour*60+state.ingame.minute+m;
      const daysAdd=Math.floor(mins/1440);
      mins=((mins%1440)+1440)%1440;
      state.ingame.day+=daysAdd;state.ingame.hour=Math.floor(mins/60);state.ingame.minute=mins%60;
      saveState();draw();Sound.click();
    });
    // Nome
    if(canEdit){
      $('#charName',body).addEventListener('input',e=>{c.name=e.target.value;saveState();});
    }
        // Classe
    $('[data-edit-classe]',body)?.addEventListener('click', async ()=>{
      const chosen = await openClassePicker(c.classe);
      if(chosen === null) return;

      const previous = c.classe;
      c.classe = chosen;

      // Ajuste automático do NEX ao trocar de classe
      if(chosen === 'mundano'){
        c.nex = 0;
      } else if(previous === 'mundano' && c.nex < 5){
        // Saiu de Mundano → volta ao mínimo padrão
        c.nex = 5;
      }

      saveState(); draw();
      if(chosen) showToast('Classe: ' + (CLASSES[chosen]?.label || chosen));
    });
    // Origem
    $('[data-edit-origem]',body)?.addEventListener('click', async ()=>{
      const chosen = await openOrigemPicker(c.origem);
      if(chosen === null) return;
      c.origem = chosen;
      saveState(); draw();
      if(chosen) showToast('Origem: ' + chosen);
    });
    $('#nexEdit',body)?.addEventListener('click', async ()=>{
      // Mundano nunca tem NEX — bloqueia
      if(c.classe === 'mundano'){
        showToast('Mundanos não possuem NEX.', true);
        Haptic.med();
        return;
      }
      const v = await openPrompt({
        title: 'Editar NEX',
        message: 'Valor entre 5 e 99.',
        defaultValue: String(c.nex),
        inputType: 'number',
        min: 5,
        max: 99
      });
      if(v===null) return;
      c.nex = clamp(parseInt(v)||5, 5, 99);
      saveState(); draw();
    });
    // Painel do Mestre
    if(showMestrePanel){
      body.querySelectorAll('[data-agent]').forEach(card=>{
        const ag=profileById(card.dataset.agent);if(!ag) return;
        const act=(key,d)=>{const t=ag.char[key];t.current=clamp(t.current+d,0,t.max);saveState();draw();Sound.click();Haptic.short();};
        const actMax=(key,d)=>{const t=ag.char[key];t.max=clamp(t.max+d,1,999);if(t.current>t.max)t.current=t.max;saveState();draw();};
        card.querySelectorAll('[data-cur]').forEach(b=>b.onclick=e=>{e.stopPropagation();const[k,d]=b.dataset.cur.split(':');act(k,parseInt(d));});
        card.querySelectorAll('[data-max]').forEach(b=>b.onclick=e=>{e.stopPropagation();const[k,d]=b.dataset.max.split(':');actMax(k,parseInt(d));});
        // Botão editar ficha completa
        card.querySelector('[data-edit-sheet]')?.addEventListener('click',e=>{
          e.stopPropagation();
          // reabrir o app ficha com target = esse agente
          openApp('ficha',{targetProfile:ag});
        });
      });
      $('#mkEvent',body)?.addEventListener('click',()=>openEventCreator());
      $('#mkCall',body)?.addEventListener('click',()=>openCallCreator());
    }
    // Habilidades — clique no card abre editor (só mestre)
    if(canEdit){
      $('#addAbility',body)?.addEventListener('click',()=>openAbilityEditor(null));
      body.querySelectorAll('.ability-card').forEach(el=>el.addEventListener('click',e=>{
        if(e.target.closest('[data-abdel]')) return;
        if(e.target.closest('[data-useab]')) return;
        const ab=c.abilities.find(a=>a.id===el.dataset.ab);
        if(ab) openAbilityEditor(ab);
      }));
      body.querySelectorAll('[data-abdel]').forEach(b=>b.onclick=e=>{
        e.stopPropagation();
        if(!confirm('Excluir esta habilidade?')) return;
        c.abilities=c.abilities.filter(a=>a.id!==b.dataset.abdel);
        saveState();draw();
      });
    }

    // Usar habilidade — funciona pro dono da ficha E pro Mestre editando
    if(canEditCurrent){
      body.querySelectorAll('[data-useab]').forEach(b=>b.onclick=(e)=>{
        e.stopPropagation();
        const ab=c.abilities.find(a=>a.id===b.dataset.useab);
        if(ab) useAbility(ab);
      });
    }
    if(canEditStats){
      body.querySelectorAll('[data-edit-max]').forEach(el=>el.onclick= async ()=>{
        const key = el.dataset.editMax;
        const lbl = key==='hp'?'Vida':key==='san'?'Sanidade':'PE';
        const v = await openPrompt({
          title: `Máximo de ${lbl}`,
          message: 'Valor a partir de 1.',
          defaultValue: String(c[key].max),
          inputType: 'number',
          min: 1
        });
        if(v===null) return;
        const n = parseInt(v);
        if(isNaN(n) || n<1){ showToast('Valor inválido.', true); return; }
        c[key].max = n;
        if(c[key].current > n) c[key].current = n;
        saveState(); draw();
      });
      body.querySelectorAll('[data-attr-inc]').forEach(b=>b.onclick=()=>{const a=b.dataset.attrInc;c.attributes[a]=clamp((c.attributes[a]||0)+1,0,10);saveState();draw();});
      body.querySelectorAll('[data-attr-dec]').forEach(b=>b.onclick=()=>{const a=b.dataset.attrDec;c.attributes[a]=clamp((c.attributes[a]||0)-1,0,10);saveState();draw();});
    }

    // HP/SAN/PE atual
    if(canEditCurrent){
      // ±1 — o "+" só existe pro Mestre, o "−" sempre
      body.querySelectorAll('[data-hp]').forEach(b=>b.onclick=()=>{
        c.hp.current=clamp(c.hp.current+parseInt(b.dataset.hp),0,c.hp.max);
        saveState();draw();Sound.click();Haptic.short();
      });
      body.querySelectorAll('[data-san]').forEach(b=>b.onclick=()=>{
        c.san.current=clamp(c.san.current+parseInt(b.dataset.san),0,c.san.max);
        saveState();draw();Sound.click();Haptic.short();updateSanityEffects();
      });
      body.querySelectorAll('[data-pe]').forEach(b=>b.onclick=()=>{
        c.pe.current=clamp(c.pe.current+parseInt(b.dataset.pe),0,c.pe.max);
        saveState();draw();Sound.click();
      });

      // Dano rápido
      body.querySelectorAll('[data-quick]').forEach(b=>b.onclick= async ()=>{
        const key = b.dataset.quick;
        const lbl = key==='hp' ? 'Vida' : key==='san' ? 'Sanidade' : 'PE';
        const t   = c[key];

        const msg = canIncrease
          ? `Digite quanto PERDER (ex: 5).\nOu NEGATIVO pra curar (ex: -3).`
          : `Quanto você perdeu?`;

        const extraInfo = `\n\nAtual: ${t.current} / ${t.max}`;

        const v = await openPrompt({
          title: lbl,
          message: msg + extraInfo,
          defaultValue: '5',
          inputType: 'number'
        });
        if(v===null) return;

        const n = parseInt(v);
        if(isNaN(n) || n===0) return;

        if(!canIncrease && n < 0){
          showToast('Você não pode se curar sozinho.', true);
          return;
        }

        const antes = t.current;
        t.current = clamp(t.current - n, 0, t.max);
        const delta = t.current - antes;

        saveState();
        Sound.click(); Haptic.short();

        if(delta < 0){
          flashScreen(key==='san'?'purple':'red');
          floatNumber(String(delta), key==='san'?'#bb8fce':'#e74c3c');
        } else if(delta > 0){
          flashScreen(key==='san'?'purple':'green');
          floatNumber('+'+delta, key==='san'?'#bb8fce':'#2ecc71');
        }

        draw();
        if(key==='san') updateSanityEffects();
      });
    }
    // Perícias
    body.querySelectorAll('.skill-row').forEach(row=>{
      row.onclick=ev=>{
        if(ev.target.closest('[data-train]')) return;
        const name=row.dataset.skill;
        const sd=SKILLS_DATA.find(s=>s.name===name);
        const lvl=c.skills[name]||0;
        if(sd.trainedOnly&&lvl===0){alert(`"${name}" só pode ser usada se você for treinado.`);return;}
        const attr=getAttrValue(sd.attr);
        const nDice=Math.max(1,attr);
        const dice=[];
        for(let i=0;i<nDice;i++) dice.push(Math.floor(Math.random()*20)+1);
        const best=Math.max(...dice);

        // Se QUALQUER dado caiu no mínimo (1), o bônus de treino não se aplica
        const hasMin = dice.some(d => d === 1);
        const train = hasMin ? 0 : TRAIN_BONUS[lvl];
        const total = best + train;

        showRollModal({
          skillName: name,
          attrName: sd.attr,
          dice,
          train,
          total,
          bonusSkipped: hasMin && lvl > 0
        });

        state.messages.push({
          id:uid(), from:'system', fromName:'Log', to:'all',
          fromId:p.id, isSecret:p.isAdmin,
          text:`🎲 ${target.name} rolou ${name}: ${total} (${nDice}d20 → ${best}${train?' +'+train:''})`,
          time:Date.now(), isLog:true
        });
        saveState();
      };
    });
    if(canEdit){
      body.querySelectorAll('[data-train]').forEach(btn=>btn.onclick=ev=>{
        ev.stopPropagation();
        const n=btn.dataset.train;const cur=c.skills[n]||0;
        c.skills[n]=(cur+1)%4;saveState();draw();
      });
    }
    
    function useAbility(ab){
      const peCost = (typeof ab.peCost === 'number' && ab.peCost > 0) ? ab.peCost : 0;
      if(peCost <= 0){
        showToast('Habilidade sem custo de PE.');
        return;
      }
      if(c.pe.current < peCost){
        showToast('PE insuficiente.', true);
        Haptic.med();
        return;
      }
      c.pe.current = clamp(c.pe.current - peCost, 0, c.pe.max);
      saveState();

      // Feedback visual
      flashScreen('yellow');
      floatNumber('-'+peCost+' PE', '#f0c674');

      // Som de "conjuração"
      try{
        Sound.tone(440,.12,'triangle',.08);
        setTimeout(()=>Sound.tone(660,.18,'sine',.07), 90);
        setTimeout(()=>Sound.tone(880,.22,'sine',.06), 200);
      }catch{}
      Haptic.med();

      // Log no chat
      state.messages.push({
        id:uid(), from:'system', fromName:'Log', to:'all',
        fromId:p.id, isSecret:p.isAdmin,
        text:`⚡ ${c.name||target.name} usou "${ab.name}" (-${peCost} PE)`,
        time:Date.now(), isLog:true
      });
      saveState();

      // Redesenha pra atualizar estado do botão
      draw();
      showToast(`⚡ ${ab.name} (-${peCost} PE)`);
    }

    function openAbilityEditor(ability){
      const isNew=!ability;
      const ab=ability||{id:uid(),name:'',peCost:'',cost:'',desc:''};
      const ov=document.createElement('div');
      ov.className='roll-overlay';
      ov.innerHTML=`
        <div class="roll-card" style="text-align:left">
          <div class="roll-skill" style="text-align:center">${isNew?'Nova Habilidade':'Editar Habilidade'}</div>
          <div style="margin-top:4cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Nome</label>
            <input id="abName" maxlength="40" value="${esc(ab.name)}" placeholder="Ex: Olhar Sinistro"></div>
          <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Custo em PE (opcional)</label>
            <input id="abPeCost" type="number" min="0" max="999" value="${typeof ab.peCost === 'number' ? ab.peCost : ''}" placeholder="Ex: 2"></div>
          <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Custo extra (opcional)</label>
            <input id="abCost" maxlength="40" value="${esc(ab.cost||'')}" placeholder="Ex: 1 ação de movimento"></div>
          <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Descrição</label>
            <textarea id="abDesc" rows="4">${esc(ab.desc||'')}</textarea></div>
          <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
            <button class="btn" id="abCancel" style="flex:1">Cancelar</button>
            <button class="btn-primary" id="abSave" style="flex:1">Salvar</button>
          </div>
        </div>`;
      screen.appendChild(ov);
      $('#abCancel',ov).onclick=()=>ov.remove();
      $('#abSave',ov).onclick=()=>{
        const name=$('#abName',ov).value.trim();
        if(!name) return alert('Dê um nome à habilidade.');
        const peRaw = $('#abPeCost',ov).value.trim();
        const peCost = peRaw === '' ? 0 : clamp(parseInt(peRaw)||0, 0, 999);
        if(isNew) c.abilities.push({id:ab.id,name,peCost,cost:$('#abCost',ov).value.trim(),desc:$('#abDesc',ov).value.trim()});
        else{ab.name=name;ab.peCost=peCost;ab.cost=$('#abCost',ov).value.trim();ab.desc=$('#abDesc',ov).value.trim();}
        saveState();ov.remove();draw();showToast('Habilidade salva.');
      };
      ov.addEventListener('click',e=>{if(e.target===ov) ov.remove();});
    }
  }

      function openClassePicker(current){
      return new Promise(resolve=>{
        const ov=document.createElement('div');
        ov.className='roll-overlay';
        ov.innerHTML=`
          <div class="roll-card" style="text-align:left">
            <div class="roll-skill" style="text-align:center">Classe do Agente</div>
            <div class="classe-picker" id="clsList">
              ${Object.entries(CLASSES).map(([key,val])=>`
                <button class="classe-opt ${current===key?'sel':''}" data-c="${key}"
                  style="${current===key?`background:${val.color}22;border-color:${val.color};color:${val.color}`:''}">
                  <span class="icon" style="background:${val.color}22;color:${val.color};border:1px solid ${val.color}66">
                    <i class="fa-solid ${val.icon}"></i>
                  </span>
                  <span class="label">${esc(val.label)}</span>
                </button>
              `).join('')}
              <button class="classe-opt" data-c="" style="justify-content:center;color:rgba(255,255,255,.4);font-size:.75em">
                <i class="fa-solid fa-xmark"></i> Limpar classe
              </button>
            </div>
            <div style="display:flex;gap:2.5cqw;margin-top:4cqw">
              <button class="btn" id="clsCancel" style="flex:1">Cancelar</button>
            </div>
          </div>`;
        screen.appendChild(ov);
        const close=(val)=>{ ov.remove(); resolve(val); };
        $('#clsCancel',ov).onclick=()=>close(null);
        ov.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>close(b.dataset.c));
        ov.addEventListener('click',e=>{if(e.target===ov) close(null);});
      });
    }

    function openOrigemPicker(current){
      return new Promise(resolve=>{
        const ov=document.createElement('div');
        ov.className='roll-overlay';
        ov.innerHTML=`
          <div class="roll-card" style="text-align:left">
            <div class="roll-skill" style="text-align:center">Origem do Agente</div>
            <div class="origem-search">
              <input id="origemSearch" placeholder="Filtrar ou digitar nova origem..." value="${esc(current||'')}" maxlength="30">
            </div>
            <div class="origem-grid" id="origemGrid">
              ${ORIGENS.map(o=>`
                <button class="origem-opt ${current===o?'sel':''}" data-o="${esc(o)}">${esc(o)}</button>
              `).join('')}
            </div>
            <div style="display:flex;gap:2.5cqw;margin-top:2cqw">
              <button class="btn" id="origCancel" style="flex:1">Cancelar</button>
              <button class="btn-primary" id="origOk" style="flex:1">Salvar</button>
            </div>
          </div>`;
        screen.appendChild(ov);
        const inp = $('#origemSearch',ov);
        let value = current || '';
        const close=(val)=>{ ov.remove(); resolve(val); };

        const selectOpt = (o)=>{
          value = o;
          inp.value = o;
          ov.querySelectorAll('.origem-opt').forEach(b=>b.classList.toggle('sel', b.dataset.o===o));
        };
        ov.querySelectorAll('.origem-opt').forEach(b=>{
          b.onclick=()=>selectOpt(b.dataset.o);
        });
        inp.addEventListener('input', ()=>{
          value = inp.value.trim();
          const q = value.toLowerCase();
          ov.querySelectorAll('.origem-opt').forEach(b=>{
            b.style.display = b.dataset.o.toLowerCase().includes(q) ? '' : 'none';
            b.classList.toggle('sel', b.dataset.o === value);
          });
        });
        $('#origCancel',ov).onclick=()=>close(null);
        $('#origOk',ov).onclick=()=>close(inp.value.trim());
        ov.addEventListener('click',e=>{if(e.target===ov) close(null);});
      });
    }

  function renderMestrePanel(){
    const agents=agentProfiles();
    return `<div class="mestre-panel">
      <div class="mestre-head"><span class="mestre-title">★ Painel do Mestre</span><span class="mestre-count">${agents.length} agente${agents.length!==1?'s':''}</span></div>
      ${agents.length===0?'<div class="empty" style="padding:3cqw 0">Nenhum agente criado.</div>'
        :agents.map(ag=>{
          const a=ag.char;
          const hpPct=clamp(a.hp.current/Math.max(1,a.hp.max),0,1);
          const sanPct=clamp(a.san.current/Math.max(1,a.san.max),0,1);
          const pePct=clamp(a.pe.current/Math.max(1,a.pe.max),0,1);
          const AM=109.96;
          return `
            <div class="agent-card" data-agent="${ag.id}">
              <div class="agent-head">
                <div class="agent-avatar" style="background:${ag.color}">${esc(ag.name.slice(0,1).toUpperCase())}</div>
                <div class="agent-name">${esc(ag.name)}</div>
                <button class="agent-edit-btn" data-edit-sheet="${ag.id}"><i class="fa-solid fa-pen"></i> Ficha</button>
              </div>
              <div class="mini-bars">
                <div class="mini-arc hp"><svg viewBox="0 0 100 58">
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6" stroke-linecap="round"/>
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="#e74c3c" stroke-width="6" stroke-linecap="round" stroke-dasharray="${AM}" stroke-dashoffset="${AM*(1-hpPct)}"/>
                  <text x="50" y="38" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${a.hp.current}</text>
                  <text x="50" y="52" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.5)">/ ${a.hp.max}</text>
                </svg><div class="mini-label">❤ Vida</div></div>
                <div class="mini-arc san"><svg viewBox="0 0 100 58">
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6" stroke-linecap="round"/>
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="#9b59b6" stroke-width="6" stroke-linecap="round" stroke-dasharray="${AM}" stroke-dashoffset="${AM*(1-sanPct)}"/>
                  <text x="50" y="38" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${a.san.current}</text>
                  <text x="50" y="52" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.5)">/ ${a.san.max}</text>
                </svg><div class="mini-label">🧠 SAN</div></div>
                <div class="mini-arc pe"><svg viewBox="0 0 100 58">
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="6" stroke-linecap="round"/>
                  <path d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="#2ecc71" stroke-width="6" stroke-linecap="round" stroke-dasharray="${AM}" stroke-dashoffset="${AM*(1-pePct)}"/>
                  <text x="50" y="38" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${a.pe.current}</text>
                  <text x="50" y="52" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.5)">/ ${a.pe.max}</text>
                </svg><div class="mini-label">⚡ PE</div></div>
              </div>
              <div class="agent-ctrl-grid">
                <div class="ctrl-row hp-lbl"><span class="lbl">❤</span><button data-cur="hp:-1">−</button><span class="val">${a.hp.current}</span><button data-cur="hp:1">+</button></div>
                <div class="ctrl-row hp-lbl"><span class="lbl">❤ Máx</span><button data-max="hp:-1">−</button><span class="val">${a.hp.max}</span><button data-max="hp:1">+</button></div>
                <div class="ctrl-row san-lbl"><span class="lbl">🧠</span><button data-cur="san:-1">−</button><span class="val">${a.san.current}</span><button data-cur="san:1">+</button></div>
                <div class="ctrl-row san-lbl"><span class="lbl">🧠 Máx</span><button data-max="san:-1">−</button><span class="val">${a.san.max}</span><button data-max="san:1">+</button></div>
                <div class="ctrl-row pe-lbl"><span class="lbl">⚡</span><button data-cur="pe:-1">−</button><span class="val">${a.pe.current}</span><button data-cur="pe:1">+</button></div>
                <div class="ctrl-row pe-lbl"><span class="lbl">⚡ Máx</span><button data-max="pe:-1">−</button><span class="val">${a.pe.max}</span><button data-max="pe:1">+</button></div>
              </div>
            </div>`;
        }).join('')}
      <div class="mestre-actions">
        <button id="mkEvent"><i class="fa-solid fa-bolt"></i> Enviar evento</button>
        <button id="mkCall"><i class="fa-solid fa-phone"></i> Simular chamada</button>
      </div>
    </div>`;
  }

  function openEventCreator(){
    const agents=agentProfiles();
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">Enviar Evento</div>
        <div style="margin-top:4cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Alvo</label>
          <button type="button" class="select-trigger" id="evTargetBtn">
            <span id="evTargetLabel">Todos os agentes</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Título</label>
          <input id="evTitle" maxlength="40" placeholder="Ex: Teste de Vontade"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Descrição</label>
          <textarea id="evDesc" rows="2" placeholder="Ex: Ouve-se um sussurro atrás de você..."></textarea></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Dado</label>
          <button type="button" class="select-trigger" id="evDiceBtn">
            <span id="evDiceLabel">d20</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">DT (opcional)</label>
          <input id="evDc" type="number" placeholder="Ex: 15"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Imagem</label>
          <input type="file" accept="image/*" id="evImg" style="font-size:.8em"></div>
        <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
          <button class="btn" id="evCancel" style="flex:1">Cancelar</button>
          <button class="btn-primary" id="evSend" style="flex:1">Enviar</button>
        </div>
      </div>`;
    screen.appendChild(ov);
        // Alvo — dropdown
    let evTargetVal = 'all';
    let evTargetLabel = 'Todos os agentes';
    $('#evTargetBtn',ov).onclick = async ()=>{
      const opts = [{value:'all', label:'Todos os agentes'}, ...agents.map(a=>({value:a.id, label:a.name}))];
      const v = await openSelect({ title:'Alvo do evento', current:evTargetVal, options:opts });
      if(v === null) return;
      evTargetVal = v;
      evTargetLabel = (opts.find(o=>o.value===v)||{}).label || v;
      $('#evTargetLabel',ov).textContent = evTargetLabel;
    };

    // Dado — dropdown
    let evDiceVal = 'd20';
    $('#evDiceBtn',ov).onclick = async ()=>{
      const v = await openSelect({
        title:'Tipo de dado',
        current: evDiceVal,
        options:['d20','d6','d8','d10','d12','d100'].map(d=>({value:d,label:d.toUpperCase()}))
      });
      if(v === null) return;
      evDiceVal = v;
      $('#evDiceLabel',ov).textContent = v.toUpperCase();
    };
    let imgData='';
    $('#evImg',ov).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, null, 700);
        if(data){ imgData=data; showToast('Imagem carregada.'); }
      }catch{}
      e.target.value='';
    };
    $('#evCancel',ov).onclick=()=>ov.remove();
    $('#evSend',ov).onclick=()=>{
      const title=$('#evTitle',ov).value.trim();
      if(!title) return alert('Dê um título.');
      state.events.push({id:uid(),target:evTargetVal,title,desc:$('#evDesc',ov).value.trim(),
        diceType:evDiceVal,dc:$('#evDc',ov).value?parseInt($('#evDc',ov).value):0,
        image:imgData,createdBy:p.id,seenBy:[],time:Date.now()});
      saveState();ov.remove();updateBadges();showToast('Evento enviado.');Sound.message();
    };
  }
  function openCallCreator(){
    const agents=agentProfiles();
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">Simular Chamada</div>
        <div style="margin-top:4cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Alvo</label>
          <button type="button" class="select-trigger" id="clTargetBtn">
            <span id="clTargetLabel">Todos os agentes</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Nome do NPC</label>
          <input id="clName" maxlength="30" placeholder="Ex: Desconhecido"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Foto (opcional)</label>
          <input type="file" accept="image/*" id="clImg" style="font-size:.8em"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Diálogo (nome|fala por linha)</label>
          <textarea id="clScript" rows="5" placeholder="Desconhecido|Você sente isso também?&#10;you|Quem é você?&#10;Desconhecido|Não olhe para trás."></textarea></div>
        <label class="check-row">
          <input type="checkbox" id="clUnrefusable">
          <span><i class="fa-solid fa-lock" style="color:#e74c3c"></i> Chamada irrecusável</span>
        </label>
        <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
          <button class="btn" id="clCancel" style="flex:1">Cancelar</button>
          <button class="btn-primary" id="clSend" style="flex:1">Enviar</button>
        </div>
      </div>`;
    screen.appendChild(ov);
        let clTargetVal = 'all';
    $('#clTargetBtn',ov).onclick = async ()=>{
      const opts = [{value:'all', label:'Todos os agentes'}, ...agents.map(a=>({value:a.id, label:a.name}))];
      const v = await openSelect({ title:'Alvo da chamada', current:clTargetVal, options:opts });
      if(v === null) return;
      clTargetVal = v;
      $('#clTargetLabel',ov).textContent = (opts.find(o=>o.value===v)||{}).label || v;
    };
    let imgData='';
    $('#clImg',ov).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, 1, 500);
        if(data) imgData=data;
      }catch{}
      e.target.value='';
    };
    $('#clCancel',ov).onclick=()=>ov.remove();
    $('#clSend',ov).onclick=()=>{
      const name=$('#clName',ov).value.trim();
      if(!name) return alert('Dê um nome ao NPC.');
      const raw=$('#clScript',ov).value.trim();
      const script=raw?raw.split('\n').map(l=>{const parts=l.split('|');return{who:parts[0]?.trim()||name,line:parts[1]?.trim()||''};}):[{who:name,line:'...'}];
      state.calls.push({id:uid(),target:clTargetVal,npcName:name,npcAvatar:imgData,script,unrefusable:$('#clUnrefusable',ov).checked,seenBy:[],time:Date.now(),createdBy:p.id});
      saveState();ov.remove();showToast('Chamada enviada.');
    };
  }
  draw();
};

/* ==================== INVENTÁRIO ==================== */
APPS.inventario=function(body){
  const p=activeProfile();
  const isMaster=p.isAdmin;
  let filter='all';

  function totalWeight(){return p.inventory.reduce((s,i)=>s+(i.weight||0)*(i.qty||1),0);}
  function ammoInInventory(type){
    return p.inventory
      .filter(x=>x.category==='municao'&&x.ammoType===type)
      .reduce((s,x)=>s+(x.qty||0),0);
  }

  /* ---------- USO RÁPIDO (consumíveis / munição) ---------- */
  function quickUse(item,ev){
    ev&&ev.stopPropagation();
    if(item.category==='municao'){
      showToast('Munição só é usada ao recarregar uma arma.',true);
      return;
    }
    if(item.category==='consumivel'&&item.effect){
      const res=applyEffect(p.char,item.effect);
      if(!res){alert('Efeito inválido: '+item.effect);return;}
      animateUse(res.healed,res.target);
      item.qty--;
      if(item.qty<=0 && !isMaster) p.inventory=p.inventory.filter(x=>x.id!==item.id);
      saveState();
      updateSanityEffects();
      const lbl=res.target==='hp'?'Vida':res.target==='san'?'Sanidade':'PE';
      showToast(`+${res.healed} ${lbl}`);
      setTimeout(()=>APPS.inventario(body),400);
      return;
    }
    showToast('Este item não tem efeito de uso.',true);
  }

  /* ---------- PAINEL DA ARMA DE FOGO ---------- */
  function drawFirearmPanel(item){
    const ammoType=AMMO_TYPES[item.ammoType]||AMMO_TYPES.special;
    const unknown=(item.currentAmmo===null||typeof item.currentAmmo==='undefined');
    const cur=unknown?'?':item.currentAmmo;
    const max=item.magazineSize||0;
    const invAmmo=ammoInInventory(item.ammoType);
    const empty=!unknown&&item.currentAmmo<=0;

    body.innerHTML=`
      <div class="firearm-panel">
        <div class="fa-portrait" ${item.image?`style="background-image:url('${item.image}')"`:''}>
          ${item.image?'':'<i class="fa-solid fa-gun"></i>'}
        </div>
        <div class="fa-title">${esc(item.name)}</div>
        <div class="fa-sub"><i class="fa-solid ${ammoType.icon}" style="color:${ammoType.color}"></i> ${ammoType.label}${item.damage?' · '+esc(item.damage):''}</div>

        <div class="fa-ammo ${empty?'empty':''}">
          <div class="fa-ammo-num">${cur}<span class="fa-ammo-sep">/</span>${max}</div>
          <div class="fa-ammo-lbl">pente</div>
        </div>

        <div class="fa-inv-ammo">
          <i class="fa-solid fa-bullseye"></i>
          Munição ${ammoType.label} no inventário: <b>${invAmmo}</b>
        </div>

        ${unknown?`
          <button class="fa-btn verify" id="faVerify">
            <i class="fa-solid fa-magnifying-glass"></i> Verificar arma
          </button>
          <div class="fa-hint">Você ainda não sabe quantas balas tem neste pente. Ao verificar, a arma tentará carregar munição automaticamente.</div>
        `:`
          <div class="fa-actions">
            <button class="fa-btn shoot" id="faShoot" ${item.currentAmmo<=0?'disabled':''}>
              <i class="fa-solid fa-crosshairs"></i> Atirar
            </button>
            <button class="fa-btn reload" id="faReload" ${invAmmo<=0?'disabled':''}>
              <i class="fa-solid fa-rotate-right"></i> Recarregar
            </button>
          </div>
          <div class="fa-actions2">
            <button class="fa-btn-small" id="faCheck"><i class="fa-solid fa-eye"></i> Checar pente</button>
            ${isMaster?`<button class="fa-btn-small" id="faEdit"><i class="fa-solid fa-pen"></i> Editar</button>`:''}
          </div>
        `}

        ${item.desc?`<div class="fa-desc">${esc(item.desc)}</div>`:''}

        <div class="row" style="width:100%">
          <button class="btn" id="faBack" style="flex:1">Voltar</button>
          ${!isMaster?`<button class="btn danger" id="faDrop" style="flex:1"><i class="fa-solid fa-trash"></i> Jogar fora</button>`:''}
        </div>
      </div>`;

    $('#faBack',body).onclick=drawList;

    // Jogar fora arma (agente) — descarta a arma e qualquer munição no pente
    $('#faDrop',body)?.addEventListener('click',()=>{
      const ammoTxt = (typeof item.currentAmmo === 'number' && item.currentAmmo > 0)
        ? `\n\n(${item.currentAmmo} bala${item.currentAmmo!==1?'s':''} no pente vão junto)`
        : '';
      if(!confirm(`Jogar fora "${item.name}"?${ammoTxt}\n\nEssa ação não pode ser desfeita.`)) return;
      p.inventory = p.inventory.filter(x=>x.id!==item.id);
      saveState();
      drawList();
      showToast('Arma descartada.');
      Haptic.med();
    });

    /* VERIFICAR — rola um número aleatório de balas no pente */
    $('#faVerify',body)?.addEventListener('click',()=>{
      const max = item.magazineSize || 0;
      // Rola de 0 até o tamanho do pente
      const foundAmmo = max > 0 ? Math.floor(Math.random() * (max + 1)) : 0;
      item.currentAmmo = foundAmmo;
      saveState();

      // Som de "mexer na arma" pra dar suspense
      Sound.emptyClick();
      Haptic.short();

      // Mensagem só informa o que achou
      if(foundAmmo === 0){
        showToast('O pente está vazio.', true);
      } else if(foundAmmo === max){
        showToast(`Pente cheio! ${foundAmmo}/${max} balas.`);
      } else {
        showToast(`Pente com ${foundAmmo}/${max} bala${foundAmmo!==1?'s':''}.`);
      }

      setTimeout(()=>drawFirearmPanel(item),900);
    });
    /* ATIRAR */
    $('#faShoot',body)?.addEventListener('click',()=>{
      if(item.currentAmmo<=0){ Sound.emptyClick(); Haptic.short(); showToast('Pente vazio!',true); return; }
      item.currentAmmo--;
      if(item.customSound){
        try{
          // pausa qualquer outro som custom tocando pra não empilhar
          const a = new Audio(item.customSound);
          a.volume = 0.7 * SFX_VOLUME;
          a.preload = 'auto';
          a.play().catch(err=>{
            // Se rejeitar (formato, rede, etc.), avisa e cai no padrão
            console.warn('Falha ao tocar som da arma:', err);
            Sound.gunshot();
          });
        }catch(err){
          console.warn('Erro ao criar Audio:', err);
          Sound.gunshot();
        }
      } else {
        Sound.gunshot();
      }
      Haptic.shoot();
      // Registra o tiro pra todos os outros devices tocarem
      if(!state.soundEvents) state.soundEvents=[];
      state.soundEvents.push({
        id: uid(),
        byId: p.id,
        byName: p.name,
        time: Date.now(),
        sound: item.customSound || ''   // ← AQUI: guarda qual som usar
      });
      if(state.soundEvents.length>30) state.soundEvents=state.soundEvents.slice(-30);
      saveState();
      flashScreen('red');
      // Log no chat
      state.messages.push({id:uid(),from:'system',fromName:'Log',to:'all',
        fromId:p.id, isSecret:p.isAdmin,
        text:`🔫 ${p.name} disparou ${item.name} (${item.currentAmmo}/${item.magazineSize||0} restantes).`,
        time:Date.now(),isLog:true});
      saveState();
      // Rola dano se tiver fórmula
      const r=item.damage?rollFormula(item.damage):null;
      if(r){
        setTimeout(()=>{
          const ov=document.createElement('div');
          ov.className='roll-overlay';
          const best=r.rolls.includes(r.sides);
          ov.innerHTML=`<div class="roll-card">
            ${best?'<div class="roll-crit-tag">DANO MÁXIMO!</div>':''}
            <div class="roll-skill">${esc(item.name)}</div>
            <div class="roll-attr">TIRO</div>
            <div class="roll-dice-row">${r.rolls.map(d=>`<span class="die ${d===r.sides?'crit':''}">${d}</span>`).join('')}${r.mod?`<span class="die best">${r.mod>0?'+':''}${r.mod}</span>`:''}</div>
            <div class="roll-total-wrap"><div class="roll-total-label">Dano</div><div class="roll-total">${r.total}</div></div>
            <button class="roll-close">Fechar</button></div>`;
          screen.appendChild(ov);
          const close=()=>ov.remove();
          ov.addEventListener('click',e=>{if(e.target===ov) close();});
          $('.roll-close',ov).onclick=close;
        },300);
      } else {
        showToast('💥 Bang!');
      }
      setTimeout(()=>drawFirearmPanel(item),500);
    });

    /* RECARREGAR */
    $('#faReload',body)?.addEventListener('click',()=>{
      const loaded=doReload(item,false);
      if(loaded<=0){ Sound.emptyClick(); showToast('Sem munição do tipo '+ammoType.label+'.',true); return; }
      saveState();
      if(item.customReloadSound){
        try{ const a=new Audio(item.customReloadSound); a.volume=0.7*SFX_VOLUME; a.play().catch(()=>Sound.reload()); }catch{ Sound.reload(); }
      } else { Sound.reload(); }
      Haptic.med();
      showToast(`+${loaded} bala${loaded!==1?'s':''} no pente.`);
      setTimeout(()=>drawFirearmPanel(item),500);
    });

    /* CHECAR (re-renderiza) */
    $('#faCheck',body)?.addEventListener('click',()=>{
      Sound.click();
      drawFirearmPanel(item);
    });

    /* EDITAR (Mestre) */
    $('#faEdit',body)?.addEventListener('click',()=>drawEditor(item));
  }

  /* ---------- RELOAD LÓGICA ---------- */
  function doReload(item,isVerify){
    if(item.currentAmmo===null||typeof item.currentAmmo==='undefined') item.currentAmmo=0;
    const space=(item.magazineSize||0)-item.currentAmmo;
    if(space<=0) return 0;
    // Encontra munição do tipo no inventário
    const ammoItems=p.inventory.filter(x=>x.category==='municao'&&x.ammoType===item.ammoType&&x.qty>0);
    let loaded=0;
    for(const ammo of ammoItems){
      if(loaded>=space) break;
      const take=Math.min(ammo.qty,space-loaded);
      ammo.qty-=take;
      loaded+=take;
      if(ammo.qty<=0 && !isMaster) p.inventory=p.inventory.filter(x=>x.id!==ammo.id);
    }
    item.currentAmmo+=loaded;
    return loaded;
  }

  /* ---------- LISTA ---------- */
  function drawList(){
    const items=filter==='all'?p.inventory:p.inventory.filter(i=>(i.category||'outro')===filter);
    const w=totalWeight(),lim=p.weightLimit||20,over=w>lim;
    body.innerHTML=`
      <div class="weight-bar ${over?'over':''}">
        <div class="wb-head"><span><i class="fa-solid fa-weight-hanging ic"></i> Peso: ${w.toFixed(1)} / ${lim} kg</span>${over?'<span>SOBRECARREGADO</span>':''}</div>
        <div class="wb-track"><div class="wb-fill" style="width:${clamp(w/Math.max(1,lim),0,1)*100}%"></div></div>
      </div>
      ${isMaster?`<div class="inv-toolbar"><button class="primary" id="addItem"><i class="fa-solid fa-plus"></i> Adicionar item</button></div>`:''}
      <div class="cat-filter" id="catFilter">
        <button data-f="all" class="${filter==='all'?'sel':''}">Todos</button>
        ${CAT_ORDER.map(cat=>{
          const n=p.inventory.filter(i=>(i.category||'outro')===cat).length;
          return `<button data-f="${cat}" class="${filter===cat?'sel':''}"><i class="fa-solid ${CATEGORIES[cat].icon}"></i> ${CATEGORIES[cat].label}${n?' ('+n+')':''}</button>`;
        }).join('')}
      </div>
      ${items.length===0?'<div class="empty">Nenhum item nesta categoria.</div>'
        :`<div class="inv-grid">
          ${items.map(it=>{
            const cat=CATEGORIES[it.category||'outro'];
            const isFirearm=it.category==='arma'&&it.isFirearm;
            const ammoType=AMMO_TYPES[it.ammoType]||AMMO_TYPES.special;
            const unknown=isFirearm&&(it.currentAmmo===null||typeof it.currentAmmo==='undefined');
            const isAmmo=it.category==='municao';
            // Quick-use só pra consumível
            const canQuickUse=(it.category==='consumivel'&&it.effect);
            const useBtn=canQuickUse?`<button class="use-btn" data-use="${it.id}" title="Usar"><i class="fa-solid fa-hand"></i></button>`:'';
            const ammoBadge=isFirearm
              ?`<span class="ammo-badge ${unknown?'unknown':''}"><i class="fa-solid fa-bullseye"></i> ${unknown?'?':it.currentAmmo}/${it.magazineSize||0}</span>`
              :'';
            const ammoTypeTag=isAmmo?`<span class="ammo-type-tag">${ammoType.label}</span>`:'';
            return `
              <div class="inv-card" data-id="${it.id}">
                <span class="cat-badge" style="color:${cat.color}"><i class="fa-solid ${cat.icon}"></i> ${cat.label}</span>
                ${ammoBadge}${ammoTypeTag}
                <div class="inv-img" style="${it.image?`background-image:url('${it.image}')`:''}">${it.image?'':`<i class="fa-solid ${cat.icon}"></i>`}</div>
                <div class="inv-info">
                  <div class="inv-name">${esc(it.name)}</div>
                  <div class="inv-qty"><span>Qtd: ${it.qty||1}</span><span class="w">${((it.weight||0)*(it.qty||1)).toFixed(1)}kg</span></div>
                </div>
                ${useBtn}
              </div>`;
          }).join('')}
        </div>`}`;

    if(isMaster) $('#addItem',body).onclick=()=>drawEditor(null);
    body.querySelectorAll('#catFilter button').forEach(b=>b.onclick=()=>{filter=b.dataset.f;drawList();});
    body.querySelectorAll('.inv-card').forEach(card=>card.onclick=()=>{
      const item=p.inventory.find(i=>i.id===card.dataset.id);
      if(!item) return;
      if(item.category==='arma'&&item.isFirearm){
        drawFirearmPanel(item);
      } else {
        drawEditor(item);
      }
    });
    body.querySelectorAll('[data-use]').forEach(btn=>{
      btn.onclick=(ev)=>{
        const item=p.inventory.find(i=>i.id===btn.dataset.use);
        if(item) quickUse(item,ev);
      };
    });
  }

  /* ---------- EDITOR ---------- */
  function drawEditor(item){
    const isNew=!item;
    const it=item||{id:uid(),name:'',qty:1,desc:'',image:'',category:'outro',weight:0,damage:'',effect:'',isFirearm:false,magazineSize:0,currentAmmo:0,ammoType:'pistol'};
    let currentCat=it.category||'outro';
    let isFirearm=!!it.isFirearm;
    let ammoType=it.ammoType||'pistol';
    let unknownMag=(it.currentAmmo===null);
    const agents=agentProfiles();
    const canGive=isMaster&&!isNew&&agents.length>0;
    const isWeapon=currentCat==='arma';
    const isConsumable=currentCat==='consumivel';
    const isAmmo=currentCat==='municao';

    // Modo leitura pra agente
    // Modo leitura pra agente
    if(!isMaster&&!isNew){
      const cat=CATEGORIES[currentCat];
      body.innerHTML=`
        <div class="inv-editor">
          <div class="inv-img-pick" style="cursor:default">
            ${it.image?`<img src="${it.image}">`:`<i class="fa-solid ${cat.icon}" style="font-size:3em;color:${cat.color}"></i>`}
          </div>
          <div class="card" style="margin:0"><label>Nome</label><div style="font-weight:800;font-size:1.05em">${esc(it.name)}</div></div>
          <div class="card" style="margin:0"><label>Categoria</label><div style="font-weight:700"><i class="fa-solid ${cat.icon}" style="color:${cat.color}"></i> ${cat.label}${isAmmo?` · ${(AMMO_TYPES[ammoType]||{label:'?'}).label}`:''}</div></div>
          <div class="row" style="gap:2.5cqw">
            <div class="card" style="margin:0;flex:1;min-width:45%"><label>Quantidade</label><div style="font-weight:800">${it.qty||1}</div></div>
            <div class="card" style="margin:0;flex:1;min-width:45%"><label>Peso total</label><div style="font-weight:800">${((it.weight||0)*(it.qty||1)).toFixed(1)} kg</div></div>
          </div>
          ${it.desc?`<div class="card" style="margin:0"><label>Descrição</label><div style="font-size:.9em;line-height:1.5">${esc(it.desc)}</div></div>`:''}
          <div class="row">
            <button class="btn" id="cancel" style="flex:1">Voltar</button>
            <button class="btn danger" id="dropItem" style="flex:1"><i class="fa-solid fa-trash"></i> Jogar fora</button>
          </div>
        </div>`;
      $('#cancel',body).onclick=drawList;

      // Jogar fora (agente) — permite descartar tudo ou só parte da pilha
      $('#dropItem',body).onclick= async ()=>{
        const qty = it.qty || 1;
        if(qty > 1){
          const v = await openPrompt({
            title: 'Jogar fora',
            message: `Quantos "${it.name}" descartar?\nVocê tem ${qty}.`,
            defaultValue: '1',
            inputType: 'number',
            min: 1,
            max: qty
          });
          if(v === null) return;
          const n = parseInt(v);
          if(isNaN(n) || n < 1){ showToast('Quantidade inválida.', true); return; }
          if(n > qty){ showToast('Você não tem tudo isso.', true); return; }
          if(n >= qty){
            p.inventory = p.inventory.filter(x=>x.id!==it.id);
          } else {
            it.qty -= n;
          }
        } else {
          p.inventory = p.inventory.filter(x=>x.id!==it.id);
        }
        saveState();
        drawList();
        showToast('Item descartado.');
        Haptic.med();
      };
      return;
    }

    // Editor completo (Mestre)
    body.innerHTML=`
      <div class="inv-editor">
        <label class="inv-img-pick" id="imgPick">${it.image?`<img src="${it.image}">`:'<i class="fa-solid fa-camera"></i> Toque para escolher uma imagem'}<input type="file" accept="image/*" id="imgInput"></label>
        <div class="card" style="margin:0"><label>Categoria</label>
          <div class="cat-picker" id="catPick">
            ${CAT_ORDER.map(cat=>`<button data-c="${cat}" class="${currentCat===cat?'sel':''}"><i class="fa-solid ${CATEGORIES[cat].icon}"></i><span>${CATEGORIES[cat].label}</span></button>`).join('')}
          </div>
        </div>
        <div class="card" style="margin:0"><label>Nome do item</label><input id="itName" maxlength="40" value="${esc(it.name)}"></div>
        <div class="row" style="gap:2.5cqw">
          <div class="card" style="margin:0;flex:1;min-width:45%"><label>Quantidade</label><input id="itQty" type="number" min="1" value="${it.qty||1}"></div>
          <div class="card" style="margin:0;flex:1;min-width:45%"><label>Peso unit. (kg)</label><input id="itWeight" type="number" step="0.1" min="0" value="${it.weight||0}"></div>
        </div>

        <!-- ARMA -->
        <div class="card" style="margin:0;display:${isWeapon?'':'none'}" id="firearmCard">
          <label><i class="fa-solid fa-gun"></i> Arma de fogo?</label>
          <label class="check-row" style="margin-top:0">
            <input type="checkbox" id="itIsFirearm" ${isFirearm?'checked':''}>
            <span>Sim, é arma de fogo</span>
          </label>
          <div id="firearmFields" style="display:${isFirearm?'':'none'};margin-top:2.5cqw">
            <label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Tipo de munição</label>
            <button type="button" class="select-trigger" id="itAmmoTypeBtn" style="margin-bottom:2.5cqw">
              <span id="itAmmoTypeLabel">${(AMMO_TYPES[ammoType]||AMMO_TYPES.pistol).label}</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
            <label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Tamanho do pente</label>
            <input id="itMagSize" type="number" min="0" value="${it.magazineSize||0}" style="margin-bottom:2.5cqw">

            <label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Som do disparo (opcional)</label>
            <label class="sound-pick" id="soundPick">
              <i class="fa-solid fa-volume-high"></i>
              <span id="soundLabel">${it.customSound?'Som customizado carregado':'Carregar som (.mp3, .wav, .ogg)'}</span>
              <input type="file" accept="audio/*" id="soundFile">
            </label>
            <div style="display:flex;gap:1.5cqw;margin-top:1.5cqw">
              <button type="button" class="btn" id="faTestSound" style="flex:1"><i class="fa-solid fa-play"></i> Testar</button>
              ${it.customSound?'<button type="button" class="btn danger" id="clearSound" style="flex:1"><i class="fa-solid fa-xmark"></i> Remover</button>':''}
            </div>
            <div style="font-size:.68em;color:rgba(255,255,255,.4);margin-top:1.5cqw;letter-spacing:.03em">
              Recomendado: arquivo &lt; 300KB. Sons grandes deixam a sincronização lenta.
            </div>

            <label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw;margin-top:2.5cqw">Som de recarregar (opcional)</label>
            <label class="sound-pick" id="reloadSoundPick">
              <i class="fa-solid fa-rotate-right"></i>
              <span id="reloadSoundLabel">${it.customReloadSound?'Som de recarga carregado':'Carregar som (.mp3, .wav, .ogg)'}</span>
              <input type="file" accept="audio/*" id="reloadSoundFile">
            </label>
            <div style="display:flex;gap:1.5cqw;margin-top:1.5cqw">
              <button type="button" class="btn" id="faTestReloadSound" style="flex:1"><i class="fa-solid fa-play"></i> Testar</button>
              ${it.customReloadSound?'<button type="button" class="btn danger" id="clearReloadSound" style="flex:1"><i class="fa-solid fa-xmark"></i> Remover</button>':''}
            </div>

            <label class="check-row" style="margin-top:2.5cqw">
              <input type="checkbox" id="itUnknownMag" ${unknownMag?'checked':''}>
              <span>Pente desconhecido (jogador precisa verificar)</span>
            </label>
            <div id="curAmmoWrap" style="display:${unknownMag?'none':'block'};margin-top:2.5cqw">
              <label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Balas no pente (atual)</label>
              <input id="itCurAmmo" type="number" min="0" value="${typeof it.currentAmmo==='number'?it.currentAmmo:0}">
            </div>
          </div>
        </div>

        <div class="card" style="margin:0;display:${isWeapon?'':'none'}" id="dmgCard">
          <label>Dano (fórmula)</label><input id="itDamage" maxlength="20" value="${esc(it.damage||'')}" placeholder="Ex: 1d8+2">
        </div>

        <!-- MUNIÇÃO -->
        <div class="card" style="margin:0;display:${isAmmo?'':'none'}" id="ammoCard">
          <label><i class="fa-solid fa-bullseye"></i> Tipo de munição</label>
          <button type="button" class="select-trigger" id="itAmmoTypeMBtn">
            <span id="itAmmoTypeMLabel">${(AMMO_TYPES[ammoType]||AMMO_TYPES.pistol).label}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <div style="font-size:.68em;color:rgba(255,255,255,.4);margin-top:1.5cqw;letter-spacing:.03em">Armas de fogo só recarregam com munição do mesmo tipo.</div>
        </div>

        <!-- CONSUMÍVEL -->
        <div class="card" style="margin:0;display:${isConsumable?'':'none'}" id="effCard">
          <label>Efeito ao usar (fórmula)</label>
          <div class="preset-row">
            <button type="button" data-eff="hp:1d6">+1d6 Vida</button>
            <button type="button" data-eff="hp:2d6">+2d6 Vida</button>
            <button type="button" data-eff="hp:3d6">+3d6 Vida</button>
            <button type="button" data-eff="hp:1d8+2">+1d8+2 Vida</button>
            <button type="button" data-eff="san:1d4">+1d4 SAN</button>
            <button type="button" data-eff="san:1d6">+1d6 SAN</button>
            <button type="button" data-eff="san:2d6">+2d6 SAN</button>
            <button type="button" data-eff="san:1d8+2">+1d8+2 SAN</button>
            <button type="button" data-eff="pe:1d4">+1d4 PE</button>
            <button type="button" data-eff="pe:1d6">+1d6 PE</button>
          </div>
          <input id="itEffect" maxlength="30" value="${esc(it.effect||'')}" placeholder="hp:1d6 / san:2d6+2 / pe:1d4">
        </div>

        <div class="card" style="margin:0"><label>Descrição</label><textarea id="itDesc" rows="3">${esc(it.desc||'')}</textarea></div>

        ${canGive?`<div class="card give-box"><label><i class="fa-solid fa-gift"></i> Dar para agente</label>
          <div class="row" style="align-items:stretch">
            <button type="button" class="select-trigger" id="giveToBtn" style="flex:1">
              <span id="giveToLabel">Escolher agente...</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
            <button class="btn-primary" id="giveBtn">Dar</button>
          </div>
        </div>`:''}

        <div class="row">
          <button class="btn" id="cancel">Voltar</button>
          <button class="btn-primary" id="save" style="flex:1">Salvar</button>
          ${isNew?'':'<button class="btn danger" id="del">Excluir</button>'}
        </div>
      </div>`;

    let newImage=it.image;
    const pick=$('#imgPick',body),inp=$('#imgInput',body);
    pick.onclick=()=>inp.click();
    inp.onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const cropped=await pickAndCrop(f, 1, 800);
        if(cropped){
          newImage=cropped;
          pick.innerHTML=`<img src="${newImage}"><input type="file" accept="image/*" id="imgInput">`;
          const ni=$('#imgInput',body);
          ni.addEventListener('change', async e2=>{
            const f2=e2.target.files[0];if(!f2) return;
            const c2=await pickAndCrop(f2, 1, 800);
            if(c2){ newImage=c2; pick.querySelector('img').src=c2; }
          });
        }
      }catch{alert('Erro.');}
      e.target.value='';
    };

    const refreshCats=()=>{
      $('#firearmCard',body).style.display=currentCat==='arma'?'':'none';
      $('#dmgCard',body).style.display=currentCat==='arma'?'':'none';
      $('#ammoCard',body).style.display=currentCat==='municao'?'':'none';
      $('#effCard',body).style.display=currentCat==='consumivel'?'':'none';
    };
    body.querySelectorAll('#catPick button').forEach(b=>b.onclick=()=>{
      currentCat=b.dataset.c;
      body.querySelectorAll('#catPick button').forEach(x=>x.classList.toggle('sel',x===b));
      refreshCats();
    });
    $('#itIsFirearm',body).onchange=e=>{
      isFirearm=e.target.checked;
      $('#firearmFields',body).style.display=isFirearm?'':'none';
    };
    $('#itUnknownMag',body)?.addEventListener('change',e=>{
      unknownMag=e.target.checked;
      $('#curAmmoWrap',body).style.display=unknownMag?'none':'block';
    });
    // Tipo de munição (arma) — dropdown custom
    $('#itAmmoTypeBtn',body)?.addEventListener('click', async ()=>{
      const v = await openSelect({
        title:'Tipo de munição',
        current: ammoType,
        options: Object.entries(AMMO_TYPES).map(([k,val])=>({ value:k, label:val.label }))
      });
      if(v === null) return;
      ammoType = v;
      $('#itAmmoTypeLabel',body).textContent = (AMMO_TYPES[v]||AMMO_TYPES.pistol).label;
    });    let newSound = it.customSound || '';
    const soundFileInp = $('#soundFile', body);
    $('#soundPick', body)?.addEventListener('click', (e)=>{
      if(e.target.tagName !== 'INPUT') soundFileInp.click();
    });
    soundFileInp?.addEventListener('change', async e=>{
      const f = e.target.files[0]; if(!f) return;
      if(f.size > 800*1024){
        if(!confirm('Arquivo grande ('+Math.round(f.size/1024)+'KB). Pode deixar a sincronização lenta. Continuar?')){ e.target.value=''; return; }
      }
      try{
        const data = await uploadFileDirect(f, 'weapons');
        newSound = data;
        $('#soundLabel', body).textContent = f.name;
        showToast('Som de disparo carregado.');
      }catch{ alert('Erro ao carregar som.'); }
      e.target.value = '';
    });
    $('#faTestSound', body)?.addEventListener('click', ()=>{
      if(newSound){
        try{ const a=new Audio(newSound); a.volume=0.7*SFX_VOLUME; a.play().catch(()=>Sound.gunshot()); }catch{ Sound.gunshot(); }
      } else { Sound.gunshot(); }
    });
    $('#clearSound', body)?.addEventListener('click', ()=>{
      newSound='';
      $('#soundLabel', body).textContent = 'Carregar som (.mp3, .wav, .ogg)';
      $('#clearSound', body).remove();
      showToast('Som removido.');
    });

    // ---- Som customizado de RECARGA ----
    let newReloadSound = it.customReloadSound || '';
    const reloadSoundFileInp = $('#reloadSoundFile', body);
    $('#reloadSoundPick', body)?.addEventListener('click', (e)=>{
      if(e.target.tagName !== 'INPUT') reloadSoundFileInp.click();
    });
    reloadSoundFileInp?.addEventListener('change', async e=>{
      const f = e.target.files[0]; if(!f) return;
      if(f.size > 800*1024){
        if(!confirm('Arquivo grande ('+Math.round(f.size/1024)+'KB). Continuar?')){ e.target.value=''; return; }
      }
      try{
        const data = await uploadFileDirect(f, 'weapons');
        newReloadSound = data;
        $('#reloadSoundLabel', body).textContent = f.name;
        showToast('Som de recarga carregado.');
      }catch{ alert('Erro ao carregar som.'); }
      e.target.value = '';
    });
    $('#faTestReloadSound', body)?.addEventListener('click', ()=>{
      if(newReloadSound){
        try{ const a=new Audio(newReloadSound); a.volume=0.7*SFX_VOLUME; a.play().catch(()=>Sound.reload()); }catch{ Sound.reload(); }
      } else { Sound.reload(); }
    });
    $('#clearReloadSound', body)?.addEventListener('click', ()=>{
      newReloadSound='';
      $('#reloadSoundLabel', body).textContent = 'Carregar som (.mp3, .wav, .ogg)';
      $('#clearReloadSound', body).remove();
      showToast('Som de recarga removido.');
    });
    // Tipo de munição (munição) — dropdown custom
    $('#itAmmoTypeMBtn',body)?.addEventListener('click', async ()=>{
      const v = await openSelect({
        title:'Tipo de munição',
        current: ammoType,
        options: Object.entries(AMMO_TYPES).map(([k,val])=>({ value:k, label:val.label }))
      });
      if(v === null) return;
      ammoType = v;
      $('#itAmmoTypeMLabel',body).textContent = (AMMO_TYPES[v]||AMMO_TYPES.pistol).label;
    });

    body.querySelectorAll('.preset-row button').forEach(b=>{
      b.onclick=()=>{ $('#itEffect',body).value=b.dataset.eff; };
    });

    const saveFields=()=>{
      const name=$('#itName',body).value.trim();
      const qty=parseInt($('#itQty',body).value)||1;
      const weight=parseFloat($('#itWeight',body).value)||0;
      const desc=$('#itDesc',body).value.trim();
      const damage=$('#itDamage',body)?.value.trim()||'';
      const effect=$('#itEffect',body)?.value.trim()||'';
      const out={name,qty,weight,desc,damage,effect,category:currentCat};
      if(currentCat==='arma'&&isFirearm){
        out.isFirearm=true;
        out.ammoType=ammoType||'pistol';
        out.magazineSize=parseInt($('#itMagSize',body)?.value)||0;
        out.currentAmmo=unknownMag?null:(parseInt($('#itCurAmmo',body)?.value)||0);
        out.customSound=newSound||'';
        out.customReloadSound=newReloadSound||'';
      } else if(currentCat==='arma'){
        out.isFirearm=false;
        out.damage=damage;
      } else if(currentCat==='municao'){
        out.ammoType=ammoType||'pistol';
      }
      return out;
    };

    $('#cancel',body).onclick=drawList;
    $('#save',body).onclick=()=>{
      const f=saveFields();
      if(!f.name) return alert('Dê um nome ao item.');
      if(isNew){
        p.inventory.push({id:it.id,...f,image:newImage});
      } else {
        Object.assign(item,{...f,image:newImage});
      }
      saveState();drawList();showToast(isNew?'Item criado.':'Item salvo.');
    };
    if(!isNew){
      $('#del',body).onclick=()=>{
        if(!confirm('Excluir este item?')) return;
        p.inventory=p.inventory.filter(x=>x.id!==it.id);
        saveState();drawList();
      };
    }
    if(canGive){
      let giveToVal = '';
      $('#giveToBtn',body).onclick = async ()=>{
        const opts = agents.map(a=>({ value:a.id, label:a.name }));
        const v = await openSelect({ title:'Enviar para quem?', current:giveToVal, options:opts });
        if(v === null) return;
        giveToVal = v;
        $('#giveToLabel',body).textContent = (opts.find(o=>o.value===v)||{}).label || v;
      };
      $('#giveBtn',body).onclick=()=>{
        const targetId = giveToVal;
        if(!targetId) return showToast('Escolha um agente.', true);
        const target=profileById(targetId);if(!target) return;
        const f=saveFields();
        Object.assign(item,{...f,image:newImage});
        const clone={id:uid(),...f,image:newImage};
        // Se for arma de fogo com pente desconhecido, reseta
        if(clone.isFirearm) clone.currentAmmo=null;
        target.inventory.push(clone);
        saveState();
        showToast(`Item enviado para ${target.name}.`);
      };
    }
  }

  drawList();
};

/* ==================== NOTAS ==================== */
APPS.notas=function(body){
  const p=activeProfile();
  function list(){
    body.innerHTML=`
      <button class="btn-primary" id="newNote" style="width:100%">+ Nova nota</button>
      <div class="notes-list">
        ${p.notes.length?p.notes.map(n=>{
          const atts=n.attachments||[];
          const nImg=atts.filter(a=>a.type==='image').length;
          const nPdf=atts.filter(a=>a.type==='pdf').length;
          const attach=[];
          if(nImg) attach.push(`<i class="fa-solid fa-image"></i> ${nImg}`);
          if(nPdf) attach.push(`<i class="fa-solid fa-file-pdf"></i> ${nPdf}`);
          return `<button class="note-item" data-id="${n.id}">
            <strong>${esc((n.text.split('\n')[0]||'Sem título').slice(0,32))}</strong>
            ${n.text.split('\n').slice(1).join(' ').trim()?`<div class="preview">${esc(n.text.split('\n').slice(1).join(' ').trim().slice(0,60))}</div>`:''}
            <div class="meta"><span>${new Date(n.date).toLocaleDateString('pt-BR')}</span>${attach.length?`<span class="attach-tag">${attach.join(' ')}</span>`:''}</div>
          </button>`;
        }).join(''):'<p class="empty">Nenhuma nota ainda.</p>'}
      </div>`;
    $('#newNote',body).onclick=()=>edit({id:uid(),text:'',date:Date.now(),attachments:[]},true);
    body.querySelectorAll('.note-item').forEach(b=>b.onclick=()=>edit(p.notes.find(n=>n.id==b.dataset.id)));
  }
  function edit(note,isNew){
    body.innerHTML=`
      <div class="note-edit">
        <textarea id="noteText" placeholder="Escreva algo...">${esc(note.text)}</textarea>
        <div class="attach-bar">
          <button id="addImg"><i class="fa-solid fa-image"></i> Imagem</button>
          <button id="addPdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
          <input type="file" accept="image/*" id="fileImg">
          <input type="file" accept="application/pdf" id="filePdf">
        </div>
        <div class="attachments" id="atts"></div>
        <div class="row">
          <button class="btn" id="cancel">Voltar</button>
          <button class="btn-primary" id="save" style="flex:1">Salvar</button>
          ${isNew?'':'<button class="btn danger" id="del">Excluir</button>'}
        </div>
      </div>`;
    const atts=note.attachments||(note.attachments=[]);
    const attsEl=$('#atts',body);
    function renderAtts(){
      attsEl.innerHTML=atts.map((a,i)=>`<div class="attach-item">
        ${a.type==='image'?`<img src="${a.data}">`:`<div class="pdf"><span class="ic"><i class="fa-solid fa-file-pdf"></i></span><span class="pdf-name">${esc(a.name)}</span></div>`}
        <div class="attach-actions">
          <a class="attach-dl" href="${a.data}" download="${esc(a.name)}" title="Baixar"><i class="fa-solid fa-download"></i></a>
          <button class="remove" data-i="${i}" title="Remover">✕</button>
        </div>
      </div>`).join('');
      attsEl.querySelectorAll('.remove').forEach(b=>b.onclick=()=>{atts.splice(+b.dataset.i,1);renderAtts();});
    }
    renderAtts();
    const fileImg=$('#fileImg',body),filePdf=$('#filePdf',body);
    $('#addImg',body).onclick=()=>fileImg.click();
    $('#addPdf',body).onclick=()=>filePdf.click();
    fileImg.onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, null, 900);
        if(data){ atts.push({type:'image',name:f.name,data}); renderAtts(); }
      }catch{alert('Erro.');}
      e.target.value='';
    };
    filePdf.onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      if(f.size>2*1024*1024){if(!confirm('PDF grande (>2MB). Continuar?')){e.target.value='';return;}}
      try{const data=await readFileAsDataURL(f);atts.push({type:'pdf',name:f.name,data});renderAtts();}catch{alert('Erro.');}
      e.target.value='';
    };
    $('#cancel',body).onclick=list;
    $('#save',body).onclick=()=>{
      const txt=$('#noteText',body).value.trim();
      if(!txt&&atts.length===0){list();return;}
      if(isNew) p.notes.unshift({...note,text:txt,date:Date.now(),attachments:atts});
      else{note.text=txt;note.date=Date.now();note.attachments=atts;}
      saveState();list();
    };
    if(!isNew){
      $('#del',body).onclick=()=>{
        if(!confirm('Excluir esta nota?')) return;
        p.notes=p.notes.filter(n=>n.id!==note.id);
        saveState();list();
      };
    }
  }
  list();
};

/* ==================== MENSAGENS ==================== */
const GHOST_MESSAGES=['eles ainda estão olhando…','você não devia ter vindo aqui','a porta está atrás de você','me ouve? me ouve? me ouve?','não é real. nenhum disso é real.','★ você foi marcado ★','a sanidade é uma mentira gentil'];

APPS.mensagens=function(body){
  const p=activeProfile();
  const isMaster=p.isAdmin;
  // marca como lido
  localStorage.setItem('msgSeen_'+p.id,String(Date.now()));
  let currentConv=null; // null = contact list
  let whisperMode=false;
  let whisperTo='';

  function allContacts(){
    // retorna todos contatos disponíveis: npcs + profiles (exceto self)
    const list=[];
    // "Todos" primeiro
    list.push({id:'all',name:'Todos',avatar:'',color:'#e74c3c',isGroup:true,isMaster:false});
    // NPCs
    (state.npcs||[]).forEach(n=>{
      list.push({id:'npc:'+n.id,name:n.name,avatar:n.avatar,color:'#f0c674',isNPC:true});
    });
    // Outros perfis
    state.profiles.filter(x=>x.id!==p.id).forEach(x=>{
      list.push({id:x.id,name:x.name,avatar:x.portrait||'',color:x.color,isMaster:x.isAdmin});
    });
    return list;
  }

  function messagesFor(convId){
    return state.messages.filter(m=>{
      // Mensagens marcadas como secretas só aparecem pro Mestre
      if(m.isSecret && !p.isAdmin) return false;
      if(m.isLog) return convId==='all';
      if(m.whisperTo){
        // whisper só aparece pra remetente e destinatário
        if(m.from!==p.id && m.whisperTo!==p.id) return false;
        // em conversa direta com a outra pessoa, mostra
        if(convId==='all') return true;
        const other = m.from===p.id ? m.whisperTo : m.from;
        return convId===other;
      }
      if(convId==='all'){
        if(m.fromNPC){
          return m.to==='all';
        }
        return m.to==='all';
      }
      // conversa direta
      if(m.fromNPC){
        const npcId='npc:'+m.npcId;
        return (m.to===p.id||m.to==='all') && convId===npcId;
      }
      return (m.from===p.id && m.to===convId) || (m.from===convId && m.to===p.id);
    }).sort((a,b)=>a.time-b.time);
  }

  function lastMsgPreview(convId){
    const msgs=messagesFor(convId);
    if(msgs.length===0) return null;
    const m=msgs[msgs.length-1];
    let who='';
    if(convId==='all'&&m.from!==p.id&&!m.isLog){
      if(m.fromNPC) who=m.fromName+': ';
      else who=m.fromName+': ';
    }
    const text=m.image?'📎 Imagem':m.text;
    return {who,text,time:m.time};
  }

  function unreadFor(convId){
    const seen=parseInt(localStorage.getItem('msgSeen_'+p.id)||'0');
    return messagesFor(convId).filter(m=>m.from!==p.id&&m.time>seen).length;
  }

  function fmtTime(t){
    const d=new Date(t);
    const today=new Date();
    const yest=new Date(); yest.setDate(yest.getDate()-1);
    if(d.toDateString()===today.toDateString()) return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    if(d.toDateString()===yest.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
  }

  function drawList(){
    const contacts=allContacts();
    const sorted=contacts.sort((a,b)=>{
      if(a.isGroup) return -1;
      if(b.isGroup) return 1;
      const la=lastMsgPreview(a.id);
      const lb=lastMsgPreview(b.id);
      if(!la&&!lb) return a.name.localeCompare(b.name);
      if(!la) return 1;
      if(!lb) return -1;
      return lb.time-la.time;
    });
    body.innerHTML=`
      <div class="wa-wrap">
        <div class="wa-header-bar">
          <div class="wa-search">
            <i class="fa-solid fa-search"></i>
            <input id="waSearch" placeholder="Buscar contato...">
          </div>
          ${isMaster?`<button class="wa-icon-btn danger" id="waClearHistory" title="Limpar histórico"><i class="fa-solid fa-trash"></i></button>`:''}
          ${isMaster?`<button class="wa-plus" id="waAddNPC" title="Novo NPC"><i class="fa-solid fa-plus"></i></button>`:''}
        </div>
        <div class="wa-list" id="waList">
          ${sorted.map(c=>{
            const preview=lastMsgPreview(c.id);
            const un=unreadFor(c.id);
            const initial=c.name.slice(0,1).toUpperCase();
            const avatarHTML=c.avatar
              ? `<div class="portrait" style="background-image:url('${c.avatar}')"></div>`
              : initial;
            return `
              <div class="wa-contact" data-id="${c.id}">
                <div class="avatar" style="--c:${c.color};${c.avatar?`background-image:url('${c.avatar}');background-size:cover;background-position:center`:''}">
                  ${c.avatar?'':avatarHTML}
                  ${c.isNPC?'<span class="npc-tag">★</span>':''}
                </div>
                <div class="info">
                  <div class="name">
                    ${esc(c.name)}
                    ${c.isMaster?'<i class="fa-solid fa-star star"></i>':''}
                    ${c.isNPC?'<span class="npc-pill">NPC</span>':''}
                  </div>
                  <div class="preview">
                    ${preview
                      ? `${preview.who?`<span class="who">${esc(preview.who)}</span>`:''}${esc(preview.text.slice(0,45))}`
                      : '<span style="opacity:.4">Sem mensagens</span>'}
                  </div>
                </div>
                <div class="meta">
                  ${preview?`<div class="time">${fmtTime(preview.time)}</div>`:''}
                  ${un?`<div class="unread">${un>9?'9+':un}</div>`:''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
    body.querySelectorAll('.wa-contact').forEach(el=>{
      el.onclick=()=>{
        currentConv=el.dataset.id;
        localStorage.setItem('msgSeen_'+p.id,String(Date.now()));
        drawConv();
      };
    });
        $('#waClearHistory')?.addEventListener('click',()=>{
      const total=(state.messages||[]).length;
      if(total===0){ showToast('Não há mensagens para limpar.',true); return; }
      if(!confirm('Apagar TODAS as '+total+' mensagens do chat?\n\nEssa ação não pode ser desfeita.')) return;
      state.messages=[];
      saveState();
      drawList();
      showToast('Histórico limpo.');
    });
    $('#waAddNPC')?.addEventListener('click',()=>editNPC(null));
    $('#waSearch')?.addEventListener('input',e=>{
      const q=e.target.value.toLowerCase();
      body.querySelectorAll('.wa-contact').forEach(el=>{
        const name=el.querySelector('.name').textContent.toLowerCase();
        el.style.display=name.includes(q)?'':'none';
      });
    });
  }

  function drawConv(){
    const contacts=allContacts();
    const contact=contacts.find(c=>c.id===currentConv);
    if(!contact){currentConv=null;drawList();return;}
    const msgs=messagesFor(currentConv);
    const isGroup=currentConv==='all';
    const canWhisper=isGroup; // só em grupo

    let lastDate='';
    let html='';
    msgs.forEach(m=>{
      const d=new Date(m.time);
      const dateKey=d.toDateString();
      if(dateKey!==lastDate){
        lastDate=dateKey;
        const today=new Date().toDateString();
        const yest=new Date(); yest.setDate(yest.getDate()-1);
        let label=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long'});
        if(dateKey===today) label='Hoje';
        else if(dateKey===yest.toDateString()) label='Ontem';
        html+=`<div class="wa-date">${label}</div>`;
      }
      if(m.isLog){
        const secretTag = m.isSecret
          ? `<span style="display:inline-block;margin-right:1.5cqw;padding:.3cqw 1.5cqw;border-radius:999px;background:rgba(155,89,182,.25);color:#bb8fce;font-style:normal;font-weight:800;font-size:.85em;letter-spacing:.05em">🔒</span>`
          : '';
        html+=`<div class="wa-msg" style="align-self:center;max-width:95%"><div class="bubble" style="background:rgba(240,198,116,.08);border-color:rgba(240,198,116,.25);font-size:.75em;font-style:italic;color:#f0c674">${secretTag}${esc(m.text)}</div></div>`;
        return;
      }
      const mine=m.from===p.id;
      const isWhisper=!!m.whisperTo;
      const authorHTML=(isGroup&&!mine)?`<div class="author">${esc(m.fromName)}</div>`:'';
      const timeHTML=`<span>${new Date(m.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>${mine?'<span class="check">✓✓</span>':''}`;
      const whisperLabel=isWhisper
        ? `<div style="font-size:.6em;color:#bb8fce;font-style:italic;margin-bottom:.8cqw">🔒 sussurro ${mine?'para '+esc((contacts.find(c=>c.id===m.whisperTo)||{name:'?'}).name):'de '+esc(m.fromName)}</div>`
        : '';
      html+=`<div class="wa-msg ${mine?'mine':''} ${isWhisper?'whisper':''}">${authorHTML}${whisperLabel}<div class="bubble">${m.image?`<img src="${m.image}">`:''}${m.text?esc(m.text):''}<div class="meta">${timeHTML}</div></div></div>`;
    });
    // ghost messages
    const sanPct=p.char.san.current/Math.max(1,p.char.san.max);
    if(sanPct<0.10&&currentConv==='all'&&Math.random()<0.7){
      const g=GHOST_MESSAGES[Math.floor(Math.random()*GHOST_MESSAGES.length)];
      html+=`<div class="wa-msg ghost" style="align-self:center;max-width:90%"><div class="author">???</div><div class="bubble">${esc(g)}<div class="meta">— —</div></div></div>`;
    }
    if(msgs.length===0&&!html.includes('wa-msg')){
      html='<div class="empty">Nenhuma mensagem ainda. Envie a primeira!</div>';
    }

    const avatarHTML=contact.avatar
      ? `<div class="portrait" style="background-image:url('${contact.avatar}')"></div>`
      : contact.name.slice(0,1).toUpperCase();

    const whisperTargetName = whisperTo
      ? ((contacts.find(c=>c.id===whisperTo)||{name:'?'}).name)
      : 'Escolher...';
    const whisperBar=whisperMode?`
      <div class="wa-whisper-bar">
        <i class="fa-solid fa-lock"></i>
        <span>Sussurrando para:</span>
        <button type="button" class="select-trigger" id="whisperBtn" style="flex:1;padding:1.5cqw 2.5cqw;font-size:.95em">
          <span id="whisperLabel">${esc(whisperTargetName)}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
      </div>`:'';

    body.innerHTML=`
      <div class="wa-wrap">
        <div class="wa-conv">
          <div class="wa-conv-header">
            <button class="wa-back" id="waBack">‹</button>
            <div class="avatar" style="--c:${contact.color};${contact.avatar?`background-image:url('${contact.avatar}');background-size:cover`:''}">
              ${contact.avatar?'':avatarHTML}
            </div>
            <div class="info">
              <div class="name">${esc(contact.name)}${contact.isMaster?' ★':''}${contact.isNPC?' (NPC)':''}</div>
              <div class="status">${isGroup?'Canal geral':contact.isNPC?'Contato NPC':'Conversa privada'}</div>
            </div>
          </div>
          <div class="wa-msgs" id="waMsgs">${html}</div>
          ${whisperBar}
          <div class="wa-input">
            ${canWhisper?`<button class="ibtn whisper-btn ${whisperMode?'active':''}" id="whisperToggle" title="Sussurro"><i class="fa-solid fa-lock"></i></button>`:''}
            <button class="ibtn" id="waAttach"><i class="fa-solid fa-paperclip"></i><input type="file" accept="image/*" id="waFile"></button>
            <textarea id="waText" placeholder="${whisperMode?'Sussurro...':'Mensagem...'}" rows="1"></textarea>
            <button class="ibtn send" id="waSend"><i class="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>
        <div class="chat-img-preview" id="preview" style="display:none;margin:0 4cqw"><img id="previewImg"><button id="previewX">✕</button></div>
      </div>`;

    const msgsEl=$('#waMsgs');
    requestAnimationFrame(()=>{msgsEl.scrollTop=msgsEl.scrollHeight;});

    $('#waBack').onclick=()=>{currentConv=null;drawList();};
    if($('#whisperToggle')){
      $('#whisperToggle').onclick=()=>{
        whisperMode=!whisperMode;
        if(!whisperMode) whisperTo='';
        drawConv();
      };
    }
    if($('#whisperBtn')){
      $('#whisperBtn').onclick = async ()=>{
        const opts = contacts
          .filter(c=>c.id!=='all'&&!c.isNPC)
          .map(c=>({ value:c.id, label:c.name }));
        const v = await openSelect({ title:'Sussurrar para', current:whisperTo, options:opts });
        if(v === null) return;
        whisperTo = v;
        $('#whisperLabel').textContent = (opts.find(o=>o.value===v)||{}).label || v;
      };
    }

    let pendingImage=null;
    const fileInp=$('#waFile');
    $('#waAttach').onclick=()=>fileInp.click();
    fileInp.onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, null, 900);
        if(data){
          pendingImage=data;
          $('#previewImg').src=data;
          $('#preview').style.display='flex';
        }
      }catch{}
      e.target.value='';
    };
    $('#previewX').onclick=()=>{pendingImage=null;$('#preview').style.display='none';};

    function send(){
      const text=$('#waText').value.trim();
      if(!text&&!pendingImage) return;
      if(whisperMode&&!whisperTo){alert('Escolha para quem sussurrar.');return;}

      const msg={
        id:uid(),from:p.id,fromName:p.name,
        to:isGroup?'all':currentConv,
        text,image:pendingImage,time:Date.now()
      };
      if(whisperMode&&whisperTo){
        msg.whisperTo=whisperTo;
      }
      // Se estou falando com um NPC, o 'to' é 'all' mas com marcação
      if(contact.isNPC){
        msg.to=p.id; // visível só pra mim na real
        msg.npcChatId=contact.id.replace('npc:','');
      }
      state.messages.push(msg);
      saveState();
      $('#waText').value='';pendingImage=null;$('#preview').style.display='none';
      drawConv();
      localStorage.setItem('msgSeen_'+p.id,String(Date.now()));
      Sound.message();
    }
    $('#waSend').onclick=send;
    $('#waText').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  }

  function editNPC(npc){
    const isNew=!npc;
    const n=npc||{id:uid(),name:'',avatar:'',desc:''};
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">${isNew?'Novo NPC':'Editar NPC'}</div>
        <label class="portrait-edit" id="npcPortrait" style="margin-top:4cqw">
          ${n.avatar?`<img src="${n.avatar}">`:'<i class="fa-solid fa-camera" style="font-size:1.6em"></i>'}
          <input type="file" accept="image/*" id="npcFile">
        </label>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Nome do NPC</label>
          <input id="npcName" maxlength="30" value="${esc(n.name)}" placeholder="Ex: Detetive Rocha"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Descrição (opcional)</label>
          <textarea id="npcDesc" rows="2">${esc(n.desc||'')}</textarea></div>
        <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
          <button class="btn" id="npcCancel" style="flex:1">Cancelar</button>
          <button class="btn-primary" id="npcSave" style="flex:1">Salvar</button>
          ${isNew?'':'<button class="btn danger" id="npcDel">Excluir</button>'}
        </div>
      </div>`;
    screen.appendChild(ov);
    let imgData=n.avatar;
    $('#npcFile',ov).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, 1, 400);
        if(data){
          imgData=data;
          $('#npcPortrait',ov).innerHTML=`<img src="${imgData}"><input type="file" accept="image/*" id="npcFile">`;
          const ni=$('#npcFile',ov);
          ni.addEventListener('change', async e2=>{
            const f2=e2.target.files[0];if(!f2) return;
            const d=await pickAndCrop(f2, 1, 400);
            if(d){ imgData=d; $('#npcPortrait',ov).querySelector('img').src=d; }
          });
        }
      }catch{}
      e.target.value='';
    };
    $('#npcCancel',ov).onclick=()=>ov.remove();
    $('#npcSave',ov).onclick=()=>{
      const name=$('#npcName',ov).value.trim();
      if(!name) return alert('Dê um nome ao NPC.');
      if(isNew){
        state.npcs.push({id:n.id,name,avatar:imgData,desc:$('#npcDesc',ov).value.trim(),createdBy:p.id,time:Date.now()});
      }else{
        npc.name=name;npc.avatar=imgData;npc.desc=$('#npcDesc',ov).value.trim();
      }
      saveState();ov.remove();showToast(isNew?'NPC criado.':'NPC salvo.');drawList();
    };
    if(!isNew){
      $('#npcDel',ov).onclick=()=>{
        if(!confirm('Excluir este NPC?')) return;
        state.npcs=state.npcs.filter(x=>x.id!==npc.id);
        saveState();ov.remove();drawList();
      };
    }
  }

  drawList();
};

/* ==================== MURAL ==================== */
APPS.mural=function(body){
  const p=activeProfile();
  function draw(){
    const sorted=[...state.mural].sort((a,b)=>b.time-a.time);
    body.innerHTML=`
      <div class="mural-toolbar"><button id="addPin"><i class="fa-solid fa-thumbtack"></i> Fixar pista</button></div>
      ${sorted.length===0?'<div class="empty">Mural vazio. Fixe pistas, fotos e suspeitos.</div>'
        :`<div class="mural-grid">
          ${sorted.map(item=>`<div class="mural-card" data-id="${item.id}">
            <div class="mc-pin"></div>
            ${item.image?`<img src="${item.image}">`:'<div style="aspect-ratio:1.2;display:grid;place-items:center;background:rgba(255,255,255,.03);font-size:2.5em;color:rgba(255,255,255,.15)"><i class="fa-solid fa-magnifying-glass"></i></div>'}
            <div class="mc-body">${item.text?`<div class="mc-text">${esc(item.text)}</div>`:''}
              <div class="mc-meta"><span class="mc-author">${esc(item.authorName)}</span><span>${new Date(item.time).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</span></div>
            </div></div>`).join('')}
        </div>`}`;
    $('#addPin',body).onclick=()=>editor(null);
    body.querySelectorAll('.mural-card').forEach(c=>c.onclick=()=>{
      const item=state.mural.find(m=>m.id===c.dataset.id);
      if(item) editor(item);
    });
  }
  function editor(item){
    const isNew=!item;
    const it=item||{id:uid(),text:'',image:'',author:p.id,authorName:p.name,time:Date.now()};
    body.innerHTML=`
      <div class="inv-editor">
        <label class="inv-img-pick" id="imgPick">${it.image?`<img src="${it.image}">`:'<i class="fa-solid fa-camera"></i> Adicionar foto'}<input type="file" accept="image/*" id="imgInput"></label>
        <div class="card" style="margin:0"><label>Anotação</label><textarea id="mText" rows="4" placeholder="Suspeito, pista...">${esc(it.text)}</textarea></div>
        <div class="row">
          <button class="btn" id="cancel">Voltar</button>
          <button class="btn-primary" id="save" style="flex:1">Salvar</button>
          ${isNew?'':'<button class="btn danger" id="del">Excluir</button>'}
        </div>
      </div>`;
    let newImage=it.image;
    const pick=$('#imgPick',body),inp=$('#imgInput',body);
    pick.onclick=()=>inp.click();
    inp.onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const cropped=await pickAndCrop(f, null, 900);
        if(cropped){
          newImage=cropped;
          pick.innerHTML=`<img src="${newImage}"><input type="file" accept="image/*" id="imgInput">`;
        }
      }catch{}
      e.target.value='';
    };
    $('#cancel',body).onclick=draw;
    $('#save',body).onclick=()=>{
      const txt=$('#mText',body).value.trim();
      if(!txt&&!newImage) return alert('Adicione texto ou imagem.');
      if(isNew) state.mural.push({...it,text:txt,image:newImage,time:Date.now()});
      else{it.text=txt;it.image=newImage;}
      saveState();draw();showToast('Pista fixada.');
    };
    if(!isNew){
      $('#del',body).onclick=()=>{
        if(!confirm('Remover esta pista?')) return;
        state.mural=state.mural.filter(m=>m.id!==it.id);
        saveState();draw();
      };
    }
  }
  draw();
};
/* ==================== RITUAIS (Ocultista) ==================== */
APPS.rituais=function(body){
  const p=activeProfile();
  if(!p.isAdmin && p.char.classe !== 'ocultista'){
    body.innerHTML='<div class="empty">Apenas Ocultistas podem acessar rituais.</div>';
    return;
  }
  const isOwn = true;
  const c = p.char;
  if(!Array.isArray(c.rituais)) c.rituais = [];

  function drawList(){
    const sorted = [...c.rituais].sort((a,b)=>(a.circle||1)-(b.circle||1));
    body.innerHTML=`
      <div class="ritual-header">
        <div class="ritual-header-info">
          <span class="ritual-header-label">Rituais conhecidos</span>
          <span class="ritual-header-count">${c.rituais.length}</span>
        </div>
        <div class="ritual-header-pe">
          <i class="fa-solid fa-bolt"></i> ${c.pe.current} / ${c.pe.max} PE
        </div>
      </div>
      <button class="add-ritual-btn" id="addRitual">
        <i class="fa-solid fa-plus"></i> Aprender novo ritual
      </button>
      ${sorted.length===0
        ? '<div class="empty" style="margin-top:4cqw">Nenhum ritual aprendido ainda.</div>'
        : sorted.map(r=>{
            const el = RITUAL_ELEMENTS[r.element] || RITUAL_ELEMENTS.conhecimento;
            const cir = RITUAL_CIRCLES[r.circle] || RITUAL_CIRCLE_PLACEHOLDER;
            const peCost = r.peCost || 0;
            const canCast = c.pe.current >= peCost;
            const sanCost = r.sanCost || '';
            return `
              <div class="ritual-card" data-r="${r.id}" style="--rc:${el.color}">
                <div class="ritual-top">
                  <div class="ritual-icon" style="background:${el.color}22;color:${el.color};border:1px solid ${el.color}66">
                    <i class="fa-solid ${el.icon}"></i>
                  </div>
                  <div class="ritual-title">
                    <div class="ritual-name">${esc(r.name)}</div>
                    <div class="ritual-meta">
                      <span class="ritual-circle">${cir.short}º</span>
                      <span class="ritual-element" style="color:${el.color}">${el.label}</span>
                    </div>
                  </div>
                </div>
                <div class="ritual-costs">
                  ${peCost>0?`<span class="ritual-cost pe"><i class="fa-solid fa-bolt"></i> ${peCost} PE</span>`:''}
                  ${sanCost?`<span class="ritual-cost san"><i class="fa-solid fa-brain"></i> ${esc(sanCost)} SAN</span>`:''}
                  ${r.range?`<span class="ritual-cost info"><i class="fa-solid fa-ruler"></i> ${esc(r.range)}</span>`:''}
                  ${r.duration?`<span class="ritual-cost info"><i class="fa-solid fa-hourglass-half"></i> ${esc(r.duration)}</span>`:''}
                </div>
                ${r.desc?`<div class="ritual-desc">${esc(r.desc)}</div>`:''}
                <div class="ritual-footer">
                  <button class="ritual-cast ${canCast?'':'no-pe'}" data-cast="${r.id}" ${!canCast?'disabled':''}>
                    <i class="fa-solid fa-wand-sparkles"></i>
                    ${canCast?'Conjurar':`Sem PE (${c.pe.current}/${peCost})`}
                  </button>
                  <button class="ritual-del" data-rdel="${r.id}" title="Esquecer"><i class="fa-solid fa-trash"></i></button>
                </div>
              </div>`;
          }).join('')}
    `;
    $('#addRitual',body).onclick=()=>openRitualEditor(null);
    body.querySelectorAll('[data-cast]').forEach(b=>b.onclick=()=>{
      const r = c.rituais.find(x=>x.id===b.dataset.cast);
      if(r) castRitual(r);
    });
    body.querySelectorAll('[data-rdel]').forEach(b=>b.onclick=(e)=>{
      e.stopPropagation();
      if(!confirm('Esquecer este ritual?')) return;
      c.rituais = c.rituais.filter(x=>x.id !== b.dataset.rdel);
      saveState(); drawList();
    });
    body.querySelectorAll('.ritual-card').forEach(card=>{
      card.addEventListener('click',(e)=>{
        if(e.target.closest('[data-cast]') || e.target.closest('[data-rdel]')) return;
        const r = c.rituais.find(x=>x.id===card.dataset.r);
        if(r) openRitualEditor(r);
      });
    });
  }

  function castRitual(r){
    const peCost = r.peCost || 0;
    if(peCost > 0 && c.pe.current < peCost){
      showToast('PE insuficiente.', true); Haptic.med(); return;
    }
    // Consome PE
    if(peCost > 0){
      c.pe.current = clamp(c.pe.current - peCost, 0, c.pe.max);
    }

    // Rola SAN se tiver custo
    let sanRoll = null;
    if(r.sanCost && /^\d+d\d+([+-]\d+)?$/i.test(String(r.sanCost).trim())){
      sanRoll = rollFormula(r.sanCost);
      if(sanRoll){
        c.san.current = clamp(c.san.current - sanRoll.total, 0, c.san.max);
      }
    }

    saveState();

    const el = RITUAL_ELEMENTS[r.element] || RITUAL_ELEMENTS.conhecimento;

    // Feedback visual
    flashScreen(r.element === 'sangue' ? 'red' : r.element === 'energia' ? 'yellow' : 'purple');
    if(peCost > 0) floatNumber('-'+peCost+' PE', '#f0c674');
    if(sanRoll) setTimeout(()=>floatNumber('-'+sanRoll.total+' SAN', '#bb8fce'), 200);

    // Som ritualístico
    try{
      Sound.tone(220,.25,'triangle',.09);
      setTimeout(()=>Sound.tone(330,.3,'sine',.08),150);
      setTimeout(()=>Sound.tone(440,.5,'sine',.07),320);
      if(r.element === 'sangue' || r.element === 'medo'){
        setTimeout(()=>Sound.tone(110,.6,'sawtooth',.06),500);
      }
    }catch{}
    Haptic.long();

    // Log
    state.messages.push({
      id:uid(), from:'system', fromName:'Log', to:'all',
      fromId:p.id, isSecret:p.isAdmin,
      text:`🔮 ${c.name||p.name} conjurou "${r.name}" (${el.label}${r.circle?' · '+r.circle+'º':''}${peCost?' · -'+peCost+' PE':''}${sanRoll?' · -'+sanRoll.total+' SAN':''})`,
      time:Date.now(), isLog:true
    });
    saveState();

    // Modal de resultado
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="ritual-result-card" style="--rc:${el.color}">
        <div class="ritual-result-icon" style="background:${el.color}22;color:${el.color};border:2px solid ${el.color}66">
          <i class="fa-solid ${el.icon}"></i>
        </div>
        <div class="ritual-result-title">${esc(r.name)}</div>
        <div class="ritual-result-elem" style="color:${el.color}">${el.label}${r.circle?' · '+RITUAL_CIRCLES[r.circle]?.label:''}</div>
        ${peCost>0?`<div class="ritual-result-line"><span><i class="fa-solid fa-bolt"></i> PE gasto:</span><b>${peCost}</b></div>`:''}
        ${sanRoll?`<div class="ritual-result-line san"><span><i class="fa-solid fa-brain"></i> SAN perdida:</span><b>${sanRoll.total}</b> <span style="opacity:.5;font-size:.85em">(${sanRoll.rolls.join('+')}${sanRoll.mod?('+'+sanRoll.mod):''})</span></div>`:''}
        ${r.damage?`<div class="ritual-result-line damage"><span><i class="fa-solid fa-burst"></i> Efeito:</span><b>${esc(r.damage)}</b></div>`:''}
        <button class="roll-close" id="rOk">Fechar</button>
      </div>`;
    screen.appendChild(ov);
    const close=()=>ov.remove();
    $('#rOk',ov).onclick=close;
    ov.addEventListener('click',(e)=>{if(e.target===ov) close();});

    // Redesenha lista
    setTimeout(()=>{
      if(_insanityInterval !== undefined) {}
      drawList();
    }, 300);
  }

  function openRitualEditor(ritual){
    const isNew = !ritual;
    const r = ritual || {id:uid(),name:'',circle:1,element:'conhecimento',peCost:0,sanCost:'',range:'',duration:'',desc:'',damage:''};
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">${isNew?'Novo Ritual':'Editar Ritual'}</div>

        <div style="margin-top:4cqw">
          <label class="ritual-label">Nome</label>
          <input id="rName" maxlength="40" value="${esc(r.name)}" placeholder="Ex: Eletrocussão">
        </div>

        <div style="margin-top:3cqw">
          <label class="ritual-label">Elemento</label>
          <div class="ritual-elem-picker" id="elemPicker">
            ${Object.entries(RITUAL_ELEMENTS).map(([k,v])=>`
              <button type="button" class="ritual-elem-opt ${r.element===k?'sel':''}" data-e="${k}"
                style="--ec:${v.color};${r.element===k?`background:${v.color}22;border-color:${v.color};color:${v.color}`:''}">
                <i class="fa-solid ${v.icon}"></i>
                <span>${v.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="row" style="gap:2.5cqw;margin-top:3cqw">
          <div style="flex:1;min-width:45%">
            <label class="ritual-label">Círculo</label>
            <button type="button" class="select-trigger" id="rCircleBtn">
              <span id="rCircleLabel">${RITUAL_CIRCLES[r.circle||1].label}</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
          </div>
          <div style="flex:1;min-width:45%">
            <label class="ritual-label">Custo PE</label>
            <input id="rPe" type="number" min="0" max="999" value="${r.peCost||0}">
          </div>
        </div>

        <div style="margin-top:3cqw">
          <label class="ritual-label">Custo SAN (fórmula, opcional)</label>
          <input id="rSan" maxlength="20" value="${esc(r.sanCost||'')}" placeholder="Ex: 1d6 / 2d4 / 3">
        </div>

        <div class="row" style="gap:2.5cqw;margin-top:3cqw">
          <div style="flex:1;min-width:45%">
            <label class="ritual-label">Alcance</label>
            <input id="rRange" maxlength="20" value="${esc(r.range||'')}" placeholder="Curto / Médio">
          </div>
          <div style="flex:1;min-width:45%">
            <label class="ritual-label">Duração</label>
            <input id="rDur" maxlength="20" value="${esc(r.duration||'')}" placeholder="Instantâneo / Cena">
          </div>
        </div>

        <div style="margin-top:3cqw">
          <label class="ritual-label">Efeito (fórmula, opcional)</label>
          <input id="rDmg" maxlength="30" value="${esc(r.damage||'')}" placeholder="Ex: 2d6 / 1d8+3">
        </div>

        <div style="margin-top:3cqw">
          <label class="ritual-label">Descrição</label>
          <textarea id="rDesc" rows="3">${esc(r.desc||'')}</textarea>
        </div>

        <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
          <button class="btn" id="rCancel" style="flex:1">Cancelar</button>
          <button class="btn-primary" id="rSave" style="flex:1">${isNew?'Aprender':'Salvar'}</button>
        </div>
      </div>`;
    screen.appendChild(ov);
    let chosenElement = r.element;

    ov.querySelectorAll('.ritual-elem-opt').forEach(b=>b.onclick=()=>{
      chosenElement = b.dataset.e;
      ov.querySelectorAll('.ritual-elem-opt').forEach(x=>{
        const el = RITUAL_ELEMENTS[x.dataset.e];
        const sel = x.dataset.e === chosenElement;
        x.classList.toggle('sel', sel);
        x.style.background = sel ? el.color + '22' : '';
        x.style.borderColor = sel ? el.color : '';
        x.style.color = sel ? el.color : '';
      });
    });

        // Círculo — dropdown custom
    let chosenCircle = r.circle || 1;
    $('#rCircleBtn',ov).onclick = async ()=>{
      const v = await openSelect({
        title: 'Círculo do Ritual',
        current: String(chosenCircle),
        options: [1,2,3,4].map(n=>({ value: String(n), label: RITUAL_CIRCLES[n].label }))
      });
      if(v === null) return;
      chosenCircle = parseInt(v) || 1;
      $('#rCircleLabel',ov).textContent = RITUAL_CIRCLES[chosenCircle].label;
    };

    $('#rCancel',ov).onclick=()=>ov.remove();
    $('#rSave',ov).onclick=()=>{
      const name = $('#rName',ov).value.trim();
      if(!name){ showToast('Dê um nome ao ritual.', true); return; }
      const data = {
        name,
        element: chosenElement,
        circle: chosenCircle,
        peCost: clamp(parseInt($('#rPe',ov).value) || 0, 0, 999),
        sanCost: $('#rSan',ov).value.trim(),
        range: $('#rRange',ov).value.trim(),
        duration: $('#rDur',ov).value.trim(),
        damage: $('#rDmg',ov).value.trim(),
        desc: $('#rDesc',ov).value.trim()
      };
      if(isNew){
        c.rituais.push({id:r.id, ...data});
      } else {
        Object.assign(r, data);
      }
      saveState();
      ov.remove();
      drawList();
      showToast(isNew?'Ritual aprendido.':'Ritual salvo.');
    };
    ov.addEventListener('click',(e)=>{if(e.target===ov) ov.remove();});
  }

  drawList();
};
/* ==================== DADOS ==================== */
APPS.dados=function(body){
  const dice=[4,6,8,10,12,20,100];
  const history=[];
  body.innerHTML=`
    <div class="dice-app">
      <div class="dice-result" id="diceResult">—</div>
      <div class="dice-btns">${dice.map(d=>`<button data-d="${d}">d${d}</button>`).join('')}</div>
      <div class="section-title" style="width:100%;margin-top:2cqw">Histórico</div>
      <div class="dice-history" id="diceHistory"></div>
    </div>`;
  const res=$('#diceResult',body),hist=$('#diceHistory',body);
  let rollInt=null;
  body.querySelectorAll('[data-d]').forEach(btn=>{
    btn.onclick=()=>{
      const d=parseInt(btn.dataset.d);
      res.classList.add('rolling');clearInterval(rollInt);
      let ticks=0;
      rollInt=setInterval(()=>{
        res.textContent=Math.floor(Math.random()*d)+1;ticks++;
        if(ticks>8){
          clearInterval(rollInt);
          const final=Math.floor(Math.random()*d)+1;
          res.textContent=final;res.classList.remove('rolling');
          if(d===20&&final===20){Sound.crit();Haptic.crit();}
          else if(final===1){Sound.fumble();Haptic.fumble();}
          else{Sound.roll();Haptic.roll();}
          history.unshift({d,v:final});if(history.length>8) history.pop();
          renderHistory();
        }
      },60);
    };
  });
  onCleanup(()=>clearInterval(rollInt));
  function renderHistory(){
    hist.innerHTML=history.map(h=>`<div class="h-row"><span>d${h.d}</span><span>${h.v}</span></div>`).join('')||'<div class="empty">Sem rolagens ainda.</div>';
  }
  renderHistory();
};

/* ==================== TARÔ ==================== */
APPS.taro=function(body){
  const p=activeProfile();
  const isMaster=p.isAdmin;
  if(!isMaster && !state.taro.enabled){
    body.innerHTML='<div class="empty">O Mestre ainda não liberou o tarô.</div>';
    return;
  }
  let cardIdx=-1;
  let reversed=false;
  let flipped=false;
  let history=state.taro.history.slice(0,8);

  function draw(){
    const card=cardIdx>=0?TAROT_DECK[cardIdx]:null;
    body.innerHTML=`
      <div class="taro-wrap">
        <div class="taro-hint">
          ${flipped?'':`
            Concentre-se em uma pergunta.<br>
            Quando estiver pronto, toque na carta para revelar.<br>
            <span style="color:#f0c674">✦ A carta revela — não decide ✦</span>
          `}
        </div>
        <div class="taro-deck">
          <div class="taro-card ${flipped?'flipped':''}" id="taroCard">
            <div class="taro-face taro-back"></div>
            <div class="taro-face taro-front ${reversed?'reversed-card':''}">
              ${card?`
                <div class="num">ARCANO ${['0','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI'][card.n]||card.n}</div>
                <div class="icon"><i class="fa-solid ${card.icon}"></i></div>
                <div class="name">${esc(card.name)}</div>
                <div class="div"></div>
                <div class="position-tag ${reversed?'rev':''}">${reversed?'↻ INVERTIDA':'◆ EM PÉ'}</div>
                <div class="meaning">${esc(reversed?card.rev:card.meaning)}</div>
              `:''}
            </div>
          </div>
        </div>
        <div class="taro-actions">
          ${!flipped?`
            <button class="taro-draw" id="taroDraw">Tirar carta</button>
          `:`
            <button class="taro-reset" id="taroReset">Nova tiragem</button>
          `}
        </div>
        <div class="section-title" style="width:100%;padding:0 5cqw;margin-top:2cqw">Últimas tiragens</div>
        <div class="taro-history" id="taroHist">
          ${history.length?history.map(h=>`
            <div class="taro-hrow">
              <span class="ic"><i class="fa-solid ${TAROT_DECK[h.cardIdx]?.icon||'fa-star'}"></i></span>
              <span class="nm">${esc(TAROT_DECK[h.cardIdx]?.name||'?')}${h.reversed?' ↻':''}</span>
              <span class="tm">${new Date(h.time).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</span>
            </div>`).join(''):'<div class="empty">Nenhuma tiragem ainda.</div>'}
        </div>
      </div>`;

    $('#taroDraw',body)?.addEventListener('click',()=>{
      if(cardIdx>=0) return;
      cardIdx=Math.floor(Math.random()*TAROT_DECK.length);
      reversed=Math.random()<0.35;
      flipped=true;
      Sound.tone(120,.4,'sine',.1);
      setTimeout(()=>Sound.tone(180,.5,'sine',.08),250);
      setTimeout(()=>Sound.tone(240,.7,'sine',.06),500);
      Haptic.long();
      state.taro.history.unshift({
        cardIdx, reversed, byId:p.id, byName:p.name, time:Date.now()
      });
      if(state.taro.history.length>100) state.taro.history=state.taro.history.slice(0,100);
      saveState();
      history=state.taro.history.slice(0,8);
      draw();
    });
    $('#taroReset',body)?.addEventListener('click',()=>{
      cardIdx=-1;reversed=false;flipped=false;
      draw();
    });
    if(!flipped){
      $('#taroCard',body).onclick=()=>$('#taroDraw',body).click();
    }
  }
  draw();
};

/* ==================== PERFIS ==================== */
APPS.perfis=function(body){
  const p=activeProfile();
  if(!p.isAdmin){body.innerHTML='<div class="empty">Acesso restrito ao Mestre.</div>';return;}
  let tab='perfis';
  function draw(){
    body.innerHTML=`
      <div class="cat-filter" style="margin-bottom:2.5cqw">
        <button data-tab="perfis" class="${tab==='perfis'?'sel':''}"><i class="fa-solid fa-users"></i> Perfis</button>
        <button data-tab="npcs" class="${tab==='npcs'?'sel':''}"><i class="fa-solid fa-user-secret"></i> NPCs</button>
        <button data-tab="taro" class="${tab==='taro'?'sel':''}"><i class="fa-solid fa-moon"></i> Tarô</button>
        <button data-tab="sons" class="${tab==='sons'?'sel':''}"><i class="fa-solid fa-volume-high"></i> Sons</button>
      </div>
      <div id="tabContent"></div>`;
    body.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;draw();});
    if(tab==='perfis') drawProfiles();
    else if(tab==='npcs') drawNPCs();
    else if(tab==='taro') drawTaro();
    else drawSounds();
  }

  function drawProfiles(){
    $('#tabContent',body).innerHTML=`
      <div class="section-title">Perfis cadastrados</div>
      ${state.profiles.map(pr=>`
        <div class="profile-row">
          <div class="profile-avatar" style="--c:${pr.color};${pr.portrait?`background-image:url('${pr.portrait}');background-size:cover;background-position:center`:''}">
            ${pr.portrait?'':esc(pr.name.slice(0,1).toUpperCase())}
          </div>
          <div class="profile-info">
            <div class="profile-name">${esc(pr.name)}</div>
            <div class="profile-tag ${pr.isAdmin?'admin':''}">${pr.isAdmin?'★ Mestre':'Agente'} · PIN ${pr.pin.length} · Limite ${pr.weightLimit||20}kg</div>
          </div>
          <div class="profile-actions">
            ${pr.id!==p.id?`<button class="primary" data-enter="${pr.id}">Entrar</button>`:''}
            <button data-edit="${pr.id}"><i class="fa-solid fa-pen"></i></button>
            ${state.profiles.length>1&&pr.id!==p.id?`<button class="danger" data-del="${pr.id}"><i class="fa-solid fa-trash"></i></button>`:''}
          </div>
        </div>`).join('')}
      <button class="btn-primary" id="newProfile" style="width:100%;margin-top:3cqw">+ Novo perfil</button>`;
    $('#tabContent',body).querySelectorAll('[data-enter]').forEach(b=>b.onclick=()=>{state.activeId=b.dataset.enter;saveState();applyWallpaper();renderHome();closeApp();});
    $('#tabContent',body).querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editProfile(profileById(b.dataset.edit)));
    $('#tabContent',body).querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
      if(!confirm('Excluir este perfil?')) return;
      state.profiles=state.profiles.filter(x=>x.id!==b.dataset.del);
      saveState();draw();
    });
    $('#newProfile',body).onclick=()=>editProfile(null);
  }
  function drawNPCs(){
    $('#tabContent',body).innerHTML=`
      <div class="section-title">NPCs controlados</div>
      ${state.npcs.length?state.npcs.map(n=>`
        <div class="profile-row">
          <div class="profile-avatar" style="--c:#f0c674;${n.avatar?`background-image:url('${n.avatar}');background-size:cover;background-position:center`:''}">
            ${n.avatar?'':esc(n.name.slice(0,1).toUpperCase())}
          </div>
          <div class="profile-info">
            <div class="profile-name">${esc(n.name)}</div>
            <div class="profile-tag" style="color:#f0c674">★ NPC</div>
          </div>
          <div class="profile-actions">
            <button data-edit-npc="${n.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="danger" data-del-npc="${n.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`).join(''):'<div class="empty">Nenhum NPC criado ainda.</div>'}
      <button class="btn-primary" id="newNPC" style="width:100%;margin-top:3cqw">+ Novo NPC</button>`;
    $('#tabContent',body).querySelectorAll('[data-edit-npc]').forEach(b=>b.onclick=()=>editNPC(state.npcs.find(n=>n.id===b.dataset.editNpc)));
    $('#tabContent',body).querySelectorAll('[data-del-npc]').forEach(b=>b.onclick=()=>{
      if(!confirm('Excluir este NPC?')) return;
      state.npcs=state.npcs.filter(x=>x.id!==b.dataset.delNpc);
      saveState();draw();
    });
    $('#newNPC',body).onclick=()=>editNPC(null);
  }
  function drawTaro(){
    const enabled=state.taro.enabled;
    $('#tabContent',body).innerHTML=`
      <div class="section-title">Tarô</div>
      <div class="card">
        <label>Visibilidade para agentes</label>
        <div style="font-size:.85em;color:rgba(255,255,255,.7);line-height:1.5;margin-bottom:2.5cqw">
          ${enabled
            ? '✅ <b style="color:#2ecc71">Ativado</b> — Todos os agentes veem o app Tarô na tela inicial.'
            : '🔒 <b style="color:#e74c3c">Desativado</b> — Apenas você (Mestre) vê o app Tarô.'}
        </div>
        <button class="btn ${enabled?'danger':'primary'}" id="taroToggle" style="width:100%">
          ${enabled?'Desativar para agentes':'Ativar para todos os agentes'}
        </button>
      </div>
      <div class="card">
        <label>Histórico global de tiragens</label>
        ${state.taro.history.length?state.taro.history.slice(0,20).map(h=>`
          <div class="taro-hrow" style="margin-bottom:1.5cqw">
            <span class="ic"><i class="fa-solid ${TAROT_DECK[h.cardIdx]?.icon||'fa-star'}"></i></span>
            <span class="nm">${esc(h.byName)} — ${esc(TAROT_DECK[h.cardIdx]?.name||'?')}${h.reversed?' (invertida)':''}</span>
            <span class="tm">${new Date(h.time).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</span>
          </div>`).join(''):'<div class="empty">Nenhuma tiragem ainda.</div>'}
        ${state.taro.history.length?'<button class="btn danger" id="taroClear" style="width:100%;margin-top:2.5cqw">Limpar histórico</button>':''}
      </div>`;
    $('#taroToggle',body).onclick=()=>{
      state.taro.enabled=!state.taro.enabled;
      saveState();draw();renderHome();
      showToast(state.taro.enabled?'Tarô ativado.':'Tarô desativado.');
    };
    $('#taroClear',body)?.addEventListener('click',()=>{
      if(!confirm('Limpar histórico global de tiragens?')) return;
      state.taro.history=[];
      saveState();draw();
    });
  }
    function drawSounds(){
    const el=$('#tabContent',body);
    const cs=state.customSounds||{};
    el.innerHTML=`
      <div class="section-title">Sons do aplicativo</div>
      <div class="card" style="margin-bottom:2.5cqw">
        <div style="font-size:.8em;color:rgba(255,255,255,.65);line-height:1.5">
          Suba arquivos curtos (mp3, wav, ogg). Recomendado: <b>menos de 200KB por som</b>. Sons grandes pesam a sincronização entre os celulares.
        </div>
      </div>
      ${SOUND_LIST.map(s=>{
        const custom=cs[s.key];
        return `
          <div class="sound-row ${custom?'has-custom':''}">
            <div class="sound-icon"><i class="fa-solid ${s.icon}"></i></div>
            <div class="sound-info">
              <div class="sound-name">${esc(s.label)}</div>
              <div class="sound-status">${custom?'★ Customizado':'Padrão'}</div>
            </div>
            <div class="sound-actions">
              <button class="sound-btn play" data-play="${s.key}" title="Testar"><i class="fa-solid fa-play"></i></button>
              <button class="sound-btn upload" data-upload="${s.key}" title="${custom?'Trocar':'Subir som'}"><i class="fa-solid fa-upload"></i></button>
              ${custom?`<button class="sound-btn del" data-del="${s.key}" title="Remover"><i class="fa-solid fa-xmark"></i></button>`:''}
            </div>
          </div>`;
      }).join('')}
      <input type="file" accept="audio/*" id="soundUploadInput" style="display:none">
    `;

    let pendingKey=null;
    const fileInp=$('#soundUploadInput',body);
    el.querySelectorAll('[data-upload]').forEach(b=>{
      b.onclick=()=>{ pendingKey=b.dataset.upload; fileInp.click(); };
    });
    fileInp.onchange=async e=>{
      const f=e.target.files[0]; if(!f||!pendingKey) return;
      if(f.size>500*1024){
        if(!confirm('Arquivo grande ('+Math.round(f.size/1024)+'KB). Pode deixar a sincronização lenta. Continuar?')){ e.target.value=''; pendingKey=null; return; }
      }
      try{
        const data=await uploadFileDirect(f, 'sounds');
        if(!state.customSounds) state.customSounds={};
        state.customSounds[pendingKey]=data;
        saveState();
        showToast('Som salvo.');
        drawSounds();
      }catch{ alert('Erro ao carregar som.'); }
      e.target.value='';
      pendingKey=null;
    };
    el.querySelectorAll('[data-play]').forEach(b=>{
      b.onclick=()=>{
        const key=b.dataset.play;
        if(typeof Sound[key]==='function') Sound[key]();
      };
    });
    el.querySelectorAll('[data-del]').forEach(b=>{
      b.onclick=()=>{
        const key=b.dataset.del;
        const lbl=(SOUND_LIST.find(s=>s.key===key)||{label:key}).label;
        if(!confirm('Remover som customizado de "'+lbl+'"?')) return;
        if(state.customSounds) delete state.customSounds[key];
        saveState();
        showToast('Som removido. Voltou ao padrão.');
        drawSounds();
      };
    });
  }
  function editNPC(npc){
    const isNew=!npc;
    const n=npc||{id:uid(),name:'',avatar:'',desc:''};
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">${isNew?'Novo NPC':'Editar NPC'}</div>
        <label class="portrait-edit" id="npcPortrait" style="margin-top:4cqw">
          ${n.avatar?`<img src="${n.avatar}">`:'<i class="fa-solid fa-camera" style="font-size:1.6em"></i>'}
          <input type="file" accept="image/*" id="npcFile">
        </label>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Nome do NPC</label>
          <input id="npcName" maxlength="30" value="${esc(n.name)}"></div>
        <div style="margin-top:3cqw"><label style="display:block;font-size:.65em;letter-spacing:.15em;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:1.5cqw">Descrição</label>
          <textarea id="npcDesc" rows="2">${esc(n.desc||'')}</textarea></div>
        <div style="display:flex;gap:2.5cqw;margin-top:5cqw">
          <button class="btn" id="npcCancel" style="flex:1">Cancelar</button>
          <button class="btn-primary" id="npcSave" style="flex:1">Salvar</button>
        </div>
      </div>`;
    screen.appendChild(ov);
    let imgData=n.avatar;
    $('#npcFile',ov).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        imgData=await compressImage(f,400,0.75);
        $('#npcPortrait',ov).innerHTML=`<img src="${imgData}"><input type="file" accept="image/*" id="npcFile">`;
        const ni=$('#npcFile',ov);ni.addEventListener('change',e2=>{
          const f2=e2.target.files[0];if(!f2) return;
          compressImage(f2,400,0.75).then(d=>{imgData=d;$('#npcPortrait',ov).querySelector('img').src=d;});
        });
      }catch{}
    };
    $('#npcCancel',ov).onclick=()=>ov.remove();
    $('#npcSave',ov).onclick=()=>{
      const name=$('#npcName',ov).value.trim();
      if(!name) return alert('Dê um nome.');
      if(isNew) state.npcs.push({id:n.id,name,avatar:imgData,desc:$('#npcDesc',ov).value.trim(),createdBy:p.id,time:Date.now()});
      else{npc.name=name;npc.avatar=imgData;npc.desc=$('#npcDesc',ov).value.trim();}
      saveState();ov.remove();draw();showToast('NPC salvo.');
    };
  }
  function editProfile(pr){
    const isNew=!pr;
    const profile=pr||{id:uid(),name:'',pin:'',isAdmin:false,color:PROFILE_COLORS[Math.floor(Math.random()*PROFILE_COLORS.length)],
      portrait:'',wallpaper:WALLPAPERS[0],wallpaperImage:'',char:newChar(),inventory:[],notes:[],weightLimit:20};
    const ov=document.createElement('div');
    ov.className='roll-overlay';
    ov.innerHTML=`
      <div class="roll-card" style="text-align:left">
        <div class="roll-skill" style="text-align:center">${isNew?'Novo Perfil':'Editar Perfil'}</div>
        <label class="portrait-edit" id="prPortrait" style="margin-top:4cqw">
          ${profile.portrait?`<img src="${profile.portrait}">`:'<i class="fa-solid fa-camera" style="font-size:1.6em"></i> Retrato'}
          <input type="file" accept="image/*" id="prFile">
        </label>
        <div class="card" style="margin:3cqw 0 0 0"><label>Nome</label><input id="prName" maxlength="22" value="${esc(profile.name)}"></div>
        <div class="card" style="margin:2.5cqw 0 0 0"><label>PIN (4 dígitos)</label><input id="prPin" maxlength="4" inputmode="numeric" value="${esc(profile.pin)}"></div>
        <div class="card" style="margin:2.5cqw 0 0 0"><label>Tipo</label>
          <div class="row"><button class="btn ${!profile.isAdmin?'primary':''}" id="typeUser" style="flex:1">Agente</button>
          <button class="btn ${profile.isAdmin?'primary':''}" id="typeAdmin" style="flex:1">★ Mestre</button></div>
        </div>
        <div class="card" style="margin:2.5cqw 0 0 0"><label>Limite de peso (kg)</label><input id="prWeight" type="number" min="1" value="${profile.weightLimit||20}"></div>
        <div class="card" style="margin:2.5cqw 0 0 0"><label>Cor</label>
          <div class="swatches" id="colorSw">${PROFILE_COLORS.map(c=>`<button data-c="${c}" style="background:${c}" class="${c===profile.color?'sel':''}"></button>`).join('')}</div>
        </div>
        <div class="row" style="margin-top:4cqw"><button class="btn" id="cancel" style="flex:1">Cancelar</button><button class="btn-primary" id="save" style="flex:1">Salvar</button></div>
      </div>`;
    screen.appendChild(ov);
    let isAdmin=profile.isAdmin,color=profile.color,portrait=profile.portrait;
    const upd=()=>{
      $('#typeUser',ov).classList.toggle('primary',!isAdmin);
      $('#typeAdmin',ov).classList.toggle('primary',isAdmin);
      ov.querySelectorAll('#colorSw button').forEach(b=>b.classList.toggle('sel',b.dataset.c===color));
    };
    $('#typeUser',ov).onclick=()=>{isAdmin=false;upd();};
    $('#typeAdmin',ov).onclick=()=>{isAdmin=true;upd();};
    ov.querySelectorAll('#colorSw button').forEach(b=>b.onclick=()=>{color=b.dataset.c;upd();});
    upd();
    $('#prFile',ov).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const data=await pickAndCrop(f, 1, 400);
        if(data){
          portrait=data;
          $('#prPortrait',ov).innerHTML=`<img src="${portrait}"><input type="file" accept="image/*" id="prFile">`;
        }
      }catch{}
      e.target.value='';
    };
    $('#cancel',ov).onclick=()=>ov.remove();
    $('#save',ov).onclick=()=>{
      const name=$('#prName',ov).value.trim();
      const pin=$('#prPin',ov).value.trim();
      const weightLimit=parseInt($('#prWeight',ov).value)||20;
      if(!name) return alert('Dê um nome.');
      if(!/^\d{4}$/.test(pin)) return alert('PIN precisa ter 4 dígitos.');
      if(state.profiles.some(x=>x.pin===pin&&x.id!==profile.id)) return alert('PIN já existe.');
      profile.name=name;profile.pin=pin;profile.isAdmin=isAdmin;
      profile.color=color;profile.portrait=portrait;profile.weightLimit=weightLimit;
      if(isNew) state.profiles.push(profile);
      saveState();ov.remove();draw();showToast('Perfil salvo.');
    };
  }
  draw();
};

/* ==================== AJUSTES ==================== */
APPS.ajustes=function(body){
  const p=activeProfile();
  function draw(){
    body.innerHTML=`
      <div class="card"><label>Seu retrato</label>
        <label class="portrait-edit" id="selfPortrait">
          ${p.portrait?`<img src="${p.portrait}">`:'<i class="fa-solid fa-camera" style="font-size:1.6em"></i><span style="margin-top:1.5cqw">Toque para escolher</span>'}
          <input type="file" accept="image/*" id="selfFile">
        </label>
      </div>
      <div class="card"><label>Perfil atual</label>
        <div class="profile-row" style="margin:0">
          <div class="profile-avatar" style="--c:${p.color};${p.portrait?`background-image:url('${p.portrait}');background-size:cover;background-position:center`:''}">
            ${p.portrait?'':esc(p.name.slice(0,1).toUpperCase())}
          </div>
          <div class="profile-info"><div class="profile-name">${esc(p.name)}</div><div class="profile-tag ${p.isAdmin?'admin':''}">${p.isAdmin?'★ Mestre':'Agente'}</div></div>
        </div>
      </div>
      <div class="card"><label>Papel de parede</label>
        <div class="swatches" id="swatches">${WALLPAPERS.map((w,i)=>`<button data-i="${i}" class="${(!p.wallpaperImage&&p.wallpaper===w)?'sel':''}" style="background:${w}"></button>`).join('')}</div>
        <input id="setWallUrl" placeholder="URL de uma imagem" value="${esc(p.wallpaperImage)}">
      </div>
      <div class="card"><label>Volume dos sons</label>
        <div style="display:flex;align-items:center;gap:3cqw">
          <i class="fa-solid fa-volume-low" style="opacity:.5"></i>
          <input type="range" id="volSlider" min="0" max="100" style="flex:1">
          <i class="fa-solid fa-volume-high" style="color:#f0c674"></i>
          <span id="volPct" style="font-size:.85em;font-weight:800;min-width:11cqw;text-align:right;color:#f0c674"></span>
        </div>
        <button class="btn" id="testVolSound" style="width:100%;margin-top:3cqw">🔊 Testar som atual</button>
      </div>
      <div class="card"><label>Testes</label>
        <button class="btn" id="testSanLow" style="width:100%;margin-bottom:2cqw">Simular SAN baixa</button>
        <button class="btn" id="testSanCrit" style="width:100%;margin-bottom:2cqw">Simular SAN crítica</button>
        <button class="btn" id="testSound" style="width:100%">Testar sons</button>
      </div>
      ${p.isAdmin?`<div class="card"><label>Mestre</label>
        <button class="btn" id="restoreHp" style="width:100%;margin-bottom:2.5cqw">Restaurar tudo (próprio)</button>
      </div>`:''}
      <div class="card"><label>Sessão</label>
        <button class="btn" id="lockNow" style="width:100%"><i class="fa-solid fa-lock"></i> Bloquear celular</button>
      </div>
      ${p.isAdmin?`<div class="card"><label>Nuvem (Mestre)</label>
        <button class="btn danger" id="resetAll" style="width:100%">Apagar tudo (todos)</button>
      </div>`:''}`;

    $('#selfFile',body).onchange=async e=>{
      const f=e.target.files[0];if(!f) return;
      try{
        const cropped=await pickAndCrop(f, 1, 400);
        if(cropped){
          p.portrait=cropped;
          saveState();draw();showToast('Retrato atualizado.');
        }
      }catch{}
      e.target.value='';
    };
    body.querySelectorAll('#swatches button').forEach(b=>b.onclick=()=>{
      p.wallpaper=WALLPAPERS[+b.dataset.i];p.wallpaperImage='';
      saveState();applyWallpaper();draw();
    });
    $('#setWallUrl',body).addEventListener('change',e=>{
      p.wallpaperImage=e.target.value.trim();saveState();applyWallpaper();draw();
    });
    $('#testSanLow',body).onclick=()=>{p.char.san.current=Math.max(1,Math.floor(p.char.san.max*0.2));saveState();updateSanityEffects();showToast('SAN baixa.');};
    $('#testSanCrit',body).onclick=()=>{p.char.san.current=Math.max(1,Math.floor(p.char.san.max*0.08));saveState();updateSanityEffects();showToast('SAN crítica.');};
    $('#testSound',body).onclick=()=>{Sound.roll();setTimeout(()=>Sound.crit(),600);setTimeout(()=>Sound.fumble(),1400);setTimeout(()=>Sound.heal(),2200);};
    $('#restoreHp',body)?.addEventListener('click',()=>{
      p.char.hp.current=p.char.hp.max;p.char.san.current=p.char.san.max;p.char.pe.current=p.char.pe.max;
      saveState();updateSanityEffects();showToast('Tudo restaurado.');
    });
    $('#lockNow',body).onclick=lockPhone;
    $('#resetAll',body)?.addEventListener('click',()=>{
      if(!confirm('Apagar TUDO em todos os dispositivos?')) return;
      state=buildDefaultState();
      localWriteTime=Date.now();
      if(cloudRef){  // ← adiciona essa guarda
        cloudRef.set({...state,_meta:{time:localWriteTime}});
      }
      try{localStorage.clear();}catch{}
      lockPhone();
    });
        // Slider de volume
    const volSlider=$('#volSlider',body);
    const volPct=$('#volPct',body);
    volSlider.value = Math.round(SFX_VOLUME*100);
    volPct.textContent = Math.round(SFX_VOLUME*100)+'%';
    volSlider.addEventListener('input', e=>{
      SFX_VOLUME = parseInt(e.target.value)/100;
      localStorage.setItem('crimsonRollVolume', String(SFX_VOLUME));
      volPct.textContent = Math.round(SFX_VOLUME*100)+'%';
    });
    $('#testVolSound',body).onclick=()=>{
      Sound.click();
      setTimeout(()=>Sound.roll(), 300);
      setTimeout(()=>Sound.message(), 800);
      setTimeout(()=>Sound.heal(), 1400);
    };
  }
  draw();
};
/* ============ CROP DE IMAGEM ============ */
function openCropModal(src, options = {}){
  return new Promise((resolve)=>{
    const aspectRatio = options.aspectRatio || null;   // null = livre
    const outputMaxW = options.outputSize || 900;
    const quality = options.quality || 0.75;

    const ov = document.createElement('div');
    ov.className = 'crop-overlay';
    ov.innerHTML = `
      <div class="crop-header">
        <button class="crop-btn cancel" id="cropCancel">Cancelar</button>
        <div class="crop-title">Ajustar imagem</div>
        <button class="crop-btn confirm" id="cropConfirm">Confirmar</button>
      </div>
      <div class="crop-stage" id="cropStage">
        <img class="crop-img" id="cropImg" src="${src}" draggable="false">
        <div class="crop-box" id="cropBox">
          <div class="crop-grid"></div>
          <div class="crop-corner tl" data-h="tl"></div>
          <div class="crop-corner tr" data-h="tr"></div>
          <div class="crop-corner bl" data-h="bl"></div>
          <div class="crop-corner br" data-h="br"></div>
        </div>
      </div>
      <div class="crop-hint">Arraste os cantos para ajustar</div>
    `;
    screen.appendChild(ov);

    const stage = ov.querySelector('#cropStage');
    const img = ov.querySelector('#cropImg');
    const box = ov.querySelector('#cropBox');

    let natW=0, natH=0, dispW=0, dispH=0, imgX=0, imgY=0;
    let cropX=0, cropY=0, cropW=0, cropH=0;
    let dragHandle=null, dragStart=null;

    function updateBox(){
      box.style.left = (imgX + cropX) + 'px';
      box.style.top = (imgY + cropY) + 'px';
      box.style.width = cropW + 'px';
      box.style.height = cropH + 'px';
    }

    function onReady(){
      natW = img.naturalWidth;
      natH = img.naturalHeight;

      const sRect = stage.getBoundingClientRect();
      const sW = sRect.width, sH = sRect.height;

      const scale = Math.min(sW / natW, sH / natH);
      dispW = natW * scale;
      dispH = natH * scale;
      imgX = (sW - dispW) / 2;
      imgY = (sH - dispH) / 2;

      img.style.width = dispW + 'px';
      img.style.height = dispH + 'px';
      img.style.left = imgX + 'px';
      img.style.top = imgY + 'px';

      if(aspectRatio){
        let w = dispW * 0.9;
        let h = w / aspectRatio;
        if(h > dispH * 0.9){
          h = dispH * 0.9;
          w = h * aspectRatio;
        }
        cropW = w; cropH = h;
      } else {
        cropW = dispW; cropH = dispH;
      }
      cropX = (dispW - cropW) / 2;
      cropY = (dispH - cropH) / 2;
      updateBox();
    }

    if(img.complete && img.naturalWidth) onReady();
    else img.onload = onReady;

    function onDown(e){
      const corner = e.target.closest('.crop-corner');
      const onBox = (e.target === box) || e.target.classList.contains('crop-grid');
      if(corner) dragHandle = corner.dataset.h;
      else if(onBox) dragHandle = 'move';
      else return;

      dragStart = { x:e.clientX, y:e.clientY, cx:cropX, cy:cropY, cw:cropW, ch:cropH };
      e.target.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onMove(e){
      if(!dragHandle) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const minSize = 40;

      if(dragHandle === 'move'){
        let nx = dragStart.cx + dx;
        let ny = dragStart.cy + dy;
        nx = Math.max(0, Math.min(dispW - cropW, nx));
        ny = Math.max(0, Math.min(dispH - cropH, ny));
        cropX = nx; cropY = ny;
        updateBox();
        e.preventDefault();
        return;
      }

      const right = dragHandle.includes('r');
      const bottom = dragHandle.includes('b');

      let nx = dragStart.cx, ny = dragStart.cy, nw = dragStart.cw, nh = dragStart.ch;

      if(right) nw = dragStart.cw + dx;
      else { nw = dragStart.cw - dx; nx = dragStart.cx + dx; }

      if(bottom) nh = dragStart.ch + dy;
      else { nh = dragStart.ch - dy; ny = dragStart.cy + dy; }

      if(nw < minSize){
        if(right) nw = minSize;
        else { nx = dragStart.cx + dragStart.cw - minSize; nw = minSize; }
      }
      if(nh < minSize){
        if(bottom) nh = minSize;
        else { ny = dragStart.cy + dragStart.ch - minSize; nh = minSize; }
      }

      if(aspectRatio){
        nh = nw / aspectRatio;
        if(!bottom) ny = dragStart.cy + dragStart.ch - nh;
      }

      if(nx < 0){ nw += nx; nx = 0; }
      if(ny < 0){ nh += ny; ny = 0; }
      if(nx + nw > dispW){ nw = dispW - nx; }
      if(ny + nh > dispH){ nh = dispH - ny; }

      if(aspectRatio){
        if(nw / aspectRatio > nh) nw = nh * aspectRatio;
        else nh = nw / aspectRatio;
        if(nx + nw > dispW){ nw = dispW - nx; nh = nw / aspectRatio; }
        if(ny + nh > dispH){ nh = dispH - ny; nw = nh * aspectRatio; }
      }

      cropX = nx; cropY = ny; cropW = nw; cropH = nh;
      updateBox();
      e.preventDefault();
    }

    function onUp(){ dragHandle = null; dragStart = null; }

    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);

    ov.querySelector('#cropCancel').onclick = ()=>{ ov.remove(); resolve(null); };
    ov.querySelector('#cropConfirm').onclick = ()=>{
      const s = natW / dispW;
      const srcX = Math.round(cropX * s);
      const srcY = Math.round(cropY * s);
      const srcW = Math.round(cropW * s);
      const srcH = Math.round(cropH * s);

      let outW = srcW, outH = srcH;
      if(outW > outputMaxW){
        outH = Math.round(outH * outputMaxW / outW);
        outW = outputMaxW;
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      ov.remove();
      resolve(dataUrl);
    };
  });
}

// Abre o seletor de arquivo, mostra a tela de crop e retorna a imagem recortada.
// Retorna null se o usuário cancelar.
/* ============ UPLOAD PARA CLOUDINARY ============ */
const CLOUDINARY_CLOUD = 'pwbqapcf';
const CLOUDINARY_PRESET = 'crimson_roll';

async function uploadDataURL(dataURL, prefix){
  if(!dataURL || typeof dataURL !== 'string') return dataURL;
  if(dataURL.startsWith('http')) return dataURL;
  if(!dataURL.startsWith('data:')) return dataURL;
  try{
    showToast('Enviando...');
    const parts = dataURL.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });

    const fd = new FormData();
    fd.append('file', blob);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    fd.append('folder', prefix || 'misc');

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`,
      { method:'POST', body: fd }
    );
    const json = await res.json();
    if(!json.secure_url) throw new Error('Upload falhou');
    return json.secure_url;
  }catch(err){
    console.error('Cloudinary:', err);
    showToast('Falha no upload — usando local.', true);
    return dataURL;
  }
}

async function uploadFileDirect(file, prefix){
  const data = await readFileAsDataURL(file);
  return await uploadDataURL(data, prefix);
}
async function pickAndCrop(file, aspectRatio, outputMaxW, storagePrefix){
  const raw = await readFileAsDataURL(file);
  const cropped = await openCropModal(raw, {
    aspectRatio,
    outputSize: outputMaxW || 900
  });
  if(!cropped) return null;
  return await uploadDataURL(cropped, storagePrefix || 'misc');
}
/* ==================== UTILS ==================== */
function compressImage(file,maxW=900,quality=0.75){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>maxW){h=h*maxW/w;w=maxW;}
        if(h>maxW*1.6){w=w*(maxW*1.6)/h;h=maxW*1.6;}
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      img.onerror=reject;
      img.src=e.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=e=>resolve(e.target.result);
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}
function showToast(msg,isError){
  const t=document.createElement('div');
  t.className='toast'+(isError?' error':'');
  t.textContent=msg;
  screen.appendChild(t);
  setTimeout(()=>{t.style.transition='opacity .4s';t.style.opacity='0';},1600);
  setTimeout(()=>t.remove(),2100);
}
/* ============ SELECT MODAL (substitui <select> nativo) ============ */
function openSelect({ title = 'Escolher', options = [], current = '', cancelLabel = 'Cancelar' }){
  return new Promise((resolve)=>{
    const ov = document.createElement('div');
    ov.className = 'roll-overlay';
    ov.innerHTML = `
      <div class="roll-card select-card">
        <div class="select-title">${esc(title)}</div>
        <div class="select-list">
          ${options.map(o=>{
            const isSel = String(o.value) === String(current);
            return `
              <button class="select-opt ${isSel?'sel':''}" data-v="${esc(String(o.value))}">
                <span class="select-opt-label">${esc(o.label)}</span>
                ${isSel ? '<i class="fa-solid fa-check"></i>' : ''}
              </button>`;
          }).join('')}
        </div>
        <button class="btn" id="selCancel" style="width:100%;margin-top:4cqw">${esc(cancelLabel)}</button>
      </div>`;
    screen.appendChild(ov);

    const close = (val)=>{ ov.remove(); resolve(val); };
    $('#selCancel', ov).onclick = ()=>close(null);
    ov.querySelectorAll('.select-opt').forEach(b=>b.onclick=()=>close(b.dataset.v));
    ov.addEventListener('click', e=>{ if(e.target===ov) close(null); });
  });
}
/* ============ PROMPT MODAL (substitui window.prompt) ============ */
function openPrompt(opts = {}){
  return new Promise((resolve)=>{
    const {
      title = '',
      message = '',
      defaultValue = '',
      placeholder = '',
      inputType = 'text',
      okLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      min, max,
      required = true
    } = opts;

    const ov = document.createElement('div');
    ov.className = 'roll-overlay';
    ov.innerHTML = `
      <div class="roll-card prompt-card">
        ${title ? `<div class="prompt-title">${esc(title)}</div>` : ''}
        ${message ? `<div class="prompt-msg">${esc(message)}</div>` : ''}
        <input
          class="prompt-input"
          id="promptInput"
          type="${inputType}"
          value="${esc(defaultValue)}"
          placeholder="${esc(placeholder)}"
          ${inputType==='number'&&min!==undefined?`min="${min}"`:''}
          ${inputType==='number'&&max!==undefined?`max="${max}"`:''}
          autocomplete="off"
          enterkeyhint="done"
        >
        <div class="prompt-actions">
          <button class="btn" id="promptCancel">${esc(cancelLabel)}</button>
          <button class="btn-primary" id="promptOk">${esc(okLabel)}</button>
        </div>
      </div>
    `;
    screen.appendChild(ov);

    const inp = $('#promptInput', ov);
    // Foca + seleciona (pra digitar por cima do valor padrão)
    setTimeout(()=>{ inp.focus(); inp.select(); }, 50);

    const cleanup = (val)=>{ ov.remove(); resolve(val); };
    const cancel  = ()=> cleanup(null);
    const confirm = ()=>{
      const v = inp.value.trim();
      if(required && !v){ inp.focus(); return; }
      cleanup(v);
    };

    // Enter confirma, Esc cancela (desktop)
    inp.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); confirm(); }
      if(e.key === 'Escape'){ e.preventDefault(); cancel(); }
    });

    $('#promptCancel', ov).onclick = cancel;
    $('#promptOk', ov).onclick = confirm;

    // Clicar fora cancela
    ov.addEventListener('click', (e)=>{
      if(e.target === ov) cancel();
    });
  });
}
/* ============ NOTIFICAÇÃO ============ */
let _lastMsgCount=0;
function showNotif(fromName,text){
  const b=$('#notifBanner');
  if(!b) return;
  $('#notifTitle').textContent='Nova mensagem de '+fromName;
  $('#notifText').textContent=text||'📎 Imagem';
  b.dataset.shownAt=Date.now();
  b.classList.add('show');
  clearTimeout(showNotif._t);
  showNotif._t=setTimeout(()=>b.classList.remove('show'),4000);
}
document.addEventListener('click', e=>{
  const b=$('#notifBanner');
  if(!b) return;
  if(e.target.closest('#notifClose')){
    e.stopPropagation();
    b.classList.remove('show');
    return;
  }
  if(e.target.closest('#notifBanner')){
    b.classList.remove('show');
    if(state.activeId) openApp('mensagens');
  }
});
// Fallback: força esconder se ficar preso por mais de 6s
setInterval(()=>{
  const b=$('#notifBanner');
  if(b && b.classList.contains('show')){
    const ts=parseInt(b.dataset.shownAt||'0');
    if(ts && Date.now()-ts>6000){
      b.classList.remove('show');
    }
  }
},2000);

function checkNewMessages(){
  if(!state.activeId) return;
  const p=activeProfile();
  const total=state.messages.filter(m=>!m.isLog).length;
  if(_lastMsgCount===0){_lastMsgCount=total;return;}
  if(total>_lastMsgCount){
    // nova mensagem chegou
    const sorted=[...state.messages].filter(m=>!m.isLog).sort((a,b)=>b.time-a.time);
    const last=sorted[0];
    if(last&&last.from!==p.id){
      const isVisibleToMe=
        (last.whisperTo&&(last.whisperTo===p.id||last.from===p.id)) ||
        (!last.whisperTo&&(last.to==='all'||last.to===p.id)) ||
        (last.fromNPC&&(last.to==='all'||last.to===p.id));
      if(isVisibleToMe){
        showNotif(last.fromName,last.image?'📎 Imagem':last.text);
        Sound.message();Haptic.med();
      }
    }
  }
  _lastMsgCount=total;
}
/* ============ TIRO COMPARTILHADO ============ */
let _lastShotTime=0;
let _shotWatchReady=false;

function checkRemoteShots(){
  if(!state.activeId) return;
  const p=activeProfile();
  const evts=state.soundEvents||[];
  if(!_shotWatchReady){
    _shotWatchReady=true;
    _lastShotTime=evts.length?Math.max(...evts.map(e=>e.time)):0;
    return;
  }
  if(!evts.length) return;
  const maxTime=Math.max(...evts.map(e=>e.time));
  // Só dispara tiros dos últimos 8 segundos (evita "fila" de tiros antigos)
  const freshThreshold = Date.now() - 8000;
  evts.filter(e => e.time > _lastShotTime && e.time > freshThreshold && e.byId !== p.id).forEach(e=>{
    try{
      if(e.sound){
        const a = new Audio(e.sound);
        a.volume = 0.7 * SFX_VOLUME;
        a.play().catch(()=>Sound.gunshot());
      } else {
        Sound.gunshot();
      }
    }catch{ Sound.gunshot(); }
  });
  if(maxTime>_lastShotTime) _lastShotTime=maxTime;
}
setInterval(checkRemoteShots,1500);
setInterval(checkNewMessages,2000);

/* ==================== INIT ==================== */
applyWallpaper(true);
renderLockHint();
updatePinDots();
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, FieldPath } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------- helpers ----------
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/-/g,'').slice(0,16);
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const pd=s=>{const[y,m,d]=String(s).split('-').map(Number);return new Date(y,(m||1)-1,d||1)};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return iso(d)};
const diff=(a,b)=>Math.round((pd(b)-pd(a))/864e5);
const today=()=>iso(new Date());
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'');
const fmtD=(s,o={weekday:'short',month:'short',day:'numeric'})=>validDate(s)?pd(s).toLocaleDateString(undefined,o):'';
const fmtT=t=>{if(!t)return'Any time';const[h,m]=t.split(':').map(Number);return`${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
const money=(n,c=0)=>(Number(n)||0).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:c,maximumFractionDigits:c});
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;

// ---------- trip vocabulary ----------
const PARKS={
  wdw:[['mk','Magic Kingdom'],['ep','EPCOT'],['hs','Hollywood Studios'],['ak','Animal Kingdom'],['ds','Disney Springs'],['wp','Water park'],['rest','Rest / pool day'],['travel','Travel day']],
  dl:[['dlp','Disneyland Park'],['dca','California Adventure'],['dtd','Downtown Disney'],['rest','Rest / pool day'],['travel','Travel day']]
};
const PCOLOR={mk:'mk',ep:'ep',hs:'hs',ak:'ak',ds:'ds',wp:'wp',rest:'rest',travel:'travel',dlp:'mk',dca:'ep',dtd:'ds'};
const RESORTS={wdw:'Walt Disney World',dl:'Disneyland Resort'};
const parkName=c=>{for(const r of Object.values(PARKS))for(const[k,n]of r)if(k===c)return n;return''};
const parkChip=c=>c&&parkName(c)?`<span class="chip park" style="--pc:var(--p-${PCOLOR[c]||'rest'})">${esc(parkName(c))}</span>`:'';
const parkOpts=(sel,blank='No park yet')=>`<option value="">${blank}</option>`+PARKS[resort()].map(([k,n])=>`<option value="${k}"${k===sel?' selected':''}>${esc(n)}</option>`).join('');
const KINDS=['Ride','Lightning Lane','Dining','Show','Character meet','Break','Travel','Other'];
const CATS=['Tickets','Hotel','Flights','Food','Lightning Lane','Souvenirs','Transport','Other'];
const MCOL=['var(--p-mk)','var(--p-ds)','var(--p-ak)','var(--p-ep)','var(--p-hs)','var(--spark)','var(--p-wp)'];
// Popular attractions with posted minimum heights in inches (0 = any height). Heights change; confirm in the park app.
const SUGGEST={
  wdw:[['Seven Dwarfs Mine Train','mk',38],['Space Mountain','mk',44],['TRON Lightcycle / Run','mk',48],['Big Thunder Mountain Railroad','mk',40],["Tiana's Bayou Adventure",'mk',40],["Peter Pan's Flight",'mk',0],['Haunted Mansion','mk',0],['Pirates of the Caribbean','mk',0],['Jungle Cruise','mk',0],['Happily Ever After fireworks','mk',0],
    ['Guardians of the Galaxy: Cosmic Rewind','ep',42],['Test Track','ep',40],['Frozen Ever After','ep',0],["Remy's Ratatouille Adventure",'ep',0],["Soarin' Around the World",'ep',40],
    ['Star Wars: Rise of the Resistance','hs',40],['Millennium Falcon: Smugglers Run','hs',38],['Slinky Dog Dash','hs',38],['The Twilight Zone Tower of Terror','hs',40],["Mickey & Minnie's Runaway Railway",'hs',0],['Toy Story Mania!','hs',0],
    ['Avatar Flight of Passage','ak',44],['Expedition Everest','ak',44],['Kilimanjaro Safaris','ak',0],["Na'vi River Journey",'ak',0],['Kali River Rapids','ak',38]],
  dl:[['Matterhorn Bobsleds','dlp',42],['Indiana Jones Adventure','dlp',46],['Space Mountain','dlp',40],['Star Wars: Rise of the Resistance','dlp',40],['Big Thunder Mountain Railroad','dlp',40],["Peter Pan's Flight",'dlp',0],['Haunted Mansion','dlp',0],
    ['Radiator Springs Racers','dca',40],['Guardians of the Galaxy – Mission: BREAKOUT!','dca',40],['Incredicoaster','dca',48],['Toy Story Midway Mania!','dca',0],["Soarin' Around the World",'dca',40]]
};

// ---------- state ----------
const COLLS=['plans','wishes','tasks','packing','budget'];
const S={trip:null,plans:[],wishes:[],tasks:[],packing:[],budget:[],mode:'loading',canWrite:true,stale:false};
const resort=()=>S.trip?.resort==='dl'?'dl':'wdw';
const party=()=>Array.isArray(S.trip?.party)?S.trip.party:[];
const member=id=>party().find(p=>p.id===id);
const mcol=id=>{const i=party().findIndex(p=>p.id===id);return MCOL[(i<0?0:i)%MCOL.length]};
const initial=n=>esc((n||'?').trim().charAt(0).toUpperCase()||'?');
const tripDays=()=>{const t=S.trip;if(!t||!validDate(t.start)||!validDate(t.end))return[];const n=Math.min(Math.max(diff(t.start,t.end),0),30);return Array.from({length:n+1},(_,i)=>addDays(t.start,i))};

// ---------- trip link ----------
// Each trip lives at trips/<key> in Firestore and has its own sign-in account, <key>@trips.example.com,
// whose password is the trip password. firestore.rules only lets that account read or write the trip,
// so the link alone shows nothing. The email address is never mailed to; it just names the account.
const KEY_RE=/^[a-z0-9]{24,64}$/;
const tripEmail=k=>`${k}@trips.example.com`;
const tripKey=()=>{const k=new URLSearchParams(location.search).get('t');return k&&KEY_RE.test(k)?k:null};
const shareUrl=()=>{const u=new URL(location.href);u.hash='';u.search='?t='+tripKey();return u.toString()};

// ---------- shared store (Firestore) ----------
let store=null;
function flatArgs(d){const out=[];const walk=(o,p)=>{for(const k in o){const v=o[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length)walk(v,[...p,k]);else out.push(new FieldPath(...p,k),v)}};walk(d,[]);return out}
function firestoreStore(db,key){
  const base=['trips',key], trip=doc(db,...base,'meta','info'), col=c=>collection(db,...base,c);
  const pend={};
  return{
    watch(){
      const waiting=new Set(['trip',...COLLS]);
      const settle=(k,snap)=>{pend[k]=snap.metadata.hasPendingWrites;S.saving=Object.values(pend).some(Boolean);if(!snap.metadata.fromCache)waiting.delete(k);if(!waiting.size){clearTimeout(timer);S.stale=false}if(S.mode==='loading'&&(!waiting.size||(S.cacheOk&&k==='trip'&&snap.exists())))S.mode='shared';render()};
      const timer=setTimeout(()=>{if(waiting.size){S.stale=true;if(S.mode==='loading')S.mode='shared';render()}},10000);
      const fail=e=>{clearTimeout(timer);S.stale=true;if(S.mode==='loading')S.mode='shared';render();console.warn(e)};
      onSnapshot(trip,{includeMetadataChanges:true},s=>{S.trip=s.exists()?s.data():null;settle('trip',s)},fail);
      COLLS.forEach(c=>onSnapshot(col(c),{includeMetadataChanges:true},q=>{S[c]=q.docs.map(d=>({...d.data(),id:d.id}));settle(c,q)},fail));
    },
    // Firestore resolves writes only once the server confirms; offline they would hang, so don't await them in the UI.
    setTrip:d=>quick(setDoc(trip,d)), updateTrip:d=>quick(updateDoc(trip,...flatArgs(d))), removeTrip:()=>quick(deleteDoc(trip)),
    add:(c,d)=>quick(addDoc(col(c),d)),
    update:(c,id,d)=>quick(updateDoc(doc(db,...base,c,id),...flatArgs(d))),
    remove:(c,id)=>quick(deleteDoc(doc(db,...base,c,id)))
  };
}
// Resolve right away (the write is already applied locally); report a failure if the server later refuses it.
function quick(p){p.catch(e=>{console.warn(e);toast(e?.code==='permission-denied'?'That change was refused. Check that the trip link is complete.':'That change didn’t save. It will retry when you’re back online.')});return Promise.resolve()}
async function act(p,ok){
  try{await p;if(ok)toast(ok)}
  catch(e){console.warn(e);toast('That change didn’t save. Try again.')}
}
let toastT;
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3200)}

// ---------- routing ----------
const TABS=[['overview','Overview'],['week','Whole trip'],['days','Day by day'],['mustdo','Must-dos'],['lists','To-dos & packing'],['budget','Budget']];
const currentTab=()=>{const h=location.hash.slice(1);return TABS.some(t=>t[0]===h)?h:'overview'};
window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0})});
let selDay=ls.get('trip-selday',null);
let openTodo=null;   // plan whose "add a to-do" form is open

// ---------- booking windows ----------
function windows(){
  const t=S.trip;if(!t||!validDate(t.start))return[];
  const end=validDate(t.end)?t.end:t.start, on=!!t.onsite, out=[];
  if(resort()==='wdw'){
    out.push(on
      ?{date:addDays(t.start,-60),title:'Dining reservations open for your whole stay',note:'Opens at 6:00 AM Eastern. Disney resort guests can book 60 days before check-in, for up to 10 days of the trip. Popular restaurants go in minutes.'}
      :{date:addDays(t.start,-60),title:'Dining reservations open for day 1',note:`Opens at 6:00 AM Eastern. Each day opens 60 days ahead. The last day opens ${fmtD(addDays(end,-60))}.`});
    out.push(on
      ?{date:addDays(t.start,-7),title:'Lightning Lane bookings open for your whole stay',note:'Opens at 7:00 AM Eastern. Resort guests can buy Lightning Lane Multi Pass 7 days before check-in, for up to 14 days of the stay.'}
      :{date:addDays(t.start,-3),title:'Lightning Lane bookings open for day 1',note:'Opens at 7:00 AM Eastern. Off-site guests can book 3 days before each park day.'});
  }else{
    out.push({date:addDays(t.start,-60),title:'Dining reservations open for day 1',note:`Opens at 6:00 AM Pacific. Each day opens 60 days ahead. The last day opens ${fmtD(addDays(end,-60))}.`});
    out.push({date:t.start,title:'Lightning Lane is bought on the day',note:'At Disneyland, buy Lightning Lane in the app the morning of each park day.'});
  }
  out.push({date:addDays(t.start,-1),title:'Check in online and link tickets',note:'Make sure every ticket and reservation is linked to the family in the Disney app.'});
  return out.sort((a,b)=>a.date<b.date?-1:1);
}
function winStatus(d){
  const n=diff(today(),d), over=S.trip?.end&&today()>S.trip.end;
  if(over)return'';
  if(n>7)return`<span class="chip">Opens in ${n} days</span>`;
  if(n>0)return`<span class="chip warn">Opens in ${plural(n,'day')}</span>`;
  if(n===0)return`<span class="chip warn">Opens today</span>`;
  return`<span class="chip good">Open now</span>`;
}
const calBox=d=>`<div class="cal"><div class="m">${esc(pd(d).toLocaleDateString(undefined,{month:'short'}))}</div><div class="d">${pd(d).getDate()}</div></div>`;

// ---------- header & tabs ----------
function renderHeader(){
  const t=['config','welcome','locked'].includes(S.mode)?null:S.trip;
  const pill=['config','welcome','locked'].includes(S.mode)?null
    :!navigator.onLine?['offline','Offline · your changes will sync when you’re back online']
    :S.saving?['offline','Saving…']
    :S.stale?['offline','Can’t reach the shared trip right now']
    :S.mode==='shared'?['shared','Synced · shared with everyone who has the link and password']:['','Connecting…'];
  let count='';
  if(t&&validDate(t.start)){
    const n=diff(today(),t.start), len=tripDays().length, k=diff(t.start,today())+1;
    if(n>0)count=`<div class="count"><b>${n}</b><span>${n===1?'day':'days'} to go</span></div>`;
    else if(k<=len)count=`<div class="count"><b>Day ${k}</b><span>of ${len}</span></div>`;
    else count=`<div class="count"><b>Done</b><span>Welcome home</span></div>`;
  }
  $('#head').innerHTML=`<div class="toprow"><div style="min-width:0">
      <div class="label">${t?esc(RESORTS[resort()]):'Family trip planner'}</div>
      <h1 class="trip-name">${t?esc(t.name||'Our Disney trip'):'Plan your Disney trip'}</h1>
      <div class="trip-sub">${t&&validDate(t.start)?`${esc(fmtD(t.start,{month:'long',day:'numeric'}))} – ${esc(fmtD(t.end||t.start,{month:'long',day:'numeric',year:'numeric'}))}${t.hotel?` · ${esc(t.hotel)}`:''}${party().length?` · ${plural(party().length,'traveler')}`:''}`:'Dates, rides, dining, packing and budget in one place for the whole family.'}</div>
      ${pill?`<div class="sync ${pill[0]}"><i></i>${pill[1]}</div>`:''}
    </div>${count}</div>`;
  const tab=currentTab();
  $('#tabs').innerHTML=S.trip?TABS.map(([k,n])=>`<a href="#${k}"${k===tab?' aria-current="page"':''}>${n}</a>`).join(''):'';
  $('nav.tabs').hidden=!S.trip||['config','welcome','locked'].includes(S.mode);
}

// ---------- views ----------
function setupView(){
  if(S.mode==='config')return`<div class="panel welcome"><h2>Finish connecting the database</h2>
    <p class="muted">This copy of the planner doesn’t have its Firebase settings yet, so it can’t save anything.</p>
    <ol class="steps"><li>Create a Firebase project and a Firestore database.</li><li>Paste the web app config into <code>firebase-config.js</code>.</li><li>Publish the rules from <code>firestore.rules</code>.</li></ol>
    <p class="fine">The README walks through each step.</p></div>`;
  if(S.mode==='welcome'){
    const last=ls.get('trip-last',null);
    return`<div class="panel welcome"><h2>Family trip planner</h2>
      <p class="muted">Open the trip link you were sent, then enter the trip password. You only need to do this once on each device.</p>
      ${last&&KEY_RE.test(last)?`<div><a class="btn" href="?t=${esc(last)}">Open my trip</a></div>`:''}
      <p class="fine">Don’t have the link or password? Ask the trip organizer.</p></div>`;
  }
  if(S.mode==='locked')return`<div class="panel welcome"><h2>Enter the trip password</h2>
    <p class="muted">This trip is password protected. Ask whoever sent you the link for the password. You only need to enter it once on this device.</p>
    <form class="form" data-form="unlock" style="grid-template-columns:minmax(0,1fr) auto">
      <input type="password" id="u-pw" autocomplete="current-password" aria-label="Trip password" placeholder="Trip password" required>
      <button class="btn" type="submit"${S.busy?' disabled':''}>${S.busy?'Checking…':'Open trip'}</button>
    </form>${S.authErr?`<div class="chip bad" role="alert" style="white-space:normal">${esc(S.authErr)}</div>`:''}</div>`;
  if(S.mode==='loading')return`<div class="panel setup"><p class="muted">Loading your trip…</p></div>`;
  if(S.stale)return`<div class="panel setup"><h2>Can’t reach the shared trip yet</h2><p class="muted">The plan will appear here as soon as the connection comes back.</p></div>`;
  return`<div class="panel setup">
    <div><h2>Start your trip</h2><p class="muted small">After this, share the trip link from the Overview tab. Everyone with it sees the same plan and can add to it.</p></div>
    <form class="form" data-form="setup">
      <label class="field wide"><span>Trip name</span><input type="text" id="s-name" placeholder="Spring break 2027" required></label>
      <label class="field"><span>Resort</span><select id="s-resort"><option value="wdw">Walt Disney World</option><option value="dl">Disneyland Resort</option></select></label>
      <label class="field"><span>Hotel</span><input type="text" id="s-hotel" placeholder="Where you’re staying"></label>
      <label class="field"><span>Arrive</span><input type="date" id="s-start" required></label>
      <label class="field"><span>Leave</span><input type="date" id="s-end" required></label>
      <label class="check wide"><input type="checkbox" id="s-onsite">Staying at a Disney-owned hotel (earlier booking windows)</label>
      <label class="field wide"><span>Who’s going (one per line, optional height in inches after a comma)</span><textarea id="s-party" rows="4" placeholder="Mom&#10;Dad&#10;Ava, 48&#10;Leo, 39"></textarea></label>
      <div class="wide" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit">Start planning</button><button class="btn ghost" type="button" data-act="example">Try an example trip first</button></div>
    </form></div>`;
}

function overviewView(){
  const t=S.trip, days=tripDays(), wins=windows();
  const openTasks=S.tasks.filter(x=>!x.done).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1).slice(0,4);
  return`${exampleBanner()}${filterBar()}<div class="grid">
    <section class="panel"><div class="panel-head"><h2>Booking windows</h2><span class="fine">Based on your dates</span></div>
      <div class="list">${wins.map(w=>`<div class="win">${calBox(w.date)}<div class="body" style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="title" style="font-weight:600">${esc(w.title)}</div><div class="small muted">${esc(fmtD(w.date,{weekday:'long',month:'long',day:'numeric'}))}. ${esc(w.note)}</div><div>${winStatus(w.date)}</div></div></div>`).join('')}</div>
      <p class="fine">Disney changes these rules from time to time. Confirm in the Disney app before the day.</p>
    </section>
    <section class="panel"><div class="panel-head"><h2>Who’s going</h2><span class="fine">Heights power the ride check</span></div>
      <div class="list" style="gap:8px">${party().map(p=>`<div class="party-row"><span class="av" style="background:${mcol(p.id)}">${initial(p.name)}</span>
        <input type="text" value="${esc(p.name)}" aria-label="Name" data-change="pname" data-id="${p.id}">
        <input type="number" min="0" max="90" value="${esc(p.height??'')}" placeholder="Height in" aria-label="Height in inches" data-change="pheight" data-id="${p.id}">
        <button class="x" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}" data-act="pdel" data-id="${p.id}">×</button></div>`).join('')||'<div class="empty">Add everyone who’s coming so you can mark who wants each ride.</div>'}</div>
      <form class="form" data-form="padd" style="grid-template-columns:minmax(0,1fr) 92px auto">
        <input type="text" id="p-name" data-keep placeholder="Name" aria-label="New traveler name" required>
        <input type="number" id="p-height" data-keep min="0" max="90" placeholder="Height in" aria-label="Height in inches">
        <button class="btn" type="submit">Add</button></form>
    </section>
    <section class="panel span2"><div class="panel-head"><h2>Trip at a glance</h2><a href="#week" class="small" style="color:var(--accent);font-weight:600">See the whole trip</a></div>
      ${days.length?`<div class="glance">${days.map((d,i)=>{const n=dayPlans(d).filter(shown).length,pk=t.dayParks?.[d];return`<button class="gday" data-act="goday" data-day="${d}"><span class="label">Day ${i+1} · ${esc(fmtD(d,{weekday:'short'}))}</span><b class="num">${esc(fmtD(d,{month:'short',day:'numeric'}))}</b>${pk?parkChip(pk):'<span class="chip">No park yet</span>'}${hotelNote(d)}<span class="small muted">${n?plural(n,'plan'):'Nothing planned'}</span></button>`}).join('')}</div>`:'<div class="empty">Add your travel dates under Trip details.</div>'}
    </section>
    <section class="panel"><div class="panel-head"><h2>Up next</h2><a href="#lists" class="small" style="color:var(--accent);font-weight:600">All to-dos</a></div>
      <div class="list">${openTasks.map(taskRow).join('')||'<div class="empty">No open to-dos. Add bookings and errands on the To-dos tab.</div>'}</div>
    </section>
    <section class="panel"><details${t.name?'':' open'}><summary>Trip details</summary>
      <form class="form" data-form="tripedit" style="margin-top:14px">
        <label class="field wide"><span>Trip name</span><input type="text" id="t-name" value="${esc(t.name)}"></label>
        <label class="field"><span>Resort</span><select id="t-resort"><option value="wdw"${resort()==='wdw'?' selected':''}>Walt Disney World</option><option value="dl"${resort()==='dl'?' selected':''}>Disneyland Resort</option></select></label>
        <label class="field"><span>Hotel</span><input type="text" id="t-hotel" value="${esc(t.hotel)}"></label>
        <label class="field"><span>Arrive</span><input type="date" id="t-start" value="${esc(t.start)}"></label>
        <label class="field"><span>Leave</span><input type="date" id="t-end" value="${esc(t.end)}"></label>
        <label class="check wide"><input type="checkbox" id="t-onsite"${t.onsite?' checked':''}>Staying at a Disney-owned hotel</label>
        <div class="wide"><button class="btn" type="submit">Save details</button></div>
      </form></details></section>
    <section class="panel span2"><div class="panel-head"><h2>Share this trip</h2><span class="fine">Link plus password</span></div>
      <p class="small muted" style="margin:0">Send the link to your family. Give them the password a different way, like saying it out loud, so the link alone is useless to anyone else. Only the trip organizer can change the password, in the Firebase console.</p>
      <div class="sharebox"><input type="text" id="share-url" readonly value="${esc(shareUrl())}" aria-label="Trip link"><button class="btn small" data-act="copylink">Copy link</button>${navigator.share?'<button class="btn ghost small" data-act="sharelink">Share…</button>':''}</div>
      <div><button class="btn ghost small" data-act="signout">Sign out of this trip on this device</button></div>
    </section>
  </div>`;
}

function exampleBanner(){
  return S.trip?.example?`<div class="banner"><span>You’re looking at an example trip. Clear it when you’re ready to plan your own.</span><button class="btn small" data-act="clearex">Clear example and start mine</button></div>`:'';
}

function whoChips(ids,act,itemId){
  return party().map(p=>`<button type="button" class="chip-btn" style="--mc:${mcol(p.id)}" aria-pressed="${ids.includes(p.id)}" data-act="${act}" data-id="${itemId}" data-who="${p.id}"><span class="av">${initial(p.name)}</span>${esc(p.name)}</button>`).join('');
}

// ---------- people on plans, the person filter, and hotels ----------
// Who's on a plan, always in the family list's order. Plans saved before "who" existed include everyone.
const planWho=p=>Array.isArray(p.who)?party().filter(m=>p.who.includes(m.id)).map(m=>m.id):party().map(m=>m.id);
let filt=ls.get('trip-filter',[]);
const activeFilt=()=>(Array.isArray(filt)?filt:[]).filter(id=>member(id));
const shown=p=>{const f=activeFilt();return !f.length||planWho(p).some(id=>f.includes(id))};
const dayPlans=d=>S.plans.filter(p=>p.date===d).sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:1);
const listJoin=(a,w='and')=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+` ${w} `+a[a.length-1];
const whoLabel=p=>{const w=planWho(p);return !w.length?'No one yet':w.length===party().length?'Everyone':listJoin(w.map(id=>member(id).name))};
function filterBar(){
  if(!party().length)return'';
  const f=activeFilt();
  return`<div class="filterbar" role="group" aria-label="Show plans for"><span class="label">Show plans for</span>
    <button type="button" class="chip-btn" aria-pressed="${!f.length}" data-act="filt" data-who="">Everyone</button>
    ${party().map(p=>`<button type="button" class="chip-btn" style="--mc:${mcol(p.id)}" aria-pressed="${f.includes(p.id)}" data-act="filt" data-who="${p.id}"><span class="av">${initial(p.name)}</span>${esc(p.name)}</button>`).join('')}
    ${f.length?`<span class="small muted">Only plans that include ${esc(listJoin(f.map(id=>member(id).name),'or'))}</span>`:''}</div>`;
}
const HOTEL_ICON='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 19V7M3 15h18v4M21 15v-2.5A2.5 2.5 0 0 0 18.5 10H11v5M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const hotelFor=d=>String(S.trip.dayHotels?.[d]||S.trip.hotel||'').trim();
function hotelNote(d){
  const t=S.trip, first=d===t.start, last=d===t.end&&!first;
  const h=last?hotelFor(addDays(d,-1)):hotelFor(d);if(!h)return'';
  const prev=first||last?'':hotelFor(addDays(d,-1));
  const txt=last?`Check out of ${h}`:first?`Check in at ${h}`:prev&&prev!==h?`Move to ${h}`:`Staying at ${h}`;
  return`<span class="hotel">${HOTEL_ICON}<span>${esc(txt)}</span></span>`;
}
function peopleEditor(p){
  if(!party().length)return'';
  const w=planWho(p), out=party().filter(m=>!w.includes(m.id));
  return`<div class="chips">${w.map(id=>{const m=member(id);return`<span class="person" style="--mc:${mcol(id)}"><span class="av">${initial(m.name)}</span>${esc(m.name)}<button type="button" class="px" aria-label="Remove ${esc(m.name)} from ${esc(p.title)}" title="Remove ${esc(m.name)}" data-act="unwho" data-id="${p.id}" data-who="${id}">×</button></span>`}).join('')||'<span class="small muted">No one yet</span>'}
    ${out.length?`<select class="addwho" aria-label="Add someone to ${esc(p.title)}" data-change="addwho" data-id="${p.id}"><option value="">+ Add person</option>${out.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>`:''}</div>`;
}
function planTodos(p){
  return S.tasks.filter(t=>t.planId===p.id).map(t=>{const m=member(t.owner),late=!t.done&&t.due&&t.due<today();
    return`<span class="chip todo ${t.done?'good':late?'bad':'warn'}">${t.done?'Done':'To-do'}: ${esc(t.text)}${m?' · '+esc(m.name):''}${t.due?' · due '+esc(fmtD(t.due,{month:'short',day:'numeric'})):''}</span>`}).join('');
}
function todoForm(p){
  return`<form class="form todo-form" data-form="plantodo" data-id="${p.id}">
    <label class="field wide"><span>To-do</span><input type="text" id="pt-text" data-keep value="${esc((p.kind==='Dining'?'Book ':'')+p.title)}" required></label>
    <label class="field"><span>Due date</span><input type="date" id="pt-due" data-keep required></label>
    <label class="field"><span>Owner</span><select id="pt-owner" data-keep required><option value="">Choose…</option>${party().map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    <div class="wide" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Create to-do</button><button class="btn ghost" type="button" data-act="todoclose">Cancel</button></div></form>`;
}
function planRow(p){
  const todos=planTodos(p);
  return`<div class="row"><div class="time">${esc(fmtT(p.time))}</div><div class="body">
    <div class="title">${esc(p.title)}</div>
    <div class="meta"><span class="chip">${esc(p.kind||'Other')}</span>${p.conf?`<span>Confirmation <b class="num" style="color:var(--ink)">${esc(p.conf)}</b></span>`:''}${p.notes?`<span>${esc(p.notes)}</span>`:''}</div>
    ${peopleEditor(p)}
    ${todos?`<div class="chips">${todos}</div>`:''}
    ${openTodo===p.id?todoForm(p):`<div><button class="btn ghost small" type="button" data-act="todoopen" data-id="${p.id}">Add a to-do for this</button></div>`}
  </div><button class="x" aria-label="Delete ${esc(p.title)}" title="Delete" data-act="del" data-coll="plans" data-id="${p.id}">×</button></div>`;
}

function weekView(){
  const days=tripDays();
  if(!days.length)return`<div class="panel"><p class="muted">Add your travel dates in Trip details on the Overview tab to see the whole trip.</p></div>`;
  return`${exampleBanner()}${filterBar()}<div class="week">${days.map((d,i)=>{
    const pk=S.trip.dayParks?.[d], all=dayPlans(d), ps=all.filter(shown);
    return`<section class="wday${d===today()?' today':''}">
      <button class="wday-head" data-act="goday" data-day="${d}" aria-label="Open ${esc(fmtD(d,{weekday:'long',month:'long',day:'numeric'}))}"><span class="label">Day ${i+1} · ${esc(fmtD(d,{weekday:'long'}))}</span><b>${esc(fmtD(d,{month:'long',day:'numeric'}))}</b></button>
      <div class="chips">${pk?parkChip(pk):'<span class="chip">No park yet</span>'}</div>
      ${hotelNote(d)}
      ${ps.length?`<ol class="wlist">${ps.map(p=>`<li><span class="wt">${esc(p.time?fmtT(p.time):'Any time')}</span><span><span class="wtitle">${esc(p.title)}</span><span class="wwho">${esc(whoLabel(p))}</span></span></li>`).join('')}</ol>`:`<div class="empty">${all.length?'Nothing for the people selected':'Nothing planned yet'}</div>`}
    </section>`}).join('')}</div>`;
}

function daysView(){
  const days=tripDays();
  if(!days.length)return`<div class="panel"><p class="muted">Add your travel dates in Trip details on the Overview tab to plan each day.</p></div>`;
  if(!days.includes(selDay))selDay=days.includes(today())?today():days[0];
  const d=selDay, pk=S.trip.dayParks?.[d]||'', all=dayPlans(d), plans=all.filter(shown), hidden=all.length-plans.length;
  const lastDay=d===S.trip.end&&d!==S.trip.start;
  return`${exampleBanner()}${filterBar()}<div class="strip" role="tablist" aria-label="Trip days">${days.map(x=>{const p=S.trip.dayParks?.[x];return`<button class="daybtn" aria-current="${x===d}" data-act="selday" data-day="${x}"><span class="dw">${esc(fmtD(x,{weekday:'short'}))}</span><span class="dn">${pd(x).getDate()}</span><span class="dot" style="${p?`background:var(--p-${PCOLOR[p]||'rest'})`:''}"></span></button>`}).join('')}</div>
  <div class="grid" style="margin-top:16px">
    <section class="panel span2"><div class="panel-head"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="label">Day ${days.indexOf(d)+1} of ${days.length}</div><h2>${esc(fmtD(d,{weekday:'long',month:'long',day:'numeric'}))}</h2>${hotelNote(d)}</div>
      <div class="dayfields"><label class="field"><span>Park</span><select data-change="daypark" data-day="${d}">${parkOpts(pk)}</select></label>
      ${lastDay?'':`<label class="field"><span>Hotel tonight</span><input type="text" id="dh-${d}" data-keep value="${esc(S.trip.dayHotels?.[d]||'')}" placeholder="${esc(S.trip.hotel||'Where you’re staying')}" data-change="dayhotel" data-day="${d}"></label>`}</div></div>
      <div class="list">${plans.map(planRow).join('')||`<div class="empty">${hidden?'Nothing for the people selected on this day.':'Nothing planned for this day yet. Add rides, meals and breaks below, or schedule a must-do.'}</div>`}</div>
      ${hidden&&plans.length?`<div class="fine">${plural(hidden,'plan')} hidden by the person filter.</div>`:''}
      <form class="form" data-form="plan">
        <label class="field"><span>Time</span><input type="time" id="pl-time" data-keep></label>
        <label class="field" style="grid-column:span 2"><span>What</span><input type="text" id="pl-title" data-keep list="sugg" placeholder="Lunch at Sanaa" required></label>
        <label class="field"><span>Type</span><select id="pl-kind" data-keep>${KINDS.map(k=>`<option>${k}</option>`).join('')}</select></label>
        <label class="field"><span>Confirmation #</span><input type="text" id="pl-conf" data-keep placeholder="Optional"></label>
        <label class="field" style="grid-column:span 2"><span>Notes</span><input type="text" id="pl-notes" data-keep placeholder="Mobile order, meeting spot, stroller parking…"></label>
        ${party().length?`<fieldset class="wide whopick"><legend>Who’s going</legend>${party().map(m=>`<label class="check"><input type="checkbox" id="pl-who-${m.id}" data-keep data-who-pick="${m.id}" checked>${esc(m.name)}</label>`).join('')}</fieldset>`:''}
        <div><button class="btn" type="submit">Add to day</button></div>
      </form>
      ${suggList()}
    </section></div>`;
}
const suggList=()=>`<datalist id="sugg">${SUGGEST[resort()].map(s=>`<option value="${esc(s[0])}"></option>`).join('')}</datalist>`;

function heightIssue(w){
  const h=Number(w.minHeight)||0;if(!h)return'';
  const short=party().filter(p=>Number(p.height)>0&&Number(p.height)<h);
  const unknown=party().filter(p=>!(Number(p.height)>0));
  if(short.length)return`<span class="chip bad">Too short: ${short.map(p=>`${esc(p.name)} (${esc(p.height)}″)`).join(', ')}</span>`;
  if(unknown.length&&party().length)return`<span class="chip warn">No height yet: ${unknown.map(p=>esc(p.name)).join(', ')}</span>`;
  return party().length?`<span class="chip good">Everyone can ride</span>`:'';
}
function mustdoView(){
  const days=tripDays();
  const list=[...S.wishes].sort((a,b)=>(b.votes?.length||0)-(a.votes?.length||0)||String(a.title).localeCompare(b.title));
  const scheduled=t=>S.plans.filter(p=>String(p.title).toLowerCase().includes(String(t).toLowerCase()));
  return`${exampleBanner()}<div class="grid"><section class="panel span2">
    <div class="panel-head"><div><h2>Must-dos</h2><p class="small muted" style="margin:2px 0 0">Everyone taps their name on what they want most. The list sorts by votes and checks heights.</p></div></div>
    <form class="form" data-form="wish">
      <label class="field" style="grid-column:span 2"><span>Ride, show or meal</span><input type="text" id="w-title" data-keep list="sugg" placeholder="Start typing a ride name" required></label>
      <label class="field"><span>Park</span><select id="w-park" data-keep>${parkOpts('','Any park')}</select></label>
      <label class="field"><span>Min height (in)</span><input type="number" id="w-h" data-keep min="0" max="60" placeholder="None"></label>
      <div><button class="btn" type="submit">Add must-do</button></div>
    </form>${suggList()}
    <div class="list">${list.map(w=>{const sch=scheduled(w.title);return`<div class="row"><div class="body">
        <div class="title">${esc(w.title)}</div>
        <div class="meta">${parkChip(w.park)}${Number(w.minHeight)?`<span class="chip num">${esc(w.minHeight)}″ minimum</span>`:''}${heightIssue(w)}${sch.length?`<span class="chip good">Planned ${esc(sch.map(p=>fmtD(p.date,{weekday:'short'})).join(', '))}</span>`:''}<span class="num">${plural(w.votes?.length||0,'vote')}</span></div>
        ${party().length?`<div class="chips">${whoChips(w.votes||[],'vote',w.id)}</div>`:''}
        ${days.length?`<div style="max-width:240px"><select aria-label="Schedule ${esc(w.title)} on a day" data-change="schedule" data-id="${w.id}"><option value="">Add to a day…</option>${days.map((d,i)=>`<option value="${d}">Day ${i+1} · ${esc(fmtD(d))}${S.trip.dayParks?.[d]?' · '+esc(parkName(S.trip.dayParks[d])):''}</option>`).join('')}</select></div>`:''}
      </div><button class="x" aria-label="Delete ${esc(w.title)}" title="Delete" data-act="del" data-coll="wishes" data-id="${w.id}">×</button></div>`}).join('')||'<div class="empty">No must-dos yet. Add the rides and characters each person cares about most.</div>'}</div>
  </section></div>`;
}

function taskRow(x){
  const m=member(x.owner), late=x.due&&!x.done&&x.due<today(), pl=x.planId&&S.plans.find(p=>p.id===x.planId);
  return`<div class="row${x.done?' done':''}"><label class="check" style="padding-top:2px"><input type="checkbox" ${x.done?'checked':''} data-change="toggle" data-coll="tasks" data-id="${x.id}" aria-label="Done: ${esc(x.text)}"></label>
    <div class="body"><div class="title">${esc(x.text)}</div><div class="meta">${x.due?`<span class="${late?'chip bad':'chip'}">${late?'Overdue · ':'Due '}${esc(fmtD(x.due))}</span>`:''}${m?`<span>${esc(m.name)}</span>`:''}${pl?`<span>For ${esc(pl.title)} · ${esc(fmtD(pl.date))}</span>`:''}</div></div>
    <button class="x" aria-label="Delete ${esc(x.text)}" title="Delete" data-act="del" data-coll="tasks" data-id="${x.id}">×</button></div>`;
}
const whoOpts=(blank)=>`<option value="">${blank}</option>`+party().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
function listsView(){
  const tasks=[...S.tasks].sort((a,b)=>(a.done-b.done)||((a.due||'9')<(b.due||'9')?-1:1));
  const groups=[{id:'',name:'Everyone'},...party()].map(g=>({...g,items:S.packing.filter(x=>(x.who||'')===g.id||(!g.id&&x.who&&!member(x.who)))})).filter(g=>g.items.length);
  const packed=S.packing.filter(x=>x.done).length;
  return`${exampleBanner()}<div class="grid">
    <section class="panel"><div class="panel-head"><h2>To-dos</h2><span class="progress num">${S.tasks.filter(x=>x.done).length} of ${S.tasks.length} done</span></div>
      <form class="form" data-form="task">
        <label class="field wide"><span>To-do</span><input type="text" id="t-text" data-keep placeholder="Book dining for Day 2" required></label>
        <label class="field"><span>Due</span><input type="date" id="t-due" data-keep></label>
        <label class="field"><span>Who</span><select id="t-owner" data-keep>${whoOpts('Anyone')}</select></label>
        <div><button class="btn" type="submit">Add</button></div></form>
      <div class="list">${tasks.map(taskRow).join('')||'<div class="empty">Track tickets, flights, dining, and anything else that needs booking.</div>'}</div>
      <div class="fine">Booking windows from your dates are on the Overview tab.</div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Packing</h2><span class="progress num">${packed} of ${S.packing.length} packed</span></div>
      <form class="form" data-form="pack">
        <label class="field wide"><span>Item</span><input type="text" id="k-text" data-keep placeholder="Ponchos, autograph book, chargers…" required></label>
        <label class="field"><span>For</span><select id="k-who" data-keep>${whoOpts('Everyone')}</select></label>
        <div><button class="btn" type="submit">Add</button></div></form>
      ${groups.map(g=>`<div style="display:flex;flex-direction:column;gap:8px"><div class="label">${esc(g.name)}</div><div class="list">${g.items.map(x=>`<div class="row${x.done?' done':''}"><label class="check"><input type="checkbox" ${x.done?'checked':''} data-change="toggle" data-coll="packing" data-id="${x.id}" aria-label="Packed: ${esc(x.text)}"></label><div class="body"><div class="title">${esc(x.text)}</div></div><button class="x" aria-label="Delete ${esc(x.text)}" title="Delete" data-act="del" data-coll="packing" data-id="${x.id}">×</button></div>`).join('')}</div></div>`).join('')||'<div class="empty">Nothing on the list yet. Add shared items for everyone, or give each person their own.</div>'}
    </section></div>`;
}

function budgetView(){
  const items=[...S.budget].sort((a,b)=>CATS.indexOf(a.category)-CATS.indexOf(b.category));
  const total=items.reduce((s,x)=>s+(Number(x.amount)||0),0), paid=items.filter(x=>x.paid).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const target=Number(S.trip.budget)||0;
  const byCat=CATS.map(c=>[c,items.filter(x=>x.category===c).reduce((s,x)=>s+(Number(x.amount)||0),0)]).filter(x=>x[1]>0);
  const max=Math.max(...byCat.map(x=>x[1]),1);
  const scale=Math.max(target,total,1);
  return`${exampleBanner()}<div class="grid">
    <section class="panel span2"><div class="panel-head"><h2>Budget</h2>
      <label class="field" style="width:180px"><span>Trip budget</span><input type="number" min="0" step="50" value="${target||''}" placeholder="Set a target" data-change="target"></label></div>
      <div class="totals"><div><span class="label">Planned</span><b>${money(total)}</b></div><div><span class="label">Paid</span><b style="color:var(--good)">${money(paid)}</b></div><div><span class="label">${target?'Left in budget':'Still to pay'}</span><b style="color:${target&&total>target?'var(--bad)':'var(--ink)'}">${money(target?target-total:total-paid)}</b></div></div>
      <div class="meter" role="img" aria-label="${money(paid)} paid of ${money(total)} planned${target?`, budget ${money(target)}`:''}"><i style="width:${paid/scale*100}%;background:var(--good)"></i><i style="width:${(total-paid)/scale*100}%;background:var(--accent)"></i></div>
      <div class="fine">Green is paid, blue is planned but unpaid${target?', and the full bar is your budget':''}.</div>
    </section>
    <section class="panel"><h2>By category</h2><div class="bars">${byCat.map(([c,v])=>`<div class="bar"><span>${esc(c)}</span><span class="track"><i style="width:${v/max*100}%"></i></span><span class="amt">${money(v)}</span></div>`).join('')||'<div class="empty">Add costs to see where the money goes.</div>'}</div></section>
    <section class="panel"><h2>Costs</h2>
      <form class="form" data-form="cost">
        <label class="field wide"><span>What</span><input type="text" id="c-label" data-keep placeholder="4-day park tickets" required></label>
        <label class="field"><span>Category</span><select id="c-cat" data-keep>${CATS.map(c=>`<option>${c}</option>`).join('')}</select></label>
        <label class="field"><span>Amount ($)</span><input type="number" id="c-amt" data-keep min="0" step="0.01" required></label>
        <label class="check"><input type="checkbox" id="c-paid" data-keep>Paid</label>
        <div><button class="btn" type="submit">Add</button></div></form>
      <div class="list">${items.map(x=>`<div class="row"><label class="check" style="padding-top:2px"><input type="checkbox" ${x.paid?'checked':''} data-change="paid" data-id="${x.id}" aria-label="Paid: ${esc(x.label)}"></label><div class="body"><div class="title">${esc(x.label)}</div><div class="meta"><span class="chip">${esc(x.category)}</span>${x.paid?'<span class="chip good">Paid</span>':''}</div></div><b class="num">${money(x.amount,Number(x.amount)%1?2:0)}</b><button class="x" aria-label="Delete ${esc(x.label)}" title="Delete" data-act="del" data-coll="budget" data-id="${x.id}">×</button></div>`).join('')||'<div class="empty">No costs yet.</div>'}</div>
    </section></div>`;
}

const VIEWS={overview:overviewView,week:weekView,days:daysView,mustdo:mustdoView,lists:listsView,budget:budgetView};

// ---------- render with form preservation ----------
function render(){
  const view=$('#view'), keep={}, ae=document.activeElement;
  view.querySelectorAll('[data-keep]').forEach(el=>keep[el.id]=el.type==='checkbox'?el.checked:el.value);
  const focusId=ae&&view.contains(ae)&&ae.id?ae.id:null, sel=focusId&&'selectionStart' in ae?[ae.selectionStart,ae.selectionEnd]:null;
  renderHeader();
  const gate=['config','welcome','locked'].includes(S.mode);
  view.innerHTML=S.trip&&!gate?VIEWS[currentTab()]():setupView();
  for(const id in keep){const el=document.getElementById(id);if(el)el.type==='checkbox'?el.checked=keep[id]:el.value=keep[id]}
  if(focusId){const el=document.getElementById(focusId);if(el){el.focus();try{sel&&el.setSelectionRange(...sel)}catch{}}}
  if(!S.canWrite)view.querySelectorAll('input,select,textarea,button:not([data-act="selday"]):not([data-act="goday"])').forEach(el=>el.disabled=true);
}

// ---------- actions ----------
const val=id=>(document.getElementById(id)?.value||'').trim();
function clear(...ids){ids.forEach(id=>{const el=document.getElementById(id);if(el)el.type==='checkbox'?el.checked=false:el.value=''})}

document.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();
  const k=f.dataset.form;
  if(k==='unlock'){const pw=$('#u-pw').value;if(pw)unlock(pw);return}
  if(k==='setup'){
    const start=val('s-start'),end=val('s-end')||start;
    if(!validDate(start)){toast('Pick your arrival date.');return}
    if(end<start){toast('The leave date is before the arrival date.');return}
    const ppl=val('s-party').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const[n,h]=l.split(',');return{id:uid(),name:n.trim().slice(0,40),height:Number(h)||null}});
    act(store.setTrip({name:val('s-name')||'Our Disney trip',resort:val('s-resort')||'wdw',hotel:val('s-hotel'),start,end,onsite:document.getElementById('s-onsite').checked,party:ppl,dayParks:{},budget:0}),'Trip created');
  }
  if(k==='tripedit'){
    const start=val('t-start'),end=val('t-end')||start;
    if(validDate(start)&&end<start){toast('The leave date is before the arrival date.');return}
    act(store.updateTrip({name:val('t-name')||'Our Disney trip',resort:val('t-resort'),hotel:val('t-hotel'),start,end,onsite:document.getElementById('t-onsite').checked}),'Trip details saved');
  }
  if(k==='padd'){
    const name=val('p-name');if(!name)return;const h=Number(val('p-height'))||null;clear('p-name','p-height');
    act(store.updateTrip({party:[...party(),{id:uid(),name:name.slice(0,40),height:h}]}));
  }
  if(k==='plan'){
    const title=val('pl-title');if(!title)return;
    const picks=[...f.querySelectorAll('[data-who-pick]')];
    const who=picks.length?picks.filter(c=>c.checked).map(c=>c.dataset.whoPick):[];
    if(picks.length&&!who.length){toast('Pick at least one person who’s going.');return}
    const d={date:selDay,time:val('pl-time'),title,kind:val('pl-kind')||'Other',conf:val('pl-conf'),notes:val('pl-notes'),who};
    clear('pl-time','pl-title','pl-conf','pl-notes');picks.forEach(c=>c.checked=true);act(store.add('plans',d));
  }
  if(k==='plantodo'){
    const text=val('pt-text'),due=val('pt-due'),owner=val('pt-owner');
    if(!text||!validDate(due)){toast('Pick a due date for the to-do.');return}
    if(!owner){toast('Choose who owns this to-do.');return}
    openTodo=null;clear('pt-text','pt-due','pt-owner');
    act(store.add('tasks',{text,due,owner,done:false,planId:f.dataset.id}),'To-do added');
    return;
  }
  if(k==='wish'){
    const title=val('w-title');if(!title)return;const d={title,park:val('w-park'),minHeight:Number(val('w-h'))||0,votes:[]};
    clear('w-title','w-h');document.getElementById('w-park').value='';act(store.add('wishes',d));
  }
  if(k==='task'){const text=val('t-text');if(!text)return;const d={text,due:val('t-due'),owner:val('t-owner'),done:false};clear('t-text','t-due');act(store.add('tasks',d))}
  if(k==='pack'){const text=val('k-text');if(!text)return;const d={text,who:val('k-who'),done:false};clear('k-text');act(store.add('packing',d))}
  if(k==='cost'){
    const label=val('c-label'),amount=Number(val('c-amt'));if(!label||!(amount>=0))return;
    const d={label,category:val('c-cat')||'Other',amount:Math.round(amount*100)/100,paid:document.getElementById('c-paid').checked};
    clear('c-label','c-amt','c-paid');act(store.add('budget',d));
  }
});

// fill park + height when a known attraction is picked
document.addEventListener('input',e=>{
  if(e.target.id!=='w-title')return;
  const s=SUGGEST[resort()].find(x=>x[0].toLowerCase()===e.target.value.trim().toLowerCase());
  if(s){document.getElementById('w-park').value=s[1];document.getElementById('w-h').value=s[2]||''}
});

const toggleIn=(arr,v)=>arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const {act:a,id,coll,who,day}=b.dataset;
  if(a==='selday'){selDay=day;ls.set('trip-selday',day);render()}
  if(a==='goday'){selDay=day;ls.set('trip-selday',day);location.hash='days'}
  if(a==='del'){const it=S[coll].find(x=>x.id===id);act(store.remove(coll,id),it?`Deleted “${it.title||it.text||it.label}”`:null)}
  if(a==='pdel'){act(store.updateTrip({party:party().filter(p=>p.id!==id)}))}
  if(a==='vote'){const w=S.wishes.find(x=>x.id===id);if(w)act(store.update('wishes',id,{votes:toggleIn(w.votes||[],who)}))}
  if(a==='filt'){filt=who?toggleIn(activeFilt(),who):[];ls.set('trip-filter',filt);render()}
  if(a==='unwho'){const p=S.plans.find(x=>x.id===id);if(p)act(store.update('plans',id,{who:planWho(p).filter(x=>x!==who)}))}
  if(a==='todoopen'){openTodo=id;render();document.getElementById('pt-due')?.focus()}
  if(a==='todoclose'){openTodo=null;render()}
  if(a==='planwho'){const p=S.plans.find(x=>x.id===id);if(p){const cur=Array.isArray(p.who)?p.who:party().map(m=>m.id);act(store.update('plans',id,{who:toggleIn(cur,who)}))}}
  if(a==='copylink'){const u=shareUrl();navigator.clipboard?.writeText(u).then(()=>toast('Link copied. Send the password separately.'),()=>{$('#share-url').select();toast('Press copy to copy the selected link.')})}
  if(a==='sharelink'){navigator.share?.({title:S.trip?.name||'Our Disney trip',text:'Our Disney trip plan. I’ll send you the password separately.',url:shareUrl()}).catch(()=>{})}
  if(a==='signout'){signOut(auth).then(()=>location.reload())}
  if(a==='example')loadExample();
  if(a==='clearex')clearExample();
});
document.addEventListener('change',e=>{
  const el=e.target.closest('[data-change]');if(!el)return;
  const {change:c,id,coll,day}=el.dataset;
  if(c==='toggle')act(store.update(coll,id,{done:el.checked}));
  if(c==='paid')act(store.update('budget',id,{paid:el.checked}));
  if(c==='daypark')act(store.updateTrip({dayParks:{[day]:el.value}}));
  if(c==='addwho'&&el.value){const p=S.plans.find(x=>x.id===id);if(p)act(store.update('plans',id,{who:[...planWho(p),el.value]}))}
  if(c==='dayhotel')act(store.updateTrip({dayHotels:{[day]:el.value.trim().slice(0,80)}}));
  if(c==='target')act(store.updateTrip({budget:Math.max(0,Number(el.value)||0)}));
  if(c==='pname'){const n=el.value.trim().slice(0,40);if(n)act(store.updateTrip({party:party().map(p=>p.id===id?{...p,name:n}:p)}))}
  if(c==='pheight')act(store.updateTrip({party:party().map(p=>p.id===id?{...p,height:Number(el.value)||null}:p)}));
  if(c==='schedule'&&el.value){
    const w=S.wishes.find(x=>x.id===id);if(!w)return;
    const d=el.value;act(store.add('plans',{date:d,time:'',title:w.title,kind:'Ride',conf:'',notes:'',who:(w.votes&&w.votes.length)?w.votes:party().map(p=>p.id)}),`Added to ${fmtD(d)}`);
  }
});

// ---------- example trip ----------
async function loadExample(){
  const start=addDays(today(),75), ids=['ex-mom','ex-dad','ex-ava','ex-leo'];
  const [m,d,a,l]=ids, D=i=>addDays(start,i), all=ids;
  await act(store.setTrip({example:true,name:'Example: Spring break',resort:'wdw',hotel:'Disney’s Art of Animation Resort',start,end:D(4),onsite:true,budget:6500,
    party:[{id:m,name:'Mom',height:65},{id:d,name:'Dad',height:71},{id:a,name:'Ava',height:50},{id:l,name:'Leo',height:39}],
    dayParks:{[D(0)]:'travel',[D(1)]:'mk',[D(2)]:'hs',[D(3)]:'rest',[D(4)]:'ep'}}));
  const ex={example:true}, adds=[
    ['plans',{date:D(0),time:'14:00',title:'Land at MCO, ride to hotel',kind:'Travel',conf:'',notes:'Pool after check-in',who:all}],
    ['plans',{date:D(1),time:'08:00',title:'Rope drop: Seven Dwarfs Mine Train',kind:'Ride',conf:'',notes:'Be at the gate by 7:30',who:all}],
    ['plans',{date:D(1),time:'11:30',title:'Lunch at Be Our Guest',kind:'Dining',conf:'384729',notes:'',who:all}],
    ['plans',{date:D(1),time:'14:00',title:'Hotel break and nap',kind:'Break',conf:'',notes:'',who:[m,l]}],
    ['plans',{date:D(1),time:'21:00',title:'Happily Ever After fireworks',kind:'Show',conf:'',notes:'Watch from the hub lawn',who:all}],
    ['plans',{date:D(2),time:'09:10',title:'Slinky Dog Dash',kind:'Lightning Lane',conf:'',notes:'',who:all}],
    ['wishes',{title:'Seven Dwarfs Mine Train',park:'mk',minHeight:38,votes:[a,l,d]}],
    ['wishes',{title:'Space Mountain',park:'mk',minHeight:44,votes:[a,d]}],
    ['wishes',{title:'Slinky Dog Dash',park:'hs',minHeight:38,votes:[a,l,m,d]}],
    ['wishes',{title:'Avatar Flight of Passage',park:'ak',minHeight:44,votes:[m]}],
    ['wishes',{title:"Peter Pan's Flight",park:'mk',minHeight:0,votes:[l,m]}],
    ['tasks',{text:'Buy 4-day park tickets',due:addDays(today(),10),owner:d,done:true}],
    ['tasks',{text:'Book flights',due:addDays(today(),14),owner:d,done:false}],
    ['tasks',{text:'Book Be Our Guest when dining opens',due:addDays(start,-60),owner:m,done:false}],
    ['tasks',{text:'Order matching shirts',due:addDays(start,-21),owner:m,done:false}],
    ['packing',{text:'Sunscreen',who:'',done:false}],['packing',{text:'Ponchos',who:'',done:true}],['packing',{text:'Portable chargers',who:'',done:false}],
    ['packing',{text:'Autograph book and pen',who:a,done:false}],['packing',{text:'Stroller fan',who:l,done:false}],
    ['budget',{label:'4-day park tickets',category:'Tickets',amount:2380,paid:true}],['budget',{label:'Hotel, 4 nights',category:'Hotel',amount:1460,paid:false}],
    ['budget',{label:'Flights for 4',category:'Flights',amount:1320,paid:false}],['budget',{label:'Food',category:'Food',amount:900,paid:false}],
    ['budget',{label:'Lightning Lane Multi Pass',category:'Lightning Lane',amount:440,paid:false}]
  ];
  for(const[c,dta]of adds)await act(store.add(c,{...dta,...ex}));
  selDay=D(1);ls.set('trip-selday',selDay);
}
async function clearExample(){
  for(const c of COLLS)for(const x of S[c].filter(x=>x.example))await act(store.remove(c,x.id));
  await act(store.removeTrip(),'Example cleared');
  location.hash='';
}

// ---------- sign-in & boot ----------
let app=null, auth=null, db=null;
function authMessage(e){
  const c=e?.code||'';
  if(c==='auth/too-many-requests')return'Too many wrong tries. Wait a few minutes, then try again.';
  if(c==='auth/network-request-failed')return'You’re offline. Connect to the internet to unlock the trip the first time.';
  if(c==='auth/operation-not-allowed')return'Password sign-in isn’t turned on for this Firebase project yet. See the README.';
  if(c==='auth/invalid-credential'||c==='auth/wrong-password'||c==='auth/user-not-found'||c==='auth/invalid-login-credentials')return'That password isn’t right for this trip.';
  return'Couldn’t open the trip. Check the link and try again.';
}
function openTrip(key){
  ls.set('trip-last',key);
  S.mode='loading';S.authErr='';S.busy=false;
  store=firestoreStore(db,key);
  store.watch();render();
}
async function unlock(pw){
  const key=tripKey();S.busy=true;S.authErr='';render();
  try{
    if(auth.currentUser)await signOut(auth);
    await signInWithEmailAndPassword(auth,tripEmail(key),pw);   // onAuthStateChanged opens the trip
  }catch(e){S.busy=false;S.authErr=authMessage(e);render();console.warn(e)}
}
function boot(){
  if(!firebaseConfig){S.mode='config';render();return}
  app=initializeApp(firebaseConfig);
  auth=getAuth(app);
  db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
  S.cacheOk=true;
  addEventListener('online',render);addEventListener('offline',render);
  onAuthStateChanged(auth,user=>{
    const key=tripKey();
    if(!key){S.mode='welcome';render();return}
    if(user&&user.email===tripEmail(key)){if(!store)openTrip(key);return}
    if(store)return location.reload();   // signed out while a trip was open
    S.mode='locked';render();
  });
}
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc, FieldPath } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION='2026.11.15-13';   // shown at the bottom of Home so you can tell which version a phone has

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
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;

// ---------- trip vocabulary ----------
const PARKS={
  wdw:[['mk','Magic Kingdom'],['ep','EPCOT'],['hs','Hollywood Studios'],['ak','Animal Kingdom'],['ds','Disney Springs'],['wp','Water park'],['rest','Rest / pool day'],['travel','Travel day']],
  dl:[['dlp','Disneyland Park'],['dca','California Adventure'],['dtd','Downtown Disney'],['rest','Rest / pool day'],['travel','Travel day']]
};
const PCOLOR={mk:'mk',ep:'ep',hs:'hs',ak:'ak',ds:'ds',wp:'wp',rest:'rest',travel:'travel',dlp:'mk',dca:'ep',dtd:'ds'};
const RESORTS={wdw:'Walt Disney World',dl:'Disneyland Resort'};
const parkName=c=>{for(const r of Object.values(PARKS))for(const[k,n]of r)if(k===c)return n;return''};
const parkOpts=(sel,blank='No park yet')=>`<option value="">${blank}</option>`+PARKS[resort()].map(([k,n])=>`<option value="${k}"${k===sel?' selected':''}>${esc(n)}</option>`).join('');
const KINDS=['Ride','Lightning Lane','Dining','Show','Character meet','Break','Travel','Other'];
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
const COLLS=['plans','wishes','tasks','packing'];
const S={trip:null,plans:[],wishes:[],tasks:[],packing:[],mode:'loading',stale:false};
const resort=()=>S.trip?.resort==='dl'?'dl':'wdw';
const party=()=>Array.isArray(S.trip?.party)?S.trip.party:[];
const member=id=>party().find(p=>p.id===id);
const mcol=id=>{const i=party().findIndex(p=>p.id===id);return MCOL[(i<0?0:i)%MCOL.length]};
const initial=n=>esc((n||'?').trim().charAt(0).toUpperCase()||'?');

// ---------- families ----------
// A trip has one or more families, each with its own people, hotel, dates and parks.
// Trips made before families existed get one family built from the old trip-wide fields.
function families(){
  const t=S.trip;if(!t)return[];
  // A family's dates count only once that family has entered them (datesSet). The first family keeps
  // the trip's original dates. This also ignores dates that were copied from another family earlier.
  if(Array.isArray(t.families)&&t.families.length)return t.families.map((f,i)=>i===0||f.datesSet?f:{...f,arrive:'',depart:''});
  // "Becker Family 2027" -> "Becker Family"
  const nm=String(t.name||'').replace(/\s*\b(19|20)\d\d\b\s*/g,' ').replace(/\s+(trip|vacation)$/i,'').trim();
  return[{id:'fam1',name:/family/i.test(nm)?nm:'Our family',hotel:t.hotel||'',arrive:t.start||'',depart:t.end||t.start||'',onsite:!!t.onsite}];
}
// One-time setup for this trip: save the families and pre-add the friends travelling with us.
// Fixed ids, so two phones doing this at the same moment write the same thing.
const SEED_FAMILIES=[{id:'fam2',name:'Logothetis Family'}];
let seeded=false;
function seedFamilies(){
  const t=S.trip;
  if(seeded||!t||(Array.isArray(t.families)&&t.families.length))return;
  seeded=true;
  const base=families(), first=base[0]||{};
  const add=SEED_FAMILIES.filter(x=>!base.some(f=>f.id===x.id)).map(x=>({id:x.id,name:x.name,hotel:'',arrive:'',depart:'',onsite:false}));
  store.updateTrip({families:[...base,...add]});
}
const fam=id=>families().find(f=>f.id===id);
const firstFam=()=>families()[0]?.id;
const famOf=m=>m&&m.family&&fam(m.family)?m.family:firstFam();
const famMembers=fid=>party().filter(m=>famOf(m)===fid);
const shortName=n=>String(n||'').replace(/\s+family$/i,'').trim()||n;
const famSaveList=(fid,patch)=>families().map(f=>f.id===fid?{...f,...patch}:f);

// Trip days run from the earliest arrival to the latest departure across families.
function tripRange(){
  const ds=families().flatMap(f=>[f.arrive,f.depart]).filter(validDate).sort();
  return ds.length?[ds[0],ds[ds.length-1]]:null;
}
const tripDays=()=>{const r=tripRange();if(!r)return[];const n=Math.min(diff(r[0],r[1]),30);return Array.from({length:n+1},(_,i)=>addDays(r[0],i))};

// ---------- scope: Group or one family, then that scope's people ----------
// Each device remembers its own scope, so the Logothetis phones can stay on their family.
let scope=ls.get('trip-scope','group');
let pick=ls.get('trip-pick',[]);                     // people picked in the filter; none picked = everyone
const curScope=()=>{const fs=families();if(fs.length===1)return fs[0].id;return scope==='group'||fam(scope)?scope:'group'};
const scopeFams=()=>{const s=curScope();return s==='group'?families():[fam(s)]};
const scopeMembers=()=>{const s=curScope();return s==='group'?party():famMembers(s)};
// The people whose itinerary is showing. A plan shows if any of them is on it, even with others.
const selected=()=>{const ms=scopeMembers().map(m=>m.id), p=(Array.isArray(pick)?pick:[]).filter(id=>ms.includes(id));return p.length?p:ms};
const filtering=()=>selected().length<scopeMembers().length;
const multiFam=()=>families().length>1;

// Who's on a plan, in the family list's order. Plans saved before "who" existed belong to the first family.
const planWho=p=>Array.isArray(p.who)?party().filter(m=>p.who.includes(m.id)).map(m=>m.id):famMembers(firstFam()).map(m=>m.id);
const planFams=p=>[...new Set(planWho(p).map(id=>famOf(member(id))))];
// A plan shows in a view only when someone in that view (and switched on) is on it.
// So a family's view includes plans shared with another family, and nothing else of theirs.
const vis=p=>planWho(p).some(id=>selected().includes(id));
// Flights live on each family (outbound and return) and show up as plans on their own.
const LEGS=[['outbound','Outbound flight'],['return','Return flight']];
function flightPlans(){
  return families().flatMap(f=>LEGS.map(([k,label])=>{
    const x=f[k];if(!x||!validDate(x.date))return null;
    const route=[x.from,x.to].filter(Boolean).join(' → ');
    return{id:`flight-${f.id}-${k}`,virtual:true,leg:k,legLabel:label,famId:f.id,date:x.date,time:x.dep||'',endTime:x.arr||'',
      title:`${x.flight?x.flight+' · ':''}${route||label}`,kind:'Travel',flight:x.flight||'',conf:x.conf||'',
      notes:x.arr?`Arrives ${fmtT(x.arr)}`:'',who:famMembers(f.id).map(m=>m.id)};
  }).filter(Boolean));
}
const allPlans=()=>S.plans.concat(flightPlans());
const dayPlans=d=>allPlans().filter(p=>p.date===d).sort((a,b)=>(a.time||'99')<(b.time||'99')?-1:1);
const listJoin=(a,w='and')=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+` ${w} `+a[a.length-1];
function whoLabel(p){
  const w=planWho(p);if(!w.length)return'No one yet';
  if(w.length===party().length&&multiFam())return'Everyone';
  const parts=[];
  for(const f of families()){
    const fm=famMembers(f.id).map(m=>m.id), inc=fm.filter(id=>w.includes(id));
    if(!inc.length)continue;
    if(inc.length===fm.length)parts.push(multiFam()?f.name:'Everyone');
    else parts.push(...inc.map(id=>member(id).name));
  }
  return listJoin(parts);
}

// Items on the to-do and packing lists belong to a family (older ones to the first family).
const itemFam=x=>x.family&&fam(x.family)?x.family:firstFam();
const inScope=x=>curScope()==='group'||itemFam(x)===curScope();
const newItemFam=personId=>personId&&member(personId)?famOf(member(personId)):(curScope()==='group'?firstFam():curScope());

// Parks and hotels are per family, per day.
const famPark=(fid,d)=>S.trip.famParks?.[fid]?.[d]||(fid===firstFam()?S.trip.dayParks?.[d]:'')||'';
const famHotel=(fid,d)=>String(S.trip.famHotels?.[fid]?.[d]||(fid===firstFam()?S.trip.dayHotels?.[d]:'')||fam(fid)?.hotel||'').trim();
// ---------- trip link ----------
// Each trip lives at trips/<key> in Firestore and has its own sign-in account, <key>@trips.example.com,
// whose password is the trip password. firestore.rules only lets that account read or write the trip,
// so the link alone shows nothing. The email address is never mailed to; it just names the account.
const KEY_RE=/^[a-z0-9]{24,64}$/;
const tripEmail=k=>`${k}@trips.example.com`;
// allsetaway.com with no ?t= opens our Disney trip, so the plain address plus the password is enough.
// That makes the trip password the only lock, so it should be a strong one.
const DEFAULT_TRIP='xsq8s36jfcz3nckg47wxnjbww5jy';
const tripKey=()=>{const k=new URLSearchParams(location.search).get('t');return k==null||k===''?DEFAULT_TRIP:KEY_RE.test(k)?k:null};
const shareUrl=()=>{const u=new URL(location.href);u.hash='';u.search=tripKey()===DEFAULT_TRIP?'':'?t='+tripKey();return u.toString()};

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
      onSnapshot(trip,{includeMetadataChanges:true},s=>{S.trip=s.exists()?s.data():null;settle('trip',s);if(!s.metadata.fromCache)seedFamilies()},fail);
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
const ICON=d=>`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TABS=[
  ['overview','Home','M3 11l9-7 9 7v8.5a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5z'],
  ['week','Trip','M4 5h16v15H4zM4 10h16M8 3v4M16 3v4'],
  ['days','Day','M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
  ['mustdo','Must-dos','M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
  ['lists','Lists','M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2']
];
const currentTab=()=>{const h=location.hash.slice(1);return TABS.some(t=>t[0]===h)?h:'overview'};
window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0})});
let selDay=ls.get('trip-selday',null);
let openTodo=null;   // plan whose "add a to-do" form is open
// ---------- small UI helpers ----------
// Live updates re-render the page, so remember which <details> boxes the person opened or closed.
const openBoxes=new Set(), closedBoxes=new Set();
const openAttr=(id,dflt)=>openBoxes.has(id)||(dflt&&!closedBoxes.has(id))?' open':'';
document.addEventListener('toggle',e=>{const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.id)return;if(d.open){openBoxes.add(d.id);closedBoxes.delete(d.id)}else{openBoxes.delete(d.id);closedBoxes.add(d.id)}},true);
// Deleting takes two taps (× then "Delete?") so a stray tap on a phone can't remove anything.
const delBtn=(a,id,coll,name)=>`<button class="x" type="button" aria-label="${a==='pdel'?'Remove':'Delete'} ${esc(name)}" title="${a==='pdel'?'Remove':'Delete'}" data-act="${a}" data-id="${id}"${coll?` data-coll="${coll}"`:''}>×</button>`;
let armed=null, armT=null;
function confirmTap(b,key){
  if(armed===key){armed=null;clearTimeout(armT);return true}
  document.querySelectorAll('.x.armed').forEach(x=>{x.classList.remove('armed');x.textContent=x.dataset.label||'×'});
  armed=key;b.classList.add('armed');b.textContent=b.dataset.act==='pdel'||b.dataset.act==='legdel'?'Remove?':'Delete?';
  if(!b.dataset.label)b.dataset.label=b.dataset.act==='legdel'?'Remove flight':'×';
  clearTimeout(armT);armT=setTimeout(()=>{armed=null;b.classList.remove('armed');b.textContent=b.dataset.label},3500);
  return false;
}

// ---------- booking windows (per family: they depend on arrival date and hotel) ----------
function windows(f){
  if(!f||!validDate(f.arrive))return[];
  const a=f.arrive, z=validDate(f.depart)?f.depart:a, on=!!f.onsite, out=[];
  if(resort()==='wdw'){
    out.push(on
      ?{date:addDays(a,-60),title:'Dining reservations open for the whole stay',note:'Opens at 6:00 AM Eastern. Disney resort guests can book 60 days before check-in, for up to 10 days of the trip. Popular restaurants go in minutes.'}
      :{date:addDays(a,-60),title:'Dining reservations open for day 1',note:`Opens at 6:00 AM Eastern. Each day opens 60 days ahead. The last day opens ${fmtD(addDays(z,-60))}.`});
    out.push(on
      ?{date:addDays(a,-7),title:'Lightning Lane bookings open for the whole stay',note:'Opens at 7:00 AM Eastern. Resort guests can buy Lightning Lane Multi Pass 7 days before check-in, for up to 14 days of the stay.'}
      :{date:addDays(a,-3),title:'Lightning Lane bookings open for day 1',note:'Opens at 7:00 AM Eastern. Off-site guests can book 3 days before each park day.'});
  }else{
    out.push({date:addDays(a,-60),title:'Dining reservations open for day 1',note:`Opens at 6:00 AM Pacific. Each day opens 60 days ahead. The last day opens ${fmtD(addDays(z,-60))}.`});
    out.push({date:a,title:'Lightning Lane is bought on the day',note:'At Disneyland, buy Lightning Lane in the app the morning of each park day.'});
  }
  out.push({date:addDays(a,-1),title:'Check in online and link tickets',note:'Make sure every ticket and reservation is linked to the family in the Disney app.'});
  return out.sort((x,y)=>x.date<y.date?-1:1);
}
function winStatus(d,f){
  const n=diff(today(),d);
  if(validDate(f?.depart)&&today()>f.depart)return'';
  if(n>7)return`<span class="chip">Opens in ${n} days</span>`;
  if(n>0)return`<span class="chip warn">Opens in ${plural(n,'day')}</span>`;
  if(n===0)return`<span class="chip warn">Opens today</span>`;
  return`<span class="chip good">Open now</span>`;
}
const calBox=d=>`<div class="cal"><div class="m">${esc(pd(d).toLocaleDateString(undefined,{month:'short'}))}</div><div class="d">${pd(d).getDate()}</div></div>`;

// ---------- header & tabs ----------
function renderHeader(){
  const gate=['config','welcome','locked'].includes(S.mode), t=gate?null:S.trip;
  const pill=gate?null
    :!navigator.onLine?['offline','Offline · changes will sync later']
    :S.saving?['offline','Saving…']
    :S.stale?['offline','Can’t reach the trip right now']
    :S.mode==='shared'?['shared','Synced']:['','Connecting…'];
  let count='', dates='';
  if(t){
    const s=curScope(), f=s==='group'?null:fam(s), r=tripRange();
    const a=f&&validDate(f.arrive)?f.arrive:r?.[0], z=f&&validDate(f.depart)?f.depart:r?.[1];
    if(a){
      const n=diff(today(),a), len=diff(a,z)+1, k=diff(a,today())+1;
      count=n>0?`<div class="count"><b>${n}</b><span>${n===1?'day':'days'}<br>to go</span></div>`
        :k<=len?`<div class="count"><b>Day ${k}</b><span>of ${len}</span></div>`
        :`<div class="count"><b>Done</b><span>Welcome<br>home</span></div>`;
      dates=`${fmtD(a,{month:'short',day:'numeric'})} – ${fmtD(z,{month:'short',day:'numeric',year:'numeric'})}`;
    }
  }
  $('#head').innerHTML=`${t?viewingBar():''}<div class="toprow"><div class="tt">
      <h1 class="trip-name">${t?esc(viewTitle()):'Family trip planner'}</h1>
      <div class="trip-sub">${t?esc(dates)+(pill?`${dates?' · ':''}<span class="sync ${pill[0]}"><i></i>${pill[1]}</span>`:''):'Rides, dining and packing for the whole family.'}</div>
    </div>${count}</div>`;
  const tab=currentTab();
  $('#tabs').innerHTML=S.trip?TABS.map(([k,n,ic])=>`<a href="#${k}"${k===tab?' aria-current="page"':''}>${ICON(ic)}<span>${n}</span></a>`).join(''):'';
  $('nav.tabs').hidden=!S.trip||gate;
}

// ---------- "Viewing" selector at the very top: Group / each family ----------
// Each view has its own palette, so it's obvious at a glance whose plans you're looking at.
const PALETTES={group:'mainstreet',fam1:'fireworks',fam2:'monorail'};
function applyPalette(){
  const gate=['config','welcome','locked','loading'].includes(S.mode)&&!S.trip;
  const pal=gate?'mainstreet':(PALETTES[curScope()]||'mainstreet');
  const root=document.documentElement;if(root.dataset.palette===pal)return;
  root.dataset.palette=pal;
  const bg=getComputedStyle(root).getPropertyValue('--bg').trim();
  if(bg)document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute('content',bg));
}
// The big title under the selector names what you're looking at.
const viewTitle=()=>{const s=curScope();return s==='group'?'Group':(fam(s)?.name||'Our family')};
function viewingBar(){
  const fs=families();if(fs.length<2)return'';
  const s=curScope();
  return`<div class="viewing"><span class="label">Viewing</span>
    <div class="scopebar" role="tablist" aria-label="Whose plans to show">${[['group','Group'],...fs.map(f=>[f.id,shortName(f.name)])].map(([k,n])=>`<button type="button" class="seg" role="tab" aria-selected="${s===k}" data-act="scope" data-who="${k}">${esc(n)}</button>`).join('')}</div></div>`;
}
// ---------- people in the current view (all on; tap to hide) ----------
function scopeBar(){
  const ms=scopeMembers();if(!ms.length)return'';
  const on=filtering(), sel=selected(), names=ms.filter(m=>sel.includes(m.id)).map(m=>m.name);
  return`<div class="filterbar" role="group" aria-label="Whose itinerary">
    <button type="button" class="chip-btn every" aria-pressed="${!on}" data-act="allon">Everyone</button>
    ${ms.map(m=>`<button type="button" class="chip-btn" style="--mc:${mcol(m.id)}" aria-pressed="${on&&sel.includes(m.id)}" data-act="person" data-who="${m.id}"><span class="av">${initial(m.name)}</span>${esc(m.name)}</button>`).join('')}
  </div>${on
    ?`<div class="filternote"><span><b>${esc(listJoin(names))}’s itinerary</b>, including plans with others.</span><button type="button" class="linkbtn" data-act="allon">Show everyone</button></div>`
    :`<div class="filternote small muted">Tap a name to see just that person’s itinerary.</div>`}`;
}

// ---------- parks and hotels shown for the families in scope ----------
const HOTEL_ICON='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 19V7M3 15h18v4M21 15v-2.5A2.5 2.5 0 0 0 18.5 10H11v5M7 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function hotelText(fid,d){
  const f=fam(fid);if(!f||!validDate(f.arrive))return'';
  if(d<f.arrive||validDate(f.depart)&&d>f.depart)return'';
  const first=d===f.arrive, last=d===f.depart&&!first;
  const h=last?famHotel(fid,addDays(d,-1)):famHotel(fid,d);if(!h)return'';
  const prev=first||last?'':famHotel(fid,addDays(d,-1));
  return last?`Check out of ${h}`:first?`Check in at ${h}`:prev&&prev!==h?`Move to ${h}`:`Staying at ${h}`;
}
function hotelNotes(d){
  const fs=scopeFams(), many=fs.length>1;
  return fs.map(f=>{const t=hotelText(f.id,d);return t?`<span class="hotel">${HOTEL_ICON}<span>${many?`<b>${esc(shortName(f.name))}:</b> `:''}${esc(t)}</span></span>`:''}).join('');
}
const parkChip=(c,prefix='')=>c&&parkName(c)?`<span class="chip park" style="--pc:var(--p-${PCOLOR[c]||'rest'})">${prefix?esc(prefix)+' · ':''}${esc(parkName(c))}</span>`:'';
function parkChips(d){
  const fs=scopeFams(), many=fs.length>1;
  const out=fs.map(f=>parkChip(famPark(f.id,d),many?shortName(f.name):'')).filter(Boolean).join('');
  return out||'<span class="chip">No park yet</span>';
}

// ---------- calendar export ----------
// Times are park-local, so events carry the resort's time zone. Re-adding an event updates it (same UID).
const TZ=()=>resort()==='dl'?'America/Los_Angeles':'America/New_York';
const DUR={Dining:90,Show:45,Travel:120,Break:120,'Character meet':30,'Lightning Lane':30,Ride:30,Other:60};
function evTimes(p){
  if(!p.time)return{allDay:true,start:p.date.replace(/-/g,''),end:addDays(p.date,1).replace(/-/g,'')};
  const[h,m]=p.time.split(':').map(Number);
  let endMin=h*60+m+(DUR[p.kind]||60);
  if(p.endTime){const[eh,em]=p.endTime.split(':').map(Number);endMin=eh*60+em;if(endMin<=h*60+m)endMin+=1440}
  const stamp=(d,mins)=>`${d.replace(/-/g,'')}T${String(Math.floor(mins/60)).padStart(2,'0')}${String(mins%60).padStart(2,'0')}00`;
  return{allDay:false,start:stamp(p.date,h*60+m),end:endMin>=1440?stamp(addDays(p.date,1),endMin-1440):stamp(p.date,endMin)};
}
const evDetails=p=>[p.notes,p.conf?`Confirmation: ${p.conf}`:'',`Who: ${whoLabel(p)}`,S.trip.name].filter(Boolean).join('\n');
const evPlace=p=>parkName(famPark(planFams(p)[0]||firstFam(),p.date));
const icsEsc=v=>String(v).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1');
function icsFor(plans){
  const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Family Disney Trip//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const p of plans){
    const t=evTimes(p), place=evPlace(p);
    L.push('BEGIN:VEVENT',`UID:${p.id}@family-trip`,`DTSTAMP:${now}`,
      t.allDay?`DTSTART;VALUE=DATE:${t.start}`:`DTSTART;TZID=${TZ()}:${t.start}`,
      t.allDay?`DTEND;VALUE=DATE:${t.end}`:`DTEND;TZID=${TZ()}:${t.end}`,
      `SUMMARY:${icsEsc(p.title)}`,`DESCRIPTION:${icsEsc(evDetails(p))}`,...(place?[`LOCATION:${icsEsc(place)}`]:[]),'END:VEVENT');
  }
  L.push('END:VCALENDAR');return L.join('\r\n');
}
function saveIcs(plans,name){
  if(!plans.length){toast('There are no plans to add.');return}
  const url=URL.createObjectURL(new Blob([icsFor(plans)],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${name.replace(/[^\w\- ]+/g,'').trim()||'trip'}.ics`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast(plans.length>1?`Calendar file with ${plans.length} plans is ready. Open it to add them.`:'Calendar file is ready. Open it to add the plan.');
}
function gcalUrl(p){
  const t=evTimes(p), q=new URLSearchParams({action:'TEMPLATE',text:p.title,dates:`${t.start}/${t.end}`,details:evDetails(p)});
  if(!t.allDay)q.set('ctz',TZ());
  const place=evPlace(p);if(place)q.set('location',place);
  return'https://calendar.google.com/calendar/render?'+q.toString();
}
const calMenu=p=>`<details class="calmenu" id="cal-${p.id}"${openAttr('cal-'+p.id,false)}><summary class="btn ghost small">Add to calendar</summary>
  <div class="calopts"><button type="button" class="btn ghost small" data-act="ics" data-id="${p.id}">iPhone / Apple Calendar</button><a class="btn ghost small" href="${esc(gcalUrl(p))}" target="_blank" rel="noopener">Google Calendar</a></div></details>`;

// ---------- plan rows ----------
function peopleEditor(p){
  if(!party().length)return'';
  const w=planWho(p), pool=curScope()==='group'?party():scopeMembers(), out=pool.filter(m=>!w.includes(m.id));
  return`<div class="chips">${w.map(id=>{const m=member(id);return`<span class="person" style="--mc:${mcol(id)}"><span class="av">${initial(m.name)}</span>${esc(m.name)}<button type="button" class="px" aria-label="Remove ${esc(m.name)} from ${esc(p.title)}" title="Remove ${esc(m.name)}" data-act="unwho" data-id="${p.id}" data-who="${id}">×</button></span>`}).join('')||'<span class="small muted">No one yet</span>'}
    ${out.length?`<select class="addwho" aria-label="Add someone to ${esc(p.title)}" data-change="addwho" data-id="${p.id}"><option value="">+ Add person</option>${out.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>`:''}</div>`;
}
function planTodos(p){
  return S.tasks.filter(t=>t.planId===p.id).map(t=>{const m=member(t.owner),late=!t.done&&t.due&&t.due<today();
    return`<span class="chip todo ${t.done?'good':late?'bad':'warn'}">${t.done?'Done':'To-do'}: ${esc(t.text)}${m?' · '+esc(m.name):''}${t.due?' · due '+esc(fmtD(t.due,{month:'short',day:'numeric'})):''}</span>`}).join('');
}
function todoForm(p){
  const owners=planWho(p).length?planWho(p).map(member):scopeMembers();
  return`<form class="form todo-form" data-form="plantodo" data-id="${p.id}">
    <label class="field wide"><span>To-do</span><input type="text" id="pt-text" data-keep value="${esc((p.kind==='Dining'?'Book ':'')+p.title)}" required></label>
    <label class="field"><span>Due date</span><input type="date" id="pt-due" data-keep required></label>
    <label class="field"><span>Owner</span><select id="pt-owner" data-keep required><option value="">Choose…</option>${owners.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    <div class="wide" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Create to-do</button><button class="btn ghost" type="button" data-act="todoclose">Cancel</button></div></form>`;
}
// On a plan that includes people from another family, say so.
const sharedChip=p=>{
  if(!multiFam())return'';
  const fs=planFams(p);if(fs.length<2)return'';
  const s=curScope(), others=fs.filter(f=>f!==s).map(f=>shortName(fam(f)?.name));
  return`<span class="chip fam">${s==='group'?'Both families':'With '+esc(listJoin(others))}</span>`;
};
function flightRow(p){
  return`<div class="row plan flightrow"><div class="time">${esc(fmtT(p.time))}</div><div class="body">
    <div class="title">${esc(p.title)}</div>
    <div class="meta"><span class="chip">${esc(p.legLabel)}</span>${p.endTime?`<span>Arrives ${esc(fmtT(p.endTime))}</span>`:''}${p.conf?`<span>Confirmation <b class="num" style="color:var(--ink)">${esc(p.conf)}</b></span>`:''}</div>
    ${p.flight?`<div>${trackLink(p.flight)}</div>`:''}
    <div class="small muted">${esc(whoLabel(p))} · <a href="#overview" class="link">Edit on Home</a></div>
    <div class="row-actions">${calMenu(p)}</div>
  </div></div>`;
}
const rowFor=p=>p.virtual?flightRow(p):planRow(p);
function planRow(p){
  const todos=planTodos(p);
  return`<div class="row plan"><div class="time">${esc(fmtT(p.time))}</div><div class="body">
    <div class="title">${esc(p.title)}</div>
    <div class="meta"><span class="chip">${esc(p.kind||'Other')}</span>${sharedChip(p)}${p.flight?trackLink(p.flight):''}${p.conf?`<span>Confirmation <b class="num" style="color:var(--ink)">${esc(p.conf)}</b></span>`:''}${p.notes?`<span>${esc(p.notes)}</span>`:''}</div>
    ${peopleEditor(p)}
    ${todos?`<div class="chips">${todos}</div>`:''}
    ${openTodo===p.id?todoForm(p):`<div class="row-actions"><button class="btn ghost small" type="button" data-act="todoopen" data-id="${p.id}">Add to-do</button>${calMenu(p)}</div>`}
  </div>${delBtn('del',p.id,'plans',p.title)}</div>`;
}
const visiblePlans=d=>dayPlans(d).filter(p=>vis(p));

// ---------- views ----------
function setupView(){
  if(S.mode==='config')return`<div class="panel welcome"><h2>Finish connecting the database</h2>
    <p class="muted">This copy of the planner doesn’t have its Firebase settings yet, so it can’t save anything.</p>
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
    <form class="form inline" data-form="unlock" method="post" action="#">
      <!-- Password managers (iCloud Keychain, Google) only offer to save a password that has a username,
           so the trip gets a fixed, hidden one. -->
      <input type="text" name="username" autocomplete="username" value="Disney trip" hidden readonly tabindex="-1" aria-hidden="true">
      <input type="password" id="u-pw" name="password" autocomplete="current-password" aria-label="Trip password" placeholder="Trip password" required>
      <button class="btn" type="submit"${S.busy?' disabled':''}>${S.busy?'Checking…':'Open trip'}</button>
    </form>${S.authErr?`<div class="chip bad" role="alert" style="white-space:normal">${esc(S.authErr)}</div>`:''}</div>`;
  if(S.mode==='loading')return`<div class="panel setup"><p class="muted">Loading your trip…</p></div>`;
  if(S.stale)return`<div class="panel setup"><h2>Can’t reach the shared trip yet</h2><p class="muted">The plan will appear here as soon as the connection comes back.</p></div>`;
  return`<div class="panel setup">
    <div><h2>Start your trip</h2><p class="muted small">You can add more families later from Home.</p></div>
    <form class="form" data-form="setup">
      <label class="field wide"><span>Trip name</span><input type="text" id="s-name" placeholder="Spring break 2027" required></label>
      <label class="field wide"><span>Your family’s name</span><input type="text" id="s-fam" placeholder="Becker Family" required></label>
      <label class="field"><span>Resort</span><select id="s-resort"><option value="wdw">Walt Disney World</option><option value="dl">Disneyland Resort</option></select></label>
      <label class="field"><span>Hotel</span><input type="text" id="s-hotel" placeholder="Where you’re staying"></label>
      <label class="field"><span>Arrive</span><input type="date" id="s-start" required></label>
      <label class="field"><span>Leave</span><input type="date" id="s-end" required></label>
      <label class="check wide"><input type="checkbox" id="s-onsite">Staying at a Disney-owned hotel</label>
      <label class="field wide"><span>Who’s going (one name per line)</span><textarea id="s-party" rows="4" placeholder="Mom&#10;Dad&#10;Ava"></textarea></label>
      <div class="wide"><button class="btn" type="submit">Start planning</button></div>
    </form></div>`;
}

// ---------- flights ----------
const flightCode=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,' ').trim().slice(0,10);
const trackLink=code=>code?`<a class="track" href="https://www.flightaware.com/live/flight/${encodeURIComponent(code.replace(/\s+/g,''))}" target="_blank" rel="noopener">Track ${esc(code)} ↗</a>`:'';

// Pre-fill a flight from an old travel activity like "EWR to MCO" on the arrival or leave day.
function legPrefill(f,k){
  const day=k==='outbound'?f.arrive:f.depart;if(!validDate(day))return null;
  const c=S.plans.filter(p=>p.kind==='Travel'&&p.date===day&&planFams(p).includes(f.id)).map(p=>({p,m:String(p.title).match(/\b([A-Za-z]{3})\s*(?:to|→|->|-|–)\s*([A-Za-z]{3})\b/)})).filter(x=>x.m);
  if(!c.length)return null;
  const x=k==='outbound'?c[0]:c[c.length-1];
  return{date:day,dep:x.p.time||'',from:x.m[1].toUpperCase(),to:x.m[2].toUpperCase(),conf:x.p.conf||'',flight:x.p.flight||'',src:x.p.id,srcTitle:x.p.title};
}
function legBox(f,k,label){
  const x=f[k]||{}, has=validDate(x.date), pre=has?null:legPrefill(f,k), v=has?x:(pre||{date:k==='outbound'?f.arrive:f.depart});
  const id=n=>`lg-${f.id}-${k}-${n}`, route=[x.from,x.to].filter(Boolean).join(' → ');
  return`<div class="leg"><div class="leghead"><span class="legname">${label}</span>${has&&x.flight?trackLink(x.flight):''}</div>
    ${has?`<div class="legmain">${esc(route||'Route not set')}${x.flight?` <span class="num muted">· ${esc(x.flight)}</span>`:''}</div>
      <div class="small">${esc(fmtD(x.date,{weekday:'short',month:'short',day:'numeric'}))}${x.dep?' · departs '+esc(fmtT(x.dep)):''}${x.arr?' · arrives '+esc(fmtT(x.arr)):''}${x.conf?' · #'+esc(x.conf):''}</div>`
    :`<div class="fine">Not added yet.</div>`}
    <details id="leg-${f.id}-${k}"${openAttr('leg-'+f.id+'-'+k,false)}><summary class="small">${has?'Edit':'+ Add'} ${label.toLowerCase()}</summary>
      <form class="form" data-form="leg" data-fam="${f.id}" data-leg="${k}"${pre?` data-src="${pre.src}"`:''} style="margin-top:8px">
        <label class="field"><span>Date</span><input type="date" id="${id('date')}" data-keep value="${esc(v.date||'')}" required></label>
        <label class="field"><span>Flight #</span><input type="text" id="${id('num')}" data-keep value="${esc(v.flight||'')}" placeholder="UA 1234" autocapitalize="characters" autocomplete="off"></label>
        <label class="field"><span>From</span><input type="text" id="${id('from')}" data-keep value="${esc(v.from||'')}" placeholder="EWR" autocapitalize="characters" autocomplete="off"></label>
        <label class="field"><span>To</span><input type="text" id="${id('to')}" data-keep value="${esc(v.to||'')}" placeholder="MCO" autocapitalize="characters" autocomplete="off"></label>
        <label class="field"><span>Departs</span><input type="time" id="${id('dep')}" data-keep value="${esc(v.dep||'')}"></label>
        <label class="field"><span>Arrives</span><input type="time" id="${id('arr')}" data-keep value="${esc(v.arr||'')}"></label>
        <label class="field wide"><span>Confirmation #</span><input type="text" id="${id('conf')}" data-keep value="${esc(v.conf||'')}" placeholder="Optional" autocomplete="off"></label>
        ${pre?`<div class="fine wide">Filled in from your “${esc(pre.srcTitle)}” plan. Saving moves it here so it isn’t listed twice.</div>`:''}
        <div class="wide legbtns"><button class="btn" type="submit">Save ${label.toLowerCase()}</button>${has?`<button class="x wide" type="button" data-act="legdel" data-id="${f.id}|${k}">Remove flight</button>`:''}</div>
      </form></details></div>`;
}
// A family's tile: the key facts first (dates, hotel, flights), then parks, activities and dining.
function famCard(f){
  const ms=famMembers(f.id), sel=f.id;
  const mine=allPlans().filter(p=>planFams(p).includes(f.id)).sort((a,b)=>(a.date+(a.time||'99'))<(b.date+(b.time||'99'))?-1:1);
  const travel=mine.filter(p=>p.kind==='Travel'), dining=mine.filter(p=>p.kind==='Dining'), acts=mine.filter(p=>p.kind!=='Travel'&&p.kind!=='Dining');
  const when=p=>`${esc(fmtD(p.date,{weekday:'short',month:'short',day:'numeric'}))}${p.time?' · '+esc(fmtT(p.time)):''}`;
  const line=p=>`<li><span class="wt">${when(p)}</span><span class="wtitle">${esc(p.title)}${p.conf?` <span class="muted">· #${esc(p.conf)}</span>`:''}</span></li>`;
  const more=(arr,n)=>arr.length>n?`<div class="fine">and ${arr.length-n} more on the Trip tab</div>`:'';
  const days=validDate(f.arrive)?Array.from({length:Math.min(diff(f.arrive,f.depart||f.arrive),30)+1},(_,i)=>addDays(f.arrive,i)):[];
  const parks=days.map(d=>[d,famPark(f.id,d)]).filter(x=>x[1]);
  return`<div class="famcard">
    <div class="famhead"><h3>${esc(f.name)}</h3><span class="small muted">${ms.length?esc(ms.map(m=>m.name).join(', ')):'No one added yet'}</span></div>
    <dl class="keyfacts">
      <div><dt>Dates</dt><dd>${validDate(f.arrive)?`${esc(fmtD(f.arrive,{weekday:'short',month:'short',day:'numeric'}))} – ${esc(fmtD(f.depart||f.arrive,{weekday:'short',month:'short',day:'numeric'}))}`:`<button type="button" class="btn small" data-act="adddates" data-id="${f.id}">Add your travel dates</button>`}</dd></div>
      <div><dt>Hotel</dt><dd>${f.hotel?esc(f.hotel):'<span class="muted">Not set</span>'}</dd></div>
    </dl>
    <div class="label">Flights</div>
    <div class="legs">${LEGS.map(([k,label])=>legBox(f,k,label)).join('')}</div>
    ${travel.filter(p=>!p.virtual).length?`<div class="label">Other travel</div><ul class="flist">${travel.filter(p=>!p.virtual).map(line).join('')}</ul>`:''}
    <div class="label">Parks</div>
    ${parks.length?`<div class="chips">${parks.map(([d,c])=>parkChip(c,fmtD(d,{weekday:'short',month:'numeric',day:'numeric'}))).join('')}</div>`:'<div class="fine">Pick a park for each day on the Day tab.</div>'}
    <div class="label">Activities</div>
    ${acts.length?`<ul class="flist">${acts.slice(0,6).map(line).join('')}</ul>${more(acts,6)}`:'<div class="fine">None yet.</div>'}
    <div class="label">Dining</div>
    ${dining.length?`<ul class="flist">${dining.slice(0,6).map(line).join('')}</ul>${more(dining,6)}`:'<div class="fine">None yet.</div>'}
    <details id="famedit-${sel}"${openAttr('famedit-'+sel,!ms.length)}><summary class="small">Edit ${esc(shortName(f.name))} family</summary>
      <form class="form" data-form="famedit" data-fam="${sel}" style="margin-top:10px">
        <label class="field wide"><span>Family name</span><input type="text" id="fe-name-${sel}" data-keep value="${esc(f.name)}" required></label>
        <label class="field wide"><span>Hotel</span><input type="text" id="fe-hotel-${sel}" data-keep value="${esc(f.hotel||'')}" placeholder="Where they’re staying"></label>
        <label class="field"><span>Arrive</span><input type="date" id="fe-arrive-${sel}" data-keep value="${esc(f.arrive||'')}"></label>
        <label class="field"><span>Leave</span><input type="date" id="fe-depart-${sel}" data-keep value="${esc(f.depart||'')}"></label>
        <label class="check wide"><input type="checkbox" id="fe-onsite-${sel}" data-keep${f.onsite?' checked':''}>Staying at a Disney-owned hotel</label>
        <div class="wide"><button class="btn" type="submit">Save</button></div>
      </form>
      <div class="names" style="margin-top:12px">${ms.map(m=>`<div class="name-row"><span class="av" style="background:${mcol(m.id)}">${initial(m.name)}</span>
        <input type="text" value="${esc(m.name)}" aria-label="Name" data-change="pname" data-id="${m.id}">${delBtn('pdel',m.id,'',m.name)}</div>`).join('')}</div>
      <form class="form inline" data-form="padd" data-fam="${sel}" style="margin-top:8px">
        <input type="text" id="p-name-${sel}" data-keep placeholder="Add a person" aria-label="Add a person to ${esc(f.name)}" required>
        <button class="btn" type="submit">Add</button></form>
      ${!ms.length&&families().length>1?`<div style="margin-top:8px">${delBtn('famdel',sel,'',f.name).replace('class="x"','class="x wide"').replace('>×<','>Remove this family<')}</div>`:''}
    </details>
  </div>`;
}

function overviewView(){
  const t=S.trip, days=tripDays(), s=curScope();
  const openTasks=S.tasks.filter(x=>!x.done&&inScope(x)).sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:1).slice(0,4);
  const famsPanel=`<section class="panel span2"><div class="panel-head"><h2>${s==='group'&&multiFam()?'Families':esc(fam(s==='group'?firstFam():s)?.name||'Your family')}</h2><span class="fine">Dates, hotel, flights, parks, activities and dining</span></div>
      <div class="famgrid">${scopeFams().map(famCard).join('')}</div>
      <details id="famadd"${openAttr('famadd',false)}><summary class="small">Add another family</summary>
        <form class="form inline" data-form="famadd" style="margin-top:8px"><input type="text" id="fa-name" data-keep placeholder="Logothetis Family" aria-label="Family name" required><button class="btn" type="submit">Add</button></form>
      </details></section>`;
  const glance=`<section class="panel span2"><div class="panel-head"><h2>Trip at a glance</h2><a href="#week" class="link">Whole trip</a></div>
      ${days.length?`<div class="glance">${days.map((d,i)=>{const n=visiblePlans(d).length;return`<button class="gday" data-act="goday" data-day="${d}"><span class="label">Day ${i+1} · ${esc(fmtD(d,{weekday:'short'}))}</span><b class="num">${esc(fmtD(d,{month:'short',day:'numeric'}))}</b><span class="chips">${parkChips(d)}</span>${hotelNotes(d)}<span class="small muted">${n?plural(n,'plan'):'Nothing planned'}</span></button>`}).join('')}</div>`:'<div class="empty">Add arrival and leave dates under Families.</div>'}
    </section>`;
  const wins=`<section class="panel"><div class="panel-head"><h2>Booking windows</h2><span class="fine">Based on each family’s dates</span></div>
      ${scopeFams().map(f=>`${scopeFams().length>1?`<div class="label">${esc(f.name)}</div>`:''}<div class="list">${windows(f).map(w=>`<div class="win">${calBox(w.date)}<div class="body" style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="title" style="font-weight:600">${esc(w.title)}</div><div class="small muted">${esc(fmtD(w.date,{weekday:'long',month:'long',day:'numeric'}))}. ${esc(w.note)}</div><div>${winStatus(w.date,f)}</div></div></div>`).join('')||'<div class="empty">Add this family’s arrival date to see booking windows.</div>'}</div>`).join('')}
      <p class="fine">Disney changes these rules from time to time. Confirm in the Disney app before the day.</p>
    </section>`;
  const upnext=`<section class="panel"><div class="panel-head"><h2>Up next</h2><a href="#lists" class="link">All to-dos</a></div>
      <div class="list">${openTasks.map(taskRow).join('')||'<div class="empty">No open to-dos. Add bookings and errands on the Lists tab.</div>'}</div>
    </section>`;
  const details=`<section class="panel"><details id="trip-details"${openAttr('trip-details',false)}><summary>Trip name and resort</summary>
      <form class="form" data-form="tripedit" style="margin-top:14px">
        <label class="field wide"><span>Trip name</span><input type="text" id="t-name" data-keep value="${esc(t.name)}"></label>
        <label class="field wide"><span>Resort</span><select id="t-resort" data-keep><option value="wdw"${resort()==='wdw'?' selected':''}>Walt Disney World</option><option value="dl"${resort()==='dl'?' selected':''}>Disneyland Resort</option></select></label>
        <div class="wide"><button class="btn" type="submit">Save</button></div>
      </form></details></section>`;
  const share=`<section class="panel"><div class="panel-head"><h2>Share this trip</h2><span class="fine">Link plus password</span></div>
      <p class="small muted" style="margin:0">Send the link and give the password a different way, like saying it out loud. Each family picks its name at the top once on each phone.</p>
      <div class="sharebox"><input type="text" id="share-url" readonly value="${esc(shareUrl())}" aria-label="Trip link"><button class="btn small" data-act="copylink">Copy link</button>${navigator.share?'<button class="btn ghost small" data-act="sharelink">Share…</button>':''}</div>
      <div><button class="btn ghost small" data-act="signout">Sign out of this trip on this device</button></div>
      <div class="fine">App version ${APP_VERSION}</div>
    </section>`;
  return`${scopeBar()}<div class="grid">${famsPanel}${glance}${upnext}${wins}${details}${share}</div>`;
}

function weekView(){
  const days=tripDays();
  if(!days.length)return`${scopeBar()}<div class="panel"><p class="muted">Add arrival and leave dates under Families on Home to see the whole trip.</p></div>`;
  const allShown=days.flatMap(visiblePlans);
  return`${scopeBar()}<div class="weekbar"><span class="small muted">${plural(allShown.length,'plan')}</span><button class="btn small" data-act="icsall"${allShown.length?'':' disabled'}>Add all to calendar</button></div><div class="week">${days.map((d,i)=>{
    const all=dayPlans(d), ps=visiblePlans(d);
    return`<section class="wday${d===today()?' today':''}">
      <button class="wday-head" data-act="goday" data-day="${d}" aria-label="Open ${esc(fmtD(d,{weekday:'long',month:'long',day:'numeric'}))}"><span class="label">Day ${i+1} · ${esc(fmtD(d,{weekday:'long'}))}</span><b>${esc(fmtD(d,{month:'long',day:'numeric'}))}</b></button>
      <div class="chips">${parkChips(d)}</div>
      ${hotelNotes(d)}
      ${ps.length?`<ol class="wlist">${ps.map(p=>`<li><span class="wt">${esc(p.time?fmtT(p.time):'Any time')}</span><span><span class="wtitle">${esc(p.title)}</span><span class="wwho">${esc(whoLabel(p))}</span></span></li>`).join('')}</ol>`:`<div class="empty">${all.length?'Nothing for the people selected':'Nothing planned yet'}</div>`}
    </section>`}).join('')}</div>`;
}

function daysView(){
  const days=tripDays();
  if(!days.length)return`${scopeBar()}<div class="panel"><p class="muted">Add arrival and leave dates under Families on Home to plan each day.</p></div>`;
  if(!days.includes(selDay))selDay=days.includes(today())?today():days[0];
  const d=selDay, s=curScope(), f=s==='group'?null:fam(s), all=dayPlans(d), plans=visiblePlans(d), hidden=all.length-plans.length;
  const lastDay=f&&d===f.depart&&d!==f.arrive;
  const sel=selected(), pickFams=s==='group'?families():[f];
  const dayFields=f?`<div class="dayfields"><label class="field"><span>Park</span><select data-change="daypark" data-day="${d}">${parkOpts(famPark(f.id,d))}</select></label>
      ${lastDay?'':`<label class="field"><span>Hotel tonight</span><input type="text" id="dh-${f.id}-${d}" data-keep value="${esc(S.trip.famHotels?.[f.id]?.[d]||(f.id===firstFam()?S.trip.dayHotels?.[d]||'':''))}" placeholder="${esc(f.hotel||'Where you’re staying')}" data-change="dayhotel" data-day="${d}"></label>`}</div>`
    :`<div class="chips">${parkChips(d)}</div>`;
  return`${scopeBar()}<div class="strip" role="tablist" aria-label="Trip days">${days.map(x=>{const pk=f?famPark(f.id,x):'';return`<button class="daybtn" aria-current="${x===d}" data-act="selday" data-day="${x}"><span class="dw">${esc(fmtD(x,{weekday:'short'}))}</span><span class="dn">${pd(x).getDate()}</span><span class="dot" style="${pk?`background:var(--p-${PCOLOR[pk]||'rest'})`:''}"></span></button>`}).join('')}</div>
  <div class="grid" style="margin-top:12px">
    <section class="panel span2"><div class="panel-head"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="label">Day ${days.indexOf(d)+1} of ${days.length}</div><h2>${esc(fmtD(d,{weekday:'long',month:'long',day:'numeric'}))}</h2>${hotelNotes(d)}</div>
      ${dayFields}</div>
      ${!f&&multiFam()?'<div class="fine">Pick a family at the top to set its park and hotel for the day.</div>':''}
      <div class="list">${plans.map(rowFor).join('')||`<div class="empty">${hidden?'Nothing for the people selected on this day.':'Nothing planned for this day yet.'}</div>`}</div>
      ${hidden?`<div class="fine">${plural(hidden,'other plan')} on this day. <button type="button" class="linkbtn" data-act="allon">Show everyone</button></div>`:''}
      <details class="addbox" id="add-plan"${openAttr('add-plan',!all.length)}><summary class="btn">+ Add a plan</summary>
      <form class="form" data-form="plan">
        <label class="field"><span>Time</span><input type="time" id="pl-time" data-keep></label>
        <label class="field"><span>Type</span><select id="pl-kind" data-keep>${KINDS.map(k=>`<option>${k}</option>`).join('')}</select></label>
        <label class="field wide"><span>What</span><input type="text" id="pl-title" data-keep list="sugg" placeholder="Dinner at Sanaa" required></label>
        <label class="field"><span>Confirmation #</span><input type="text" id="pl-conf" data-keep placeholder="Optional"></label>
        <label class="field"><span>Notes</span><input type="text" id="pl-notes" data-keep placeholder="Optional"></label>
        ${pickFams.map(pf=>{const ms=famMembers(pf.id);return ms.length?`<fieldset class="wide whopick"><legend>${pickFams.length>1?esc(pf.name):'Who’s going'}</legend>${ms.map(m=>`<label class="check"><input type="checkbox" id="pl-who-${m.id}" data-keep data-who-pick="${m.id}"${sel.includes(m.id)?' checked':''}>${esc(m.name)}</label>`).join('')}</fieldset>`:''}).join('')}
        <div><button class="btn" type="submit">Add to day</button></div>
      </form></details>
      ${suggList()}
    </section></div>`;
}
const suggList=()=>`<datalist id="sugg">${SUGGEST[resort()].map(x=>`<option value="${esc(x[0])}"></option>`).join('')}</datalist>`;

function whoChips(ids,act,itemId){
  return scopeMembers().map(p=>`<button type="button" class="chip-btn" style="--mc:${mcol(p.id)}" aria-pressed="${ids.includes(p.id)}" data-act="${act}" data-id="${itemId}" data-who="${p.id}"><span class="av">${initial(p.name)}</span>${esc(p.name)}</button>`).join('');
}
function heightIssue(w){
  const h=Number(w.minHeight)||0, ms=scopeMembers();if(!h||!ms.length)return'';
  const short=ms.filter(p=>Number(p.height)>0&&Number(p.height)<h), unknown=ms.filter(p=>!(Number(p.height)>0));
  if(short.length)return`<span class="chip bad">Too short: ${short.map(p=>`${esc(p.name)} (${esc(p.height)}″)`).join(', ')}</span>`;
  if(unknown.length)return`<span class="chip warn">No height yet: ${unknown.map(p=>esc(p.name)).join(', ')}</span>`;
  return`<span class="chip good">Everyone can ride</span>`;
}
function mustdoView(){
  const days=tripDays(), ms=scopeMembers();
  const list=[...S.wishes].sort((a,b)=>(b.votes?.length||0)-(a.votes?.length||0)||String(a.title).localeCompare(b.title));
  const scheduled=t=>S.plans.filter(p=>String(p.title).toLowerCase().includes(String(t).toLowerCase()));
  return`${scopeBar()}<div class="grid"><section class="panel span2">
    <div class="panel-head"><div><h2>Must-dos</h2><p class="small muted" style="margin:2px 0 0">Shared by every family. Tap your name on what you want most; the list sorts by votes and checks heights.</p></div></div>
    ${ms.length?`<details id="heights"${openAttr('heights',false)}><summary>Heights for the ride check</summary>
      <div class="names" style="margin-top:12px">${ms.map(p=>`<label class="name-row"><span class="av" style="background:${mcol(p.id)}">${initial(p.name)}</span><span class="nm">${esc(p.name)}</span>
        <input type="number" inputmode="numeric" min="0" max="90" value="${esc(p.height??'')}" placeholder="inches" aria-label="${esc(p.name)}’s height in inches" data-change="pheight" data-id="${p.id}"></label>`).join('')}</div></details>`:''}
    <details class="addbox" id="add-wish"${openAttr('add-wish',!list.length)}><summary class="btn">+ Add a must-do</summary>
    <form class="form" data-form="wish">
      <label class="field wide"><span>Ride, show or meal</span><input type="text" id="w-title" data-keep list="sugg" placeholder="Start typing a ride name" required></label>
      <label class="field"><span>Park</span><select id="w-park" data-keep>${parkOpts('','Any park')}</select></label>
      <label class="field"><span>Min height (in)</span><input type="number" id="w-h" data-keep min="0" max="60" placeholder="None"></label>
      <div><button class="btn" type="submit">Add must-do</button></div>
    </form></details>${suggList()}
    <div class="list">${list.map(w=>{const sch=scheduled(w.title);return`<div class="row"><div class="body">
        <div class="title">${esc(w.title)}</div>
        <div class="meta">${parkChip(w.park)}${Number(w.minHeight)?`<span class="chip num">${esc(w.minHeight)}″ minimum</span>`:''}${heightIssue(w)}${sch.length?`<span class="chip good">Planned ${esc(sch.map(p=>fmtD(p.date,{weekday:'short'})).join(', '))}</span>`:''}<span class="num">${plural(w.votes?.length||0,'vote')}</span></div>
        ${ms.length?`<div class="chips">${whoChips(w.votes||[],'vote',w.id)}</div>`:''}
        ${days.length?`<div style="max-width:260px"><select aria-label="Schedule ${esc(w.title)} on a day" data-change="schedule" data-id="${w.id}"><option value="">Add to a day…</option>${days.map((d,i)=>`<option value="${d}">Day ${i+1} · ${esc(fmtD(d))}</option>`).join('')}</select></div>`:''}
      </div>${delBtn('del',w.id,'wishes',w.title)}</div>`}).join('')||'<div class="empty">No must-dos yet. Add the rides and characters each person cares about most.</div>'}</div>
  </section></div>`;
}

function taskRow(x){
  const m=member(x.owner), late=x.due&&!x.done&&x.due<today(), pl=x.planId&&S.plans.find(p=>p.id===x.planId);
  return`<div class="row${x.done?' done':''}"><label class="check" style="padding-top:2px"><input type="checkbox" ${x.done?'checked':''} data-change="toggle" data-coll="tasks" data-id="${x.id}" aria-label="Done: ${esc(x.text)}"></label>
    <div class="body"><div class="title">${esc(x.text)}</div><div class="meta">${curScope()==='group'&&multiFam()?`<span class="chip fam">${esc(shortName(fam(itemFam(x))?.name))}</span>`:''}${x.due?`<span class="${late?'chip bad':'chip'}">${late?'Overdue · ':'Due '}${esc(fmtD(x.due))}</span>`:''}${m?`<span>${esc(m.name)}</span>`:''}${pl?`<span>For ${esc(pl.title)} · ${esc(fmtD(pl.date))}</span>`:''}</div></div>
    ${delBtn('del',x.id,'tasks',x.text)}</div>`;
}
const whoOpts=blank=>`<option value="">${blank}</option>`+scopeMembers().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
function listsView(){
  const tasks=S.tasks.filter(inScope).sort((a,b)=>(a.done-b.done)||((a.due||'9')<(b.due||'9')?-1:1));
  const pack=S.packing.filter(inScope), fs=scopeFams(), many=fs.length>1;
  const groups=fs.flatMap(f=>[
    {name:many?`${f.name} · shared`:'Whole family',items:pack.filter(x=>itemFam(x)===f.id&&!(x.who&&member(x.who)))},
    ...famMembers(f.id).map(m=>({name:m.name,items:pack.filter(x=>x.who===m.id)}))
  ]).filter(g=>g.items.length);
  return`${scopeBar()}<div class="grid">
    <section class="panel"><div class="panel-head"><h2>To-dos</h2><span class="progress num">${tasks.filter(x=>x.done).length} of ${tasks.length} done</span></div>
      <details class="addbox" id="add-task"${openAttr('add-task',!tasks.length)}><summary class="btn">+ Add a to-do</summary>
      <form class="form" data-form="task">
        <label class="field wide"><span>To-do</span><input type="text" id="t-text" data-keep placeholder="Book dining for Day 2" required></label>
        <label class="field"><span>Due</span><input type="date" id="t-due" data-keep></label>
        <label class="field"><span>Who</span><select id="t-owner" data-keep>${whoOpts('Anyone')}</select></label>
        <div><button class="btn" type="submit">Add</button></div></form></details>
      <div class="list">${tasks.map(taskRow).join('')||'<div class="empty">Track tickets, flights, dining, and anything else that needs booking.</div>'}</div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Packing</h2><span class="progress num">${pack.filter(x=>x.done).length} of ${pack.length} packed</span></div>
      <details class="addbox" id="add-pack"${openAttr('add-pack',!pack.length)}><summary class="btn">+ Add to packing</summary>
      <form class="form" data-form="pack">
        <label class="field wide"><span>Item</span><input type="text" id="k-text" data-keep placeholder="Ponchos, autograph book, chargers…" required></label>
        <label class="field"><span>For</span><select id="k-who" data-keep>${whoOpts(many?'Shared (pick a family above)':'Whole family')}</select></label>
        <div><button class="btn" type="submit">Add</button></div></form></details>
      ${groups.map(g=>`<div style="display:flex;flex-direction:column;gap:6px"><div class="label">${esc(g.name)}</div><div class="list">${g.items.map(x=>`<div class="row${x.done?' done':''}"><label class="check"><input type="checkbox" ${x.done?'checked':''} data-change="toggle" data-coll="packing" data-id="${x.id}" aria-label="Packed: ${esc(x.text)}"></label><div class="body"><div class="title">${esc(x.text)}</div></div>${delBtn('del',x.id,'packing',x.text)}</div>`).join('')}</div></div>`).join('')||'<div class="empty">Nothing on the list yet.</div>'}
    </section></div>`;
}

const VIEWS={overview:overviewView,week:weekView,days:daysView,mustdo:mustdoView,lists:listsView};

// ---------- render with form preservation ----------
function render(){
  const view=$('#view'), keep={}, ae=document.activeElement;
  view.querySelectorAll('[data-keep]').forEach(el=>keep[el.id]=el.type==='checkbox'?el.checked:el.value);
  const focusId=ae&&view.contains(ae)&&ae.id?ae.id:null, sel=focusId&&'selectionStart' in ae?[ae.selectionStart,ae.selectionEnd]:null;
  applyPalette();
  renderHeader();
  const gate=['config','welcome','locked'].includes(S.mode);
  view.innerHTML=S.trip&&!gate?VIEWS[currentTab()]():setupView();
  for(const id in keep){const el=document.getElementById(id);if(el)el.type==='checkbox'?el.checked=keep[id]:el.value=keep[id]}
  if(focusId){const el=document.getElementById(focusId);if(el){el.focus();try{sel&&el.setSelectionRange(...sel)}catch{}}}
}

// ---------- actions ----------
const val=id=>(document.getElementById(id)?.value||'').trim();
function clear(...ids){ids.forEach(id=>{const el=document.getElementById(id);if(el)el.type==='checkbox'?el.checked=false:el.value=''})}

document.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();
  const k=f.dataset.form, fid=f.dataset.fam;
  if(k==='unlock'){const pw=$('#u-pw').value;if(pw)unlock(pw);return}
  if(k==='setup'){
    const start=val('s-start'),end=val('s-end')||start;
    if(!validDate(start)){toast('Pick your arrival date.');return}
    if(end<start){toast('The leave date is before the arrival date.');return}
    const famId=uid();
    const ppl=val('s-party').split('\n').map(l=>l.trim()).filter(Boolean).map(n=>({id:uid(),name:n.slice(0,40),height:null,family:famId}));
    act(store.setTrip({name:val('s-name')||'Our Disney trip',resort:val('s-resort')||'wdw',
      families:[{id:famId,name:val('s-fam')||'Our family',hotel:val('s-hotel'),arrive:start,depart:end,onsite:document.getElementById('s-onsite').checked}],party:ppl}),'Trip created');
  }
  if(k==='tripedit')act(store.updateTrip({name:val('t-name')||'Our Disney trip',resort:val('t-resort')}),'Saved');
  if(k==='famedit'){
    const name=val('fe-name-'+fid), arrive=val('fe-arrive-'+fid), depart=val('fe-depart-'+fid);
    if(!name){toast('Give the family a name.');return}
    if(validDate(arrive)!==validDate(depart)){toast('Add both the arrival and the leave date.');return}
    if(validDate(arrive)&&depart<arrive){toast('The leave date is before the arrival date.');return}
    act(store.updateTrip({families:famSaveList(fid,{name:name.slice(0,40),hotel:val('fe-hotel-'+fid).slice(0,80),arrive,depart,datesSet:validDate(arrive),onsite:document.getElementById('fe-onsite-'+fid).checked})}),'Saved');
  }
  if(k==='leg'){
    const g=n=>val(`lg-${fid}-${f.dataset.leg}-${n}`), date=g('date');
    if(!validDate(date)){toast('Add the flight date.');return}
    const leg={date,flight:flightCode(g('num')),from:g('from').toUpperCase().slice(0,4),to:g('to').toUpperCase().slice(0,4),dep:g('dep'),arr:g('arr'),conf:g('conf').slice(0,30)};
    const label=f.dataset.leg==='outbound'?'Outbound flight':'Return flight', src=f.dataset.src&&S.plans.find(p=>p.id===f.dataset.src);
    closedBoxes.add(`leg-${fid}-${f.dataset.leg}`);openBoxes.delete(`leg-${fid}-${f.dataset.leg}`);
    act(store.updateTrip({families:famSaveList(fid,{[f.dataset.leg]:leg})}),src?`${label} saved. “${src.title}” moved into it.`:`${label} saved`);
    if(src)act(store.remove('plans',src.id));
    return;
  }
  if(k==='famadd'){
    const name=val('fa-name');if(!name)return;clear('fa-name');
    const nf={id:uid(),name:name.slice(0,40),hotel:'',arrive:'',depart:'',onsite:false};
    openBoxes.add('famedit-'+nf.id);
    act(store.updateTrip({families:[...families(),nf]}),`${nf.name} added. Add their people below.`);
  }
  if(k==='padd'){
    const name=val('p-name-'+fid);if(!name)return;clear('p-name-'+fid);
    act(store.updateTrip({party:[...party(),{id:uid(),name:name.slice(0,40),height:null,family:fid}],...(S.trip.families?{}:{families:families()})}));
  }
  if(k==='plan'){
    const title=val('pl-title');if(!title)return;
    const picks=[...f.querySelectorAll('[data-who-pick]')];
    const who=picks.filter(c=>c.checked).map(c=>c.dataset.whoPick);
    if(picks.length&&!who.length){toast('Pick at least one person who’s going.');return}
    const kind=val('pl-kind')||'Other';
    const d={date:selDay,time:val('pl-time'),title,kind,conf:val('pl-conf'),notes:val('pl-notes'),who};
    clear('pl-time','pl-title','pl-conf','pl-notes');act(store.add('plans',d));
  }
  if(k==='plantodo'){
    const text=val('pt-text'),due=val('pt-due'),owner=val('pt-owner');
    if(!text||!validDate(due)){toast('Pick a due date for the to-do.');return}
    if(!owner){toast('Choose who owns this to-do.');return}
    openTodo=null;clear('pt-text','pt-due','pt-owner');
    act(store.add('tasks',{text,due,owner,done:false,planId:f.dataset.id,family:newItemFam(owner)}),'To-do added');
  }
  if(k==='wish'){
    const title=val('w-title');if(!title)return;const d={title,park:val('w-park'),minHeight:Number(val('w-h'))||0,votes:[]};
    clear('w-title','w-h');document.getElementById('w-park').value='';act(store.add('wishes',d));
  }
  if(k==='task'){const text=val('t-text');if(!text)return;const owner=val('t-owner');const d={text,due:val('t-due'),owner,done:false,family:newItemFam(owner)};clear('t-text','t-due');act(store.add('tasks',d))}
  if(k==='pack'){const text=val('k-text');if(!text)return;const who=val('k-who');const d={text,who,done:false,family:newItemFam(who)};clear('k-text');act(store.add('packing',d))}
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
  if((a==='del'||a==='pdel'||a==='famdel'||a==='legdel')&&!confirmTap(b,a+id))return;
  if(a==='scope'){scope=who;ls.set('trip-scope',scope);render()}
  if(a==='person'){pick=toggleIn(filtering()?selected():[],who);ls.set('trip-pick',pick);render()}
  if(a==='allon'){pick=[];ls.set('trip-pick',pick);render()}
  if(a==='selday'){selDay=day;ls.set('trip-selday',day);render()}
  if(a==='goday'){selDay=day;ls.set('trip-selday',day);location.hash='days'}
  if(a==='del'){const it=S[coll].find(x=>x.id===id);act(store.remove(coll,id),it?`Deleted “${it.title||it.text}”`:null)}
  if(a==='pdel'){act(store.updateTrip({party:party().filter(p=>p.id!==id)}))}
  if(a==='adddates'){openBoxes.add('famedit-'+id);closedBoxes.delete('famedit-'+id);render();document.getElementById('fe-arrive-'+id)?.focus()}
  if(a==='legdel'){const[fid2,leg]=id.split('|');act(store.updateTrip({families:famSaveList(fid2,{[leg]:null})}),'Flight removed')}
  if(a==='famdel'){if(famMembers(id).length){toast('Remove this family’s people first.');return}act(store.updateTrip({families:families().filter(f=>f.id!==id)}),'Family removed')}
  if(a==='vote'){const w=S.wishes.find(x=>x.id===id);if(w)act(store.update('wishes',id,{votes:toggleIn(w.votes||[],who)}))}
  if(a==='unwho'){const p=S.plans.find(x=>x.id===id);if(p)act(store.update('plans',id,{who:planWho(p).filter(x=>x!==who)}))}
  if(a==='todoopen'){openTodo=id;render();document.getElementById('pt-due')?.focus()}
  if(a==='todoclose'){openTodo=null;render()}
  if(a==='ics'){const p=allPlans().find(x=>x.id===id);if(p)saveIcs([p],p.title)}
  if(a==='icsall'){saveIcs(tripDays().flatMap(visiblePlans),S.trip.name||'Disney trip')}
  if(a==='copylink'){const u=shareUrl();navigator.clipboard?.writeText(u).then(()=>toast('Link copied. Send the password separately.'),()=>{$('#share-url').select();toast('Press copy to copy the selected link.')})}
  if(a==='sharelink'){navigator.share?.({title:S.trip?.name||'Our Disney trip',text:'Our Disney trip plan. I’ll send you the password separately.',url:shareUrl()}).catch(()=>{})}
  if(a==='signout'){signOut(auth).then(()=>location.reload())}
});
document.addEventListener('change',e=>{
  const el=e.target.closest('[data-change]');if(!el)return;
  const {change:c,id,coll,day}=el.dataset, s=curScope();
  if(c==='toggle')act(store.update(coll,id,{done:el.checked}));
  if(c==='daypark'&&s!=='group')act(store.updateTrip({famParks:{[s]:{[day]:el.value}}}));
  if(c==='dayhotel'&&s!=='group')act(store.updateTrip({famHotels:{[s]:{[day]:el.value.trim().slice(0,80)}}}));
  if(c==='addwho'&&el.value){const p=S.plans.find(x=>x.id===id);if(p)act(store.update('plans',id,{who:[...planWho(p),el.value]}))}
  if(c==='pname'){const n=el.value.trim().slice(0,40);if(n)act(store.updateTrip({party:party().map(p=>p.id===id?{...p,name:n}:p)}))}
  if(c==='pheight')act(store.updateTrip({party:party().map(p=>p.id===id?{...p,height:Number(el.value)||null}:p)}));
  if(c==='schedule'&&el.value){
    const w=S.wishes.find(x=>x.id===id);if(!w)return;
    const ms=scopeMembers().map(m=>m.id), voters=(w.votes||[]).filter(v=>ms.includes(v));
    const d=el.value;act(store.add('plans',{date:d,time:'',title:w.title,kind:'Ride',conf:'',notes:'',who:voters.length?voters:selected()}),`Added to ${fmtD(d)}`);
  }
});
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

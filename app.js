import { firebaseConfig, appConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, limit, onSnapshot, getDoc, getDocs, getDocsFromServer, getFirestore, writeBatch, setDoc, updateDoc, deleteDoc, addDoc, FieldPath, terminate, clearIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_VERSION='v2-test.3';   // shown at the bottom of Home so you can tell which version a phone has

// ---------- helpers ----------
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/-/g,'').slice(0,16);
// The test version shares a web address with the live one, so its saved settings get their own prefix.
const LS_PREFIX='v2test-';
const ls={get(k,d){try{const v=localStorage.getItem(LS_PREFIX+k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem(LS_PREFIX+k,JSON.stringify(v))}catch{}}};
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
  dl:[['dlp','Disneyland Park'],['dca','California Adventure'],['dtd','Downtown Disney'],['rest','Rest / pool day'],['travel','Travel day']],
  none:[]
};
const PCOLOR={mk:'mk',ep:'ep',hs:'hs',ak:'ak',ds:'ds',wp:'wp',rest:'rest',travel:'travel',dlp:'mk',dca:'ep',dtd:'ds'};
const RESORTS={wdw:'Walt Disney World',dl:'Disneyland Resort',none:'Other trip (no parks)'};
const resortOpts=sel=>Object.entries(RESORTS).map(([k,n])=>`<option value="${k}"${k===sel?' selected':''}>${esc(n)}</option>`).join('');
const parkName=c=>{for(const r of Object.values(PARKS))for(const[k,n]of r)if(k===c)return n;return''};
const parkOpts=(sel,blank='No park yet')=>`<option value="">${blank}</option>`+PARKS[resort()].map(([k,n])=>`<option value="${k}"${k===sel?' selected':''}>${esc(n)}</option>`).join('');
const KINDS_DISNEY=['Ride','Lightning Lane','Dining','Show','Character meet','Break','Travel','Other'];
const KINDS_OTHER=['Sightseeing','Dining','Tour','Show','Break','Travel','Other'];
const kinds=()=>isDisney()?KINDS_DISNEY:KINDS_OTHER;
const MCOL=['var(--p-mk)','var(--p-ds)','var(--p-ak)','var(--p-ep)','var(--p-hs)','var(--spark)','var(--p-wp)'];
// Popular attractions with posted minimum heights in inches (0 = any height). Heights change; confirm in the park app.
const SUGGEST={
  wdw:[['Seven Dwarfs Mine Train','mk',38],['Space Mountain','mk',44],['TRON Lightcycle / Run','mk',48],['Big Thunder Mountain Railroad','mk',40],["Tiana's Bayou Adventure",'mk',40],["Peter Pan's Flight",'mk',0],['Haunted Mansion','mk',0],['Pirates of the Caribbean','mk',0],['Jungle Cruise','mk',0],['Happily Ever After fireworks','mk',0],
    ['Guardians of the Galaxy: Cosmic Rewind','ep',42],['Test Track','ep',40],['Frozen Ever After','ep',0],["Remy's Ratatouille Adventure",'ep',0],["Soarin' Around the World",'ep',40],
    ['Star Wars: Rise of the Resistance','hs',40],['Millennium Falcon: Smugglers Run','hs',38],['Slinky Dog Dash','hs',38],['The Twilight Zone Tower of Terror','hs',40],["Mickey & Minnie's Runaway Railway",'hs',0],['Toy Story Mania!','hs',0],
    ['Avatar Flight of Passage','ak',44],['Expedition Everest','ak',44],['Kilimanjaro Safaris','ak',0],["Na'vi River Journey",'ak',0],['Kali River Rapids','ak',38]],
  dl:[['Matterhorn Bobsleds','dlp',42],['Indiana Jones Adventure','dlp',46],['Space Mountain','dlp',40],['Star Wars: Rise of the Resistance','dlp',40],['Big Thunder Mountain Railroad','dlp',40],["Peter Pan's Flight",'dlp',0],['Haunted Mansion','dlp',0],
    ['Radiator Springs Racers','dca',40],['Guardians of the Galaxy – Mission: BREAKOUT!','dca',40],['Incredicoaster','dca',48],['Toy Story Midway Mania!','dca',0],["Soarin' Around the World",'dca',40]],
  none:[]
};

// ---------- state ----------
const COLLS=['plans','wishes','tasks','packing'];
const S={trip:null,plans:[],wishes:[],tasks:[],packing:[],mode:'loading',stale:false};
const resort=()=>S.trip?.resort==='dl'||S.trip?.resort==='none'?S.trip.resort:'wdw';
const isDisney=()=>resort()!=='none';
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
// ---------- accounts ----------
// Everyone signs in with their own email. A new account stays "pending" until the admin approves it,
// and firestore.rules lets a pending account read or write nothing. A trip lists the emails that can open it.
const ME={user:null,email:'',profile:null,admin:false};
const D={trips:[],fams:[],users:[]};            // dashboard data: my trips, my saved families, accounts (admin only)
const normEmail=s=>String(s||'').trim().toLowerCase();
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const myEmail=()=>ME.email;
const myName=()=>String(ME.profile?.name||ME.user?.displayName||ME.email.split('@')[0]||'Me').slice(0,40);
const tripId=()=>{const k=new URLSearchParams(location.search).get('trip');return k&&/^[A-Za-z0-9]{10,40}$/.test(k)?k:null};
const shareUrl=()=>{const u=new URL(location.href);u.hash='';u.search='?trip='+tripId();return u.toString()};
const members=()=>Array.isArray(S.trip?.members)?S.trip.members:[];
const isOwner=()=>!!S.trip&&S.trip.owner===myEmail();
const meInParty=()=>party().find(m=>m.email&&normEmail(m.email)===myEmail());
// Screens that aren't a trip: sign-in steps, the dashboard and approvals.
const GATES=['config','boot','signin','signup','reset','verify','pending','denied','dash','noaccess'];
const gated=()=>GATES.includes(S.mode);

// ---------- shared store (Firestore) ----------
let store=null;
function flatArgs(d){const out=[];const walk=(o,p)=>{for(const k in o){const v=o[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length)walk(v,[...p,k]);else out.push(new FieldPath(...p,k),v)}};walk(d,[]);return out}
function firestoreStore(db,id){
  const base=['trips',id], trip=doc(db,...base), col=c=>collection(db,...base,c);
  const pend={};
  return{
    watch(){
      const waiting=new Set(['trip',...COLLS]);
      const settle=(k,snap)=>{pend[k]=snap.metadata.hasPendingWrites;S.saving=Object.values(pend).some(Boolean);if(!snap.metadata.fromCache)waiting.delete(k);if(!waiting.size){clearTimeout(timer);S.stale=false}if(S.mode==='loading'&&(!waiting.size||(S.cacheOk&&k==='trip'&&snap.exists())))S.mode='shared';render()};
      const timer=setTimeout(()=>{if(waiting.size){S.stale=true;if(S.mode==='loading')S.mode='shared';render()}},10000);
      // Not on this trip (or it was deleted): the server refuses, so show "not available".
      const fail=e=>{clearTimeout(timer);console.warn(e);if(e?.code==='permission-denied'){S.trip=null;S.mode='noaccess';render();return}S.stale=true;if(S.mode==='loading')S.mode='shared';render()};
      onSnapshot(trip,{includeMetadataChanges:true},s=>{S.trip=s.exists()?{...s.data(),id:s.id}:null;settle('trip',s);if(!s.exists()&&!s.metadata.fromCache){S.mode='noaccess';render()}},fail);
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
function quick(p){p.catch(e=>{console.warn(e);toast(e?.code==='permission-denied'?'That change was refused. You may no longer have access.':'That change didn’t save. It will retry when you’re back online.')});return Promise.resolve()}
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
  if(!f||!validDate(f.arrive)||!isDisney())return[];
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
  const gate=gated(), t=gate?null:S.trip;
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
  const admin=S.mode==='dash'&&location.hash==='#admin'&&ME.admin;
  const gh=admin?['Approvals','Only you can see this page.']:S.mode==='dash'?['My trips',`Signed in as ${myEmail()}`]:['Trip planner','Every trip, every family, one place.'];
  const flag=appConfig?.testBanner?'<div class="testflag">Test version · not the live trip</div>':'';
  const crumbs=t||(tripId()&&S.mode==='loading')?`<div class="crumbs"><a href="./" class="linkbtn">‹ My trips</a>${t?`<span class="tripnm">${esc(t.name||'')}</span>`:''}</div>`:'';
  $('#head').innerHTML=`${flag}${crumbs}${t?viewingBar():''}<div class="toprow"><div class="tt">
      <h1 class="trip-name">${t?esc(viewTitle()):esc(gh[0])}</h1>
      <div class="trip-sub">${t?esc(dates)+(pill?`${dates?' · ':''}<span class="sync ${pill[0]}"><i></i>${pill[1]}</span>`:''):esc(gh[1])}</div>
    </div>${count}</div>`;
  const tab=currentTab();
  $('#tabs').innerHTML=S.trip?TABS.map(([k,n,ic])=>`<a href="#${k}"${k===tab?' aria-current="page"':''}>${ICON(ic)}<span>${n}</span></a>`).join(''):'';
  $('nav.tabs').hidden=!S.trip||gate;
}

// ---------- "Viewing" selector at the very top: Group / each family ----------
// Each view has its own palette, so it's obvious at a glance whose plans you're looking at.
const FAM_PALETTES=['fireworks','monorail'];
const paletteFor=s=>{if(s==='group')return'mainstreet';const i=families().findIndex(f=>f.id===s);return i<0?'mainstreet':FAM_PALETTES[i%FAM_PALETTES.length]};
function applyPalette(){
  const gate=gated()||!S.trip;
  const pal=gate?'mainstreet':paletteFor(curScope());
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
    ${meInParty()&&ms.some(m=>m.id===meInParty().id)&&!(sel.length===1&&sel[0]===meInParty().id)?'<button type="button" class="chip-btn every" aria-pressed="false" data-act="justme">Just me</button>':''}
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
  if(!isDisney())return'';
  const fs=scopeFams(), many=fs.length>1;
  const out=fs.map(f=>parkChip(famPark(f.id,d),many?shortName(f.name):'')).filter(Boolean).join('');
  return out||'<span class="chip">No park yet</span>';
}

// ---------- calendar export ----------
// Times are park-local, so events carry the resort's time zone. Re-adding an event updates it (same UID).
// Other trips use "floating" local times: 7 PM stays 7 PM wherever the phone is.
const TZ=()=>resort()==='dl'?'America/Los_Angeles':resort()==='wdw'?'America/New_York':'';
const DUR={Sightseeing:120,Tour:120,Dining:90,Show:45,Travel:120,Break:120,'Character meet':30,'Lightning Lane':30,Ride:30,Other:60};
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
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Family Trip Planner//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const p of plans){
    const t=evTimes(p), place=evPlace(p);
    L.push('BEGIN:VEVENT',`UID:${p.id}@family-trip`,`DTSTAMP:${now}`,
      t.allDay?`DTSTART;VALUE=DATE:${t.start}`:TZ()?`DTSTART;TZID=${TZ()}:${t.start}`:`DTSTART:${t.start}`,
      t.allDay?`DTEND;VALUE=DATE:${t.end}`:TZ()?`DTEND;TZID=${TZ()}:${t.end}`:`DTEND:${t.end}`,
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
  if(!t.allDay&&TZ())q.set('ctz',TZ());
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
const authErr=()=>S.authErr?`<div class="chip bad" role="alert" style="white-space:normal">${esc(S.authErr)}</div>`:'';
const busyBtn=(label,busyLabel)=>`<button class="btn" type="submit"${S.busy?' disabled':''}>${S.busy?busyLabel:label}</button>`;
const adminName=()=>esc(appConfig?.adminName||'the organizer');
function setupView(){
  const m=S.mode;
  if(m==='config')return`<div class="panel welcome"><h2>Finish connecting the database</h2>
    <p class="muted">This copy of the planner doesn’t have its Firebase settings yet, so it can’t save anything.</p>
    <p class="fine">The README walks through each step.</p></div>`;
  if(m==='boot')return`<div class="panel setup"><p class="muted">Signing you in…</p>${authErr()}</div>`;
  if(m==='signin')return`<div class="panel welcome"><h2>Sign in</h2>
    <form class="form" data-form="signin">
      <label class="field wide"><span>Email</span><input type="email" id="a-email" data-keep autocomplete="username" required></label>
      <label class="field wide"><span>Password</span><input type="password" id="a-pw" autocomplete="current-password" required></label>
      <div class="wide">${busyBtn('Sign in','Signing in…')}</div></form>${authErr()}
    <div class="authlinks"><button type="button" class="linkbtn" data-act="go" data-who="signup">Create an account</button><button type="button" class="linkbtn" data-act="go" data-who="reset">Forgot password?</button></div></div>`;
  if(m==='signup')return`<div class="panel welcome"><h2>Create your account</h2>
    <p class="muted small">Use your own email. ${adminName()} approves every new account before it can see any trip.</p>
    <form class="form" data-form="signup">
      <label class="field wide"><span>Your name</span><input type="text" id="a-name" data-keep autocomplete="name" maxlength="40" required></label>
      <label class="field wide"><span>Email</span><input type="email" id="a-email" data-keep autocomplete="username" required></label>
      <label class="field wide"><span>Password (at least 8 characters)</span><input type="password" id="a-pw" autocomplete="new-password" minlength="8" required></label>
      <div class="wide">${busyBtn('Create account','Creating…')}</div></form>${authErr()}
    <div class="authlinks"><button type="button" class="linkbtn" data-act="go" data-who="signin">I already have an account</button></div></div>`;
  if(m==='reset')return`<div class="panel welcome"><h2>Reset your password</h2>
    <p class="muted small">We’ll email you a link to choose a new password.</p>
    <form class="form inline" data-form="reset"><input type="email" id="a-email" data-keep autocomplete="username" aria-label="Email" placeholder="Email" required>${busyBtn('Send link','Sending…')}</form>${authErr()}
    <div class="authlinks"><button type="button" class="linkbtn" data-act="go" data-who="signin">Back to sign in</button></div></div>`;
  if(m==='verify')return`<div class="panel welcome"><h2>Check your email</h2>
    <p class="muted">We sent a link to <b>${esc(myEmail())}</b>. Tap it to confirm the address is yours, then come back here.</p>
    <div class="authlinks"><button class="btn" type="button" data-act="verified"${S.busy?' disabled':''}>I tapped the link</button><button class="btn ghost" type="button" data-act="resend">Send it again</button></div>
    <p class="fine">Not there? Check spam. <button type="button" class="linkbtn" data-act="signout">Use a different email</button></p></div>`;
  if(m==='pending'){
    const ph=String(appConfig?.adminPhone||'').replace(/[^\d+]/g,''), body=`Hi! I just made an account on the trip planner: ${myName()} (${myEmail()}). Can you approve it?`;
    return`<div class="panel welcome"><h2>Waiting for approval</h2>
      <p class="muted">Thanks, ${esc(myName())}. ${adminName()} needs to approve <b>${esc(myEmail())}</b> before you can see any trips. This page opens up by itself once that happens.</p>
      ${ph?`<div><a class="btn" href="sms:${esc(ph)}?&amp;body=${encodeURIComponent(body)}">Let ${adminName()} know</a></div>`:''}
      <p class="fine"><button type="button" class="linkbtn" data-act="signout">Sign out</button></p></div>`;
  }
  if(m==='denied')return`<div class="panel welcome"><h2>This account isn’t approved</h2>
    <p class="muted">${esc(myEmail())} can’t open any trips. If you think that’s a mistake, ask ${adminName()}.</p>
    <p class="fine"><button type="button" class="linkbtn" data-act="signout">Sign out</button></p></div>`;
  if(m==='noaccess')return`<div class="panel welcome"><h2>This trip isn’t available</h2>
    <p class="muted">Either you haven’t been added to it, or it was deleted. Ask whoever planned it to add <b>${esc(myEmail())}</b>.</p>
    <div><a class="btn" href="./">Go to my trips</a></div></div>`;
  if(m==='dash')return location.hash==='#admin'&&ME.admin?adminView():dashboardView();
  if(m==='loading')return`<div class="panel setup"><p class="muted">Loading your trip…</p></div>`;
  if(S.stale)return`<div class="panel setup"><h2>Can’t reach the trip yet</h2><p class="muted">The plan will appear here as soon as the connection comes back.</p></div>`;
  return`<div class="panel setup"><p class="muted">This trip has no details yet.</p><div><a class="btn" href="./">Go to my trips</a></div></div>`;
}

// ---------- dashboard: my trips and my families ----------
// A trip's dates run from the earliest family arrival to the latest departure.
function tripSpan(t){
  const fs=Array.isArray(t.families)?t.families:[];
  const ds=fs.flatMap((f,i)=>i===0||f.datesSet?[f.arrive,f.depart]:[]).filter(validDate).sort();
  return ds.length?[ds[0],ds[ds.length-1]]:null;
}
function tripCard(t){
  const r=tripSpan(t), fs=(t.families||[]).map(f=>f.name).filter(Boolean);
  const when=r?`${fmtD(r[0],{month:'short',day:'numeric'})} – ${fmtD(r[1],{month:'short',day:'numeric',year:'numeric'})}`:'Dates not set';
  const n=r?diff(today(),r[0]):null, soon=r&&n>0?`<span class="chip">${plural(n,'day')} to go</span>`:r&&today()<=r[1]&&n<=0?'<span class="chip good">Happening now</span>':'';
  return`<a class="tripcard" href="?trip=${esc(t.id)}"><span class="tcname">${esc(t.name||'Untitled trip')}</span>
    <span class="small muted">${esc(when)} · ${esc(RESORTS[t.resort]||RESORTS.wdw)}</span>
    ${fs.length?`<span class="small">${esc(listJoin(fs))}</span>`:''}
    <span class="chips">${soon}${t.owner&&t.owner!==myEmail()?`<span class="chip">Shared by ${esc(t.owner)}</span>`:''}</span></a>`;
}
const fgPeople=F=>Array.isArray(F.people)?F.people:[];
const fgEditors=people=>[...new Set([myEmail(),...people.map(p=>normEmail(p.email)).filter(e=>EMAIL_RE.test(e))])];
function newTripForm(){
  const meIn=D.fams.some(F=>fgPeople(F).some(p=>normEmail(p.email)===myEmail()));
  const pick=F=>{const ps=fgPeople(F);return ps.length?`<fieldset class="wide whopick"><legend>${esc(F.name)} <button type="button" class="linkbtn" data-act="ntall" data-id="${esc(F.id)}">Everyone</button></legend>
    ${ps.map(p=>`<label class="check"><input type="checkbox" id="nt-${esc(F.id)}-${esc(p.id)}" data-keep data-nt="${esc(F.id)}|${esc(p.id)}"${normEmail(p.email)===myEmail()?' checked':''}>${esc(p.name)}</label>`).join('')}</fieldset>`:''};
  return`<details class="addbox" id="newtrip"${openAttr('newtrip',!D.trips.length)}><summary class="btn">+ New trip</summary>
    <form class="form" data-form="newtrip">
      <label class="field wide"><span>Trip name</span><input type="text" id="nt-name" data-keep maxlength="60" placeholder="London 2027" required></label>
      <label class="field wide"><span>Type</span><select id="nt-type" data-keep>${resortOpts('none')}</select></label>
      <label class="field"><span>Arrive</span><input type="date" id="nt-start" data-keep></label>
      <label class="field"><span>Leave</span><input type="date" id="nt-end" data-keep></label>
      ${D.fams.length?`<div class="wide small muted">Who’s going? Only the people you tick can see this trip. People without an email are just names on the plan.</div>${D.fams.map(pick).join('')}`
        :'<div class="wide small muted">Just you for now. Save your family under “My families” to add them in one tap.</div>'}
      ${meIn?'':`<div class="wide fine">You’re added automatically, as ${esc(myName())}.</div>`}
      <div class="wide">${busyBtn('Create trip','Creating…')}</div>
    </form></details>`;
}
function famGroupCard(F){
  const ps=fgPeople(F), id=esc(F.id);
  return`<div class="famcard"><div class="famhead"><h3>${esc(F.name)}</h3><span class="small muted">${ps.length?plural(ps.length,'person'):'No one yet'}</span></div>
    <div class="list">${ps.map(p=>`<div class="row"><div class="body"><div class="title">${esc(p.name)}</div><div class="small muted">${p.email?esc(p.email):'No login (just a name)'}</div></div>${delBtn('fgpdel',`${id}|${esc(p.id)}`,'',p.name)}</div>`).join('')}</div>
    <details id="fgadd-${id}"${openAttr('fgadd-'+F.id,!ps.length)}><summary class="small">+ Add a person</summary>
      <form class="form" data-form="fgperson" data-fam="${id}" style="margin-top:8px">
        <label class="field"><span>Name</span><input type="text" id="fg-name-${id}" data-keep maxlength="40" required></label>
        <label class="field"><span>Email (optional)</span><input type="email" id="fg-email-${id}" data-keep placeholder="For their own login"></label>
        <div class="wide"><button class="btn" type="submit">Add</button></div></form></details>
    <details id="fgedit-${id}"${openAttr('fgedit-'+F.id,false)}><summary class="small">Rename or delete</summary>
      <form class="form inline" data-form="fgrename" data-fam="${id}" style="margin-top:8px"><input type="text" id="fg-rn-${id}" data-keep value="${esc(F.name)}" aria-label="Family name" maxlength="60" required><button class="btn" type="submit">Save</button></form>
      <div style="margin-top:8px">${delBtn('fgdel',id,'',F.name).replace('class="x"','class="x wide"').replace('>×<','>Delete this family<')}</div>
      <p class="fine">Deleting a saved family doesn’t change any trip.</p></details>
  </div>`;
}
function dashboardView(){
  const sorted=[...D.trips].sort((a,b)=>{const x=tripSpan(a),y=tripSpan(b);return(x?x[0]:'9')<(y?y[0]:'9')?-1:1});
  const done=t=>{const r=tripSpan(t);return r&&r[1]<today()};
  const upcoming=sorted.filter(t=>!done(t)), past=sorted.filter(done).reverse();
  const pend=D.users.filter(u=>u.status==='pending').length;
  return`<div class="grid">
    ${ME.admin?`<a class="panel span2 approvals" href="#admin"><b>Approvals</b>${pend?`<span class="badge">${pend} waiting</span>`:'<span class="small muted">No one waiting</span>'}</a>`:''}
    <section class="panel span2"><div class="panel-head"><h2>Trips</h2><span class="fine">Only trips you’re on</span></div>
      <div class="tripcards">${upcoming.map(tripCard).join('')||'<div class="empty">No upcoming trips yet.</div>'}</div>
      ${past.length?`<details id="pasttrips"${openAttr('pasttrips',false)}><summary class="small">Past trips (${past.length})</summary><div class="tripcards" style="margin-top:8px">${past.map(tripCard).join('')}</div></details>`:''}
      ${newTripForm()}${importForm()}</section>
    <section class="panel span2"><div class="panel-head"><h2>My families</h2><span class="fine">Saved groups for adding people to trips</span></div>
      <div class="famgrid">${D.fams.map(famGroupCard).join('')}</div>
      <details id="fgnew"${openAttr('fgnew',!D.fams.length)}><summary class="small">+ New family</summary>
        <form class="form inline" data-form="fgnew" style="margin-top:8px"><input type="text" id="fg-new" data-keep placeholder="Becker Family" aria-label="Family name" maxlength="60" required><button class="btn" type="submit">Create</button></form>
        <p class="fine">Anyone in a family with an email can see and edit that family’s list. You’re added to new families automatically.</p></details></section>
    <section class="panel span2"><div class="panel-head"><h2>Account</h2></div>
      <div class="small">${esc(myName())} · ${esc(myEmail())}</div>
      <div><button class="btn ghost small" data-act="signout">Sign out</button></div>
      <div class="fine">App version ${APP_VERSION}</div></section></div>`;
}

// Builds the new trip from the ticked people. Their saved families become the trip's families,
// and everyone with an email (plus you) can open it.
async function createTrip(f){
  const name=val('nt-name').slice(0,60), type=RESORTS[val('nt-type')]?val('nt-type'):'none', a=val('nt-start'), z=val('nt-end')||a;
  if(!name){toast('Give the trip a name.');return}
  if(validDate(a)&&z<a){toast('The leave date is before the arrival date.');return}
  if(!navigator.onLine){toast('Connect to the internet to create a trip.');return}
  const picks=[...f.querySelectorAll('[data-nt]')].filter(c=>c.checked).map(c=>c.dataset.nt.split('|'));
  const fl=[], ppl=[];
  for(const[fid,pid]of picks){
    const F=D.fams.find(x=>x.id===fid), p=F&&fgPeople(F).find(x=>x.id===pid);
    if(!p||ppl.some(x=>x.id===p.id))continue;
    if(!fl.some(x=>x.id===F.id))fl.push({id:F.id,name:F.name});
    ppl.push({id:p.id,name:p.name,height:null,family:F.id,...(p.email?{email:normEmail(p.email)}:{})});
  }
  // You're on the plan unless you're in a saved family and unticked yourself (planning for others).
  const meIn=D.fams.some(F=>fgPeople(F).some(p=>normEmail(p.email)===myEmail()));
  if(!ppl.length||(!meIn&&!ppl.some(p=>p.email===myEmail()))){const sid=uid();fl.push({id:sid,name:myName()});ppl.push({id:uid(),name:myName(),height:null,family:sid,email:myEmail()})}
  const dated=validDate(a);
  const trip={name,resort:type,
    families:fl.map(x=>({...x,hotel:'',arrive:dated?a:'',depart:dated?z:'',onsite:false,datesSet:dated})),
    party:ppl,members:[...new Set([myEmail(),...ppl.map(p=>p.email).filter(Boolean)])],owner:myEmail(),created:new Date().toISOString()};
  const ref=doc(collection(db,'trips'));
  S.busy=true;render();
  try{await setDoc(ref,trip);location.href='?trip='+ref.id}
  catch(e){console.warn(e);S.busy=false;render();toast('Couldn’t create the trip. Try again.')}
}
// ---------- copy a trip from the old planner (link + trip password) ----------
// Reads the old trip with its own password, read-only, and saves a copy here that only you can open.
// The old trip is never changed. Add people afterwards under "Who can open this trip".
const LEGACY_FIELDS=['name','resort','hotel','start','end','onsite','party','dayParks','dayHotels','families','famParks','famHotels'];
function legacyKey(s){
  const t=String(s||'').trim(), m=t.match(/[?&]t=([a-z0-9]{24,64})\b/);
  const k=m?m[1]:t;return /^[a-z0-9]{24,64}$/.test(k)?k:null;
}
function importedTrip(meta,key){
  const out={};
  for(const k of LEGACY_FIELDS)if(meta&&meta[k]!==undefined)out[k]=meta[k];
  out.name=String(out.name||'Imported trip').slice(0,60);
  if(!['wdw','dl','none'].includes(out.resort))out.resort='wdw';
  return{...out,members:[myEmail()],owner:myEmail(),created:new Date().toISOString()};
}
const importForm=()=>appConfig?.legacyConfig?`<details id="importtrip"${openAttr('importtrip',false)}><summary class="small">Copy a trip from the old planner</summary>
  <form class="form" data-form="import" style="margin-top:8px">
    <label class="field wide"><span>Old trip link</span><input type="url" id="im-link" data-keep placeholder="https://jbecker1961.github.io/family-trip/?t=…" required></label>
    <label class="field wide"><span>That trip’s password</span><input type="password" id="im-pw" autocomplete="off" required></label>
    <div class="wide">${busyBtn('Copy trip','Copying…')}</div>
    <div class="wide fine">Makes a copy here that only you can open. The old trip isn’t changed. Then add people under “Who can open this trip”.</div>
  </form></details>`:'';
let legacy=null;
async function importTrip(link,pw){
  const key=legacyKey(link);
  if(!key){toast('That doesn’t look like a trip link from the old planner.');return}
  if(!navigator.onLine){toast('Connect to the internet to copy a trip.');return}
  S.busy=true;render();
  try{
    if(!legacy){const la=initializeApp(appConfig.legacyConfig,'legacy');legacy={auth:initializeAuth(la,{persistence:inMemoryPersistence}),db:getFirestore(la)}}
    await signInWithEmailAndPassword(legacy.auth,`${key}@trips.example.com`,pw);
    const meta=await getDoc(doc(legacy.db,'trips',key,'meta','info'));
    if(!meta.exists())throw{code:'empty'};
    const lists={};for(const c of COLLS)lists[c]=(await getDocs(collection(legacy.db,'trips',key,c))).docs.map(d=>[d.id,d.data()]);
    await signOut(legacy.auth);
    // The trip has to exist before its plans can be saved (the rules check you're on it).
    const ref=doc(collection(db,'trips'));
    await setDoc(ref,importedTrip(meta.data(),key));
    const all=COLLS.flatMap(c=>lists[c].map(([id,d])=>[c,id,d]));
    for(let i=0;i<all.length;i+=400){const b=writeBatch(db);all.slice(i,i+400).forEach(([c,id,d])=>b.set(doc(db,'trips',ref.id,c,id),d));await b.commit()}
    toast(`Copied ${plural(all.length,'item')}.`);location.href='?trip='+ref.id;
  }catch(e){
    console.warn(e);S.busy=false;
    const c=e?.code||'';
    toast(c==='empty'?'That trip has no details yet.':/credential|password|user-not-found/.test(c)?'That password isn’t right for that trip.':c==='auth/too-many-requests'?'Too many tries. Wait a few minutes.':'Couldn’t copy the trip. Try again.');
    try{legacy&&await signOut(legacy.auth)}catch{}
    render();
  }
}
// ---------- approvals (admin only; the rules enforce it, this page just hides itself from others) ----------
function adminView(){
  const order={pending:0,approved:1,denied:2};
  const us=[...D.users].sort((a,b)=>(order[a.status]??3)-(order[b.status]??3)||String(b.created||'').localeCompare(String(a.created||'')));
  const chip={pending:'<span class="chip warn">Waiting</span>',approved:'<span class="chip good">Approved</span>',denied:'<span class="chip bad">Denied</span>'};
  return`<div class="grid"><section class="panel span2"><div class="panel-head"><h2>Accounts</h2><a href="#" class="link">‹ My trips</a></div>
    <p class="small muted" style="margin:0">New accounts can’t see anything until you approve them. Denying or removing access takes effect right away.</p>
    <div class="list">${us.map(u=>`<div class="row"><div class="body"><div class="title">${esc(u.name||'(no name)')}</div>
      <div class="small muted">${esc(u.email||'')}${u.created?' · signed up '+esc(fmtD(String(u.created).slice(0,10),{month:'short',day:'numeric'})):''}</div>
      <div class="meta">${chip[u.status]||''}</div>
      <div class="row-actions">${u.email===myEmail()?'<span class="fine">That’s you</span>'
        :u.status==='approved'?`<button class="x wide" type="button" data-act="deny" data-id="${esc(u.id)}">Remove access</button>`
        :`<button class="btn small" type="button" data-act="approve" data-id="${esc(u.id)}">Approve</button>${u.status==='pending'?`<button class="btn ghost small" type="button" data-act="denynow" data-id="${esc(u.id)}">Deny</button>`:''}`}</div>
      </div></div>`).join('')||'<div class="empty">No accounts yet.</div>'}</div>
    <p class="fine">To delete a login completely, use the Firebase console: Authentication &gt; Users.</p></section></div>`;
}

// ---------- who can open this trip ----------
function accessPanel(){
  const ms=members(), own=isOwner(), byEmail=e=>party().find(p=>p.email&&normEmail(p.email)===e);
  const noEmail=party().filter(p=>!p.email);
  const imp=D.fams.filter(F=>fgPeople(F).some(p=>!party().some(x=>x.id===p.id)));
  return`<section class="panel"><div class="panel-head"><h2>Who can open this trip</h2><span class="fine">${plural(ms.length,'person')}</span></div>
    <div class="list">${ms.map(e=>{const p=byEmail(e);return`<div class="row"><div class="body"><div class="title">${esc(p?.name||e)}</div>
      <div class="small muted">${p?esc(e)+' · ':''}${e===S.trip.owner?'Planner':'Can view and edit'}${e===myEmail()?' · you':''}</div></div>
      ${own&&e!==S.trip.owner?delBtn('memdel',esc(e),'',p?.name||e):''}</div>`}).join('')}</div>
    <details id="memadd"${openAttr('memadd',false)}><summary class="small">+ Add someone by email</summary>
      <form class="form" data-form="memadd" style="margin-top:8px">
        <label class="field wide"><span>Their email</span><input type="email" id="ma-email" data-keep required></label>
        <label class="field wide"><span>On the plan as</span><select id="ma-as" data-keep>
          <option value="">Not on the plan (can still view and edit)</option>
          ${noEmail.map(p=>`<option value="p:${esc(p.id)}">${esc(p.name)} (${esc(shortName(fam(famOf(p))?.name||''))})</option>`).join('')}
          ${families().map(f=>`<option value="f:${esc(f.id)}">New person in ${esc(f.name)}</option>`).join('')}</select></label>
        <label class="field wide"><span>Name (for a new person)</span><input type="text" id="ma-name" data-keep maxlength="40"></label>
        <div class="wide"><button class="btn" type="submit">Add</button></div>
        <div class="wide fine">They’ll see this trip after they sign in with that email (once approved).</div></form></details>
    ${imp.length?`<form class="form inline" data-form="famimport"><select id="fi-fam" data-keep aria-label="Saved family">${imp.map(F=>`<option value="${esc(F.id)}">${esc(F.name)}</option>`).join('')}</select><button class="btn ghost" type="submit">Add saved family</button></form>`:''}
    ${own?'':'<p class="fine">Only the planner can remove people.</p>'}
    <div class="sharebox"><input type="text" id="share-url" readonly value="${esc(shareUrl())}" aria-label="Trip link"><button class="btn small" data-act="copylink">Copy link</button></div>
    <div><button class="btn ghost small" data-act="signout">Sign out</button></div>
    <div class="fine">App version ${APP_VERSION}</div>
  </section>`;
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
    ${isDisney()?`<div class="label">Parks</div>
    ${parks.length?`<div class="chips">${parks.map(([d,c])=>parkChip(c,fmtD(d,{weekday:'short',month:'numeric',day:'numeric'}))).join('')}</div>`:'<div class="fine">Pick a park for each day on the Day tab.</div>'}`:''}
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
        ${isDisney()?`<label class="check wide"><input type="checkbox" id="fe-onsite-${sel}" data-keep${f.onsite?' checked':''}>Staying at a Disney-owned hotel</label>`:''}
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
  const details=`<section class="panel"><details id="trip-details"${openAttr('trip-details',false)}><summary>Trip name and type</summary>
      <form class="form" data-form="tripedit" style="margin-top:14px">
        <label class="field wide"><span>Trip name</span><input type="text" id="t-name" data-keep value="${esc(t.name)}"></label>
        <label class="field wide"><span>Type</span><select id="t-resort" data-keep>${resortOpts(resort())}</select></label>
        <div class="wide"><button class="btn" type="submit">Save</button></div>
      </form>
      ${isOwner()?`<div style="margin-top:12px">${delBtn('tripdel',S.trip.id,'',t.name).replace('class="x"','class="x wide"').replace('>×<','>Delete this trip<')}</div>`:''}</details></section>`;
  return`${scopeBar()}<div class="grid">${famsPanel}${glance}${upnext}${isDisney()?wins:''}${details}${accessPanel()}</div>`;
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
  const dayFields=f?`<div class="dayfields">${isDisney()?`<label class="field"><span>Park</span><select data-change="daypark" data-day="${d}">${parkOpts(famPark(f.id,d))}</select></label>`:''}
      ${lastDay?'':`<label class="field"><span>Hotel tonight</span><input type="text" id="dh-${f.id}-${d}" data-keep value="${esc(S.trip.famHotels?.[f.id]?.[d]||(f.id===firstFam()?S.trip.dayHotels?.[d]||'':''))}" placeholder="${esc(f.hotel||'Where you’re staying')}" data-change="dayhotel" data-day="${d}"></label>`}</div>`
    :`<div class="chips">${parkChips(d)}</div>`;
  return`${scopeBar()}<div class="strip" role="tablist" aria-label="Trip days">${days.map(x=>{const pk=f?famPark(f.id,x):'';return`<button class="daybtn" aria-current="${x===d}" data-act="selday" data-day="${x}"><span class="dw">${esc(fmtD(x,{weekday:'short'}))}</span><span class="dn">${pd(x).getDate()}</span><span class="dot" style="${pk?`background:var(--p-${PCOLOR[pk]||'rest'})`:''}"></span></button>`}).join('')}</div>
  <div class="grid" style="margin-top:12px">
    <section class="panel span2"><div class="panel-head"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><div class="label">Day ${days.indexOf(d)+1} of ${days.length}</div><h2>${esc(fmtD(d,{weekday:'long',month:'long',day:'numeric'}))}</h2>${hotelNotes(d)}</div>
      ${dayFields}</div>
      ${!f&&multiFam()?`<div class="fine">Pick a family at the top to set its ${isDisney()?'park and hotel':'hotel'} for the day.</div>`:''}
      <div class="list">${plans.map(rowFor).join('')||`<div class="empty">${hidden?'Nothing for the people selected on this day.':'Nothing planned for this day yet.'}</div>`}</div>
      ${hidden?`<div class="fine">${plural(hidden,'other plan')} on this day. <button type="button" class="linkbtn" data-act="allon">Show everyone</button></div>`:''}
      <details class="addbox" id="add-plan"${openAttr('add-plan',!all.length)}><summary class="btn">+ Add a plan</summary>
      <form class="form" data-form="plan">
        <label class="field"><span>Time</span><input type="time" id="pl-time" data-keep></label>
        <label class="field"><span>Type</span><select id="pl-kind" data-keep>${kinds().map(k=>`<option>${k}</option>`).join('')}</select></label>
        <label class="field wide"><span>What</span><input type="text" id="pl-title" data-keep list="sugg" placeholder="${isDisney()?'Dinner at Sanaa':'Dinner reservation'}" required></label>
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
  if(!isDisney())return'';
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
    <div class="panel-head"><div><h2>Must-dos</h2><p class="small muted" style="margin:2px 0 0">Shared by every family. Tap your name on what you want most; the list sorts by votes${isDisney()?' and checks heights':''}.</p></div></div>
    ${ms.length&&isDisney()?`<details id="heights"${openAttr('heights',false)}><summary>Heights for the ride check</summary>
      <div class="names" style="margin-top:12px">${ms.map(p=>`<label class="name-row"><span class="av" style="background:${mcol(p.id)}">${initial(p.name)}</span><span class="nm">${esc(p.name)}</span>
        <input type="number" inputmode="numeric" min="0" max="90" value="${esc(p.height??'')}" placeholder="inches" aria-label="${esc(p.name)}’s height in inches" data-change="pheight" data-id="${p.id}"></label>`).join('')}</div></details>`:''}
    <details class="addbox" id="add-wish"${openAttr('add-wish',!list.length)}><summary class="btn">+ Add a must-do</summary>
    <form class="form" data-form="wish">
      <label class="field wide"><span>${isDisney()?'Ride, show or meal':'Place, show or meal'}</span><input type="text" id="w-title" data-keep list="sugg" placeholder="${isDisney()?'Start typing a ride name':'Somewhere you want to go'}" required></label>
      ${isDisney()?`<label class="field"><span>Park</span><select id="w-park" data-keep>${parkOpts('','Any park')}</select></label>
      <label class="field"><span>Min height (in)</span><input type="number" id="w-h" data-keep min="0" max="60" placeholder="None"></label>`:''}
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
  const gate=gated();
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
  if(k==='signin'){signIn(normEmail(val('a-email')),$('#a-pw').value);return}
  if(k==='signup'){signUp(val('a-name').slice(0,40),normEmail(val('a-email')),$('#a-pw').value);return}
  if(k==='reset'){resetPw(normEmail(val('a-email')));return}
  if(k==='newtrip'){createTrip(f);return}
  if(k==='import'){const pw=$('#im-pw').value;importTrip(val('im-link'),pw);$('#im-pw').value='';return}
  if(k==='fgnew'){const name=val('fg-new').slice(0,60);if(!name)return;clear('fg-new');closedBoxes.add('fgnew');openBoxes.delete('fgnew');
    const people=[{id:uid(),name:myName(),email:myEmail()}];
    act(setDoc(doc(collection(db,'families')),{name,people,editors:fgEditors(people)}),`${name} created`);return}
  if(k==='fgperson'||k==='fgrename'){
    const F=D.fams.find(x=>x.id===fid);if(!F)return;
    if(k==='fgrename'){const name=val('fg-rn-'+fid).slice(0,60);if(name)act(updateDoc(doc(db,'families',fid),{name}),'Saved');return}
    const name=val('fg-name-'+fid).slice(0,40), email=normEmail(val('fg-email-'+fid));if(!name)return;
    if(email&&!EMAIL_RE.test(email)){toast('That email doesn’t look right.');return}
    if(email&&fgPeople(F).some(p=>normEmail(p.email)===email)){toast('That email is already in this family.');return}
    clear('fg-name-'+fid,'fg-email-'+fid);
    const people=[...fgPeople(F),{id:uid(),name,...(email?{email}:{})}];
    act(updateDoc(doc(db,'families',fid),{people,editors:fgEditors(people)}),`${name} added`);return}
  if(k==='memadd'){
    const email=normEmail(val('ma-email')), as=val('ma-as'), name=val('ma-name').slice(0,40);
    if(!EMAIL_RE.test(email)){toast('That email doesn’t look right.');return}
    if(party().some(p=>p.email&&normEmail(p.email)===email)&&members().includes(email)){toast('They’re already on this trip.');return}
    let ppl=party();
    if(as.startsWith('p:'))ppl=ppl.map(p=>p.id===as.slice(2)?{...p,email}:p);
    else if(as.startsWith('f:')){if(!name){toast('Add their name for the plan.');return}ppl=[...ppl,{id:uid(),name,height:null,family:as.slice(2),email}]}
    clear('ma-email','ma-name');
    act(store.updateTrip({members:[...new Set([...members(),email])],party:ppl}),`${email} can open this trip now`);return}
  if(k==='famimport'){
    const F=D.fams.find(x=>x.id===val('fi-fam'));if(!F)return;
    const fs=fam(F.id)?families():[...families(),{id:F.id,name:F.name,hotel:'',arrive:'',depart:'',onsite:false}];
    const add=fgPeople(F).filter(p=>!party().some(x=>x.id===p.id)).map(p=>({id:p.id,name:p.name,height:null,family:F.id,...(p.email?{email:normEmail(p.email)}:{})}));
    const ems=add.map(p=>p.email).filter(Boolean);
    act(store.updateTrip({families:fs,party:[...party(),...add],members:[...new Set([...members(),...ems])]}),`${F.name} added`);return}
  if(k==='tripedit')act(store.updateTrip({name:val('t-name')||'Our trip',resort:RESORTS[val('t-resort')]?val('t-resort'):'wdw'}),'Saved');
  if(k==='famedit'){
    const name=val('fe-name-'+fid), arrive=val('fe-arrive-'+fid), depart=val('fe-depart-'+fid);
    if(!name){toast('Give the family a name.');return}
    if(validDate(arrive)!==validDate(depart)){toast('Add both the arrival and the leave date.');return}
    if(validDate(arrive)&&depart<arrive){toast('The leave date is before the arrival date.');return}
    act(store.updateTrip({families:famSaveList(fid,{name:name.slice(0,40),hotel:val('fe-hotel-'+fid).slice(0,80),arrive,depart,datesSet:validDate(arrive),onsite:!!document.getElementById('fe-onsite-'+fid)?.checked})}),'Saved');
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
    clear('w-title','w-h');const wp=document.getElementById('w-park');if(wp)wp.value='';act(store.add('wishes',d));
  }
  if(k==='task'){const text=val('t-text');if(!text)return;const owner=val('t-owner');const d={text,due:val('t-due'),owner,done:false,family:newItemFam(owner)};clear('t-text','t-due');act(store.add('tasks',d))}
  if(k==='pack'){const text=val('k-text');if(!text)return;const who=val('k-who');const d={text,who,done:false,family:newItemFam(who)};clear('k-text');act(store.add('packing',d))}
});

// fill park + height when a known attraction is picked
document.addEventListener('input',e=>{
  if(e.target.id!=='w-title')return;
  const s=SUGGEST[resort()].find(x=>x[0].toLowerCase()===e.target.value.trim().toLowerCase());
  if(s&&document.getElementById('w-park')){document.getElementById('w-park').value=s[1];document.getElementById('w-h').value=s[2]||''}
});

const toggleIn=(arr,v)=>arr.includes(v)?arr.filter(x=>x!==v):[...arr,v];
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const {act:a,id,coll,who,day}=b.dataset;
  if(['del','pdel','famdel','legdel','memdel','fgdel','fgpdel','tripdel','deny'].includes(a)&&!confirmTap(b,a+id))return;
  if(a==='go'&&['signin','signup','reset'].includes(who)){S.mode=who;S.authErr='';render()}
  if(a==='verified')checkVerified();
  if(a==='resend'&&auth.currentUser)sendEmailVerification(auth.currentUser).then(()=>toast('Sent. Check your inbox.'),e=>toast(e?.code==='auth/too-many-requests'?'Too many emails. Wait a few minutes.':'Couldn’t send it. Try again.'));
  if(a==='approve')act(updateDoc(doc(db,'users',id),{status:'approved'}),'Approved');
  if(a==='deny'||a==='denynow')act(updateDoc(doc(db,'users',id),{status:'denied'}),a==='deny'?'Access removed':'Denied');
  if(a==='justme'){const m=meInParty();if(m){pick=[m.id];ls.set('trip-pick',pick);render()}}
  if(a==='ntall')document.querySelectorAll(`[data-nt^="${id}|"]`).forEach(c=>c.checked=true);
  if(a==='memdel'){if(id===S.trip.owner)return;act(store.updateTrip({members:members().filter(e=>e!==id)}),'Access removed')}
  if(a==='fgdel')act(deleteDoc(doc(db,'families',id)),'Family deleted');
  if(a==='fgpdel'){const[fid2,pid]=id.split('|'),F=D.fams.find(x=>x.id===fid2);if(F){const people=fgPeople(F).filter(p=>p.id!==pid);act(updateDoc(doc(db,'families',fid2),{people,editors:fgEditors(people)}))}}
  if(a==='tripdel'&&isOwner())deleteDoc(doc(db,'trips',S.trip.id)).then(()=>location.href='./',()=>toast('Couldn’t delete the trip. Try again.'));
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
  if(a==='copylink'){const u=shareUrl();navigator.clipboard?.writeText(u).then(()=>toast('Link copied. It only works for people on this trip.'),()=>{$('#share-url').select();toast('Press copy to copy the selected link.')})}
  if(a==='signout')signOutAll();
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
    const d=el.value;act(store.add('plans',{date:d,time:'',title:w.title,kind:isDisney()?'Ride':'Sightseeing',conf:'',notes:'',who:voters.length?voters:selected()}),`Added to ${fmtD(d)}`);
  }
});
// ---------- sign-in & boot ----------
let app=null, auth=null, db=null;
function authMessage(e){
  const c=e?.code||'';
  if(c==='auth/too-many-requests')return'Too many tries. Wait a few minutes, then try again.';
  if(c==='auth/network-request-failed')return'You’re offline. Connect to the internet and try again.';
  if(c==='auth/email-already-in-use')return'That email already has an account. Sign in instead, or reset the password.';
  if(c==='auth/weak-password')return'Use a longer password (at least 8 characters).';
  if(c==='auth/invalid-email')return'That email doesn’t look right.';
  if(c==='auth/operation-not-allowed'||c==='auth/admin-restricted-operation')return'New accounts are switched off right now. Ask the organizer.';
  if(c==='auth/invalid-credential'||c==='auth/wrong-password'||c==='auth/user-not-found'||c==='auth/invalid-login-credentials')return'That email and password don’t match.';
  return'Something went wrong. Try again.';
}
async function busy(fn){S.busy=true;S.authErr='';render();try{await fn()}catch(e){console.warn(e);S.authErr=authMessage(e)}S.busy=false;render()}
const signIn=(email,pw)=>busy(()=>signInWithEmailAndPassword(auth,email,pw));
function signUp(name,email,pw){
  if(!name){S.authErr='Add your name.';render();return}
  if(String(pw).length<8){S.authErr='Use a longer password (at least 8 characters).';render();return}
  busy(async()=>{const c=await createUserWithEmailAndPassword(auth,email,pw);await updateProfile(c.user,{displayName:name});await sendEmailVerification(c.user)});
}
// Always says the same thing, so this form can't be used to find out who has an account.
const resetPw=email=>busy(async()=>{try{await sendPasswordResetEmail(auth,email)}catch(e){if(e?.code==='auth/network-request-failed'||e?.code==='auth/too-many-requests')throw e}toast('If that email has an account, a reset link is on its way.');S.mode='signin'});
// The sign-in token only learns about a confirmed email once it's refreshed.
async function checkVerified(){
  const u=auth.currentUser;if(!u)return;
  S.busy=true;render();
  try{await u.reload();if(auth.currentUser.emailVerified){await auth.currentUser.getIdToken(true);S.busy=false;return enterApp(auth.currentUser)}toast('Not confirmed yet. Tap the link in the email first.')}
  catch(e){toast(authMessage(e))}
  S.busy=false;render();
}
// Signing out also wipes this device's offline copy, so the next person can't read it.
function signOutAll(){
  signOut(auth).then(()=>terminate(db)).then(()=>clearIndexedDbPersistence(db)).catch(e=>console.warn(e)).finally(()=>{location.href='./'});
}
// Only the admin may list accounts, so asking the server is how the app finds out (the rules decide, not the app).
async function probeAdmin(){try{await getDocsFromServer(query(collection(db,'users'),limit(1)));return true}catch{return false}}
const unsubs=[];
function watchDash(){
  unsubs.push(onSnapshot(query(collection(db,'trips'),where('members','array-contains',myEmail())),q=>{D.trips=q.docs.map(d=>({...d.data(),id:d.id}));render()},e=>console.warn(e)));
  unsubs.push(onSnapshot(query(collection(db,'families'),where('editors','array-contains',myEmail())),q=>{D.fams=q.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>String(a.name).localeCompare(b.name));render()},e=>console.warn(e)));
  if(ME.admin)unsubs.push(onSnapshot(collection(db,'users'),q=>{D.users=q.docs.map(d=>({...d.data(),id:d.id}));render()},e=>console.warn(e)));
}
let entered=false;
async function enterApp(user){
  if(entered)return;entered=true;
  S.mode='boot';render();
  ME.user=user;ME.email=normEmail(user.email);
  const ref=doc(db,'users',user.uid);
  ME.admin=await probeAdmin();
  let snap=null;
  try{snap=await getDoc(ref)}catch(e){console.warn(e)}
  if(!snap){entered=false;S.authErr='Can’t reach the server. Check your connection, then reload.';render();return}
  if(!snap.exists()){
    // First sign-in after confirming the email: create the profile. It starts out "pending".
    const prof={email:ME.email,name:String(user.displayName||ME.email.split('@')[0]).slice(0,40),status:'pending',created:new Date().toISOString()};
    try{await setDoc(ref,prof)}catch(e){console.warn(e)}
    ME.profile=prof;
  }else ME.profile=snap.data();
  if(ME.admin&&ME.profile.status!=='approved'){ME.profile.status='approved';quick(updateDoc(ref,{status:'approved'}))}
  // Approval (or removal) shows up right away: reload into the new state.
  const was=ME.profile.status;
  onSnapshot(ref,s=>{const st=s.data()?.status;if(st&&st!==was&&!ME.admin)location.reload()},e=>console.warn(e));
  if(was!=='approved'){S.mode=was==='denied'?'denied':'pending';render();return}
  watchDash();
  const id=tripId();
  if(id){S.mode='loading';store=firestoreStore(db,id);store.watch();render();return}
  S.mode='dash';render();
}
async function boot(){
  if(!firebaseConfig){S.mode='config';render();return}
  app=initializeApp(firebaseConfig);
  // Optional bot shield: only this website can talk to the database (see README, "App Check").
  if(appConfig?.appCheckKey){try{const m=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');m.initializeAppCheck(app,{provider:new m.ReCaptchaV3Provider(appConfig.appCheckKey),isTokenAutoRefreshEnabled:true})}catch(e){console.warn(e)}}
  auth=getAuth(app);
  db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
  S.cacheOk=true;S.mode='boot';render();
  addEventListener('online',render);addEventListener('offline',render);
  onAuthStateChanged(auth,async user=>{
    if(!user){if(entered)return location.reload();if(!['signup','reset'].includes(S.mode))S.mode='signin';render();return}
    ME.user=user;ME.email=normEmail(user.email);
    if(!user.emailVerified){try{await user.reload()}catch{}if(auth.currentUser?.emailVerified)await auth.currentUser.getIdToken(true).catch(()=>{})}
    if(!auth.currentUser?.emailVerified){S.mode='verify';S.busy=false;render();return}
    enterApp(auth.currentUser);
  });
}
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
boot();

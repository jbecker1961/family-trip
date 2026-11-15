// ---------- v2 scenario ----------
var fails=[];
function check(name,cond,detail){out((cond?'PASS ':'FAIL ')+name+(cond||!detail?'':'  -> '+detail));if(!cond)fails.push(name)}
function html(){render();return __els['#view'].innerHTML}
function head(){return __els['#head'].innerHTML}
function has(h,s){return h.indexOf(s)>=0}
function fire(type,ev){(__h[type]||[]).forEach(function(f){f(ev)})}
function submit(form,dataset,vals,checks){__vals=vals||{};var f={dataset:Object.assign({form:form},dataset||{}),closest:function(){return f},querySelectorAll:function(){return checks||[]}};fire('submit',{target:f,preventDefault:function(){}})}
function click(dataset){var b={dataset:dataset,classList:{add:function(){},remove:function(){}},textContent:''};fire('click',{target:{closest:function(){return b}}})}
db={};auth={currentUser:null};

// ---------- sign-in screens ----------
['config','boot','signin','signup','reset','verify','pending','denied','noaccess'].forEach(function(m){S.mode=m;S.trip=null;var h=html();check('screen '+m+' renders',h.length>60,h.slice(0,80))});
S.mode='signup';check('sign-up says the admin approves',has(html(),'Jason approves every new account'));
ME.email='maria@example.com';ME.profile={name:'Maria',status:'pending'};S.mode='pending';var hp=html();
check('pending screen names the email',has(hp,'maria@example.com')&&has(hp,'Waiting for approval'));
check('pending screen has text-Jason button',has(hp,'href="sms:+15551234567?&amp;body=')&&has(hp,'Let Jason know'));
check('test banner shows',(renderHeader(),has(head(),'Test version')));
check('no tabs on sign-in screens',__els['nav.tabs'].hidden===true);
S.mode='signup';S.authErr='';var errs=0;
signUp('Maria','maria@example.com','short');check('short password refused before calling Firebase',has(S.authErr,'at least 8'));
signUp('','maria@example.com','longenough');check('name required',has(S.authErr,'Add your name'));

// ---------- dashboard ----------
var ME_E='jason@example.com';
ME.email=ME_E;ME.profile={name:'Jason',status:'approved'};ME.admin=false;S.mode='dash';S.trip=null;location.hash='';
D.fams=[
  {id:'famB',name:'Becker Family',editors:[ME_E,'jess@example.com','zemi@example.com'],people:[{id:'pj',name:'Jason',email:ME_E},{id:'pjs',name:'Jess',email:'jess@example.com'},{id:'pe',name:'Ella'},{id:'pz',name:'Zemi',email:'zemi@example.com'}]},
  {id:'famL',name:'Logothetis Family',editors:[ME_E,'maria@example.com'],people:[{id:'pm',name:'Maria',email:'maria@example.com'},{id:'pa',name:'Alex',email:'alex@example.com'}]}];
D.trips=[
  {id:'tripNL',name:'Netherlands',resort:'none',owner:ME_E,members:[ME_E],families:[{id:'solo',name:'Jason',arrive:'2027-06-01',depart:'2027-06-05',datesSet:true}],party:[{id:'x',name:'Jason',family:'solo',email:ME_E}]},
  {id:'tripLON',name:'London',resort:'none',owner:'jess@example.com',members:[ME_E,'jess@example.com'],families:[{id:'famB',name:'Becker Family',arrive:'2027-03-01',depart:'2027-03-06'}]},
  {id:'tripOld',name:'Old trip',resort:'wdw',owner:ME_E,members:[ME_E],families:[{id:'famB',name:'Becker Family',arrive:'2020-01-01',depart:'2020-01-03'}]}];
var hd=html();
check('dashboard lists upcoming trips',has(hd,'href="?trip=tripNL"')&&has(hd,'href="?trip=tripLON"'));
check('upcoming trips sorted by date (London first)',hd.indexOf('tripLON')<hd.indexOf('tripNL'));
check('past trips tucked away',has(hd,'Past trips (1)'));
check('shared-by shows on a trip someone else planned',has(hd,'Shared by jess@example.com'));
check('header says My trips',(renderHeader(),has(head(),'My trips')&&has(head(),ME_E)));
check('non-admin sees no Approvals link',!has(hd,'href="#admin"'));
check('new trip form lists both saved families',has(hd,'<legend>Becker Family')&&has(hd,'<legend>Logothetis Family'));
check('me ticked by default, Zemi not',has(hd,'data-nt="famB|pj" checked')&&has(hd,'data-nt="famB|pz">'));
check('saved family shows who has no login',has(hd,'No login (just a name)'));
check('dashboard uses Main Street',(render(),document.documentElement.dataset.palette==='mainstreet'));

// ---------- create trips ----------
function cb(v,on){return{dataset:{nt:v},checked:on}}
__writes=[];navigator.onLine=true;
// London: Jason + Jess only (Zemi and Ella unticked)
submit('newtrip',{},{'nt-name':'London','nt-type':'none','nt-start':'2027-03-01','nt-end':'2027-03-06'},[cb('famB|pj',true),cb('famB|pjs',true),cb('famB|pe',false),cb('famB|pz',false)]);
var w=__writes[0]&&__writes[0][2];
check('London trip written',!!w,JSON.stringify(__writes));
check('London: only Jason and Jess can open it',w&&w.members.join(',')===ME_E+',jess@example.com',w&&w.members.join(','));
check('London: Zemi not on it',w&&!w.members.includes('zemi@example.com')&&!w.party.some(function(p){return p.name==='Zemi'}));
check('London: owner is me, type other',w&&w.owner===ME_E&&w.resort==='none');
check('London: one family, Becker, with the dates',w&&w.families.length===1&&w.families[0].id==='famB'&&w.families[0].arrive==='2027-03-01'&&w.families[0].datesSet===true);
// Netherlands: nobody ticked -> just me
__writes=[];S.busy=false;
submit('newtrip',{},{'nt-name':'Netherlands','nt-type':'none'},[cb('famB|pj',false)]);
w=__writes[0]&&__writes[0][2];
check('solo trip: just me',w&&w.members.length===1&&w.members[0]===ME_E&&w.party.length===1&&w.party[0].email===ME_E);
check('solo trip: family named after me',w&&w.families[0].name==='Jason');
// Disney with Logothetis
__writes=[];S.busy=false;
submit('newtrip',{},{'nt-name':'Disney 2027','nt-type':'wdw','nt-start':'2027-04-14','nt-end':'2027-04-19'},[cb('famB|pj',true),cb('famB|pjs',true),cb('famB|pe',true),cb('famB|pz',true),cb('famL|pm',true),cb('famL|pa',true)]);
w=__writes[0]&&__writes[0][2];
check('cross-family trip: both families',w&&w.families.map(function(f){return f.name}).join('|')==='Becker Family|Logothetis Family');
check('cross-family trip: everyone with an email can open it',w&&w.members.length===5,w&&w.members.join(','));
check('cross-family trip: Ella is on the plan without a login',w&&w.party.some(function(p){return p.name==='Ella'&&!p.email}));
__writes=[];S.busy=false;
submit('newtrip',{},{'nt-name':'Bad','nt-start':'2027-04-14','nt-end':'2027-04-10'},[]);
check('leave-before-arrive refused',__writes.length===0);
navigator.onLine=false;submit('newtrip',{},{'nt-name':'Offline'},[]);check('offline create refused',__writes.length===0);navigator.onLine=true;

// ---------- saved families ----------
__writes=[];
submit('fgnew',{},{'fg-new':'Becker Cousins'});
w=__writes[0];check('new family: me in it and an editor',w&&w[2].people[0].email===ME_E&&w[2].editors.join()===ME_E);
__writes=[];submit('fgperson',{fam:'famB'},{'fg-name-famB':'Grandma','fg-email-famB':'GRANDMA@Example.com '});
w=__writes[0];check('adding a person lowercases email and makes them an editor',w&&w[2].editors.includes('grandma@example.com')&&w[2].people.length===5);
__writes=[];submit('fgperson',{fam:'famB'},{'fg-name-famB':'Dup','fg-email-famB':'jess@example.com'});check('duplicate email refused',__writes.length===0);
__writes=[];submit('fgperson',{fam:'famB'},{'fg-name-famB':'Bad','fg-email-famB':'not-an-email'});check('bad email refused',__writes.length===0);

// ---------- admin ----------
ME.admin=true;D.users=[{id:'u1',name:'Maria',email:'maria@example.com',status:'pending',created:'2026-11-15T10:00:00Z'},{id:'u0',name:'Jason',email:ME_E,status:'approved'},{id:'u2',name:'Bot',email:'bot@x.com',status:'denied'}];
hd=html();check('admin sees Approvals with count',has(hd,'href="#admin"')&&has(hd,'1 waiting'));
location.hash='admin';var ha=html();
check('approvals page lists pending first',ha.indexOf('maria@example.com')<ha.indexOf('bot@x.com'));
check('approve and deny buttons for pending',has(ha,'data-act="approve" data-id="u1"')&&has(ha,'data-act="denynow" data-id="u1"'));
check('cannot remove own access',has(ha,'That’s you'));
__writes=[];click({act:'approve',id:'u1'});check('approve writes status only',__writes[0]&&__writes[0][1]==='users/u1'&&JSON.stringify(__writes[0][2])==='{"status":"approved"}');
ME.admin=false;html();check('non-admin on #admin gets the dashboard',!has(html(),'Accounts</h2>'));location.hash='';

// ---------- inside a trip ----------
var upd=null;store={updateTrip:function(d){upd=d;return Promise.resolve()},update:function(){return Promise.resolve()},add:function(){return Promise.resolve()},remove:function(){return Promise.resolve()}};
location.search='?trip=tripLON123';
S.mode='shared';S.stale=false;S.plans=[{id:'p1',date:'2027-03-02',time:'19:00',title:'Dinner at Dishoom',kind:'Dining',who:['pj','pjs']},{id:'p2',date:'2027-03-03',time:'10:00',title:'Tower of London',kind:'Sightseeing',who:['pj']}];S.tasks=[];S.packing=[];S.wishes=[{id:'w1',title:'Borough Market',votes:[]}];
S.trip={id:'tripLON123',name:'London',resort:'none',owner:'jess@example.com',members:[ME_E,'jess@example.com'],
  families:[{id:'famB',name:'Becker Family',hotel:'The Hoxton',arrive:'2027-03-01',depart:'2027-03-06',datesSet:true}],
  party:[{id:'pj',name:'Jason',family:'famB',email:ME_E},{id:'pjs',name:'Jess',family:'famB',email:'jess@example.com'}]};
['overview','week','days','mustdo','lists'].forEach(function(t){location.hash=t;var h='';try{h=html()}catch(e){h='ERR '+e.message+' line '+e.line}check('London / '+t+' renders',h.length>200&&!has(h,'ERR'),h.slice(0,120))});
location.hash='overview';var ho=html();
check('London: no booking windows',!has(ho,'Booking windows'));
check('London: no park chips',!has(ho,'No park yet')&&!has(ho,'>Parks<'));
check('London: access panel lists both',has(ho,'Who can open this trip')&&has(ho,'jess@example.com'));
check('London: not owner so no remove buttons',!has(ho,'data-act="memdel"')&&has(ho,'Only the planner can remove people'));
check('London: header has back to My trips and trip name',(renderHeader(),has(head(),'‹ My trips')&&has(head(),'class="tripnm">London')));
check('London: single family uses Fireworks',document.documentElement.dataset.palette==='fireworks');
location.hash='days';selDay='2027-03-02';var hdy=html();
check('London day: no park picker, hotel still there',!has(hdy,'data-change="daypark"')&&has(hdy,'data-change="dayhotel"'));
check('London day: trip kinds (Sightseeing) not rides',has(hdy,'<option>Sightseeing</option>')&&!has(hdy,'<option>Lightning Lane</option>'));
location.hash='mustdo';var hm=html();check('London must-dos: no heights or park',!has(hm,'Heights for the ride check')&&!has(hm,'id="w-park"'));
check('London calendar: floating local time',has(icsFor([S.plans[0]]),'DTSTART:20270302T190000')&&!has(icsFor([S.plans[0]]),'TZID'));
check('London Google link: no time zone',!has(gcalUrl(S.plans[0]),'ctz='));
// Just me
location.hash='overview';pick=[];var hj=html();check('Just me button shows',has(hj,'data-act="justme"'));
click({act:'justme'});check('Just me picks only me',selected().length===1&&selected()[0]==='pj');
check('my itinerary includes dinner with Jess',vis(S.plans[0])&&vis(S.plans[1]));
pick=[];
// Adding people
upd=null;submit('memadd',{},{'ma-email':'Zemi@Example.com','ma-as':'','ma-name':''});
check('non-owner can add someone (access only)',upd&&upd.members.includes('zemi@example.com')&&upd.party.length===2);
upd=null;submit('memadd',{},{'ma-email':'grandma@example.com','ma-as':'f:famB','ma-name':'Grandma'});
check('add as new person on the plan',upd&&upd.party.some(function(p){return p.name==='Grandma'&&p.email==='grandma@example.com'&&p.family==='famB'}));
upd=null;submit('memadd',{},{'ma-email':'grandma@example.com','ma-as':'f:famB','ma-name':''});check('new person needs a name',upd===null);
upd=null;submit('memadd',{},{'ma-email':'nope','ma-as':''});check('bad email refused in trip',upd===null);
// Owner view
S.trip.owner=ME_E;var hown=html();
check('owner sees remove buttons, not on self',has(hown,'data-act="memdel" data-id="jess@example.com"')&&!has(hown,'data-act="memdel" data-id="'+ME_E+'"'));
check('owner sees Delete this trip',has(hown,'Delete this trip'));
upd=null;click({act:'memdel',id:'jess@example.com'});click({act:'memdel',id:'jess@example.com'});
check('owner removes Jess (two taps)',upd&&upd.members.join()===ME_E);
upd=null;click({act:'memdel',id:ME_E});click({act:'memdel',id:ME_E});check('owner can never remove themselves',upd===null);
// Import saved family
D.fams=D.fams.filter(function(F){return F.id!=='famB'||true});
var hi=html();check('can add a saved family not on the trip',has(hi,'Add saved family')&&has(hi,'<option value="famL">Logothetis Family'));
upd=null;submit('famimport',{},{'fi-fam':'famL'});
check('importing Logothetis adds family, people and emails',upd&&upd.families.length===2&&upd.party.length===4&&upd.members.includes('maria@example.com'));
// Two families -> palettes by position
S.trip.families.push({id:'famL',name:'Logothetis Family',hotel:'',arrive:'',depart:''});
check('palette: Group',paletteFor('group')==='mainstreet');
check('palette: 1st family Fireworks',paletteFor('famB')==='fireworks');
check('palette: 2nd family Monorail',paletteFor('famL')==='monorail');

// ---------- a Disney trip still works as before ----------
S.trip={id:'dis1',name:'Disney 2027',resort:'wdw',owner:ME_E,members:[ME_E],
  families:[{id:'famB',name:'Becker Family',hotel:'Animal Kingdom Lodge',arrive:'2027-04-14',depart:'2027-04-19',onsite:true,datesSet:true,outbound:{date:'2027-04-14',flight:'UA 1234',from:'EWR',to:'MCO',dep:'07:00',arr:'10:00'}}],
  party:[{id:'pj',name:'Jason',family:'famB',email:ME_E},{id:'pe',name:'Ella',family:'famB',height:38}],famParks:{famB:{'2027-04-15':'mk'}}};
S.plans=[{id:'d1',date:'2027-04-15',time:'09:00',title:'Space Mountain',kind:'Ride',who:['pj','pe']}];S.wishes=[{id:'w1',title:'Slinky Dog Dash',park:'hs',minHeight:38,votes:['pe']}];
['overview','week','days','mustdo','lists'].forEach(function(t){location.hash=t;var h='';try{h=html()}catch(e){h='ERR '+e.message}check('Disney / '+t+' renders',h.length>200&&!has(h,'ERR'),h.slice(0,120))});
location.hash='overview';var hdis=html();
check('Disney: booking windows still there',has(hdis,'Booking windows'));
check('Disney: flight shows',has(hdis,'Track UA 1234'));
location.hash='days';selDay='2027-04-15';check('Disney day: park picker',has(html(),'data-change="daypark"'));
check('Disney calendar keeps Eastern time',has(icsFor([S.plans[0]]),'TZID=America/New_York'));
// access lost while open
S.mode='noaccess';S.trip=null;check('lost access shows notice',has(html(),'This trip isn’t available'));


// ---------- copy from the old planner ----------
appConfig.legacyConfig={projectId:'family-disney-trip'};S.mode='dash';S.trip=null;location.hash='';location.search='';
check('import option on dashboard',has(html(),'Copy a trip from the old planner'));
var K='xsq8s36jfcz3nckg47wxnjbww5jy';
check('reads key from full link',legacyKey('https://jbecker1961.github.io/family-trip/?t='+K)===K);
check('reads bare key',legacyKey('  '+K+' ')===K);
check('rejects junk link',legacyKey('https://example.com/?x=1')===null);
var it=importedTrip({name:'Becker Family 2027',resort:'wdw',hotel:'AKL',start:'2027-04-14',end:'2027-04-19',party:[{id:'a',name:'Jess'}],families:[{id:'fam1',name:'Becker Family'},{id:'fam2',name:'Logothetis Family'}],famParks:{fam1:{}},junk:'x'},K);
check('import keeps trip fields',it.name==='Becker Family 2027'&&it.families.length===2&&it.party.length===1&&it.hotel==='AKL');
check('import drops unknown fields and the old key',!('junk' in it)&&JSON.stringify(it).indexOf(K)<0);
check('import: only me can open the copy',it.members.join()===ME.email&&it.owner===ME.email);
check('import fits the rules size limit',Object.keys(it).length<=40);
delete appConfig.legacyConfig;check('import hidden without old config',!has(html(),'Copy a trip from the old planner'));
out('');out(fails.length?('FAILURES: '+fails.length):'ALL PASSED ('+__out.length+' checks)');
__out.join('\n');

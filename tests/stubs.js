// Minimal browser + Firebase stand-ins so app.js can run in JavaScriptCore (osascript -l JavaScript).
var console={log:function(){},warn:function(){},error:function(){}};
var __out=[];function out(s){__out.push(String(s))}
function setTimeout(){return 0} function clearTimeout(){}
var __els={};var __h={};var __vals={};
function El(id){this.id=id;this.innerHTML='';this.hidden=false;this.textContent='';this.dataset={};this.classList={add(){},remove(){}}}
El.prototype.querySelectorAll=function(){return[]};El.prototype.contains=function(){return false};
var document={
  addEventListener(t,f){(__h[t]=__h[t]||[]).push(f)}, activeElement:null,
  querySelector(s){return __els[s]||(__els[s]=new El(s))},
  querySelectorAll(){return[]}, getElementById(id){return id in __vals?{id:id,value:__vals[id],type:'text',checked:!!__vals[id]}:null},
  createElement(){return new El('x')}, body:{appendChild(){}}, documentElement:{dataset:{}}
};
var __hash='';
var location={get hash(){return __hash},set hash(v){__hash=v?('#'+String(v).replace(/^#/,'')):''},search:'',href:'https://example.test/family-trip/?t=abcdefghijkmnpqrstuvwxyz2345',pathname:'/family-trip/',protocol:'https:',reload(){}};
var __ls={};var localStorage={getItem(k){return k in __ls?__ls[k]:null},setItem(k,v){__ls[k]=String(v)}};
var navigator={onLine:true};
var crypto={randomUUID(){return 'u'+Math.random().toString(36).slice(2)+'-x'},getRandomValues(a){for(var i=0;i<a.length;i++)a[i]=Math.floor(Math.random()*256);return a}};
function addEventListener(){} var window={addEventListener(){},scrollTo(){}};
function HTMLDetailsElement(){}
function URLSearchParams(init){this.m=[];if(typeof init==='string'){init.replace(/^\?/,'').split('&').filter(Boolean).forEach(kv=>{var p=kv.split('=');this.m.push([decodeURIComponent(p[0]),decodeURIComponent(p[1]||'')])})}else if(init){for(var k in init)this.m.push([k,String(init[k])])}}
URLSearchParams.prototype.get=function(k){var f=this.m.find(x=>x[0]===k);return f?f[1]:null};
URLSearchParams.prototype.set=function(k,v){var f=this.m.find(x=>x[0]===k);if(f)f[1]=String(v);else this.m.push([k,String(v)])};
URLSearchParams.prototype.toString=function(){return this.m.map(x=>encodeURIComponent(x[0])+'='+encodeURIComponent(x[1])).join('&')};
function URL(h){this.href=h;this.hash='';this.search='';}
URL.prototype.toString=function(){return 'https://example.test/family-trip/'+this.search};
URL.createObjectURL=function(){return 'blob:x'};URL.revokeObjectURL=function(){};
function Blob(p){this.parts=p}
// Firebase stand-ins (never called in this test except boot, which is stripped)
var firebaseConfig=null;var appConfig={adminName:'Jason',adminPhone:'+15551234567',appCheckKey:'',testBanner:true};
function initializeApp(){} function getAuth(){} function onAuthStateChanged(){} function signInWithEmailAndPassword(){} function signOut(){return Promise.resolve()} function createUserWithEmailAndPassword(){} function sendEmailVerification(){return Promise.resolve()} function sendPasswordResetEmail(){} function updateProfile(){}
function initializeFirestore(){} function persistentLocalCache(){} function persistentMultipleTabManager(){} var __writes=[];function doc(){var a=[].slice.call(arguments,1);return{path:a.join('/')||'trips/AUTOID1234567890'}} function query(){} function where(){} function limit(){} function getDoc(){} function getDocsFromServer(){} function terminate(){} function clearIndexedDbPersistence(){} function collection(){} function onSnapshot(){} function setDoc(r,d){__writes.push(['set',r.path,d]);return Promise.resolve()} function updateDoc(r,d){__writes.push(['update',r.path,d]);return Promise.resolve()} function deleteDoc(r){__writes.push(['delete',r.path]);return Promise.resolve()} function addDoc(){}
function FieldPath(){this.p=[].slice.call(arguments)}

function getComputedStyle(){return{getPropertyValue(){return''}}}

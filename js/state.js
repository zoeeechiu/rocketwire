let ST = {isLoggedIn:false, projects:[]};

// Navigation stack: each entry = {projId, systemId} (null systemId = top level)
// We store a full "canvas scope" stack
let navStack = []; // [{scope}]  scope = {systems, connectors, wires, splices, label}
let activeProjId = null;
let activeConnId = null;
let editWireId   = null;
let renameProjId = null;
let addMode      = null;
let authCb       = null;
let newConnTemp  = null;
let draftConn    = null; // working copy while editing connector — committed on Save
let spliceState  = null; // {wireId, t, fromConnId, isConnEdit, connId}
let wireChVis    = {}; // wireId -> bool

// Camera
let cam = {x:80,y:80,scale:1};
let drag   = {on:false,target:null,isSplice:false,isWire:false,ox:0,oy:0};
let panSt  = {on:false,sx:0,sy:0,cx:0,cy:0};
let cv, ctx;

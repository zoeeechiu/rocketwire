// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════
const CREDS = {user:'rocketteam',pass:'launch2026'};
const WC = ['red','black','yellow','blue','green','orange','gray','purple','white','brown','pink','cyan'];
const WHX = {red:'#e74c3c',black:'#2c2c2c',yellow:'#f1c40f',blue:'#2980b9',green:'#27ae60',orange:'#e67e22',gray:'#95a5a6',purple:'#8e44ad',white:'#bdc3c7',brown:'#795548',pink:'#e91e63',cyan:'#00bcd4'};
const AUTO_PINS = {'Amphenol 9-35':6,'Amphenol 13-pin':13,'XT60':2,'XT30':2,'DSUB-9':9,'DSUB-15':15,'DSUB-37':37};
// Connectors where user cannot change pin count
const FIXED_PINS = new Set(['Amphenol 9-35','Amphenol 13-pin','XT60','XT30','DSUB-9','DSUB-15','DSUB-37']);
const PAD = 20; // collision padding around boxes
const GRID = 14; // routing grid cell size (world units)

// Mutate array in-place (preserves references held by navStack/ST.projects)
function removeWhere(arr, fn){
  for(let i=arr.length-1;i>=0;i--){if(fn(arr[i]))arr.splice(i,1);}
}

// Pinout layouts
const PINOUTS = {
  // Amphenol 9-35 (6-pin): from image — hexagonal ring + center
  // Top row: 5(left), 1(right)
  // Middle row: 4(far-left), 6(center), 2(far-right)
  // Bottom: 3(center-bottom)
  'Amphenol 9-35':{shape:'amphenol',R:54,fixedPins:6,pins:[
    {id:1, dx:28,  dy:-30},
    {id:2, dx:44,  dy:4},
    {id:3, dx:16,  dy:38},
    {id:4, dx:-44, dy:4},
    {id:5, dx:-28, dy:-30},
    {id:6, dx:0,   dy:4}
  ]},
  // Amphenol 13-pin: scattered irregular circular layout
  'Amphenol 13-pin':{shape:'amphenol',R:68,fixedPins:13,pins:[
    {id:1, dx:68,   dy:0},
    {id:2, dx:55,   dy:40},
    {id:3, dx:21,   dy:64.7},
    {id:4, dx:-21,  dy:64.7},
    {id:5, dx:-55,  dy:40},
    {id:6, dx:-68,  dy:0},
    {id:7, dx:-55,  dy:-40},
    {id:8, dx:-21,  dy:-64.7},
    {id:9, dx:21,   dy:-64.7},
    {id:10,dx:55,   dy:-40},
    {id:11,dx:26,   dy:0},
    {id:13,dx:-13,  dy:-22.5},
    {id:12,dx:-13,  dy:22.5},
    ]},
  // DSUB-9: horizontal, 2 staggered rows. Top row (5 pins): 1-5 right-to-left. Bottom (4 pins): 6-9 right-to-left
  // From image: top row pins right-to-left = 1,6,2,7,3,8,4,9,5 alternating? 
  // Image shows bottom numbers: 5,9,4,8,3,7,2,6,1 left-to-right
  // So left-to-right bottom positions: 5(top),9(bot),4(top),8(bot),3(top),7(bot),2(top),6(bot),1(top)
  // Top row (pins 1,2,3,4,5): positions at x = 44,22,0,-22,-44 (right to left = 1..5)
  // Bottom row (pins 6,7,8,9): positions at x = 33,11,-11,-33
  'DSUB-9':{shape:'dsub_h',W:160,H:70,fixedPins:9,pins:[
    {id:1,dx:56,dy:-14},{id:2,dx:28,dy:-14},{id:3,dx:0,dy:-14},{id:4,dx:-28,dy:-14},{id:5,dx:-56,dy:-14},
    {id:6,dx:42,dy:14}, {id:7,dx:14,dy:14}, {id:8,dx:-14,dy:14},{id:9,dx:-42,dy:14}
  ]},
  // DSUB-15: larger layout for readability
  'DSUB-15':{shape:'dsub_h',W:300,H:72,fixedPins:15,pins:[
    {id:1,dx:112,dy:-16},{id:2,dx:80,dy:-16},{id:3,dx:48,dy:-16},{id:4,dx:16,dy:-16},
    {id:5,dx:-16,dy:-16},{id:6,dx:-48,dy:-16},{id:7,dx:-80,dy:-16},{id:8,dx:-112,dy:-16},
    {id:9,dx:96,dy:16},{id:10,dx:64,dy:16},{id:11,dx:32,dy:16},{id:12,dx:0,dy:16},
    {id:13,dx:-32,dy:16},{id:14,dx:-64,dy:16},{id:15,dx:-96,dy:16}
  ]},
  // DSUB-37: larger with clear 26px pin spacing
  'DSUB-37':{shape:'dsub_h',W:500,H:72,fixedPins:37,pins:(()=>{
    const p=[];
    const topN=19, botN=18, sp=26;
    const topSpan=(topN-1)*sp, botSpan=(botN-1)*sp;
    for(let i=0;i<topN;i++) p.push({id:i+1,    dx:-topSpan/2+i*sp, dy:-16});
    for(let i=0;i<botN;i++) p.push({id:i+topN+1,dx:-botSpan/2+i*sp, dy:16});
    return p;
  })()},
  'Molex':{shape:'rect_grid',fixedPins:null,pins:[]},
  'XT60':{shape:'xt',W:60,H:44,fixedPins:2,pins:[{id:1,dx:-16,dy:0,lbl:'+'},{id:2,dx:16,dy:0,lbl:'−'}]},
  'XT30':{shape:'xt',W:48,H:36,fixedPins:2,pins:[{id:1,dx:-12,dy:0,lbl:'+'},{id:2,dx:12,dy:0,lbl:'−'}]},
  'JST':{shape:'rect_grid',fixedPins:null,pins:[]},
  'Custom':{shape:'rect_grid',fixedPins:null,pins:[]}
};

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

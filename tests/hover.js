// Hovering a box on the canvas marks its row in the tree, and hovering a
// row in the tree marks its box on the canvas, the same symmetry the
// canvas and tree already keep for selection.
const http = require('http');
let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if(!ok) { console.log('        got  ' + JSON.stringify(actual));
            console.log('        want ' + JSON.stringify(expected)); }
}
const PORT = 9222;
function get(t){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:t},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});}
async function main(){
  const page = (await get('/json/list')).find(t=>t.type==='page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>socket.addEventListener('open',r));
  let id=0; const pending=new Map();
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  const send=(m,p)=>new Promise(res=>{id++;pending.set(id,res);socket.send(JSON.stringify({id,method:m,params:p||{}}));});
  const evaluate=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300));return r.result.value;};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const move=(x,y,type,buttons)=>send('Input.dispatchMouseEvent',{type,x:Math.round(x),y:Math.round(y),button:'left',buttons:buttons===undefined?1:buttons,clickCount:1});
  const drag=async(f,t)=>{await move(f.x,f.y,'mousePressed');
    for(let i=1;i<=8;i++){await move(f.x+(t.x-f.x)*i/8,f.y+(t.y-f.y)*i/8,'mouseMoved');await pause(28);}
    await move(t.x,t.y,'mouseReleased');await pause(320);};
  const tap=async p=>{await move(p.x,p.y,'mousePressed');await move(p.x,p.y,'mouseReleased');await pause(280);};
  const hover=async p=>{await move(p.x,p.y,'mouseMoved',0);await pause(280);};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:8080/'});
  await pause(1800);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New').click()`);
  await pause(400);
  const c = await evaluate(`(() => { const r=document.querySelector('[data-canvas]').getBoundingClientRect(); return {left:r.left, top:r.top}; })()`);
  const at = (x, y) => ({x: c.left + 1 + x, y: c.top + 1 + y});
  const away = {x: c.left + 350, y: c.top + 250};

  const box = () => evaluate(`(() => {
    const b = Array.from(document.querySelector('[data-canvas]').children)
      .find(c => c.style.boxShadow.indexOf('inset') !== -1);
    const r = b.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2,
      selected: b.hasAttribute('data-selected'),
      hovered: b.hasAttribute('data-hovered')};
  })()`);
  const row = () => evaluate(`(() => {
    const b = Array.from(document.querySelectorAll(
      '[data-outline] div > button:last-child'))
      .find(b => b.children[0].textContent.trim() === 'space');
    const r = b.parentElement.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2,
      background: getComputedStyle(b.parentElement).backgroundColor};
  })()`);
  const rowAt = label => evaluate(`(() => {
    const b = Array.from(document.querySelectorAll(
      '[data-outline] div > button:last-child'))
      .find(b => b.children[0].textContent.trim() === ${JSON.stringify(label)});
    const r = b.parentElement.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  })()`);

  await drag(at(40, 40), at(240, 140));
  await tap(away);

  // Hovering the box on the canvas marks its row in the tree.
  const spot = await box();
  await hover({x: spot.x, y: spot.y});
  check('hovering the box marks it', (await box()).hovered, true);
  check('and marks its row in the tree', (await row()).background,
    'rgb(245, 245, 245)');
  await hover(away);
  check('leaving the box clears it', (await box()).hovered, false);
  check('and clears its row', (await row()).background,
    'rgba(0, 0, 0, 0)');

  // Hovering the row in the tree marks the box on the canvas.
  const spotRow = await row();
  await hover({x: spotRow.x, y: spotRow.y});
  check('hovering the row marks its box', (await box()).hovered, true);
  await hover(away);
  check('leaving the row clears its box', (await box()).hovered, false);

  // A selected box or a chosen row is not also marked as hovered.
  await tap(spot);
  check('the box is selected', (await box()).selected, true);
  await hover({x: spot.x, y: spot.y});
  check('hovering a selected box adds nothing', (await box()).hovered,
    false);
  check('its row keeps the selection colour, not the hover one',
    (await row()).background, 'rgb(104, 75, 199)');
  await hover(away);
  await tap(away);

  // A row without a box of its own -- a section -- marks nothing on the
  // canvas, but is still marked hovered itself.
  const rowBackground = label => evaluate(`(() => {
    const b = Array.from(document.querySelectorAll(
      '[data-outline] div > button:last-child'))
      .find(b => b.children[0].textContent.trim() === ${JSON.stringify(label)});
    return getComputedStyle(b.parentElement).backgroundColor;
  })()`);
  const main = await rowAt('Main');
  await hover({x: main.x, y: main.y});
  check('hovering a section row marks nothing on the canvas',
    (await box()).hovered, false);
  check('but still marks the row itself', await rowBackground('Main'),
    'rgb(245, 245, 245)');
  await hover(away);
  check('leaving it clears the row', await rowBackground('Main'),
    'rgba(0, 0, 0, 0)');

  const banner = failures === 0 ?
    'hovering keeps the tree and the canvas in step' :
    `${failures} FAILURES`;
  console.log('');
  console.log(banner);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});

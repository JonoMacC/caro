// Sections and scenarios can be dragged in the outline panel to change the
// order they are held in, the default scenario and every other kind of row
// staying put.
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
  const evaluate=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const move=(x,y,type,buttons)=>send('Input.dispatchMouseEvent',{type,x:Math.round(x),y:Math.round(y),button:'left',buttons:buttons===undefined?1:buttons,clickCount:1});
  const drag=async(f,t)=>{await move(f.x,f.y,'mousePressed');
    for(let i=1;i<=8;i++){await move(f.x+(t.x-f.x)*i/8,f.y+(t.y-f.y)*i/8,'mouseMoved');await pause(28);}
    await move(t.x,t.y,'mouseReleased');await pause(320);};
  const CODES = {z: 90, y: 89};
  const stroke = async (key, modifiers) => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key, code: `Key${key}`,
        modifiers, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key]});
    }
    await pause(320);
  };
  const undo = () => stroke('z', 2);
  const redo = () => stroke('y', 2);
  const escape = async () => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key: 'Escape',
        code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27});
    }
    await pause(200);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:8080/'});
  await pause(1800);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New').click()`);
  await pause(400);

  // Every row read down the panel, indented by its depth.
  const rows = () => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    return Array.from(panel.querySelectorAll('div > button:nth-child(2)'))
      .map(b => {
        const pad = parseInt(b.parentElement.style.paddingLeft) / 12;
        return '..'.repeat(pad) + b.textContent.trim();
      });
  })()`);
  const topRows = async () =>
    (await rows()).filter(row => row.indexOf('..') === -1);
  const rowRect = label => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    const row = Array.from(panel.querySelectorAll('div > button:nth-child(2)'))
      .find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if(row === undefined) { return null; }
    const r = row.parentElement.getBoundingClientRect();
    return {top: r.top, bottom: r.bottom, cx: r.left + r.width / 2};
  })()`);
  const near = async (label, side) => {
    const r = await rowRect(label);
    const y = side === 'before' ? r.top + 2 : r.bottom - 2;
    return {x: r.cx, y};
  };
  const dragRowTo = async (label, targetLabel, side) => {
    const from = await rowRect(label);
    const to = await near(targetLabel, side);
    await drag({x: from.cx, y: (from.top + from.bottom) / 2}, to);
  };
  const setCondition = async text => {
    await evaluate(`(() => {
      const inputs = document.querySelectorAll('input[placeholder="condition"]');
      const field = inputs[inputs.length - 1];
      const s = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      s.call(field, ${JSON.stringify(text)});
      field.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    await pause(300);
  };
  const indicatorCount = () => evaluate(
    `document.querySelectorAll('[data-drop-indicator]').length`);
  const twistyRect = label => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    const label_btn = Array.from(panel.querySelectorAll('div > button:nth-child(2)'))
      .find(b => b.textContent.trim() === ${JSON.stringify(label)});
    const twisty = label_btn.parentElement.firstChild;
    const r = twisty.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  })()`);

  // Three sections: Main, Section1, Section2.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Add a section').click()`);
  await pause(400);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Add a section').click()`);
  await pause(400);
  check('three sections, in the order they were added', await topRows(),
    ['Main', 'Section1', 'Section2']);

  await dragRowTo('Section2', 'Main', 'before');
  check('dragging the last section ahead of the first reorders them',
    await topRows(), ['Section2', 'Main', 'Section1']);
  await undo();
  check('the move can be taken back', await topRows(),
    ['Main', 'Section1', 'Section2']);
  await redo();
  check('and put back again', await topRows(),
    ['Section2', 'Main', 'Section1']);

  await dragRowTo('Section2', 'Main', 'before');
  check('dragging a section just ahead of its own successor is a no-op',
    await topRows(), ['Section2', 'Main', 'Section1']);

  // A second scenario under Section2, so there is something to reorder.
  // Section2 is already the section being edited, added last.
  check('Section2 is the section being edited',
    await evaluate(
      `document.querySelector('input[placeholder="Section:Name"]').value`),
    'Section2');
  await setCondition('a');
  await setCondition('b');
  const withScenarios = ['Section2', '..default', '..a', '..b',
    'Main', 'Section1'];
  check('Section2 now lists a default and two scenarios', await rows(),
    withScenarios);

  await dragRowTo('b', 'a', 'before');
  check('dragging a scenario ahead of a sibling reorders them', await rows(),
    ['Section2', '..default', '..b', '..a', 'Main', 'Section1']);
  await undo();
  check('the scenario move can be taken back', await rows(), withScenarios);

  // Dropping after the last scenario, past the hidden blank one waits in.
  await dragRowTo('a', 'b', 'after');
  check('dragging a scenario after its sibling reorders them too',
    await rows(), ['Section2', '..default', '..b', '..a', 'Main', 'Section1']);
  await undo();
  check('and that move can be taken back as well', await rows(),
    withScenarios);

  await dragRowTo('a', 'default', 'before');
  check('a scenario cannot be dropped ahead of the default', await rows(),
    withScenarios);

  // The default itself never drags: no indicator, no reorder.
  const before = await rowRect('default');
  await move(before.cx, (before.top + before.bottom) / 2, 'mousePressed');
  await move(before.cx, before.bottom + 40, 'mouseMoved', 1);
  await pause(60);
  check('no drop indicator appears while pressing the default scenario',
    await indicatorCount(), 0);
  await move(before.cx, before.bottom + 40, 'mouseReleased');
  await pause(300);
  check('and it never moves', await rows(), withScenarios);

  // Escape cancels a drag in progress.
  const from = await rowRect('a');
  const to = await near('b', 'after');
  await move(from.cx, (from.top + from.bottom) / 2, 'mousePressed');
  await move((from.cx + to.x) / 2, (from.top + to.y) / 2, 'mouseMoved', 1);
  await move(to.x, to.y, 'mouseMoved', 1);
  await pause(60);
  check('a drop indicator appears mid-drag', await indicatorCount() > 0, true);
  await escape();
  check('escape clears the indicator', await indicatorCount(), 0);
  await move(to.x, to.y, 'mouseReleased');
  await pause(300);
  check('and cancels the move', await rows(), withScenarios);

  // A real press-and-release on a twisty still folds its row: pressing the
  // twisty must not start a drag, since mousedown on it bubbles to the row.
  const beforeFold = await rows();
  const twisty = await twistyRect('Section2');
  await move(twisty.x, twisty.y, 'mousePressed');
  await move(twisty.x + 1, twisty.y + 1, 'mouseMoved', 1);
  await pause(60);
  check('no drop indicator appears while pressing a twisty',
    await indicatorCount(), 0);
  await move(twisty.x, twisty.y, 'mouseReleased');
  await pause(300);
  check('and a real click on it still folds the subtree',
    (await rows()).length < beforeFold.length, true);
  await move(twisty.x, twisty.y, 'mousePressed');
  await move(twisty.x, twisty.y, 'mouseReleased');
  await pause(300);
  check('clicking it again unfolds it', await rows(), beforeFold);

  // A layer row, never draggable, still behaves as a normal click target.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Add a layer').click()`);
  await pause(400);
  const withLayer = await rows();
  check('a layer is listed under the scenario it belongs to',
    withLayer.indexOf('....Layer 1') !== -1, true);
  const layer = await rowRect('Layer 1');
  await drag({x: layer.cx, y: (layer.top + layer.bottom) / 2},
    {x: layer.cx, y: layer.top - 40});
  check('dragging a layer does nothing', await rows(), withLayer);

  const banner = failures === 0 ?
    'sections and scenarios can be reordered by dragging them' :
    `${failures} FAILURES`;
  console.log('');
  console.log(banner);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});

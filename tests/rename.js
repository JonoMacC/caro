// Sections, scenarios and boxes can be renamed inline, in the outline panel
// and (for boxes) on the canvas, by pressing an already-current row or box
// a second time.
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
  const move=(x,y,type,buttons,clickCount)=>send('Input.dispatchMouseEvent',{type,x:Math.round(x),y:Math.round(y),button:'left',buttons:buttons===undefined?1:buttons,clickCount:clickCount===undefined?1:clickCount});
  const tap=async p=>{await move(p.x,p.y,'mousePressed');await pause(30);await move(p.x,p.y,'mouseReleased');await pause(300);};
  const stroke = async (key, code, windowsVirtualKeyCode, modifiers) => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key, code, modifiers,
        windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode});
    }
    await pause(250);
  };
  const pressEnter = () => stroke('Enter', 'Enter', 13);
  const pressEscape = () => stroke('Escape', 'Escape', 27);
  const pressSpace = () => stroke(' ', 'Space', 32);
  // Dispatched one real keystroke at a time, over whatever the editor
  // starts with selected, so a fix for "only the last letter lands" (a
  // ref callback re-selecting on every re-render) actually gets exercised.
  const type = async text => {
    for(const ch of text) {
      await send('Input.dispatchKeyEvent', {type: 'char', text: ch});
      await pause(30);
    }
    await pause(150);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://localhost:8080/'});
  await pause(1800);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New').click()`);
  await pause(400);

  const rows = () => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    return Array.from(panel.querySelectorAll('div > button:last-child'))
      .map(b => {
        const twist = b.previousElementSibling;
        const pad = twist ? (parseInt(twist.style.width) - 14) / 12 :
          (parseInt(b.style.paddingLeft) - 16) / 12;
        return '..'.repeat(pad) + b.children[0].textContent.trim();
      });
  })()`);
  const rowRect = label => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    const row = Array.from(panel.querySelectorAll('div > button:last-child'))
      .find(b => b.children[0].textContent.trim() === ${JSON.stringify(label)});
    if(row === undefined) { return null; }
    const r = row.parentElement.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  })()`);
  const tapRow = async label => { await tap(await rowRect(label)); };
  // Taps a row until it is renaming, whether it takes one tap (it was
  // already the focused row, e.g. left that way by an earlier rename on
  // it) or two (a fresh row, never focused before).
  const startRename = async label => {
    if(await rowIsEditing(label)) { return; }
    await tapRow(label);
    if(await rowIsEditing(label)) { return; }
    await tapRow(label);
  };
  const rowIsEditing = label => evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    const row = Array.from(panel.querySelectorAll('div')).find(d => {
      const b = d.querySelector('button:last-child');
      return b !== null && b.children[0].textContent.trim() === ${JSON.stringify(label)};
    });
    if(row !== undefined) { return false; }
    return Array.from(panel.querySelectorAll('input')).length > 0;
  })()`);
  const editorValue = () => evaluate(
    `document.querySelector('[data-outline] input').value`);
  const sectionName = () => evaluate(
    `document.querySelector('input[placeholder="Section:Name"]').value`);
  const conditionOf = label => evaluate(`(() => {
    const inputs = Array.from(document.querySelectorAll(
      'input[placeholder="condition"]'));
    return inputs.map(i => i.value);
  })()`);
  const elementName = () => evaluate(
    `document.querySelector('input[placeholder="Element:Name"]').value`);
  const canvasLabel = () => evaluate(`(() => {
    const box = Array.from(document.querySelector('[data-canvas]').children)
      .find(c => c.style.boxShadow.indexOf('inset') !== -1);
    const s = box.querySelector('span');
    return s === null ? '' : s.textContent.trim();
  })()`);
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
  const undo = () => stroke('z', 'KeyZ', 90, 2);

  // Sections: a first tap only selects; a second, on the now-current row,
  // enters rename.
  await tapRow('Main');
  check('a first tap on a not-yet-current row does not rename',
    await rowIsEditing('Main'), false);
  await tapRow('Main');
  check('a second tap on the now-current row renames it',
    await rowIsEditing('Main'), true);
  check('the editor starts with the current name', await editorValue(),
    'Main');
  await type('Primary');
  await pressEnter();
  await pause(300);
  check('the outline shows the new name', await rows(),
    ['Primary', '..default']);
  check('and the section picker agrees', await sectionName(), 'Primary');

  // A second section, to check Escape reverts.
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.title==='Add a section').click()`);
  await pause(400);
  await startRename('Section1');
  check('Section1 is being renamed', await rowIsEditing('Section1'), true);
  await type('Discarded');
  await pressEscape();
  await pause(300);
  check('Escape leaves the name as it was', await sectionName(), 'Section1');
  check('and the outline agrees',
    (await rows()).indexOf('Discarded'), -1);

  // Blur commits, same as Enter.
  await startRename('Section1');
  await type('Blurred');
  await evaluate(`document.querySelector('[data-outline] input').blur()`);
  await pause(300);
  check('blurring the editor commits it', await sectionName(), 'Blurred');

  // The default scenario is protected: a second tap on it never renames.
  await tapRow('Primary');
  await pause(300);
  await tapRow('default');
  await tapRow('default');
  check('the default scenario never enters rename',
    await rowIsEditing('default'), false);

  // A scenario's condition can be renamed from its outline row.
  await setCondition('a');
  await pause(300);
  await startRename('a');
  check('a scenario row can be renamed', await rowIsEditing('a'), true);
  check('starting from its raw condition', await editorValue(), 'a');
  await type('ready');
  await pressEnter();
  await pause(300);
  check('the outline shows the new condition', await rows(),
    ['Primary', '..default', '..ready', 'Blurred', '..default']);
  check('and the scenario board agrees', await conditionOf(), ['ready', '']);

  // A box can be renamed from its outline row, and shows without brackets
  // while being edited.
  const c = await evaluate(`(() => { const r=document.querySelector('[data-canvas]').getBoundingClientRect(); return {left:r.left, top:r.top}; })()`);
  const at = (x, y) => ({x: c.left + 1 + x, y: c.top + 1 + y});
  await tapRow('default');
  await pause(300);
  const move10 = async(f,t)=>{await move(f.x,f.y,'mousePressed');
    for(let i=1;i<=8;i++){await move(f.x+(t.x-f.x)*i/8,f.y+(t.y-f.y)*i/8,'mouseMoved');await pause(25);}
    await move(t.x,t.y,'mouseReleased');await pause(350);};
  await move10(at(20, 20), at(220, 100));
  await evaluate(`(() => {
    const f = document.querySelector('input[placeholder="Element:Name"]');
    const s = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    s.call(f, 'Box'); f.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await pause(300);
  await startRename('<Box>');
  check('a box row can be renamed', await rowIsEditing('<Box>'), true);
  check('its editor shows the raw name, no brackets', await editorValue(),
    'Box');
  await type('Renamed');
  await pressEnter();
  await pause(300);
  check('the outline wraps the new name in brackets',
    (await rows()).some(row => row.endsWith('<Renamed>')), true);
  check('the canvas label agrees', await canvasLabel(), '<Renamed>');
  check('and the properties field holds the raw name', await elementName(),
    'Renamed');

  // Renaming a box from the canvas: a first click just selects it; a
  // plain second click elsewhere on it is a no-op (it might be the start
  // of a drag); only a real double-click, anywhere on the box, renames it.
  const editorShown = () => evaluate(
    `document.querySelector('[data-canvas] input') !== null`);
  const boxRect = () => evaluate(`(() => {
    const box = Array.from(document.querySelector('[data-canvas]').children)
      .find(c => c.style.boxShadow.indexOf('inset') !== -1);
    const r = box.getBoundingClientRect();
    return {cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      corner: {x: r.left + 10, y: r.top + 10}};
  })()`);
  const labelPoint = () => evaluate(`(() => {
    const label = document.querySelector('[data-canvas] [data-box-label]');
    const r = label.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  })()`);
  const dblclick = async p => {
    await move(p.x, p.y, 'mousePressed', 1, 2);
    await move(p.x, p.y, 'mouseReleased', 1, 2);
    await pause(300);
  };

  const box1 = await boxRect();
  await tap({x: box1.cx, y: box1.cy});
  check('a first canvas click just selects the box', await editorShown(),
    false);
  await tap(box1.corner);
  check('a second plain click elsewhere on the box does not rename it',
    await editorShown(), false);
  await dblclick(box1.corner);
  check('a double-click anywhere on the already-selected box renames it',
    await editorShown(), true);
  await pressEscape();
  await pause(200);

  // Reselecting the box by some other means (its outline row) means the
  // very next canvas click doesn't count as "the same box clicked twice",
  // so a single label click right after still just re-selects; a second
  // one (now that it was the last thing clicked on the canvas) renames.
  await evaluate(`(() => {
    const panel = document.querySelector('[data-outline]');
    Array.from(panel.querySelectorAll('div > button:last-child'))
      .find(b => b.children[0].textContent.trim() === '<Renamed>').focus();
  })()`);
  await pause(200);
  await pressEnter();
  await pause(300);
  const label = await labelPoint();
  await tap(label);
  check('a label click right after selecting elsewhere does not rename',
    await editorShown(), false);
  await tap(label);
  check('a second label click, now the last thing clicked here, renames',
    await editorShown(), true);
  await type('FromCanvas');
  await tap(box1.corner);
  check('clicking the box outside the editor closes it', await editorShown(),
    false);
  check('committing what was typed', await elementName(), 'FromCanvas');
  check('the canvas rename reaches the outline',
    (await rows()).some(row => row.endsWith('<FromCanvas>')), true);

  // Space enters rename on an already-focused row; Enter does not.
  await evaluate(`document.querySelectorAll(
    '[data-outline] div > button:last-child')[0].focus()`);
  await pause(200);
  await pressEnter();
  check('Enter on a focused row does not rename', await evaluate(
    `document.querySelector('[data-outline] input') === null`), true);
  await pressSpace();
  check('Space on a focused row renames it', await evaluate(
    `document.querySelector('[data-outline] input') !== null`), true);

  // Editing swaps the row's own label button for the input and back —
  // unlike an ordinary re-render, that does not carry focus over on its
  // own, so without an explicit restore the row (and arrow-key
  // navigation) would silently stop responding until something was
  // clicked or tabbed to again.
  const isRowFocused = () => evaluate(`document.activeElement ===
    document.querySelectorAll(
      '[data-outline] div > button:last-child')[0]`);
  await pressEscape();
  await pause(200);
  check('focus returns to the row after Escape cancels', await isRowFocused(),
    true);
  await pressSpace();
  await type('Retitled');
  await pressEnter();
  await pause(300);
  check('focus returns to the row after Enter submits', await isRowFocused(),
    true);
  await stroke('ArrowDown', 'ArrowDown', 40);
  await pause(200);
  check('so the arrow keys still navigate right after an edit',
    await isRowFocused(), false);

  // A rename is one undo step. (Undo/redo rebuild the board from a
  // snapshot, so unrelated sections' fold state — keyed by object
  // identity, unrelated to renaming — isn't expected to survive; only the
  // renamed value itself is checked here.)
  await startRename('Blurred');
  await type('Once');
  await pressEnter();
  await pause(300);
  check('the rename took', (await rows()).indexOf('Once') !== -1, true);
  await undo();
  check('one undo takes the name all the way back',
    (await rows()).indexOf('Once') === -1 &&
      (await rows()).indexOf('Blurred') !== -1, true);

  const banner = failures === 0 ?
    'sections, scenarios and boxes can be renamed inline' :
    `${failures} FAILURES`;
  console.log('');
  console.log(banner);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});

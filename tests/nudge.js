// Checks that arrow keys nudge and Ctrl/Cmd+arrow resizes the selected
// box(es), that both stop at the canvas edge and the minimum size, that
// same-axis nudges coalesce into one undo step, and that arrow keys are
// left alone when nothing is selected.
const http = require('http');
const PORT = 9222;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({host: '127.0.0.1', port: PORT, path}, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if(!ok) {
    console.log(`        got  ${JSON.stringify(actual)}`);
    console.log(`        want ${JSON.stringify(expected)}`);
  }
}

async function main() {
  const page = (await get('/json/list')).find(t => t.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if(pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  const send = (method, params) => new Promise(resolve => {
    id++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({id, method, params: params || {}}));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate',
      {expression, returnByValue: true, awaitPromise: true});
    if(r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    return r.result.value;
  };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const move = (x, y, type, modifiers) => send('Input.dispatchMouseEvent',
    {type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1,
      clickCount: 1, modifiers: modifiers || 0});
  const drag = async (from, to) => {
    await move(from.x, from.y, 'mousePressed');
    for(let i = 1; i <= 8; i++) {
      await move(from.x + (to.x - from.x) * i / 8,
        from.y + (to.y - from.y) * i / 8, 'mouseMoved');
      await pause(25);
    }
    await move(to.x, to.y, 'mouseReleased');
    await pause(350);
  };
  const tap = async (point, modifiers) => {
    await move(point.x, point.y, 'mousePressed', modifiers);
    await move(point.x, point.y, 'mouseReleased', modifiers);
    await pause(280);
  };
  const SHIFT = 8;
  const CTRL = 2;
  const CODES = {
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, z: 90
  };
  const stroke = async (key, modifiers) => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key, code: key,
        modifiers: modifiers || 0, windowsVirtualKeyCode: CODES[key],
        nativeVirtualKeyCode: CODES[key]});
    }
    await pause(280);
  };
  const undo = () => stroke('z', CTRL);
  const BOXES = `(() => {
    const canvas = document.querySelector('[data-canvas]');
    return Array.from(canvas.children)
      .filter(c => c.style.boxShadow.indexOf('inset') !== -1)
      .map(b => ({x: parseInt(b.style.left), y: parseInt(b.style.top),
        width: parseInt(b.style.width), height: parseInt(b.style.height)}));
  })()`;
  const boxes = () => evaluate(BOXES);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',
    {width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: 'http://localhost:8080/'});
  await pause(1800);
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'New').click()`);
  await pause(400);
  const c = await evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);
  const at = (x, y) => ({x: c.left + 1 + x, y: c.top + 1 + y});

  // A plain nudge and a big nudge.
  await drag(at(20, 20), at(120, 120));
  let drawn = await boxes();
  check('a drawn box sits where it was drawn', [drawn[0].x, drawn[0].y],
    [20, 20]);
  await stroke('ArrowRight');
  check('an arrow key nudges the selection by 1px',
    (await boxes())[0].x, 21);
  await stroke('ArrowRight', SHIFT);
  check('Shift+arrow nudges by 8px', (await boxes())[0].x, 29);

  // Nudging left clamps at the canvas origin rather than going negative.
  for(let i = 0; i < 5; i++) {
    await stroke('ArrowLeft', SHIFT);
  }
  check('nudging past the canvas edge clamps at 0',
    (await boxes())[0].x, 0);

  // Resizing keeps the top-left corner fixed in every direction.
  await stroke('ArrowRight', CTRL);
  drawn = await boxes();
  check('Ctrl+arrow grows the width by 1px', drawn[0].width, 101);
  check('the position is untouched', [drawn[0].x, drawn[0].y], [0, 20]);
  await stroke('ArrowRight', CTRL | SHIFT);
  check('Shift+Ctrl+arrow grows by 8px', (await boxes())[0].width, 109);
  await stroke('ArrowLeft', CTRL);
  drawn = await boxes();
  check('Ctrl+arrow shrinks the width, not the position',
    [drawn[0].width, drawn[0].x], [108, 0]);

  // Shrinking stops at the minimum size, never reaching 0.
  const c2 = await evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);
  await tap({x: c2.left + 350, y: c2.top + 250});
  await drag({x: c2.left + 300, y: c2.top + 20},
    {x: c2.left + 305, y: c2.top + 25});
  for(let i = 0; i < 8; i++) {
    await stroke('ArrowLeft', CTRL | SHIFT);
  }
  check('shrinking repeatedly stops at the minimum size',
    (await boxes())[(await boxes()).length - 1].width, 1);

  // A burst of same-axis nudges coalesces into one undo step.
  await tap({x: c2.left + 350, y: c2.top + 250});
  await drag({x: c2.left + 20, y: c2.top + 200},
    {x: c2.left + 120, y: c2.top + 250});
  const beforeBurst = (await boxes())[(await boxes()).length - 1].x;
  await stroke('ArrowRight');
  await stroke('ArrowRight');
  await stroke('ArrowRight');
  const afterBurst = (await boxes())[(await boxes()).length - 1].x;
  check('three nudges move the box by three',
    afterBurst, beforeBurst + 3);
  await undo();
  const afterOneUndo = (await boxes())[(await boxes()).length - 1].x;
  check('one undo takes back the whole coalesced burst, not one nudge',
    afterOneUndo, beforeBurst);

  // Switching axis starts a new undo step rather than merging.
  await stroke('ArrowRight');
  await stroke('ArrowDown');
  const beforeAxisUndo = await boxes();
  const lastIndex = beforeAxisUndo.length - 1;
  await undo();
  const afterAxisUndo = (await boxes())[lastIndex];
  check('undoing after switching axis only takes back the y nudge',
    [afterAxisUndo.x, afterAxisUndo.y],
    [beforeAxisUndo[lastIndex].x, beforeAxisUndo[lastIndex].y - 1]);
  await undo();
  const afterSecondUndo = (await boxes())[lastIndex];
  check('a second undo takes back the earlier x nudge',
    afterSecondUndo.x, beforeAxisUndo[lastIndex].x - 1);

  // Multi-select: a move nudges both boxes; a resize nudges each of
  // their own width/height independently.
  await tap({x: c2.left + 350, y: c2.top + 250});
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent.trim() === 'New').click()`);
  await pause(400);
  const c3 = await evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);
  const at3 = (x, y) => ({x: c3.left + 1 + x, y: c3.top + 1 + y});
  await drag(at3(20, 20), at3(120, 70));
  await tap({x: c3.left + 350, y: c3.top + 250});
  await drag(at3(200, 20), at3(320, 90));
  await tap(at3(70, 45));
  await tap(at3(260, 55), SHIFT);
  const before2 = await boxes();
  await stroke('ArrowRight');
  const after2 = await boxes();
  check('a move nudge shifts every selected box by the same amount',
    after2.map((b, i) => b.x - before2[i].x), [1, 1]);
  await stroke('ArrowRight', CTRL);
  const after3 = await boxes();
  check('a resize nudge grows each selected box\'s own width',
    after3.map((b, i) => b.width - after2[i].width), [1, 1]);

  // With no selection, a plain arrow key leaves the board alone (so the
  // default scroll behavior the issue asks for is free to happen). Not
  // exercising Ctrl+arrow here: on macOS, Ctrl+Left/Right/Up/Down are
  // Mission Control/Spaces shortcuts the OS itself intercepts, which
  // can wedge a headless browser regardless of what the page does.
  await tap({x: c3.left + 350, y: c3.top + 250});
  const beforeNone = await boxes();
  await stroke('ArrowRight');
  check('with nothing selected, an arrow key does not touch the board',
    await boxes(), beforeNone);

  console.log(failures === 0 ?
    '\nkeyboard nudge and resize work' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('FAILED:', error.message);
  process.exit(1);
});

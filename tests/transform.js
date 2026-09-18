// A rectangle with a handle at each corner is drawn around the selection,
// and moving or resizing it moves or resizes every selected box together,
// each keeping its place within it.
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
  const SHIFT = 8;
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
  const click = title => evaluate(`document.querySelector(
    ${JSON.stringify(`[title="${title}"]`)}).click()`);
  const fresh = async () => {
    await evaluate(`Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'New').click()`);
    await pause(400);
  };

  // Boxes as the model has them, and every box's rectangle on screen.
  const boxes = () => evaluate(`(() => {
    const canvas = document.querySelector('[data-canvas]');
    return Array.from(canvas.children)
      .filter(c => c.style.boxShadow.indexOf('inset') !== -1)
      .map(b => ({x: parseInt(b.style.left), y: parseInt(b.style.top),
        width: parseInt(b.style.width), height: parseInt(b.style.height)}));
  })()`);
  const RECTS = `(() => {
    const canvas = document.querySelector('[data-canvas]');
    const of = e => { const r = e.getBoundingClientRect();
      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        width: r.width, height: r.height}; };
    const boxes = Array.from(canvas.children)
      .filter(c => c.style.boxShadow.indexOf('inset') !== -1).map(of);
    const frames = Array.from(canvas.querySelectorAll('[data-transform]'));
    return {boxes,
      frames: frames.map(of),
      handles: Array.from(
        canvas.querySelectorAll('[data-transform-handle]')).map(of),
      border: frames.length === 0 ? null :
        getComputedStyle(frames[0]).borderTopWidth};
  })()`;
  const rects = () => evaluate(RECTS);
  const union = list => ({left: Math.min(...list.map(r => r.left)),
    top: Math.min(...list.map(r => r.top)),
    right: Math.max(...list.map(r => r.right)),
    bottom: Math.max(...list.map(r => r.bottom))});
  const near = (a, b) => ['left', 'top', 'right', 'bottom'].every(
    side => Math.abs(a[side] - b[side]) <= 1);
  const corners = r => [[r.left, r.top], [r.right, r.top],
    [r.left, r.bottom], [r.right, r.bottom]];
  const centered = (handles, frame) => corners(frame).every(([x, y]) =>
    handles.some(h => Math.abs(h.left + h.width / 2 - x) <= 1 &&
      Math.abs(h.top + h.height / 2 - y) <= 1));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',
    {width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: 'http://localhost:8080/'});
  await pause(1800);
  await fresh();
  const c = await evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);
  const at = (x, y) => ({x: c.left + 1 + x, y: c.top + 1 + y});
  const pair = async () => {
    await drag(at(40, 40), at(140, 90));
    await drag(at(200, 60), at(320, 140));
    await tap(at(90, 65));
    await tap(at(260, 100), SHIFT);
  };

  // One box: the rectangle is the box, with its handles on the corners.
  await drag(at(40, 40), at(140, 90));
  let now = await rects();
  check('a selected box is framed', now.frames.length, 1);
  check('the frame is the box', near(now.frames[0], now.boxes[0]), true);
  check('with a 7px handle on each corner', [now.handles.length,
    now.handles.every(h => Math.round(h.width) === 7 &&
      Math.round(h.height) === 7), centered(now.handles, now.frames[0])],
    [4, true, true]);
  await tap(at(350, 250));
  now = await rects();
  check('nothing selected, nothing framed', now.frames.length, 0);

  // Several boxes: one frame around all of them.
  await fresh();
  await pair();
  now = await rects();
  check('a pair is framed once', now.frames.length, 1);
  check('by a rectangle around both', near(now.frames[0], union(now.boxes)),
    true);
  check('with a handle on each of its corners', [now.handles.length,
    centered(now.handles, now.frames[0])], [4, true]);

  // The frame stays 1px, its handles 7px, however far in.
  await click('Zoom in');
  await pause(300);
  await click('Zoom in');
  await pause(400);
  now = await rects();
  check('at 200% the handles are still 7px on screen',
    now.handles.every(h => Math.round(h.width) === 7), true);
  check('and its border 1px', parseFloat(now.border) * 2, 1);
  await click('Back to the literal size');
  await pause(400);

  // It follows the boxes while they are carried.
  await move(...Object.values(at(90, 65)), 'mousePressed');
  await move(...Object.values(at(120, 85)), 'mouseMoved');
  await pause(80);
  now = await rects();
  check('the frame goes with the boxes as they are carried',
    near(now.frames[0], union(now.boxes)), true);
  await move(...Object.values(at(120, 85)), 'mouseReleased');
  await pause(350);

  // Resizing from a corner scales every box about the opposite corner.
  await fresh();
  await pair();
  await drag(at(318, 138), at(318 + 56, 138 + 20));
  check('a corner scales every box, each keeping its place in the group',
    await boxes(), [
      {x: 40, y: 40, width: 120, height: 60},
      {x: 232, y: 64, width: 144, height: 96}]);

  // Boxes that met still meet, rounding being of edges, not of sizes.
  await fresh();
  await drag(at(103, 40), at(170, 90));
  await drag(at(40, 40), at(103, 90));
  await tap(at(136, 65), SHIFT);
  // Drawn right to left, so the right-hand box comes first in the layout.
  const before = await boxes();
  check('two boxes meet to begin with',
    before[1].x + before[1].width, before[0].x);
  await drag(at(168, 65), at(181, 65));
  const after = await boxes();
  check('and still do once resized together',
    after[1].x + after[1].width, after[0].x);
  check('the pair having grown', after[0].x + after[0].width > 170, true);

  // Dragged off the canvas's left edge, the whole group stops there.
  await fresh();
  await pair();
  await move(...Object.values(at(42, 65)), 'mousePressed');
  await move(...Object.values(at(0, 65)), 'mouseMoved');
  await pause(80);
  const pinned = await boxes();
  const far = {x: 3, y: c.top + 66};
  await move(far.x, far.y, 'mouseMoved');
  await pause(80);
  const further = await boxes();
  await move(far.x, far.y, 'mouseReleased');
  await pause(350);
  check('the group pins at the canvas edge', pinned[0].x, 0);
  check('with its far edge where it was', pinned[1].x + pinned[1].width, 320);
  check('and dragging further changes nothing', further, pinned);

  // A selected box's own edge no longer resizes it: it carries the group.
  await fresh();
  await pair();
  await drag(at(138, 65), at(168, 65));
  check('a selected box\'s edge carries the whole selection',
    await boxes(), [
      {x: 70, y: 40, width: 100, height: 50},
      {x: 230, y: 60, width: 120, height: 80}]);

  console.log(failures === 0 ? '\nthe selection has transform controls' :
    `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('FAILED:', error.message);
  process.exit(1);
});

// A tag below the rectangle around the selection says how wide and tall it
// is, in the same size on screen at any magnification, and keeps saying so
// as the selection is resized.
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

  const TAGS = `(() => {
    const canvas = document.querySelector('[data-canvas]');
    const of = e => { const r = e.getBoundingClientRect();
      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        width: r.width, height: r.height}; };
    const boxes = Array.from(canvas.children)
      .filter(c => c.style.boxShadow.indexOf('inset') !== -1).map(of);
    return {boxes,
      tags: Array.from(canvas.querySelectorAll('[data-transform-size]'))
        .map(t => ({text: t.textContent.trim(), rect: of(t),
          color: getComputedStyle(t).color,
          background: getComputedStyle(t).backgroundColor,
          weight: getComputedStyle(t).fontWeight,
          padding: getComputedStyle(t).padding,
          radius: getComputedStyle(t).borderTopLeftRadius}))};
  })()`;
  const read = () => evaluate(TAGS);
  const center = r => (r.left + r.right) / 2;
  const CTRL = 2;
  const nudge = async () => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key: 'ArrowRight',
        code: 'ArrowRight', modifiers: CTRL, windowsVirtualKeyCode: 39,
        nativeVirtualKeyCode: 39});
    }
    await pause(300);
  };

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

  // One box: its size, just below it, in white on the accent colour.
  await drag(at(40, 40), at(140, 90));
  let now = await read();
  check('a selected box has a size tag', now.tags.length, 1);
  check('saying how wide and tall it is', now.tags[0].text, '100 × 50');
  const tag = now.tags[0].rect;
  const box = now.boxes[0];
  check('centred below the box', Math.abs(center(tag) - center(box)) <= 1,
    true);
  const gap = tag.top - box.bottom;
  check('6px below its bottom edge', gap >= 5 && gap <= 7, true);
  check('in white text on the accent colour',
    [now.tags[0].color, now.tags[0].background],
    ['rgb(255, 255, 255)', 'rgb(104, 75, 199)']);
  check('in regular weight, padded 2px by 8px, with 4px corners',
    [now.tags[0].weight, now.tags[0].padding, now.tags[0].radius],
    ['400', '2px 8px', '4px']);
  await tap(at(350, 250));
  now = await read();
  check('nothing selected, no tag', now.tags.length, 0);

  // Its size is the size of the rectangle around all of them.
  await fresh();
  await drag(at(40, 40), at(140, 90));
  await drag(at(200, 60), at(320, 140));
  await tap(at(90, 65));
  await tap(at(260, 100), SHIFT);
  now = await read();
  check('a pair has one tag', now.tags.length, 1);
  check('for the rectangle around both', now.tags[0].text,
    '280 × 100');

  // It follows the rectangle while it is dragged out, and after.
  await move(...Object.values(at(318, 138)), 'mousePressed');
  await move(...Object.values(at(318 + 56, 138 + 20)), 'mouseMoved');
  await pause(80);
  now = await read();
  check('the tag keeps up while the selection is resized',
    now.tags[0].text, '336 × 120');
  await move(...Object.values(at(318 + 56, 138 + 20)), 'mouseReleased');
  await pause(350);
  now = await read();
  check('and stays right once it is let go', now.tags[0].text,
    '336 × 120');

  // And after a resize from the keyboard.
  await fresh();
  await drag(at(40, 40), at(140, 90));
  await nudge();
  now = await read();
  check('a resize from the keyboard updates it', now.tags[0].text,
    '101 × 50');

  // The same size and distance on screen, however far in.
  await fresh();
  await drag(at(40, 40), at(140, 90));
  now = await read();
  const small = now.tags[0].rect;
  const smallGap = small.top - now.boxes[0].bottom;
  await click('Zoom in');
  await pause(300);
  await click('Zoom in');
  await pause(400);
  now = await read();
  const big = now.tags[0].rect;
  const bigGap = big.top - now.boxes[0].bottom;
  check('at 200% the tag is as large on screen',
    [Math.abs(big.height - small.height) <= 1,
      Math.abs(big.width - small.width) <= 1], [true, true]);
  check('and as far below the box', Math.abs(bigGap - smallGap) <= 1, true);
  check('saying the same thing', now.tags[0].text, '100 × 50');

  console.log(failures === 0 ? '\nthe selection tells its size' :
    `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('FAILED:', error.message);
  process.exit(1);
});

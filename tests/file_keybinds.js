// Checks that Ctrl/Cmd+N, +O and +S do the same thing as clicking the
// New, Open and Save toolbar buttons.
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
  const move = (x, y, type) => send('Input.dispatchMouseEvent',
    {type, x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1,
      clickCount: 1});
  const drag = async (from, to) => {
    await move(from.x, from.y, 'mousePressed');
    for(let i = 1; i <= 8; i++) {
      await move(from.x + (to.x - from.x) * i / 8,
        from.y + (to.y - from.y) * i / 8, 'mouseMoved');
      await pause(25);
    }
    await move(to.x, to.y, 'mouseReleased');
    await pause(400);
  };
  const tap = async point => {
    await move(point.x, point.y, 'mousePressed');
    await move(point.x, point.y, 'mouseReleased');
    await pause(300);
  };
  const CODES = {n: 78, o: 79, s: 83};
  const stroke = async (key, ms) => {
    for(const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type, key,
        code: `Key${key.toUpperCase()}`, modifiers: 2,
        windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key]});
    }
    await pause(ms || 400);
  };
  const canvas = () => evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);
  const boxCount = () => evaluate(`(() => {
    let n = 0;
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) n++;
      else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return n;
  })()`);

  // A mutable handle: what Save writes is what Open later reads back,
  // so the three keybinds can be checked as one Save-New-Open story
  // without needing an external fixture file.
  const stub = `(() => {
    window.__written = null;
    let text = '';
    const handle = {
      name: 'layout.json',
      getFile: async () => ({text: async () => text}),
      createWritable: async () => ({
        write: async t => { window.__written = t; text = t; },
        close: async () => {}
      })
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  })()`;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',
    {width: 1500, height: 950, deviceScaleFactor: 1, mobile: false});
  await send('Page.addScriptToEvaluateOnNewDocument', {source: stub});
  await send('Page.navigate', {url: 'http://localhost:8080/'});
  await pause(1800);

  check('a new specification has no boxes', await boxCount(), 0);
  const c = await canvas();
  await drag({x: c.left + 20, y: c.top + 20}, {x: c.left + 220, y: c.top + 70});
  check('a box is drawn', await boxCount(), 1);
  await tap({x: c.left + 300, y: c.top + 200});

  await stroke('s', 900);
  check('Ctrl+S saves, same as clicking Save',
    (await evaluate('window.__written')) !== null, true);

  await stroke('n');
  check('Ctrl+N starts a fresh specification, same as clicking New',
    await boxCount(), 0);

  await stroke('o', 900);
  check('Ctrl+O opens the saved file, same as clicking Open',
    await boxCount(), 1);

  console.log(failures === 0 ? '\nkeybinds match the toolbar buttons' :
    `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('FAILED:', error.message);
  process.exit(1);
});

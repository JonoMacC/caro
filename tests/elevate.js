// The box being dragged or resized paints above every other box, however
// it's ordered in the layout, but that order itself never changes.
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
    console.log('        got  ' + JSON.stringify(actual));
    console.log('        want ' + JSON.stringify(expected));
  }
}

const IS_BOX = "child.style.boxShadow.indexOf('inset') !== -1";
const READ_RECTS = `(() => {
  const surface = document.querySelector('[data-canvas]');
  const out = [];
  const walk = element => { for(const child of element.children) {
    if(${IS_BOX}) {
      const r = child.getBoundingClientRect();
      out.push({zIndex: getComputedStyle(child).zIndex,
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom)});
    } else if(child.children.length) { walk(child); } } };
  walk(surface);
  return out;
})()`;
const ROWS = `(() => {
  const panel = document.querySelector('[data-outline]');
  return Array.from(panel.querySelectorAll('div > button:nth-child(2)'))
    .map(b => {
      const pad = parseInt(b.parentElement.style.paddingLeft) / 12;
      return '..'.repeat(pad) + b.textContent.trim();
    });
})()`;

async function main() {
  const page = (await get('/json/list')).find(t => t.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if(pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise(res => {
    id++; pending.set(id, res);
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
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent',
    {type, x: Math.round(x), y: Math.round(y), button: 'left',
      buttons: buttons === undefined ? 1 : buttons, clickCount: 1});
  const draw = async (x1, y1, x2, y2) => {
    await mouse('mousePressed', x1, y1, 1);
    for(let i = 1; i <= 8; i++) {
      await mouse('mouseMoved', x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8, 1);
      await pause(20);
    }
    await mouse('mouseReleased', x2, y2, 0);
    await pause(300);
  };
  const rects = () => evaluate(READ_RECTS);
  const rows = () => evaluate(ROWS);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', {url: 'http://localhost:8080/'});
  await pause(1600);

  const c = await evaluate(`(() => {
    const r = document.querySelector('[data-canvas]').getBoundingClientRect();
    return {left: r.left, top: r.top};
  })()`);

  // Two pairs of boxes, drawn left to right, later ones drawn second so
  // they'd normally paint on top of the earlier ones wherever they meet.
  await draw(c.left + 40, c.top + 40, c.left + 200, c.top + 140);
  await draw(c.left + 240, c.top + 40, c.left + 400, c.top + 140);
  await draw(c.left + 40, c.top + 180, c.left + 200, c.top + 260);
  await draw(c.left + 240, c.top + 180, c.left + 400, c.top + 260);

  const baseline = await rows();
  let boxes = await rects();
  check('four boxes are drawn', boxes.length, 4);
  check('none is elevated at rest', boxes.map(b => b.zIndex),
    ['auto', 'auto', 'auto', 'auto']);

  // Drag A across B. A is drawn first, so B would normally paint over it.
  const [a, b] = boxes;
  await mouse('mousePressed', a.x, a.y, 1);
  const midway = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  await mouse('mouseMoved', midway.x, midway.y, 1);
  await pause(60);
  let mid = await rects();
  check('dragging A elevates it over B', mid[0].zIndex, '1');
  check('B stays unelevated while A is dragged over it', mid[1].zIndex,
    'auto');
  await mouse('mouseMoved', b.x, b.y, 1);
  await mouse('mouseReleased', b.x, b.y, 0);
  await pause(300);
  let after = await rects();
  check('releasing the drag drops A back to normal stacking',
    after[0].zIndex, 'auto');
  check('dragging A does not reorder the outline panel', await rows(),
    baseline);

  // Resize C's right edge into D. C is drawn first, so D would normally
  // paint over the part of C that grows into it.
  const [, , cBox, dBox] = boxes;
  const edgeY = (cBox.top + cBox.bottom) / 2;
  await mouse('mousePressed', cBox.right - 2, edgeY, 1);
  const reach = (cBox.right + dBox.right) / 2;
  await mouse('mouseMoved', reach, edgeY, 1);
  await pause(60);
  mid = await rects();
  check('resizing C into D also elevates C', mid[2].zIndex, '1');
  check('D stays unelevated while C resizes over it', mid[3].zIndex,
    'auto');
  await mouse('mouseReleased', reach, edgeY, 0);
  await pause(300);
  after = await rects();
  check('releasing the resize drops C back to normal stacking',
    after[2].zIndex, 'auto');
  check('resizing C does not reorder the outline panel', await rows(),
    baseline);

  const banner = failures === 0 ?
    'the box being interacted with is brought to the front' :
    `${failures} FAILURES`;
  console.log('');
  console.log(banner);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

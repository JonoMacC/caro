// Checks that alignment guides appear while resizing and dragging.
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
  const ok = actual === expected;
  if(!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if(!ok) {
    console.log(`        got  ${actual}`);
    console.log(`        want ${expected}`);
  }
}

async function main() {
  const targets = await get('/json/list');
  const page = targets.find(t => t.type === 'page');
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
    const r = await send('Runtime.evaluate', {expression, returnByValue: true});
    if(r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  };
  const mouse = async (type, x, y, buttons) => {
    await send('Input.dispatchMouseEvent', {type, x: Math.round(x),
      y: Math.round(y), button: 'left', clickCount: 1, buttons: buttons || 0});
    await new Promise(r => setTimeout(r, 16));
  };

  // A guide is a 1px red bar inside the canvas.
  const GUIDES = `(() => {
    const surface = document.querySelector('[data-canvas]');
    return Array.from(surface.children)
      .filter(c => c.style.backgroundColor === 'rgb(230, 63, 68)')
      .map(c => {
        const r = c.getBoundingClientRect();
        if(r.width <= 2) {
          return {vertical: true, at: r.left, span: r.height};
        }
        return {vertical: false, at: r.top, span: r.width};
      });
  })()`;

  // Boxes highlighted as participating in an alignment.
  const HIGHLIGHTED = `(() => {
    const out = [];
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) {
        if(c.style.outline.indexOf('230, 63, 68') !== -1) {
          const s = c.querySelector('span');
          out.push(s ? s.textContent : '(unnamed)');
        }
      } else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return out.sort();
  })()`;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', {url: 'http://localhost:8080/'});
  await new Promise(r => setTimeout(r, 1600));
  const b = await evaluate(`(() => {
    const r = document.querySelector(
      '[data-canvas]').getBoundingClientRect();
    const surface = document.querySelector('[data-canvas]');
    return {left: Math.round(r.left), top: Math.round(r.top),
      width: surface.clientWidth, height: surface.clientHeight};
  })()`);

  const draw = async (x1, y1, x2, y2, name) => {
    await mouse('mousePressed', b.left + x1, b.top + y1);
    await mouse('mouseMoved', b.left + (x1 + x2) / 2, b.top + (y1 + y2) / 2, 1);
    await mouse('mouseMoved', b.left + x2, b.top + y2, 1);
    await mouse('mouseReleased', b.left + x2, b.top + y2);
    await evaluate(`(() => {
      const i = document.querySelector('input[placeholder="Element:Name"]');
      const s = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      s.call(i, ${JSON.stringify(name)});
      i.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
  };

  // Two boxes side by side, A narrower than B.
  await draw(20, 20, 220, 120, 'A');
  await draw(260, 20, 560, 120, 'B');
  const rects = await evaluate(`(() => {
    const out = [];
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) {
        const s = c.querySelector('span');
        const r = c.getBoundingClientRect();
        out.push({name: s ? s.textContent : '', left: Math.round(r.left),
          right: Math.round(r.right), top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2)});
      } else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return out;
  })()`);
  console.log('   layout:', rects.map(r =>
    `${r.name} x=${r.left}..${r.right} y=${r.top}..${r.bottom}`).join(' | '));
  const a = rects.find(r => r.name === '<A>');
  const other = rects.find(r => r.name === '<B>');

  check('no guides before a gesture starts',
    (await evaluate(GUIDES)).length, 0);

  // Drag A's bottom edge down past B's bottom, stopping level with it.
  await mouse('mousePressed', a.x, a.bottom - 2);
  await mouse('mouseMoved', a.x, a.bottom + 20, 1);
  const away = await evaluate(GUIDES);
  console.log('   part way through the resize:', away.length, 'guides');
  await mouse('mouseMoved', a.x, other.bottom - 2, 1);
  await mouse('mouseMoved', a.x, other.bottom - 2, 1);
  const aligned = await evaluate(GUIDES);
  console.log('   level with B:', aligned.length, 'guides');
  const horizontal = aligned.find(g => !g.vertical);
  check('a guide appears when the resized edge lines up',
    horizontal !== undefined, true);
  const inner = await evaluate(
    `document.querySelector('[data-canvas]').clientWidth`);
  check('the guide spans the whole canvas width', horizontal.span, inner);
  console.log(`   guide at y=${horizontal.at}, B's bottom edge at ` +
    `y=${other.bottom}`);
  check('a guide sits exactly on the edge it matched',
    aligned.some(g => !g.vertical && Math.abs(g.at - other.bottom) <= 1),
    true);
  const lit = await evaluate(HIGHLIGHTED);
  console.log('   highlighted:', JSON.stringify(lit));
  check('both boxes on the guide are highlighted',
    lit.join(','), '<A>,<B>');
  await mouse('mouseReleased', a.x, other.bottom - 2);
  await new Promise(r => setTimeout(r, 150));
  check('guides clear once the gesture ends',
    (await evaluate(GUIDES)).length, 0);
  check('the highlight clears too', (await evaluate(HIGHLIGHTED)).length, 0);

  // Now a drag: the phantom's edges against the other box.
  const now = await evaluate(`(() => {
    const out = [];
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) {
        const s = c.querySelector('span');
        const r = c.getBoundingClientRect();
        out.push({name: s ? s.textContent : '',
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2)});
      } else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return out;
  })()`);
  const moving = now.find(r => r.name === '<A>');
  const anchor = now.find(r => r.name === '<B>');
  await mouse('mousePressed', moving.x, moving.y);
  for(let i = 1; i <= 8; ++i) {
    await mouse('mouseMoved', moving.x + (anchor.x - moving.x) * i / 8,
      moving.y + (anchor.y - moving.y) * i / 8, 1);
  }
  const during = await evaluate(GUIDES);
  console.log('   during the drag:', during.length, 'guides');
  check('guides appear while dragging', during.length > 0, true);
  const snapPoints = await evaluate(`(() => {
    const out = [];
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) {
        const r = c.getBoundingClientRect();
        out.push(r.left, r.right, r.top, r.bottom,
          r.left + r.width / 2, r.top + r.height / 2);
      } else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return out;
  })()`);
  const stray = during.filter(g =>
    !snapPoints.some(point => Math.abs(point - g.at) < 1.5));
  check('every guide drawn while dragging sits on a real edge or center',
    stray.length, 0);
  const litDrag = await evaluate(HIGHLIGHTED);
  console.log('   highlighted while dragging:', JSON.stringify(litDrag));
  check('the dragged box and a partner are both highlighted',
    litDrag.length >= 2, true);
  await mouse('mouseReleased', anchor.x, anchor.y);
  await new Promise(r => setTimeout(r, 150));
  check('guides clear after the drop', (await evaluate(GUIDES)).length, 0);

  // Real magnetism: within reach of another edge, a drop is pulled the
  // rest of the way there rather than left where it landed.
  const RECTS = `(() => {
    const out = [];
    const walk = e => { for(const c of e.children) {
      if(c.style.boxShadow.indexOf('inset') !== -1) {
        const s = c.querySelector('span');
        const r = c.getBoundingClientRect();
        out.push({name: s ? s.textContent : '', left: Math.round(r.left),
          right: Math.round(r.right), top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2)});
      } else if(c.children.length) walk(c); } };
    walk(document.querySelector('[data-canvas]'));
    return out;
  })()`;
  const fresh = async () => {
    await evaluate(`Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'New').click()`);
    await new Promise(r => setTimeout(r, 400));
  };
  const dragBy = async (moving, dx) => {
    await mouse('mousePressed', moving.x, moving.y);
    await mouse('mouseMoved', moving.x + dx, moving.y, 1);
    await mouse('mouseReleased', moving.x + dx, moving.y);
    await new Promise(r => setTimeout(r, 150));
  };
  const named = (list, label) => list.find(r => r.name === label);

  // Dropped 3 screen pixels short of an exact match -- close enough.
  await fresh();
  await draw(20, 300, 220, 400, 'C');
  await draw(260, 300, 460, 400, 'D');
  let boxes = await evaluate(RECTS);
  await dragBy(named(boxes, '<C>'),
    named(boxes, '<D>').left - named(boxes, '<C>').right - 3);
  boxes = await evaluate(RECTS);
  check('dropping within reach snaps the edge exactly to its target',
    named(boxes, '<C>').right, named(boxes, '<D>').left);

  // Dropped 10 screen pixels short -- too far to snap.
  await fresh();
  await draw(20, 300, 220, 400, 'C');
  await draw(260, 300, 460, 400, 'D');
  boxes = await evaluate(RECTS);
  await dragBy(named(boxes, '<C>'),
    named(boxes, '<D>').left - named(boxes, '<C>').right - 10);
  boxes = await evaluate(RECTS);
  check('dropping too far away is left where it landed',
    named(boxes, '<D>').left - named(boxes, '<C>').right, 10);

  // The same closeness, in screen pixels, snaps the same way at 200%.
  await fresh();
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find(b => b.title === 'Zoom in').click()`);
  await new Promise(r => setTimeout(r, 300));
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find(b => b.title === 'Zoom in').click()`);
  await new Promise(r => setTimeout(r, 400));
  await draw(20, 300, 220, 400, 'C');
  await draw(300, 300, 500, 400, 'D');
  boxes = await evaluate(RECTS);
  await dragBy(named(boxes, '<C>'),
    named(boxes, '<D>').left - named(boxes, '<C>').right - 3);
  boxes = await evaluate(RECTS);
  check('the same few screen pixels still snap when zoomed in',
    named(boxes, '<C>').right, named(boxes, '<D>').left);

  // Back to 100% -- the zoom test above left it zoomed in.
  await evaluate(`Array.from(document.querySelectorAll('button'))
    .find(b => b.title === 'Back to the literal size').click()`);
  await new Promise(r => setTimeout(r, 300));

  // Centers are snap points too: two boxes of different heights, dragged
  // so their vertical centers line up though no edge does.
  await fresh();
  await draw(20, 20, 220, 100, 'E');   // 200x80, center at (120, 60)
  await draw(300, 150, 420, 270, 'F'); // 120x120, center at (360, 210)
  boxes = await evaluate(RECTS);
  let e = named(boxes, '<E>');
  let f = named(boxes, '<F>');
  const dy = f.y - e.y;
  await mouse('mousePressed', e.x, e.y);
  for(let i = 1; i <= 8; ++i) {
    await mouse('mouseMoved', e.x, e.y + dy * i / 8, 1);
  }
  const centered = await evaluate(GUIDES);
  const centerGuide = centered.find(g => !g.vertical);
  check('a guide appears when centers line up, not just edges',
    centerGuide !== undefined, true);
  check('it sits on the shared center', centerGuide !== undefined &&
    Math.abs(centerGuide.at - f.y) <= 1, true);
  check('it only spans from the center to the far edge of the other box',
    centerGuide !== undefined && Math.round(centerGuide.span),
    Math.abs(f.right - e.x));
  check('both boxes are highlighted for a center match',
    (await evaluate(HIGHLIGHTED)).join(','), '<E>,<F>');
  await mouse('mouseReleased', e.x, e.y + dy);
  await new Promise(r => setTimeout(r, 150));
  check('a center guide clears once the gesture ends',
    (await evaluate(GUIDES)).length, 0);

  // Dragged within reach, a box's own center is pulled onto another's.
  await fresh();
  await draw(20, 20, 120, 80, 'G');    // 100x60, center at (70, 50)
  await draw(300, 150, 360, 310, 'H'); // 60x160, center at (330, 230)
  boxes = await evaluate(RECTS);
  await dragBy(named(boxes, '<G>'),
    named(boxes, '<H>').x - named(boxes, '<G>').x - 3);
  boxes = await evaluate(RECTS);
  check('dropping within reach snaps a center onto another center',
    named(boxes, '<G>').x, named(boxes, '<H>').x);

  // A resized edge can snap onto another box's center line too, the same
  // way it already snaps onto an edge -- no separate magnetism of its own.
  await fresh();
  await draw(20, 20, 220, 120, 'I');  // right edge at 220
  await draw(400, 20, 500, 120, 'J'); // 100 wide, center at x=450
  boxes = await evaluate(RECTS);
  let i = named(boxes, '<I>');
  const j = named(boxes, '<J>');
  await mouse('mousePressed', i.right - 2, i.y);
  await mouse('mouseMoved', j.x - 3, i.y, 1);
  await mouse('mouseMoved', j.x - 3, i.y, 1);
  const nearCenter = await evaluate(GUIDES);
  const edgeOntoCenter = nearCenter.find(g => g.vertical);
  check('a guide appears when a resized edge nears another box\'s center',
    edgeOntoCenter !== undefined && Math.abs(edgeOntoCenter.at - j.x) <= 1,
    true);
  await mouse('mouseReleased', j.x - 3, i.y);
  await new Promise(r => setTimeout(r, 150));
  i = named(await evaluate(RECTS), '<I>');
  check('resizing an edge within reach snaps it onto another box\'s center',
    i.right, j.x);

  // Resizing a box can happen to leave its own overall center matching
  // another box's center -- but that's incidental to the resize, not
  // something the user placed, so it gets none of a drag's center
  // treatment: no guide, and the edge isn't pulled onto it.
  await fresh();
  await draw(20, 20, 120, 120, 'K');  // 100x100, right edge at 120
  await draw(200, 20, 300, 120, 'L'); // 100x100, center at x=250
  boxes = await evaluate(RECTS);
  let k = named(boxes, '<K>');
  const l = named(boxes, '<L>');
  const selfCenterTarget = 2 * l.x - k.left;
  await mouse('mousePressed', k.right - 2, k.y);
  for(let step = 1; step <= 10; ++step) {
    await mouse('mouseMoved',
      k.right + (selfCenterTarget - 3 - k.right) * step / 10, k.y, 1);
  }
  const duringResize = await evaluate(GUIDES);
  check('no center guide appears when a resize only makes its own ' +
    'center coincide with another\'s', duringResize.some(g =>
      g.vertical && Math.abs(g.at - l.x) <= 1 && g.span < 400), false);
  await mouse('mouseReleased', selfCenterTarget - 3, k.y);
  await new Promise(r => setTimeout(r, 150));
  k = named(await evaluate(RECTS), '<K>');
  check('and its edge isn\'t pulled by that incidental self-center match',
    Math.abs(k.right - (selfCenterTarget - 3)) <= 2, true);

  console.log(failures === 0 ? '\nalignment guides work' :
    `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

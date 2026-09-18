import * as React from 'react';
import { Box, Component, Layout } from '../layout';
import { POLICY_EDGE, PROBLEM_COLOR, REPEAT_DIRECTION,
  WARNING_COLOR } from './palette';
import { REPEAT_GLYPH } from './repeat';
import { isBlank } from './scenarios';
import { Problem, Severity } from './validation';

/** How far each level of the tree is indented, in pixels. */
const INDENT = 12;

/** How wide the twisty is at the top level, before any indentation is
    added to it. */
const TWIST_WIDTH = 14;

/** How much room sits between the twisty and the name it opens or shuts,
    matched by a leaf row's own indent so its name lines up with one that
    has a twisty at the same depth. */
const GAP = 2;

/** How wide the panel is to begin with, in pixels. */
const WIDTH = 210;

/** How narrow and how wide the panel may be dragged. */
const NARROWEST = 120;
const WIDEST = 520;

/** The distance a press must cover before it drags a row to reorder it,
    rather than choosing it, in pixels. */
const DRAG_THRESHOLD = 4;

/** How tall the line marking where a dragged row would land is drawn. */
const INDICATOR_HEIGHT = 8;

/** How far the line marking where a dragged row would land is held clear of
    the panel's own edge. */
const INDICATOR_INSET = 8;

interface Point {
  x: number;
  y: number;
}

/** A row of the tree as it stands, one of the sections, scenarios, layers
    and boxes on show once the folded ones are left out. */
interface Entry {

  /** What the row can be opened or shut by, and is remembered open by. */
  node: object;

  /** The section the row belongs to, which a press switches to. */
  component: Component;

  /** The box the row stands for, null for every other kind of row. */
  box: Box;

  /** The row this one is folded away into, null at the top. */
  parent: object;

  /** How many levels in the row sits. */
  depth: number;

  /** What the row is called. */
  label: string;

  /** What the row says of itself when the cursor rests on it. */
  title: string;

  /** What is written to the right of the label. */
  note: React.ReactNode;

  /** Whether the row has nothing folded away inside it. */
  leaf: boolean;

  /** Whether the row is open. */
  open: boolean;

  /** Whether the row can be dragged to reorder it among its siblings. */
  draggable: boolean;

  /** How the row is marked out from the rest. */
  style: object;

  /** What the row does when the walk lands on it, making it the current
      item without folding anything. */
  visit: () => void;

  /** What a press on the row does besides moving the focus to it. */
  choose: () => void;
}

interface Properties {

  /** The sections of the specification, outermost first. */
  sections: Component[];

  /** The section being edited. */
  component: Component;

  /** The boxes of the canvas being worked in, null when none is. */
  active: Box[];

  /** The boxes currently selected, empty when none are. */
  selection: Box[];

  /** The box the cursor rests on, null when none does. */
  hovered: Box;

  /** What is amiss in each section, so that a section can be marked
      without being visited. */
  problems: Map<Component, Problem[]>;

  /** Called to make a section the one being edited. */
  onSection?: (component: Component) => void;

  /** Called to make a canvas the one being worked in. */
  onActivate?: (component: Component, boxes: Box[]) => void;

  /** Called to select a box and bring it into view. */
  onReveal?: (component: Component, box: Box) => void;

  /** Called when the cursor rests on a row's box or leaves it, naming null
      in the latter case. */
  onHover?: (box: Box) => void;
  /** Called to move a section to a new position among its siblings. */
  onMoveSection?: (component: Component, offset: number) => void;

  /** Called to move a scenario to a new position within its section. */
  onMoveScenario?: (layout: Layout, offset: number) => void;
}

/** Where the line marking a drop sits: how far down the tree, and how deep,
    so it can be indented like the row it would land among. */
interface DropLine {
  top: number;
  depth: number;
}

interface State {
  open: Set<object>;
  width: number;
  focus: number;

  /** The node a row without a box of its own is marked hovered by, since
      there is no selection-like prop to carry that for it. */
  hovered: object;
  dragging: object;
  dropLine: DropLine;
}

/** Lists a whole specification as a tree of sections, scenarios, layers and
    boxes, so that a box too small to hit, or buried in a section that is not
    on screen, can still be reached. */
export class OutlinePanel extends React.Component<Properties, State> {
  constructor(props: Properties) {
    super(props);
    this.state = {open: new Set<object>(), width: WIDTH, focus: -1,
      hovered: null, dragging: null, dropLine: null};
    this.grabbed = 0;
    this.held = 0;
    this.rows = [];
    this.settled = -1;
    this.walked = false;
    this.identifiers = new WeakMap<object, string>();
    this.count = 0;
    this.dragOrigin = null;
    this.dragActive = false;
    this.dragEntry = null;
    this.dropTarget = null;
  }

  public render(): JSX.Element {
    const entries = this.entries();
    this.rows = [];
    return (
      <div style={{...OutlinePanel.STYLE.panel,
          width: `${this.state.width}px`}} data-keeps-selection=''
          data-outline='' onKeyDown={this.onKeyDown}>
        <div style={OutlinePanel.STYLE.tree}>
          {entries.map(this.renderRow)}
          {this.state.dropLine !== null &&
            <div data-drop-indicator=''
                style={{...OutlinePanel.STYLE.indicator,
                  top: `${this.state.dropLine.top}px`,
                  left: `${this.state.dropLine.depth * INDENT +
                    INDICATOR_INSET}px`}}>
              <span style={OutlinePanel.STYLE.indicatorDot}/>
              <span style={OutlinePanel.STYLE.indicatorLine}/>
            </div>}
        </div>
        <div style={OutlinePanel.STYLE.grip} data-grip=''
          title='Drag to widen' onMouseDown={this.onGrab}/>
      </div>);
  }

  public componentDidMount(): void {
    this.reveal(this.props.component);
  }

  public componentDidUpdate(previous: Properties): void {
    const walked = this.walked;
    this.walked = false;
    if(previous.component !== this.props.component && !walked) {
      this.reveal(this.props.component);
    }
    if(this.state.focus === this.settled) {
      return;
    }
    this.settled = this.state.focus;
    const row = this.rows[this.state.focus];
    if(row !== undefined && row !== null) {
      row.focus();
    }
  }

  public componentWillUnmount(): void {
    this.release();
    this.endDrag();
  }

  private grabbed: number;
  private held: number;
  private rows: HTMLButtonElement[];
  private settled: number;
  private walked: boolean;
  private identifiers: WeakMap<object, string>;
  private count: number;
  private dragOrigin: Point;
  private dragActive: boolean;
  private dragEntry: Entry;
  private dropTarget: number;

  /** Returns the rows on show, folded ones left out, in the order they are
      read down the panel. This is what the arrow keys walk. */
  private entries(): Entry[] {
    const entries = [] as Entry[];
    for(const component of this.props.sections) {
      const scenarios = OutlinePanel.scenariosOf(component);
      const open = this.state.open.has(component);
      entries.push({
        node: component,
        component,
        box: null,
        parent: null,
        depth: 0,
        label: component.name,
        title: component.name,
        note: `${scenarios.length}`,
        leaf: scenarios.length === 0,
        open,
        draggable: true,
        style: {...this.amissStyle(this.sectionFaults(component)),
          ...this.hoverStyle(component), ...this.editingStyle(component)},
        visit: () => this.props.onSection?.(component),
        choose: () => {
          const here = component === this.props.component;
          this.props.onSection?.(component);
          this.spread(OutlinePanel.under(component), !(here && open));
        }
      });
      if(!open) {
        continue;
      }
      for(let index = 0; index < scenarios.length; index += 1) {
        this.gather(entries, component, scenarios[index], index);
      }
    }
    return entries;
  }

  private gather(entries: Entry[], component: Component, layout: Layout,
      index: number): void {
    const open = this.state.open.has(layout);
    const label = OutlinePanel.conditionOf(layout, index);
    entries.push({
      node: layout,
      component,
      box: null,
      parent: component,
      depth: 1,
      label,
      title: label,
      note: `${layout.boxes.length}`,
      leaf: layout.boxes.length === 0 && layout.overlays.length === 0,
      open,
      draggable: index !== 0,
      style: {...this.amissStyle(
          this.frameFaults(component, layout.boxes)),
        ...this.hoverStyle(layout), ...this.markFor(layout.boxes)},
      visit: () => this.props.onActivate?.(component, layout.boxes),
      choose: () => {
        const here = component === this.props.component;
        this.props.onActivate?.(component, layout.boxes);
        this.spread([layout as object].concat(layout.overlays),
          !(here && open));
      }
    });
    if(!open) {
      return;
    }
    for(const box of OutlinePanel.reading(layout.boxes)) {
      this.carry(entries, component, box, layout, 2);
    }
    for(let order = 0; order < layout.overlays.length; order += 1) {
      const overlay = layout.overlays[order];
      const shown = this.state.open.has(overlay);
      entries.push({
        node: overlay,
        component,
        box: null,
        parent: layout,
        depth: 2,
        label: `Layer ${order + 1}`,
        title: `Layer ${order + 1}`,
        note: `${overlay.length}`,
        leaf: overlay.length === 0,
        open: shown,
        draggable: false,
        style: {...this.amissStyle(this.frameFaults(component, overlay)),
          ...this.hoverStyle(overlay), ...this.markFor(overlay)},
        visit: () => this.props.onActivate?.(component, overlay),
        choose: () => {
          const here = component === this.props.component;
          this.props.onActivate?.(component, overlay);
          this.spread([overlay], !(here && shown));
        }
      });
      if(!shown) {
        continue;
      }
      for(const box of OutlinePanel.reading(overlay)) {
        this.carry(entries, component, box, overlay, 3);
      }
    }
  }

  private carry(entries: Entry[], component: Component, box: Box,
      parent: object, depth: number): void {
    const chosen = this.props.selection.indexOf(box) !== -1;
    const hovered = !chosen && this.props.hovered === box;
    const visit = () => this.props.onReveal?.(component, box);
    entries.push({
      node: box,
      component,
      box,
      parent,
      depth,
      label: OutlinePanel.nameOf(box),
      title: `${box.width} x ${box.height} at ${box.x}, ${box.y}`,
      note: OutlinePanel.sizeOf(box, chosen),
      leaf: true,
      open: false,
      draggable: false,
      style: {...this.amissStyle(this.boxFaults(component, box)),
        ...(hovered ? OutlinePanel.STYLE.hovered : {}),
        ...(chosen ? OutlinePanel.STYLE.chosen : {})},
      visit,
      choose: visit
    });
  }

  private renderRow = (entry: Entry, index: number) => {
    const reached = (() => {
      if(index === Math.max(this.state.focus, 0)) {
        return 0;
      }
      return -1;
    })();
    const label = (
      <button style={{...OutlinePanel.STYLE.label,
          ...(entry.leaf ? {paddingLeft:
            `${TWIST_WIDTH + GAP + entry.depth * INDENT}px`} : {})}}
          tabIndex={reached} ref={element => this.rows[index] = element}
          title={entry.title} onFocus={() => this.settle(index)}
          onClick={() => {
            this.settle(index);
            entry.choose();
          }}>
        <span style={OutlinePanel.STYLE.name}>{entry.label}</span>
        <span style={OutlinePanel.STYLE.note}>{entry.note}</span>
      </button>);
    const hover = {
      onMouseEnter: () => {
        if(entry.box !== null) {
          this.props.onHover?.(entry.box);
        } else {
          this.setState({hovered: entry.node});
        }
      },
      onMouseLeave: () => {
        if(entry.box !== null) {
          this.props.onHover?.(null);
        } else {
          this.setState({hovered: null});
        }
      }
    };
    const row = {
      ...hover,
      'data-index': index,
      style: {...OutlinePanel.STYLE.row, ...entry.style,
        ...(() => {
          if(this.state.dragging === entry.node) {
            return OutlinePanel.STYLE.dragging;
          }
          return {};
        })()},
      onMouseDown: (event: React.MouseEvent) => {
        if(entry.draggable && entry.depth <= 1) {
          this.onRowMouseDown(event, entry);
        }
      }
    };
    if(entry.leaf) {
      return (
        <div key={this.keyOf(entry.node)} {...row}>
          {label}
        </div>);
    }
    const twist = entry.open ? '\u25BE' : '\u25B8';
    return (
      <div key={this.keyOf(entry.node)} {...row}>
        <button style={{...OutlinePanel.STYLE.twist,
            width: `${TWIST_WIDTH + entry.depth * INDENT}px`}} tabIndex={-1}
            onMouseDown={event => event.stopPropagation()}
            onClick={() => this.toggle(entry.node)} title='Fold'>
          {twist}
        </button>
        {label}
      </div>);
  }

  /** Walks the tree by the arrow keys, the way a tree is walked anywhere
      else: down and up move a row at a time, right opens a row and then
      steps into it, left shuts it and then steps back out to what holds
      it. Whatever the walk lands on becomes the current item, the same as
      a press would make it. */
  private onKeyDown = (event: React.KeyboardEvent) => {
    const entries = this.entries();
    const at = Math.min(Math.max(this.state.focus, 0), entries.length - 1);
    const entry = entries[at];
    if(entry === undefined) {
      return;
    }
    if(event.key === 'ArrowDown') {
      event.preventDefault();
      this.walk(entries, at + 1);
    } else if(event.key === 'ArrowUp') {
      event.preventDefault();
      this.walk(entries, at - 1);
    } else if(event.key === 'Home') {
      event.preventDefault();
      this.walk(entries, 0);
    } else if(event.key === 'End') {
      event.preventDefault();
      this.walk(entries, entries.length - 1);
    } else if(event.key === 'ArrowRight') {
      event.preventDefault();
      if(entry.leaf) {
        return;
      }
      if(!entry.open) {
        this.toggle(entry.node);
      } else {
        this.walk(entries, at + 1);
      }
    } else if(event.key === 'ArrowLeft') {
      event.preventDefault();
      if(!entry.leaf && entry.open) {
        this.toggle(entry.node);
        return;
      }
      const holder = entries.findIndex(other => other.node === entry.parent);
      if(holder !== -1) {
        this.walk(entries, holder);
      }
    } else if(event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      entry.choose();
    }
  }

  /** Moves the focus to a row and makes it the current item, leaving the
      tree folded as it stands so that a walk can step over what is shut
      rather than opening it. */
  private walk(entries: Entry[], index: number): void {
    const at = Math.min(Math.max(index, 0), entries.length - 1);
    this.settle(at);
    this.walked = true;
    entries[at].visit();
  }

  private settle(index: number): void {
    if(index === this.state.focus) {
      return;
    }
    this.setState({focus: index});
  }

  /** Opens a section and its scenarios, so that the one being edited is not
      left folded away out of sight. */
  private reveal(component: Component): void {
    const open = new Set(this.state.open);
    open.add(component);
    for(const layout of component.layouts) {
      open.add(layout);
    }
    this.setState({open});
  }

  private onGrab = (event: React.MouseEvent) => {
    event.preventDefault();
    this.grabbed = event.clientX;
    this.held = this.state.width;
    window.addEventListener('mousemove', this.onDrag);
    window.addEventListener('mouseup', this.release);
  }

  private onDrag = (event: MouseEvent) => {
    const width = this.held + event.clientX - this.grabbed;
    this.setState({
      width: Math.min(Math.max(width, NARROWEST), WIDEST)
    });
  }

  private release = () => {
    window.removeEventListener('mousemove', this.onDrag);
    window.removeEventListener('mouseup', this.release);
  }

  /** Returns a stable identifier for a node, made up the first time it is
      asked for and kept for as long as the node exists, so that a row keeps
      its own identity in React's eyes across a reorder rather than being
      reused for whatever node now sits at its old position. */
  private keyOf(node: object): string {
    let id = this.identifiers.get(node);
    if(id === undefined) {
      id = `row${this.count}`;
      this.count += 1;
      this.identifiers.set(node, id);
    }
    return id;
  }

  /** Returns the array a row's node is one of, which is what a reorder
      splices into. */
  private siblingsOf(entry: Entry): object[] {
    if(entry.depth === 0) {
      return this.props.sections;
    }
    return entry.component.layouts;
  }

  private onRowMouseDown = (event: React.MouseEvent, entry: Entry) => {
    this.dragOrigin = {x: event.clientX, y: event.clientY};
    this.dragActive = false;
    this.dragEntry = entry;
    window.addEventListener('mousemove', this.onRowMouseMove);
    window.addEventListener('mouseup', this.onRowMouseUp);
    window.addEventListener('keydown', this.onDragKeyDown);
  }

  private onRowMouseMove = (event: MouseEvent) => {
    if(!this.dragActive) {
      const dx = event.clientX - this.dragOrigin.x;
      const dy = event.clientY - this.dragOrigin.y;
      if(Math.hypot(dx, dy) < DRAG_THRESHOLD) {
        return;
      }
      this.dragActive = true;
      this.setState({dragging: this.dragEntry.node});
    }
    this.updateDrop(event.clientX, event.clientY);
  }

  private onRowMouseUp = () => {
    if(this.dragActive && this.dropTarget !== null) {
      this.commitDrop();
    }
    this.endDrag();
  }

  private onDragKeyDown = (event: KeyboardEvent) => {
    if(event.key !== 'Escape') {
      return;
    }
    this.endDrag();
  }

  /** Figures out where a row being dragged would land, and how that should
      be shown, from the point under the cursor. Clears the drop when the
      point is not a valid place for this row to go. */
  private updateDrop(x: number, y: number): void {
    const entries = this.entries();
    const hit = (document.elementFromPoint(x, y) as Element)?.
      closest('[data-index]') as HTMLElement;
    if(hit === null || hit === undefined) {
      this.clearDrop();
      return;
    }
    const at = Number(hit.dataset.index);
    const candidate = entries[at];
    if(candidate === undefined || candidate.depth !== this.dragEntry.depth) {
      this.clearDrop();
      return;
    }
    if(this.dragEntry.depth === 1 &&
        candidate.component !== this.dragEntry.component) {
      this.clearDrop();
      return;
    }
    const rect = hit.getBoundingClientRect();
    const after = y > rect.top + rect.height / 2;
    const list = this.siblingsOf(this.dragEntry);
    const current = list.indexOf(this.dragEntry.node);
    const candidateIndex = list.indexOf(candidate.node);
    const arrayIndex = after ? candidateIndex + 1 : candidateIndex;
    if(arrayIndex === current || arrayIndex === current + 1) {
      this.clearDrop();
      return;
    }
    if(this.dragEntry.depth === 1 && arrayIndex <= 0) {
      this.clearDrop();
      return;
    }
    const edge = (() => {
      if(!after) {
        return hit.offsetTop;
      }
      let index = at + 1;
      while(index < entries.length && entries[index].depth > candidate.depth) {
        index += 1;
      }
      const last = this.rows[index - 1]?.parentElement as HTMLElement;
      if(last === undefined || last === null) {
        return hit.offsetTop + hit.offsetHeight;
      }
      return last.offsetTop + last.offsetHeight;
    })();
    this.dropTarget = arrayIndex;
    const top = edge - INDICATOR_HEIGHT / 2;
    const line = this.state.dropLine;
    if(line === null || line.top !== top || line.depth !== candidate.depth) {
      this.setState({dropLine: {top, depth: candidate.depth}});
    }
  }

  private clearDrop(): void {
    this.dropTarget = null;
    if(this.state.dropLine !== null) {
      this.setState({dropLine: null});
    }
  }

  private commitDrop(): void {
    if(this.dropTarget === null) {
      return;
    }
    const list = this.siblingsOf(this.dragEntry);
    const current = list.indexOf(this.dragEntry.node);
    const finalIndex = this.dropTarget > current ?
      this.dropTarget - 1 : this.dropTarget;
    const offset = finalIndex - current;
    if(this.dragEntry.depth === 0) {
      this.props.onMoveSection?.(this.dragEntry.component, offset);
    } else {
      this.props.onMoveScenario?.(this.dragEntry.node as Layout, offset);
    }
  }

  private endDrag(): void {
    window.removeEventListener('mousemove', this.onRowMouseMove);
    window.removeEventListener('mouseup', this.onRowMouseUp);
    window.removeEventListener('keydown', this.onDragKeyDown);
    this.dragOrigin = null;
    this.dragActive = false;
    this.dragEntry = null;
    this.dropTarget = null;
    if(this.state.dragging !== null || this.state.dropLine !== null) {
      this.setState({dragging: null, dropLine: null});
    }
  }

  /** Opens or shuts a set of nodes together. */
  private spread(nodes: object[], open: boolean): void {
    const next = new Set(this.state.open);
    for(const node of nodes) {
      if(open) {
        next.add(node);
      } else {
        next.delete(node);
      }
    }
    this.setState({open: next});
  }

  private toggle(node: object): void {
    const open = new Set(this.state.open);
    if(open.has(node)) {
      open.delete(node);
    } else {
      open.add(node);
    }
    this.setState({open});
  }

  /** Returns the marking that says something in a row is amiss, in the
      colour of the worst of it, so that the panel below and the tree agree
      on how much a row matters. A row that is selected keeps the marking
      for that instead, since a box being looked at is named in the panel
      anyway. */
  private amissStyle(problems: Problem[]) {
    if(problems.length === 0) {
      return {};
    }
    if(problems.some(
        problem => problem.severity === Severity.ERROR)) {
      return OutlinePanel.STYLE.amiss;
    }
    return OutlinePanel.STYLE.warned;
  }

  /** Returns what is amiss anywhere in a section. */
  private sectionFaults(component: Component): Problem[] {
    return this.faults(component);
  }

  /** Returns what is amiss within one canvas. */
  private frameFaults(component: Component, frame: Box[]): Problem[] {
    return this.faults(component).filter(
      problem => problem.frame === frame);
  }

  /** Returns what points at a box. */
  private boxFaults(component: Component, box: Box): Problem[] {
    return this.faults(component).filter(problem => problem.box === box);
  }

  /** Returns what is amiss in a section. */
  private faults(component: Component): Problem[] {
    const found = this.props.problems.get(component);
    if(found === undefined) {
      return [];
    }
    return found;
  }

  /** Returns the marking that says a canvas is the one being worked in. */
  private markFor(boxes: Box[]) {
    if(boxes !== this.props.active) {
      return {};
    }
    return OutlinePanel.STYLE.working;
  }

  /** Returns the marking that says a section is the one being edited. */
  private editingStyle(component: Component) {
    if(component !== this.props.component) {
      return {};
    }
    return OutlinePanel.STYLE.editing;
  }

  /** Returns the marking that says the cursor rests on a row with no box
      of its own to carry that on, a section, scenario or layer. */
  private hoverStyle(node: object) {
    if(this.state.hovered !== node) {
      return {};
    }
    return OutlinePanel.STYLE.hovered;
  }

  /** Returns a box's size written in the colours of the policies that
      decide it, the width in one and the height in the other, so that what
      a box is made of can be read without selecting it. The darker shade of
      each colour is used, since the lighter one is what the box is painted
      and does not carry against a white page. */
  private static sizeOf(box: Box, chosen: boolean): React.ReactNode {
    const arrow = (() => {
      if(box.repeatDirection === null) {
        return '';
      }
      return REPEAT_GLYPH[box.repeatDirection];
    })();
    if(chosen) {
      return `${box.width}x${box.height}${arrow}`;
    }
    return (
      <React.Fragment>
        <span style={{color: POLICY_EDGE[box.widthPolicy]}}>{box.width}</span>
        x
        <span style={{color: POLICY_EDGE[box.heightPolicy]}}>
          {box.height}
        </span>
        {arrow !== '' &&
          <span style={{color: REPEAT_DIRECTION}}>{arrow}</span>}
      </React.Fragment>);
  }

  /** Returns everything a section holds that can be opened or shut. */
  private static under(component: Component): object[] {
    const nodes = [component as object];
    for(const layout of OutlinePanel.scenariosOf(component)) {
      nodes.push(layout);
      for(const overlay of layout.overlays) {
        nodes.push(overlay);
      }
    }
    return nodes;
  }

  /** Returns the scenarios a section is made of, without the blank waiting
      at the end for the next one to be drawn into. That blank is how a
      scenario is added rather than a scenario in its own right, and it is
      dropped when the specification is written out. A blank left in the
      middle is deliberate and stays. */
  private static scenariosOf(component: Component): Layout[] {
    const scenarios = component.layouts.slice();
    while(scenarios.length > 1 && isBlank(scenarios[scenarios.length - 1])) {
      scenarios.pop();
    }
    return scenarios;
  }

  /** Returns the boxes in the order they are read on the canvas rather than
      the order they happen to be drawn in, which is the order they were put
      there rather than where they now sit. */
  private static reading(boxes: Box[]): Box[] {
    return boxes.slice().sort((left, right) => {
      if(left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });
  }

  private static conditionOf(layout: Layout, index: number): string {
    if(index === 0) {
      return 'default';
    }
    if(layout.condition === '') {
      return 'no condition';
    }
    return layout.condition;
  }

  /** Returns what a box is called, half of them standing for space alone and
      carrying no name to show. */
  private static nameOf(box: Box): string {
    if(box.name === '') {
      return 'space';
    }
    return `<${box.name}>`;
  }

  private static readonly STYLE = {
    panel: {
      position: 'relative' as 'relative',
      flexShrink: 0,
      display: 'flex',
      borderRight: '1px solid #C8C8C8',
      backgroundColor: '#FFFFFF',
      fontSize: '12px'
    },
    tree: {
      position: 'relative' as 'relative',
      flexGrow: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column' as 'column',
      padding: '12px 0',
      overflow: 'auto' as 'auto'
    },
    grip: {
      position: 'absolute' as 'absolute',
      top: 0,
      bottom: 0,
      right: '-3px',
      width: '7px',
      cursor: 'col-resize',
      zIndex: 1
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: `${GAP}px`
    },
    amiss: {
      color: PROBLEM_COLOR
    },
    warned: {
      color: WARNING_COLOR
    },
    editing: {
      fontWeight: 700
    },
    working: {
      backgroundColor: '#F0ECFA'
    },
    hovered: {
      backgroundColor: '#F5F5F5'
    },
    dragging: {
      backgroundColor: '#F0ECFA'
    },
    indicator: {
      position: 'absolute' as 'absolute',
      right: '8px',
      display: 'flex',
      alignItems: 'center',
      height: `${INDICATOR_HEIGHT}px`,
      pointerEvents: 'none' as 'none'
    },
    indicatorDot: {
      flexShrink: 0,
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      border: '2px solid #684BC7',
      backgroundColor: '#FFFFFF',
      boxSizing: 'border-box' as 'border-box'
    },
    indicatorLine: {
      flexGrow: 1,
      height: '2px',
      backgroundColor: '#684BC7'
    },
    chosen: {
      backgroundColor: '#684BC7',
      color: '#FFFFFF'
    },
    twist: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexShrink: 0,
      padding: 0,
      border: 'none',
      backgroundColor: 'transparent',
      color: 'inherit',
      fontSize: '10px',
      lineHeight: '18px',
      cursor: 'pointer'
    },
    label: {
      display: 'flex',
      alignItems: 'center',
      flexGrow: 1,
      minWidth: 0,
      padding: '2px 0',
      paddingRight: '8px',
      border: 'none',
      backgroundColor: 'transparent',
      color: 'inherit',
      fontFamily: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      cursor: 'pointer'
    },
    name: {
      flexGrow: 1,
      minWidth: 0,
      textAlign: 'left' as 'left',
      whiteSpace: 'nowrap' as 'nowrap',
      overflow: 'hidden' as 'hidden',
      textOverflow: 'ellipsis'
    },
    note: {
      flexShrink: 0,
      fontSize: '11px',
      color: '#999999'
    }
  };
}

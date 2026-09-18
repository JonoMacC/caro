import * as React from 'react';
import { Box, RepeatDirection, SizePolicy } from '../layout';
import { boxAt, extentOf } from './arrange';
import { POLICY_COLOR, POLICY_EDGE, POLICY_INK,
  REPEAT_DIRECTION } from './palette';
import { REPEAT_GLYPH, runsFrom } from './repeat';

/** The distance a press must cover before it draws or drags, in pixels of
    screen. */
const DRAG_THRESHOLD = 4;

/** The fraction of the canvas a drawn box must span to be taken as filling
    it. */
const FILL_RATIO = 0.8;

/** The smallest a box may be resized to. */
export const MINIMUM_SIZE = 1;

/** How thick a box's policy edges are painted, in pixels of screen. */
const EDGE = 3;

/** How thick the ring around a selected box is painted, in pixels of
    screen, held to that regardless of the canvas's zoom. */
const RING = 1;

/** How thick the line separating a selected box's ring from the policy
    edge beneath it is painted, in pixels of screen, held to that
    regardless of the canvas's zoom. Without it the ring's colour can be
    hard to tell apart from a policy edge of a similar shade. */
const HALO = 1;

/** How thick the box-creation marquee's border is painted, in pixels of
    screen. */
const MARQUEE_BORDER = 2;

/** How thick the ring around a hovered box is painted, in pixels of
    screen, held to that regardless of the canvas's zoom. Thicker than the
    selected ring so the two read as different states. */
const HOVER_RING = 2;

/** How close to an edge the cursor must be to resize a box, in pixels of
    screen. */
const RESIZE_MARGIN = 8;

/** How far the delete control sits inside a box's corner. */
const DELETE_INSET = 10;

/** The smallest box that has room for a delete control. */
const DELETE_ROOM = 44;

/** How wide the delete control is drawn. */
const DELETE_DIAMETER = 18;

/** How large the glyph inside the delete control is drawn. */
const GLYPH_SIZE = 13;

/** How large the name inside a box is drawn. */
const LABEL_SIZE = 12;

/** How wide a box's inline name editor starts, in pixels of screen, before
    it grows to fit whatever is typed into it. */
const RENAME_WIDTH = 96;

/** How large the arrow marking which way a box repeats is drawn. */
const REPEAT_SIZE = 15;

/** How far that arrow sits inside the edge it marks. */
const REPEAT_INSET = 4;

/** How large the prompt on an empty canvas is drawn. */
const HINT_SIZE = 13;

/** How far apart two edges may be and still count as aligned. */
const ALIGN_TOLERANCE = 0.5;

/** How close a dragged or resized edge must come to another box's edge to
    snap to it, in pixels of screen, held to that regardless of the
    canvas's zoom. */
const SNAP_DISTANCE = 6;

/** How thick the ring around a box aligned with a snap is painted, in
    pixels of screen, held to that regardless of the canvas's zoom. */
const ALIGN_RING = 2;

/** How thick a snap guide is painted, in pixels of screen, held to that
    regardless of the canvas's zoom. */
const GUIDE_THICKNESS = 1;

/** The smallest a canvas is drawn, whatever it holds. */
const FLOOR = {width: 400, height: 300};

/** The gesture a press has turned into. */
enum Gesture {
  NONE,
  DRAW,
  DRAG,
  RESIZE
}

interface Point {
  x: number;
  y: number;
}

interface Guide {
  vertical: boolean;
  offset: number;

  /** The span the guide is drawn across, along the axis it doesn't sit
      on: the whole canvas for a guide following an edge, but only from
      the center of the box it followed to the far edge of the box it
      matched for one following a center. */
  from: number;
  to: number;
}

/** A request to bring a box into view, made afresh each time one is asked
    for so that asking twice for the same box is two requests. */
export interface Reveal {
  box: Box;
}

/** A box and the place it held when a gesture began. */
interface Held {
  box: Box;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The edges a resize has hold of. */
interface Handle {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** The boxes a press takes hold of, and the edges of them it has. */
interface Grasp {
  handle: Handle;
  boxes: Box[];
}

interface Properties {

  /** The boxes being drawn. */
  boxes: Box[];

  /** How much the canvas is magnified, 1 being its literal size. */
  zoom: number;

  /** The boxes currently selected, empty when none are. */
  selection: Box[];

  /** The box the cursor rests on, null when none does. */
  hovered: Box;

  /** Whether this is the canvas being worked in, the one a paste goes
      into. */
  active: boolean;

  /** The box to bring into view, null when none has been asked for. */
  reveal: Reveal;

  /** Called when the selection changes, adding to it rather than replacing
      it when asked, and naming the boxes of the canvas it changed in. */
  onSelect?: (boxes: Box[], extend: boolean, holder: Box[]) => void;

  /** Called when the cursor rests on a box or leaves it, naming null in
      the latter case. */
  onHover?: (box: Box) => void;

  /** Called whenever the layout has been modified. */
  onChange?: () => void;

  /** Called when a gesture is over and the change it made is complete. */
  onCommit?: () => void;

  /** Called when the selected box is deleted from the canvas. */
  onRemove?: () => void;

  /** Called to rename a box. */
  onRenameBox?: (box: Box, name: string) => void;
}

interface State {
  gesture: Gesture;
  origin: Point;
  current: Point;
  handle: Handle;
  guides: Guide[];
  aligned: Box[];
  renaming: Box;
  draft: string;
  editorWidth: number;
}

/** Displays a layout, letting boxes be drawn into it and moved around it. */
export class LayoutCanvas extends React.Component<Properties, State> {
  constructor(props: Properties) {
    super(props);
    this.state = {
      gesture: Gesture.NONE,
      origin: null,
      current: null,
      handle: null,
      guides: [],
      aligned: [],
      renaming: null,
      draft: '',
      editorWidth: RENAME_WIDTH
    };
    this.held = [];
    this.active = false;
    this.identifiers = new WeakMap<Box, string>();
    this.count = 0;
    this.extend = false;
    this.pointer = null;
    this.cancelling = false;
    this.focused = null;
    this.renameArmed = false;
    this.ownSelect = false;
  }

  public render(): JSX.Element {
    const extent = this.extent();
    return (
      <div ref={element => this.container = element} data-canvas=''
          data-keeps-selection=''
          style={{...LayoutCanvas.STYLE.container, zoom: this.props.zoom,
            width: `${extent.width}px`, height: `${extent.height}px`,
            ...this.activeStyle(),
            ...LayoutCanvas.cursorFor(this.state.handle)}}
          onMouseDown={this.onMouseDown} onMouseMove={this.onHover}
          onMouseLeave={this.onLeave}>
        {this.props.boxes.map(this.renderBox)}
        {this.renderRubberBand()}
        {this.state.guides.map(this.renderGuide)}
        {this.props.boxes.length === 0 &&
          <div style={{...LayoutCanvas.STYLE.hint,
            fontSize: `${this.local(HINT_SIZE)}px`}}>
            Drag to draw a box.
          </div>}
      </div>);
  }

  public componentDidMount(): void {
    this.show();
  }

  public componentDidUpdate(previous: Properties): void {
    if(this.ownSelect) {
      this.ownSelect = false;
    } else if(previous.selection !== this.props.selection) {
      this.focused = null;
    }
    this.show();
    if(this.state.gesture !== Gesture.NONE || this.pointer === null ||
        this.container === null) {
      return;
    }
    const handle = this.handleAt(this.pointOf(this.pointer));
    if(LayoutCanvas.sameHandle(handle, this.state.handle)) {
      return;
    }
    this.setState({handle});
  }

  public componentWillUnmount(): void {
    this.detachListeners();
  }

  private container: HTMLDivElement;
  private elements = new WeakMap<Box, HTMLDivElement>();
  private shown: Reveal = null;
  private pointer: {clientX: number, clientY: number};
  private held: Held[];
  private active: boolean;
  private identifiers: WeakMap<Box, string>;
  private count: number;
  private extend: boolean;
  private cancelling: boolean;

  /** This canvas's own notion of "focus": the box a click here last made
      the current selection, as opposed to the selection arriving some
      other way, such as through the outline panel. `componentDidUpdate` clears it
      whenever the selection changes for any reason other than this
      canvas's own `select()` call. */
  private focused: Box;

  private renameArmed: boolean;

  /** Set just before calling `onSelect`, and read (then cleared) by
      `componentDidUpdate` — marks a selection change as this canvas's own
      doing, so it knows not to treat it as the box losing focus (see
      `focused`). */
  private ownSelect: boolean;

  /** Scrolls a box asked for into view, once for each time it is asked
      for. Every canvas is asked, and the one holding the box answers. */
  private show(): void {
    if(this.props.reveal === this.shown) {
      return;
    }
    this.shown = this.props.reveal;
    if(this.props.reveal === null) {
      return;
    }
    const element = this.elements.get(this.props.reveal.box);
    if(element === undefined || element === null) {
      return;
    }
    element.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }

  /** Returns the marking that sets the canvas being worked in apart from
      the rest, shown only while its own selection is empty. An outline is used
      rather than a border, since the border is measured when a place on
      screen is turned into a place in the layout. Both markings name the
      same properties and differ only in their values, because a property
      dropped between renders is cleared rather than put back to what the
      container asked for. */
  private activeStyle() {
    if(!this.props.active || this.chosen().length > 0) {
      return LayoutCanvas.STYLE.idle;
    }
    return LayoutCanvas.STYLE.active;
  }

  /** Returns how much room the canvas needs, never less than its floor. */
  private extent() {
    const region = extentOf(this.props.boxes);
    return {
      width: Math.max(region.x + region.width, FLOOR.width),
      height: Math.max(region.y + region.height, FLOOR.height)
    };
  }

  private renderBox = (box: Box) => {
    const label = LayoutCanvas.labelOf(box);
    const marked = this.props.selection.indexOf(box) !== -1;
    const hovered = !marked && this.props.hovered === box;
    const selection = (() => {
      if(marked) {
        return this.selectedStyle();
      }
      if(hovered) {
        return this.hoverStyle();
      }
      return {};
    })();
    const alignment = (() => {
      if(this.state.aligned.indexOf(box) === -1) {
        return {};
      }
      return this.alignedStyle();
    })();
    const elevated = this.isHeld(box) ? LayoutCanvas.STYLE.elevated : {};
    return (
      <div key={this.keyOf(box)} data-keeps-selection=''
          data-selected={marked ? '' : undefined}
          data-hovered={hovered ? '' : undefined}
          ref={element => this.elements.set(box, element)}
          onMouseEnter={() => this.props.onHover?.(box)}
          onMouseLeave={() => this.props.onHover?.(null)}
          style={{...LayoutCanvas.STYLE.box,
            left: `${box.x}px`, top: `${box.y}px`,
            width: `${box.width}px`, height: `${box.height}px`,
            ...this.paintFor(box, marked, hovered), ...selection,
            ...alignment, ...elevated,
            ...LayoutCanvas.cursorFor(this.state.handle)}}>
        {this.state.renaming === box ?
          <input style={{...LayoutCanvas.STYLE.renameInput,
              fontSize: `${this.local(LABEL_SIZE)}px`,
              padding: `0 ${this.local(4)}px`,
              outlineWidth: `${this.local(1)}px`,
              outlineOffset: `-${this.local(1)}px`,
              width: `${this.local(this.state.editorWidth)}px`}}
              autoFocus ref={this.selectOnMount}
              value={this.state.draft}
              onMouseDown={event => event.stopPropagation()}
              onChange={event => this.onRenameChange(event.target)}
              onKeyDown={event => {
                event.stopPropagation();
                if(event.key === 'Escape') {
                  this.cancelRename();
                } else if(event.key === 'Enter') {
                  this.submitRename();
                }
              }}
              onBlur={this.submitRename}/> :
          label !== '' &&
            <span data-box-label='' style={{...LayoutCanvas.STYLE.label,
              ...LayoutCanvas.inkFor(box),
              fontSize: `${this.local(LABEL_SIZE)}px`}}>{label}</span>}
        {this.renderRepeat(box)}
        {this.renderDelete(box)}
      </div>);
  }

  /** Selects an input's text once, when it is first mounted, rather than
      on every re-render — a fresh inline function passed as `ref` would
      make React re-invoke it (and so re-select, clobbering whatever has
      since been typed) on every keystroke. */
  private selectOnMount = (element: HTMLInputElement) => {
    element?.select();
  }

  /** Grows the editor to fit what has been typed, never shrinking below
      `RENAME_WIDTH`. `editorWidth` is in pixels of screen (unlike most
      sizes here, which are pixels of layout) — `local()` is applied once,
      at the point the width is actually rendered. The text itself is
      measured rather than read from the field's own `scrollWidth`, which
      reflects the field's current (already-grown) box once nothing
      overflows it, not the natural width of what's typed — relying on it
      would ratchet the box wider by the same amount on every keystroke,
      however short the name. */
  private onRenameChange(field: HTMLInputElement): void {
    const width = LayoutCanvas.measure(field.value,
      `700 ${LABEL_SIZE}px Roboto, Segoe UI, sans-serif`);
    const grown = Math.max(RENAME_WIDTH, width + 8);
    this.setState({draft: field.value, editorWidth: grown});
  }

  /** Returns how wide a string renders in a given font, in pixels of
      screen, independent of any element's own current box size. */
  private static measure(text: string, font: string): number {
    const context = LayoutCanvas.measurer.getContext('2d');
    context.font = font;
    return context.measureText(text).width;
  }

  private static readonly measurer = document.createElement('canvas');

  /** Marks which way a repeating box repeats with an arrow on the edge it
      runs from, the direction being nothing the box's own shape can say. */
  private renderRepeat(box: Box): JSX.Element {
    if(box.repeatDirection === null) {
      return null;
    }
    return (
      <span style={{...LayoutCanvas.STYLE.repeat,
          ...LayoutCanvas.placeFor(box.repeatDirection,
            this.local(REPEAT_INSET)),
          fontSize: `${this.local(REPEAT_SIZE)}px`}}
          title={`Repeats ${box.repeatDirection}`}>
        {REPEAT_GLYPH[box.repeatDirection]}
      </span>);
  }

  private renderDelete(box: Box): JSX.Element {
    if(this.props.selection.length !== 1 ||
        this.props.selection[0] !== box ||
        this.state.gesture !== Gesture.NONE) {
      return null;
    }
    const room = this.local(DELETE_ROOM);
    if(box.width < room || box.height < room) {
      return null;
    }
    return (
      <button style={{...LayoutCanvas.STYLE.remove,
          top: `${this.local(DELETE_INSET)}px`,
          right: `${this.local(DELETE_INSET)}px`,
          width: `${this.local(DELETE_DIAMETER)}px`,
          height: `${this.local(DELETE_DIAMETER)}px`,
          borderRadius: `${this.local(DELETE_DIAMETER / 2)}px`,
          fontSize: `${this.local(GLYPH_SIZE)}px`}} title='Delete'
        onMouseDown={this.onRemove}>{'\u00D7'}</button>);
  }

  private onRemove = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    this.props.onRemove?.();
  }

  private renderRubberBand(): JSX.Element {
    if(this.state.gesture !== Gesture.DRAW || !this.isActive()) {
      return null;
    }
    const region = this.measure();
    return (
      <div style={{...LayoutCanvas.STYLE.rubberBand,
        border: `${this.local(MARQUEE_BORDER)}px dashed #684BC7`,
        left: `${region.x}px`, top: `${region.y}px`,
        width: `${region.width}px`, height: `${region.height}px`}}/>);
  }

  private renderGuide = (guide: Guide, index: number) => {
    const thickness = `${this.local(GUIDE_THICKNESS)}px`;
    const span = `${guide.to - guide.from}px`;
    const style = (() => {
      if(guide.vertical) {
        return {left: `${guide.offset}px`, top: `${guide.from}px`,
          height: span, width: thickness};
      }
      return {top: `${guide.offset}px`, left: `${guide.from}px`,
        width: span, height: thickness};
    })();
    return (
      <div key={index}
        style={{...LayoutCanvas.STYLE.guide, ...style}}/>);
  }

  /** Converts a length in pixels of screen into one in the layout. */
  private local(value: number): number {
    return value / this.props.zoom;
  }

  /** Returns the outline marking a selected box. */
  private selectedStyle() {
    const ring = this.local(RING);
    return {
      outline: `${ring}px solid #684BC7`,
      outlineOffset: `-${ring}px`
    };
  }

  /** Returns the outline marking a hovered box. */
  private hoverStyle() {
    const ring = this.local(HOVER_RING);
    return {
      outline: `${ring}px solid #684BC7`,
      outlineOffset: `-${ring}px`
    };
  }

  /** Returns the outline marking a box aligned with a snap. */
  private alignedStyle() {
    const ring = this.local(ALIGN_RING);
    return {
      outline: `${ring}px solid #E63F44`,
      outlineOffset: `-${ring}px`
    };
  }

  /** Converts a place on screen into a place in the layout. */
  private pointOf(place: {clientX: number, clientY: number}): Point {
    const bounds = this.container.getBoundingClientRect();
    return {
      x: this.local(place.clientX - bounds.left) - this.container.clientLeft,
      y: this.local(place.clientY - bounds.top) - this.container.clientTop
    };
  }

  /** Returns the rectangle a press has swept out. */
  private measure() {
    const origin = this.state.origin;
    const current = this.state.current;
    return {
      x: Math.min(origin.x, current.x),
      y: Math.min(origin.y, current.y),
      width: Math.abs(current.x - origin.x),
      height: Math.abs(current.y - origin.y)
    };
  }

  /** Returns whether a press has become a gesture. Once it has, it stays
      one: a cursor brought back to where it started has still travelled, and
      a drag that stopped counting there would leave the box behind wherever
      it last looked far enough away. */
  private isActive(): boolean {
    if(this.state.gesture === Gesture.NONE) {
      return false;
    }
    if(this.active) {
      return true;
    }
    const region = this.measure();
    const threshold = this.local(DRAG_THRESHOLD);
    this.active = region.width >= threshold || region.height >= threshold;
    return this.active;
  }

  /** Returns the edges of a set of boxes a point has hold of, or null when
      it has hold of none of them, taking a point outside them only when
      asked to reach beyond their edges. */
  private handleFor(boxes: Box[], point: Point, beyond: boolean): Handle {
    if(boxes.length === 0) {
      return null;
    }
    const region = extentOf(boxes);
    const across = Math.min(this.local(RESIZE_MARGIN), region.width / 3);
    const down = Math.min(this.local(RESIZE_MARGIN), region.height / 3);
    const reach = (() => {
      if(beyond) {
        return {across, down};
      }
      return {across: 0, down: 0};
    })();
    if(point.x < region.x - reach.across ||
        point.x > region.x + region.width + reach.across ||
        point.y < region.y - reach.down ||
        point.y > region.y + region.height + reach.down) {
      return null;
    }
    const handle = {
      left: Math.abs(point.x - region.x) <= across,
      right: Math.abs(point.x - (region.x + region.width)) <= across,
      top: Math.abs(point.y - region.y) <= down,
      bottom: Math.abs(point.y - (region.y + region.height)) <= down
    };
    if(!handle.left && !handle.right && !handle.top && !handle.bottom) {
      return null;
    }
    return handle;
  }

  /** Returns what a point takes hold of: the selection when the point is at
      its edges, otherwise the topmost box whose edges it is at, or null when
      it takes hold of nothing. Boxes the point lies within are asked first,
      so that the edge between two touching boxes belongs to the one the
      point is actually over, and a box only reaches past its edges over the
      empty canvas beside it. */
  private grasp(point: Point): Grasp {
    const chosen = this.chosen();
    const held = this.handleFor(chosen, point, true);
    if(held !== null) {
      return {handle: held, boxes: chosen};
    }
    const within = this.nearest(point, false);
    if(within !== null) {
      return within;
    }
    if(boxAt(this.props.boxes, point.x, point.y) !== null) {
      return null;
    }
    return this.nearest(point, true);
  }

  /** Returns the topmost box a point has an edge of, or null when it has
      none of them. */
  private nearest(point: Point, beyond: boolean): Grasp {
    for(let index = this.props.boxes.length - 1; index >= 0; index -= 1) {
      const box = this.props.boxes[index];
      const handle = this.handleFor([box], point, beyond);
      if(handle !== null) {
        return {handle, boxes: [box]};
      }
    }
    return null;
  }

  /** Returns the edges a point has hold of, or null when it has hold of none
      of them. */
  private handleAt(point: Point): Handle {
    const grasp = this.grasp(point);
    if(grasp === null) {
      return null;
    }
    return grasp.handle;
  }

  /** Returns the selected boxes that are on this canvas. */
  private chosen(): Box[] {
    return this.props.boxes.filter(
      box => this.props.selection.indexOf(box) !== -1);
  }

  /** Whether a box is one of the ones currently being dragged or resized,
      so its own render can bring it to the front — a purely visual
      reordering; the array `boxes` (and so the outline panel's own order)
      is never touched. `held` alone isn't enough to answer this, since it
      stays populated after a gesture ends. */
  private isHeld(box: Box): boolean {
    if(this.state.gesture !== Gesture.DRAG &&
        this.state.gesture !== Gesture.RESIZE) {
      return false;
    }
    return this.held.some(held => held.box === box);
  }

  private onHover = (event: React.MouseEvent) => {
    this.pointer = {clientX: event.clientX, clientY: event.clientY};
    if(this.state.gesture !== Gesture.NONE) {
      return;
    }
    const handle = this.handleAt(this.pointOf(event));
    if(LayoutCanvas.sameHandle(handle, this.state.handle)) {
      return;
    }
    this.setState({handle});
  }

  private onLeave = () => {
    this.pointer = null;
    if(this.state.gesture === Gesture.NONE && this.state.handle !== null) {
      this.setState({handle: null});
    }
  }

  private onMouseDown = (event: React.MouseEvent) => {
    const point = this.pointOf(event);
    this.extend = event.shiftKey;
    this.active = false;
    event.preventDefault();
    this.attach();
    const grasp = (() => {
      if(this.extend) {
        return null;
      }
      return this.grasp(point);
    })();
    if(grasp !== null) {
      this.hold(grasp.boxes);
      if(grasp.boxes.length === 1 &&
          this.props.selection.indexOf(grasp.boxes[0]) === -1) {
        this.select(grasp.boxes, false);
      }
      this.setState({gesture: Gesture.RESIZE, handle: grasp.handle,
        origin: point, current: point});
      return;
    }
    const picked = boxAt(this.props.boxes, point.x, point.y);
    if(picked === null) {
      this.focused = null;
      this.hold([]);
      this.setState({gesture: Gesture.DRAW, handle: null, origin: point,
        current: point});
      return;
    }
    const taken = this.props.selection.indexOf(picked) !== -1;
    const sole = taken && this.props.selection.length === 1;
    const doubleClicked = event.detail >= 2;
    const labelHit = (event.target as Element).closest?.(
      '[data-box-label]') != null;
    // A box can be renamed by a real double-click anywhere on it, or by a
    // single click on its own label once it is focused — see `focused`.
    this.renameArmed = sole &&
      (doubleClicked || (labelHit && picked === this.focused));
    this.focused = picked;
    const moving = (() => {
      if(this.extend || !taken) {
        return [picked];
      }
      return this.chosen();
    })();
    this.hold(moving);
    if(!this.extend && !taken) {
      this.select([picked], false);
    }
    this.setState({gesture: Gesture.DRAG, handle: null, origin: point,
      current: point});
  }

  /** Remembers where a set of boxes sat when a gesture began. */
  private hold(boxes: Box[]): void {
    this.held = boxes.map(box => ({box, x: box.x, y: box.y,
      width: box.width, height: box.height}));
  }

  /** Puts the held boxes back where they stood when the gesture began. */
  private restore(): void {
    for(const held of this.held) {
      held.box.x = held.x;
      held.box.y = held.y;
      held.box.width = held.width;
      held.box.height = held.height;
    }
  }

  private onMouseMove = (event: MouseEvent) => {
    this.pointer = {clientX: event.clientX, clientY: event.clientY};
    const point = this.pointOf(event);
    this.setState({current: point}, () => {
      if(!this.isActive()) {
        return;
      }
      if(this.state.gesture === Gesture.DRAG) {
        this.move(point);
      } else if(this.state.gesture === Gesture.RESIZE) {
        this.resize(point);
      }
      this.setState(this.measureGuides());
    });
  }

  /** Moves the held boxes by however far the cursor has travelled, pulled
      the rest of the way to a nearby edge when it comes close enough. */
  private move(point: Point): void {
    const across = point.x - this.state.origin.x;
    const down = point.y - this.state.origin.y;
    const shift = {
      x: Math.max(across, -Math.min(...this.held.map(held => held.x))),
      y: Math.max(down, -Math.min(...this.held.map(held => held.y)))
    };
    const snapped = this.snap(shift);
    for(const held of this.held) {
      held.box.x = Math.round(held.x + snapped.x);
      held.box.y = Math.round(held.y + snapped.y);
    }
    this.props.onChange?.();
  }

  /** Pulls a drag's shift toward a nearby box's edge, using the same
      bounding region the alignment guides already measure, so landing
      close is as good as landing exactly. */
  private snap(shift: Point): Point {
    const distance = this.local(SNAP_DISTANCE);
    const left = Math.min(...this.held.map(held => held.x)) + shift.x;
    const right = Math.max(
      ...this.held.map(held => held.x + held.width)) + shift.x;
    const top = Math.min(...this.held.map(held => held.y)) + shift.y;
    const bottom = Math.max(
      ...this.held.map(held => held.y + held.height)) + shift.y;
    const across = LayoutCanvas.closest([left, right, (left + right) / 2],
      this.targetsAlong(true), distance);
    const down = LayoutCanvas.closest([top, bottom, (top + bottom) / 2],
      this.targetsAlong(false), distance);
    return {
      x: Math.max(shift.x + across,
        -Math.min(...this.held.map(held => held.x))),
      y: Math.max(shift.y + down,
        -Math.min(...this.held.map(held => held.y)))
    };
  }

  /** Returns every edge and center along an axis belonging to a box
      other than the ones the current gesture holds, for a drag or
      resize to line up against. */
  private targetsAlong(vertical: boolean): number[] {
    const moving = this.held.map(held => held.box);
    const targets = [] as number[];
    for(const other of this.props.boxes) {
      if(moving.indexOf(other) !== -1) {
        continue;
      }
      targets.push(vertical ? other.x : other.y,
        vertical ? other.right : other.bottom,
        vertical ? other.x + other.width / 2 : other.y + other.height / 2);
    }
    return targets;
  }

  /** Returns the smallest correction that lands one of the given
      positions on one of the given edges, or 0 if none is within
      distance. */
  private static closest(positions: number[], edges: number[],
      distance: number): number {
    let best = 0;
    let found = null as number;
    for(const position of positions) {
      for(const edge of edges) {
        const delta = edge - position;
        if(Math.abs(delta) > distance) {
          continue;
        }
        if(found === null || Math.abs(delta) < Math.abs(found)) {
          found = delta;
          best = delta;
        }
      }
    }
    return best;
  }

  /** Resizes the held boxes, moving only the edges the press has hold of,
      pulled the rest of the way to a nearby edge when it comes close
      enough. */
  private resize(point: Point): void {
    this.restore();
    const handle = this.state.handle;
    const distance = this.local(SNAP_DISTANCE);
    const region = extentOf(this.held.map(held => held.box));
    const rawAcross = point.x - this.state.origin.x;
    const rawDown = point.y - this.state.origin.y;
    let across = rawAcross;
    if(handle.right) {
      across = rawAcross + LayoutCanvas.closest(
        [region.x + region.width + rawAcross], this.targetsAlong(true),
        distance);
    } else if(handle.left) {
      across = rawAcross + LayoutCanvas.closest(
        [region.x + rawAcross], this.targetsAlong(true), distance);
    }
    let down = rawDown;
    if(handle.bottom) {
      down = rawDown + LayoutCanvas.closest(
        [region.y + region.height + rawDown], this.targetsAlong(false),
        distance);
    } else if(handle.top) {
      down = rawDown + LayoutCanvas.closest(
        [region.y + rawDown], this.targetsAlong(false), distance);
    }
    for(const held of this.held) {
      if(handle.right && held.x + held.width >= region.x + region.width - 1) {
        held.box.width = Math.max(Math.round(held.width + across),
          MINIMUM_SIZE);
      }
      if(handle.left && held.x <= region.x + 1) {
        const rightEdge = held.x + held.width;
        const x = Math.min(Math.max(Math.round(held.x + across), 0),
          rightEdge - MINIMUM_SIZE);
        held.box.x = x;
        held.box.width = rightEdge - x;
      }
      if(handle.bottom &&
          held.y + held.height >= region.y + region.height - 1) {
        held.box.height = Math.max(Math.round(held.height + down),
          MINIMUM_SIZE);
      }
      if(handle.top && held.y <= region.y + 1) {
        const bottomEdge = held.y + held.height;
        const y = Math.min(Math.max(Math.round(held.y + down), 0),
          bottomEdge - MINIMUM_SIZE);
        held.box.y = y;
        held.box.height = bottomEdge - y;
      }
    }
    this.props.onChange?.();
  }

  private onMouseUp = () => {
    this.detachListeners();
    const gesture = this.state.gesture;
    const active = this.isActive();
    const region = this.measure();
    const origin = this.state.origin;
    this.setState({gesture: Gesture.NONE, handle: null, guides: [],
      aligned: []});
    if(!active) {
      if(gesture !== Gesture.RESIZE) {
        const picked = boxAt(this.props.boxes, origin.x, origin.y);
        if(!this.extend && picked !== null && this.renameArmed) {
          this.cancelling = false;
          this.setState({renaming: picked, draft: picked.name,
            editorWidth: RENAME_WIDTH});
          return;
        }
        const chosen = (() => {
          if(picked === null) {
            return [];
          }
          return [picked];
        })();
        this.select(chosen, this.extend);
      }
      return;
    }
    if(gesture !== Gesture.DRAW) {
      this.props.onCommit?.();
      return;
    }
    const box = this.build(region);
    this.props.boxes.push(box);
    this.select([box], false);
    this.props.onCommit?.();
  }

  /** Calls `onSelect`, marking the selection change it causes as this
      canvas's own doing (see `ownSelect`). */
  private select(boxes: Box[], extend: boolean): void {
    this.ownSelect = true;
    this.props.onSelect?.(boxes, extend, this.props.boxes);
  }

  /** Returns a box covering a drawn rectangle, clipped to the canvas so
      it's never created with a negative position. */
  private build(region: {x: number, y: number, width: number,
      height: number}): Box {
    const x = Math.max(region.x, 0);
    const y = Math.max(region.y, 0);
    const width = region.width - (x - region.x);
    const height = region.height - (y - region.y);
    const extent = this.extent();
    const widthPolicy = (() => {
      if(LayoutCanvas.fills(width, extent.width)) {
        return SizePolicy.FILL;
      }
      return SizePolicy.FIXED;
    })();
    const heightPolicy = (() => {
      if(LayoutCanvas.fills(height, extent.height)) {
        return SizePolicy.FILL;
      }
      return SizePolicy.FIXED;
    })();
    return new Box('', Math.round(x), Math.round(y),
      Math.max(Math.round(width), MINIMUM_SIZE),
      Math.max(Math.round(height), MINIMUM_SIZE), widthPolicy,
      heightPolicy);
  }

  private static fills(extent: number, available: number): boolean {
    return extent >= available * FILL_RATIO && extent <= available;
  }

  /** Measures what the boxes being moved line up with, on their edges or
      on their center. */
  private measureGuides(): {guides: Guide[], aligned: Box[]} {
    const moving = this.held.map(held => held.box);
    if(moving.length === 0) {
      return {guides: [], aligned: []};
    }
    const region = extentOf(moving);
    const verticals = [region.x, region.x + region.width];
    const horizontals = [region.y, region.y + region.height];
    const dragging = this.state.gesture === Gesture.DRAG;
    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    const extent = this.extent();
    const guides = [] as Guide[];
    const aligned = [] as Box[];
    for(const other of this.props.boxes) {
      if(moving.indexOf(other) !== -1) {
        continue;
      }
      const otherCenterX = other.x + other.width / 2;
      const otherCenterY = other.y + other.height / 2;
      const across = LayoutCanvas.collect(guides, verticals,
        [other.x, other.right, otherCenterX], true, 0, extent.height);
      const down = LayoutCanvas.collect(guides, horizontals,
        [other.y, other.bottom, otherCenterY], false, 0, extent.width);
      // The moved box's own center only counts as a snap point while
      // dragging -- a resize only moves one edge, so its center is
      // incidental to the resize rather than something the user placed.
      let centered = false;
      if(dragging && Math.abs(centerX - otherCenterX) <= ALIGN_TOLERANCE) {
        const far = LayoutCanvas.farEdge(centerY, other.y, other.bottom);
        LayoutCanvas.mark(guides, true, centerX,
          Math.min(centerY, far), Math.max(centerY, far));
        centered = true;
      }
      if(dragging && Math.abs(centerY - otherCenterY) <= ALIGN_TOLERANCE) {
        const far = LayoutCanvas.farEdge(centerX, other.x, other.right);
        LayoutCanvas.mark(guides, false, centerY,
          Math.min(centerX, far), Math.max(centerX, far));
        centered = true;
      }
      if(across || down || centered) {
        aligned.push(other);
      }
    }
    if(aligned.length > 0) {
      aligned.push(...moving);
    }
    return {guides, aligned};
  }

  /** Returns whichever of two edges is farther from a reference point,
      the "far edge" a center guide reaches for. */
  private static farEdge(from: number, a: number, b: number): number {
    return Math.abs(a - from) > Math.abs(b - from) ? a : b;
  }

  private static collect(guides: Guide[], moving: number[], edges: number[],
      vertical: boolean, from: number, to: number): boolean {
    let found = false;
    for(const position of moving) {
      for(const edge of edges) {
        if(Math.abs(position - edge) > ALIGN_TOLERANCE) {
          continue;
        }
        found = true;
        LayoutCanvas.mark(guides, vertical, edge, from, to);
      }
    }
    return found;
  }

  /** Adds a guide unless one already sits at the same offset. */
  private static mark(guides: Guide[], vertical: boolean, offset: number,
      from: number, to: number): void {
    const known = guides.some(guide => guide.vertical === vertical &&
      Math.abs(guide.offset - offset) <= ALIGN_TOLERANCE);
    if(!known) {
      guides.push({vertical, offset, from, to});
    }
  }

  private cancelRename(): void {
    this.cancelling = true;
    this.setState({renaming: null, draft: ''});
  }

  private submitRename = () => {
    if(this.cancelling) {
      this.cancelling = false;
      return;
    }
    const box = this.state.renaming;
    if(box === null) {
      return;
    }
    this.props.onRenameBox?.(box, this.state.draft);
    this.setState({renaming: null, draft: ''});
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if(event.key !== 'Escape') {
      return;
    }
    this.detachListeners();
    this.restore();
    this.setState({gesture: Gesture.NONE, handle: null, guides: [],
      aligned: []});
    this.props.onChange?.();
  }

  private attach(): void {
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private detachListeners(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private keyOf(box: Box): string {
    const identifier = this.identifiers.get(box);
    if(identifier !== undefined) {
      return identifier;
    }
    this.count += 1;
    const assigned = `box-${this.count}`;
    this.identifiers.set(box, assigned);
    return assigned;
  }

  private static labelOf(box: Box): string {
    if(box.name === '') {
      return '';
    }
    return `<${box.name}>`;
  }

  /** Returns the cursor an edge of the selection is grabbed by. */
  private static cursorFor(handle: Handle) {
    if(handle === null) {
      return {};
    }
    if((handle.left && handle.top) || (handle.right && handle.bottom)) {
      return {cursor: 'nwse-resize'};
    }
    if((handle.right && handle.top) || (handle.left && handle.bottom)) {
      return {cursor: 'nesw-resize'};
    }
    if(handle.left || handle.right) {
      return {cursor: 'ew-resize'};
    }
    return {cursor: 'ns-resize'};
  }

  private static sameHandle(left: Handle, right: Handle): boolean {
    if(left === null || right === null) {
      return left === right;
    }
    return left.left === right.left && left.right === right.right &&
      left.top === right.top && left.bottom === right.bottom;
  }

  /** Returns the colour an edge is drawn in: the darker shade of its policy
      where it meets that policy's own fill, save on a repeat, which is left
      pale so that the edge it runs from is the only strong mark on it. */
  private static edgeFor(policy: SizePolicy, same: boolean) {
    if(same && policy !== SizePolicy.REPEAT) {
      return POLICY_EDGE[policy];
    }
    return POLICY_COLOR[policy];
  }

  /** Returns the painting a box carries: a policy colour along each edge,
      the strong purple along the edge a repeat runs from, a fill where
      both policies agree, and, on a selected or hovered box, a line of a
      neutral colour laid between its ring and the policy colour so the
      two are never read as one border. */
  private paintFor(box: Box, marked: boolean, hovered: boolean) {
    const same = box.widthPolicy === box.heightPolicy;
    const across = LayoutCanvas.edgeFor(box.widthPolicy, same);
    const down = LayoutCanvas.edgeFor(box.heightPolicy, same);
    const edges = {left: across, right: across, top: down, bottom: down};
    if(box.repeatDirection !== null) {
      edges[runsFrom(box.repeatDirection)] = REPEAT_DIRECTION;
    }
    const boxShadow = `inset ${EDGE}px 0 0 0 ${edges.left}, ` +
      `inset -${EDGE}px 0 0 0 ${edges.right}, ` +
      `inset 0 ${EDGE}px 0 0 ${edges.top}, ` +
      `inset 0 -${EDGE}px 0 0 ${edges.bottom}`;
    const painted = (() => {
      if(marked) {
        const rim = this.local(RING) + this.local(HALO);
        return `inset 0 0 0 ${rim}px #FFFFFF, ${boxShadow}`;
      }
      if(hovered) {
        const rim = this.local(HOVER_RING) + this.local(HALO);
        return `inset 0 0 0 ${rim}px #FFFFFF, ${boxShadow}`;
      }
      return boxShadow;
    })();
    if(!same) {
      return {boxShadow: painted};
    }
    return {boxShadow: painted, backgroundColor: POLICY_COLOR[box.widthPolicy]};
  }

  /** Returns where the repeat arrow sits, which is centred on the edge the
      copies run towards, opposite the edge that is marked. */
  private static placeFor(direction: RepeatDirection, inset: number) {
    if(direction === RepeatDirection.LEFT) {
      return {left: `${inset}px`, top: 0, bottom: 0, alignItems: 'center'};
    }
    if(direction === RepeatDirection.RIGHT) {
      return {right: `${inset}px`, top: 0, bottom: 0, alignItems: 'center'};
    }
    if(direction === RepeatDirection.UP) {
      return {top: `${inset}px`, left: 0, right: 0,
        justifyContent: 'center'};
    }
    return {bottom: `${inset}px`, left: 0, right: 0,
      justifyContent: 'center'};
  }

  private static inkFor(box: Box) {
    if(box.widthPolicy !== box.heightPolicy) {
      return {color: '#000000'};
    }
    return {color: POLICY_INK[box.widthPolicy]};
  }

  private static readonly STYLE = {
    container: {
      position: 'relative' as 'relative',
      alignSelf: 'flex-start',
      backgroundColor: '#FFFFFF',
      border: '1px solid #C8C8C8',
      cursor: 'crosshair',
      userSelect: 'none' as 'none'
    },
    box: {
      position: 'absolute' as 'absolute',
      boxSizing: 'border-box' as 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden' as 'hidden',
      backgroundColor: '#FAFAFA',
      cursor: 'move',
      fontSize: '12px'
    },
    active: {
      outline: '2px solid #684BC7',
      outlineOffset: '1px'
    },
    idle: {
      outline: '2px solid transparent',
      outlineOffset: '1px'
    },
    elevated: {
      zIndex: 1
    },
    remove: {
      position: 'absolute' as 'absolute',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      border: 'none',
      backgroundColor: '#684BC7',
      color: '#FFFFFF',
      cursor: 'pointer'
    },
    repeat: {
      position: 'absolute' as 'absolute',
      display: 'flex',
      color: REPEAT_DIRECTION,
      fontWeight: 700,
      lineHeight: 1,
      pointerEvents: 'none' as 'none'
    },
    label: {
      fontWeight: 700,
      whiteSpace: 'nowrap' as 'nowrap',
      overflow: 'hidden' as 'hidden'
    },
    renameInput: {
      boxSizing: 'border-box' as 'border-box',
      textAlign: 'center' as 'center',
      fontWeight: 700,
      fontFamily: 'inherit',
      border: 'none',
      outlineStyle: 'solid' as 'solid',
      outlineColor: '#684BC7',
      outlineOffset: '-1px',
      backgroundColor: '#FFFFFF',
      color: '#000000',
      cursor: 'text'
    },
    rubberBand: {
      position: 'absolute' as 'absolute',
      boxSizing: 'border-box' as 'border-box',
      backgroundColor: 'rgba(104, 75, 199, 0.1)',
      pointerEvents: 'none' as 'none'
    },
    guide: {
      position: 'absolute' as 'absolute',
      backgroundColor: '#E63F44',
      pointerEvents: 'none' as 'none',
      zIndex: 5
    },
    hint: {
      position: 'absolute' as 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      color: '#AAAAAA',
      pointerEvents: 'none' as 'none'
    }
  };
}

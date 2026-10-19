import * as React from 'react';
import { Box, RepeatDirection, SizePolicy } from '../layout';
import { POLICY_COLOR } from './palette';
import { directionsFor, REPEAT_GLYPH, repeats, setHeightPolicy,
  setWidthPolicy } from './repeat';

interface Properties {

  /** The boxes currently selected, empty when none are. */
  selection: Box[];

  /** Called when a property of the node changes, naming what was changed so
      that a run of changes to the same thing is taken back together. */
  onCommit?: (tag: string) => void;

  /** Called when the node is removed. */
  onRemove?: () => void;
}

/** Displays the properties of the selected node. */
export class NodeProperties extends React.Component<Properties> {
  public render(): JSX.Element {
    if(this.props.selection.length === 0) {
      return (
        <div style={NodeProperties.STYLE.panel} data-keeps-selection=''>
          <div style={NodeProperties.STYLE.empty}>
            Select a box to edit it.
          </div>
        </div>);
    }
    if(this.props.selection.length > 1) {
      return (
        <div style={NodeProperties.STYLE.panel} data-keeps-selection=''>
          <div style={NodeProperties.STYLE.empty}>
            {`${this.props.selection.length} boxes selected.`}
          </div>
        </div>);
    }
    const node = this.props.selection[0];
    return (
      <div style={NodeProperties.STYLE.panel} data-keeps-selection=''>
        <div style={NodeProperties.STYLE.heading}>Box</div>
        {
          <label style={NodeProperties.STYLE.field}>
            <span style={NodeProperties.STYLE.caption}>Name</span>
            <input style={NodeProperties.STYLE.input} value={node.name}
              onChange={this.onName} placeholder='Element:Name'/>
          </label>}
        {this.renderAxis('Width', node.widthPolicy, node.width,
          this.onWidthPolicy, this.onWidth)}
        {this.renderAxis('Height', node.heightPolicy, node.height,
          this.onHeightPolicy, this.onHeight)}
        {this.renderDirection(node)}
        <button style={NodeProperties.STYLE.remove}
            onClick={() => this.props.onRemove?.()}>
          Delete
        </button>
      </div>);
  }

  private renderAxis(caption: string, policy: SizePolicy, size: number,
      onPolicy: (policy: SizePolicy) => void,
      onSize: (event: React.ChangeEvent<HTMLInputElement>) => void) {
    return (
      <div style={NodeProperties.STYLE.field}>
        <span style={NodeProperties.STYLE.caption}>{caption}</span>
        <div style={NodeProperties.STYLE.choices} role='radiogroup'
            aria-label={`${caption} policy`}>
          {this.renderChoice(caption, 'Fixed', SizePolicy.FIXED, policy,
            onPolicy)}
          {this.renderChoice(caption, 'Fill', SizePolicy.FILL, policy,
            onPolicy)}
          {this.renderChoice(caption, 'Fit', SizePolicy.FIT, policy, onPolicy)}
          {this.renderChoice(caption, 'Repeat', SizePolicy.REPEAT, policy,
            onPolicy)}
        </div>
        <input style={NodeProperties.STYLE.input} type='number' min='0'
          value={size} onChange={onSize}/>
      </div>);
  }

  /** Shows which way a repeating box repeats, offering only the directions
      the axes it repeats along allow. */
  private renderDirection(node: Box) {
    if(!repeats(node)) {
      return null;
    }
    return (
      <div style={NodeProperties.STYLE.field} data-repeat=''>
        <span style={NodeProperties.STYLE.caption}>Repeats</span>
        <div style={NodeProperties.STYLE.arrows} role='radiogroup'
            aria-label='Repeat direction'>
          {directionsFor(node).map(direction =>
            this.renderArrow(direction, node.repeatDirection))}
        </div>
      </div>);
  }

  private renderArrow(direction: RepeatDirection, chosen: RepeatDirection) {
    return (
      <Choice key={direction} group='repeat-direction' value={direction}
          title={direction} checked={direction === chosen}
          style={NodeProperties.STYLE.arrow}
          onSelect={() => this.onDirection(direction)}>
        {REPEAT_GLYPH[direction]}
      </Choice>);
  }

  private renderChoice(axis: string, caption: string, value: SizePolicy,
      policy: SizePolicy, onPolicy: (policy: SizePolicy) => void) {
    return (
      <Choice key={value} group={`${axis.toLowerCase()}-policy`} value={value}
          checked={value === policy} style={NodeProperties.STYLE.choice}
          onSelect={() => onPolicy(value)}>
        <span style={{...NodeProperties.STYLE.swatch,
          backgroundColor: POLICY_COLOR[value]}}/>
        {caption}
      </Choice>);
  }

  private onName = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.selection[0].name = event.target.value;
    this.props.onCommit?.('name');
  }

  private onWidthPolicy = (policy: SizePolicy) => {
    setWidthPolicy(this.props.selection[0], policy);
    this.props.onCommit?.(null);
  }

  private onHeightPolicy = (policy: SizePolicy) => {
    setHeightPolicy(this.props.selection[0], policy);
    this.props.onCommit?.(null);
  }

  private onDirection = (direction: RepeatDirection) => {
    this.props.selection[0].repeatDirection = direction;
    this.props.onCommit?.(null);
  }

  private onWidth = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.selection[0].width = Number(event.target.value);
    this.props.onCommit?.('width');
  }

  private onHeight = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.selection[0].height = Number(event.target.value);
    this.props.onCommit?.('height');
  }

  private static readonly STYLE = {
    panel: {
      width: '240px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column' as 'column',
      gap: '16px',
      padding: '20px',
      borderLeft: '1px solid #C8C8C8',
      backgroundColor: '#FFFFFF'
    },
    heading: {
      fontSize: '14px',
      fontWeight: 700
    },
    empty: {
      fontSize: '12px',
      color: '#888888'
    },
    field: {
      display: 'flex',
      flexDirection: 'column' as 'column',
      gap: '6px'
    },
    caption: {
      fontSize: '12px',
      color: '#555555'
    },
    input: {
      boxSizing: 'border-box' as 'border-box',
      width: '100%',
      padding: '6px 8px',
      fontSize: '13px',
      border: '1px solid #C8C8C8'
    },
    choices: {
      display: 'flex',
      flexDirection: 'column' as 'column',
      gap: '4px'
    },
    arrows: {
      display: 'flex',
      gap: '4px'
    },
    arrow: {
      flexGrow: 1,
      textAlign: 'center' as 'center',
      padding: '6px 0',
      fontSize: '14px',
      lineHeight: '14px',
      cursor: 'pointer',
      border: '2px solid #E6E6E6',
      backgroundColor: '#FFFFFF'
    },
    choice: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 8px',
      fontSize: '12px',
      textAlign: 'left' as 'left',
      cursor: 'pointer',
      border: '2px solid #E6E6E6',
      backgroundColor: '#FFFFFF'
    },
    swatch: {
      width: '12px',
      height: '12px',
      flexShrink: 0,
      border: '1px solid rgba(0, 0, 0, 0.2)'
    },
    remove: {
      padding: '8px',
      fontSize: '12px',
      color: '#FFFFFF',
      backgroundColor: '#E63F44',
      border: 'none',
      cursor: 'pointer'
    }
  };
}

interface ChoiceProperties {

  /** The name shared by the choices that one of is picked. */
  group: string;

  /** The value this choice stands for. */
  value: string;

  /** Whether this is the choice that is picked. */
  checked: boolean;

  /** How the choice looks when it is not picked. */
  style: React.CSSProperties;

  /** What the choice is called when its content does not say. */
  title?: string;

  /** Called when the choice is picked. */
  onSelect: () => void;

  children?: React.ReactNode;
}

/** One of a group of radio buttons, drawn as the box its label makes, with
    the radio button itself left invisible but still focusable. */
class Choice extends React.Component<ChoiceProperties> {
  public render(): JSX.Element {
    const base = {...Choice.STYLE.label, ...this.props.style};
    const style = (() => {
      if(this.props.checked) {
        return {...base, ...Choice.STYLE.chosen, border: '2px solid #684BC7'};
      }
      return base;
    })();
    return (
      <label style={style} title={this.props.title}>
        <input type='radio' style={Choice.STYLE.radio}
          name={this.props.group} value={this.props.value}
          aria-label={this.props.title} checked={this.props.checked}
          onChange={this.props.onSelect}/>
        {this.props.children}
      </label>);
  }

  private static readonly STYLE = {
    label: {
      position: 'relative' as 'relative',
      fontFamily: 'Arial'
    },
    radio: {
      appearance: 'none' as 'none',
      position: 'absolute' as 'absolute',
      width: 0,
      height: 0,
      margin: 0,
      opacity: 0,
      pointerEvents: 'none' as 'none'
    },
    chosen: {
      fontWeight: 700
    }
  };
}

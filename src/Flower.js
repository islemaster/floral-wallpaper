import _ from 'lodash';
import {Map} from 'immutable';
import Genome from './Genome';
import * as SVG from './SVG';

// Might get applied either direction
const MAX_RPM = 60;

export default class Flower {
  constructor(genome = new Genome()) {
    this.dirty = true;
    this._isDomCreated = false;
    this.genome = genome;
    this.petalCount = genome.petalCount();
    this.board = null;
    this._currentCell = null;
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.rpm = 60;
    this.maxRpm = MAX_RPM;
    this._scale = 0.1;
    this._hovered = false;
    this._dragging = false;
  }

  createDom() {
    const genome = this.genome;
    this.gradient = SVG.create('linearGradient', {
      id: _.uniqueId(),
      x1: 0,
      x2: 0,
      y1: 1,
      y2: 0,
    });
    const colors = genome.petalColors();
    const gradientStops = genome.petalGradientStops();
    for (let i = 0; i < colors.length; i++) {
      const stop = SVG.create('stop', {
        'offset': gradientStops[i] + '%',
        'stop-color': colors[i],
      });
      this.gradient.appendChild(stop);
    }
    SVG.addToDefs(this.gradient);

    const strokeColor = '#420';
    const strokeOpacity = 0.4;

    // Create elements
    this.root = SVG.create('g');
    this.root.classList.add('grabbable');

    this.petals = _.range(this.petalCount).map(i => {
      const petal = SVG.create('ellipse', {
        'fill': `url(#${this.gradient.id})`,
        'stroke': strokeColor,
        'stroke-opacity': strokeOpacity,
      });
      return petal;
    });
    // Push petals in a deterministic skip-order because it z-orders better.
    const petalOrderingSkip = this.petals.length < 12 ? 2 : 3;
    for (let i = 0; i < petalOrderingSkip; i++) {
      for (let j = i; j < this.petals.length; j += petalOrderingSkip) {
        this.root.appendChild(this.petals[j]);
      }
    }

    this.petals.forEach((petal, i) => {
      petal.setAttribute('cx',0);
      petal.setAttribute('cy',-10);
      petal.setAttribute('rx', 2.5 + 2.5 * (8 / this.petalCount));
      petal.setAttribute('ry',10);
      petal.setAttribute('transform',`rotate(${(i * 360 / this.petalCount)})`);
    });

    this.center = SVG.create('circle', {
      'cx': 0,
      'cy': 0,
      'r': genome.centerSize(),
      'fill': genome.centerColor(),
      'stroke': strokeColor,
      'stroke-opacity': strokeOpacity,
    });
    this.root.appendChild(this.center);

    // Bind event handlers
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseUp = this.onMouseUp.bind(this);
    this._onTouchCancel = this.onTouchCancel.bind(this);
    this._onTouchMove = this.onTouchMove.bind(this);
    this._onTouchUp = this.onTouchUp.bind(this);

    // Attach event handlers
    this.root.addEventListener('mouseenter', this.onMouseEnter.bind(this), false);
    this.root.addEventListener('mouseleave', this.onMouseLeave.bind(this), false);
    this.root.addEventListener('mousedown', this.onMouseDown.bind(this), false);
    this.root.addEventListener('touchstart', this.onTouchStart.bind(this), false);

    SVG.addToRoot(this.root);

    this._isDomCreated = true;
  }

  destroy() {
    SVG.removeFromRoot(this.root);
    SVG.removeFromDefs(this.gradient);
  }

  setCell(board, cell) {
    this.board = board;
    this._currentCell = cell;
    const center = this.board.center(cell);
    this.x = center.x;
    this.y = center.y;
    this.dirty = true;
  }

  onMouseEnter() {
    this._hovered = true;
    // If not spinning pick a new direction
    if (this.rpm === 0) {
      this.maxRpm = Math.random() < 0.5 ? MAX_RPM : -MAX_RPM;
    }
    this.dirty = true;
  }

  onMouseLeave() {
    this._hovered = false;
  }

  onMouseDown() {
    document.addEventListener('mousemove', this._onMouseMove, false);
    document.addEventListener('mouseup', this._onMouseUp, false);
    this.onDragStart();
  }

  onMouseMove(event) {
    this.onDragMove(event);
  }

  onMouseUp() {
    this.onDragDrop();
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }

  onTouchStart(event) {
    if (this._dragging) { return; }
    this._firstTouch = event.touches[0];
    event.preventDefault();
    document.addEventListener('touchmove', this._onTouchMove, false);
    document.addEventListener('touchend', this._onTouchUp, false);
    document.addEventListener('touchcancel', this._onTouchCancel, false);
    this.onDragStart();
  }

  onTouchMove(event) {
    const touch = Object.values(event.changedTouches)
      .find(t => t.identifier === this._firstTouch.identifier);
    if (touch) {
      this.onDragMove(touch);
    }
  }

  onTouchUp(event) {
    event.preventDefault();
    const touch = Object.values(event.changedTouches)
      .find(t => t.identifier === this._firstTouch.identifier);
    if (touch) {
      this.onDragDrop();
      document.removeEventListener('touchmove', this._onTouchMove);
      document.removeEventListener('touchend', this._onTouchUp);
      document.removeEventListener('touchcancel', this._onTouchCancel);
    }
  }

  onTouchCancel() {
    event.preventDefault();
    this.onDragCancel();
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend', this._onTouchUp);
    document.removeEventListener('touchcancel', this._onTouchCancel);
  }

  /**
   * Begin moving a flower (common to mouse and touch)
   */
  onDragStart() {
    this._originalTargetCell = this._currentCell;
    this._dragging = true;

    this.root.classList.add('grabbed');
    this.root.classList.remove('grabbable');

    // Re-append element so it sorts above other elements while dragging
    SVG.addToRoot(this.root);
  }

  /**
   * Move a flower (common to mouse and touch)
   */
  onDragMove(interactionEvent) {
    const newPosition = SVG.getSVGMousePosition(interactionEvent);
    const targetCell = this.board.cellFromPoint(newPosition);

    // If cell is occupied or out of bounds, stay on the last spot we snapped
    // to.  Otherwise, snap to the new spot.
    if (!Map(targetCell).equals(Map(this._currentCell))
      && this.board.isInBounds(targetCell)
      && !this.board.get(targetCell)) {
      this.board.set(targetCell, this);
    }
  }

  /**
   * Drop a flower in a new location (common to mouse and touch)
   */
  onDragDrop() {
    this.onDragEnd();

    // If we dropped a flower at a new position, report that we made a move
    // and generate new flowers
    if (!Map(this._originalTargetCell).equals(Map(this._currentCell))) {
      this.board.resolveMoveAt(this._currentCell);
    }
  }

  /**
   * Stop moving a flower and return it to its original position without
   * making a move.
   */
  onDragCancel() {
    this.onDragEnd();

    // As a cancel event, we want to return the flower to its original position
    // and _not_ resolve a move.
    this.board.set(this._originalTargetCell, this);
  }

  /**
   * Cleanup used when we stop moving a flower, whether we've dropped it in a
   * new location or we've cancelled our move and returned it.
   */
  onDragEnd() {
    this.root.classList.remove('grabbed');
    this.root.classList.add('grabbable');
    this._dragging = false;
  }

  pulse() {
    this._scale = 1.2;
    this.dirty = true;
  }

  render(deltaT) {
    if (!this._isDomCreated) {
      this.createDom();
    }

    // Scale up when created
    if (this._scale < 1) {
      this._scale = Math.min(1, this._scale + deltaT / 200);
      this.dirty = true;
    } else if (this._scale > 1) {
      this._scale = Math.max(1, this._scale - deltaT / 1000);
      this.dirty = true;
    }

    // Spin when hovered or dragging
    if (this._hovered || this._dragging) {
      this.rpm += (this.maxRpm - this.rpm) / 3;
    } else {
      this.rpm = this.rpm * 0.9;
      if (Math.abs(this.rpm) < 0.5) {
        this.rpm = 0;
      }
    }

    if (this.rpm != 0) {
      const rpDeltaT = this.rpm * deltaT / 60000;
      this.rotation = (this.rotation + 360 * rpDeltaT) % 360;
      this.dirty = true;
    }

    this.root.setAttribute(`transform`,`translate(${this.x} ${this.y}) scale(${this._scale}) rotate(${this.rotation})`);
  }
}

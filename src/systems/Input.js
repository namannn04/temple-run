/**
 * Keyboard + touch (swipe / tap) input, mapped to game actions.
 */
export class Input {
  constructor(target = window) {
    this.handlers = {};
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map = {
        ArrowLeft: 'left', KeyA: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
        ArrowDown: 'slide', KeyS: 'slide',
        Escape: 'pause', KeyP: 'pause',
        Enter: 'confirm',
      };
      const action = map[e.code];
      if (action) {
        e.preventDefault();
        this.emit(action);
      }
    });

    // Swipe detection
    let sx = 0, sy = 0, st = 0, tracking = false, fired = false;
    const threshold = 28;
    target.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, select, label')) return;
      const t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; st = performance.now();
      tracking = true; fired = false;
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (!tracking || fired) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > threshold) {
        fired = true;
        if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
        else this.emit(dy > 0 ? 'slide' : 'jump');
      }
    }, { passive: true });
    target.addEventListener('touchend', () => {
      if (tracking && !fired && performance.now() - st < 250) this.emit('tap');
      tracking = false;
    }, { passive: true });
  }

  on(action, fn) {
    (this.handlers[action] ||= []).push(fn);
  }

  emit(action) {
    if (!this.enabled) return;
    for (const fn of this.handlers[action] || []) fn();
  }
}

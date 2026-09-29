const $ = (id) => document.getElementById(id);

/** DOM overlay: loader, HUD, menus, toasts. */
export class UI {
  constructor() {
    this.el = {
      loader: $('loader'), loaderFill: $('loader-fill'), loaderText: $('loader-text'),
      hud: $('hud'), score: $('score'), distance: $('distance'), coins: $('coins'), multiplier: $('multiplier'),
      powerups: $('powerups'), toast: $('toast'), danger: $('danger'),
      menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
      best: $('best-score'), finalScore: $('final-score'), finalDistance: $('final-distance'),
      finalCoins: $('final-coins'), newBest: $('new-best'), deathReason: $('death-reason'),
      quality: $('quality'),
    };
    this.toastTimer = null;
    this.last = {};
  }

  progress(p, text) {
    this.el.loaderFill.style.width = `${Math.round(p * 100)}%`;
    if (text) this.el.loaderText.textContent = text;
  }

  hideLoader() {
    this.el.loader.classList.remove('visible');
  }

  show(name) {
    for (const s of ['menu', 'pause', 'gameover']) this.el[s].classList.toggle('visible', s === name);
    this.el.hud.classList.toggle('hidden', !(name === 'hud' || name === 'pause'));
  }

  setBest(v) {
    this.el.best.textContent = Math.floor(v).toLocaleString();
  }

  // Only touch the DOM when a value actually changes
  set(key, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    this.el[key].textContent = value;
  }

  hud({ score, distance, coins, multiplier }) {
    this.set('score', Math.floor(score).toLocaleString());
    this.set('distance', Math.floor(distance).toLocaleString());
    this.set('coins', coins.toLocaleString());
    this.set('multiplier', multiplier);
  }

  powerups(list) {
    const key = list.map((p) => p.kind + Math.ceil(p.t * 10)).join();
    if (this.last.powerups === key) return;
    this.last.powerups = key;
    this.el.powerups.innerHTML = list
      .map((p) => `<div class="powerup">${p.kind === 'magnet' ? '🧲 MAGNET' : '🛡 SHIELD'}<div class="meter"><i style="width:${(p.t / p.max) * 100}%"></i></div></div>`)
      .join('');
  }

  danger(v) {
    this.el.danger.style.opacity = v.toFixed(2);
  }

  toast(text, ms = 1400) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  gameOver({ score, distance, coins, best, isBest, reason }) {
    this.el.finalScore.textContent = Math.floor(score).toLocaleString();
    this.el.finalDistance.textContent = `${Math.floor(distance).toLocaleString()} m`;
    this.el.finalCoins.textContent = coins.toLocaleString();
    this.el.newBest.classList.toggle('hidden', !isBest);
    this.el.deathReason.textContent = reason;
    this.setBest(best);
    this.show('gameover');
  }
}

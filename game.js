/* =========================================================================
   You VS You  -  standalone browser version (no server, just open index.html)
   A faithful port of the Python game: same fighters, same AI brains, same
   controls, same procedural 8-bit audio + interactive music, plus a Settings
   screen with difficulty (the original balance = MEDIUM).
   ========================================================================= */
"use strict";

/* ----------------------------- settings -------------------------------- */
const W = 1100, H = 700, FPS = 60;
const ARENA_MARGIN = 40;
const ARENA = { x: ARENA_MARGIN, y: ARENA_MARGIN, w: W - 2 * ARENA_MARGIN, h: H - 2 * ARENA_MARGIN };

const COL = {
  BLACK: "#0a0a10", BG: "#12121c", BG2: "#1a1a28", WHITE: "#ebebf5",
  GREY: "#78788c", DARKGREY: "#3c3c4e", RED: "#e64646", GREEN: "#5adc78",
  BLUE: "#5aaaff", YELLOW: "#fad25a", ORANGE: "#fa963c", PURPLE: "#be78ff",
  CYAN: "#5ae6e6", PLAYER: "#5aaaff", PLAYER_DARK: "#326ebe",
  GRID: "#202030",
};

const MAX_HP = 100, MAX_ENERGY = 100, ENERGY_REGEN = 0.55;
const MOVE_SPEED = 3.3, BLOCK_SPEED_MULT = 0.4, FIGHTER_RADIUS = 22;
const DASH_IMPULSE = 15, DASH_COST = 25, DASH_COOLDOWN = 28, DASH_IFRAMES = 8;
const CHARGE_MAX = 48, CHARGE_FULL = 38;
const BLOCK_DAMAGE_MULT = 0.18, BLOCK_FRONT_ARC = rad(120);
const ROUNDS_TO_WIN = 2;

const ATTACKS = {
  jab:   { windup: 4,  active: 4, recovery: 9,  reach: 74,  arc: 55,  damage: 7,  knockback: 6,  cost: 8,  color: [255,255,255] },
  heavy: { windup: 11, active: 6, recovery: 19, reach: 118, arc: 26,  damage: 24, knockback: 22, cost: 22, color: [250,150,60] },
  wide:  { windup: 17, active: 8, recovery: 21, reach: 98,  arc: 135, damage: 15, knockback: 11, cost: 26, color: [190,120,255] },
  kick:  { windup: 8,  active: 5, recovery: 15, reach: 78,  arc: 62,  damage: 9,  knockback: 30, cost: 18, color: [90,230,230] },
};

const OPPONENTS = [
  { name: "RUSTBLADE", color: "#e66e50", subtitle: "The Berserker", style: "aggressive", power: 0.6 },
  { name: "GLACIA",    color: "#78c8f0", subtitle: "The Wall",      style: "defensive",  power: 0.8 },
  { name: "VORTEX",    color: "#be82ff", subtitle: "The Trickster", style: "mobile",     power: 0.9 },
  { name: "YOU",       color: "#ff5a5a", subtitle: "Everything it knows, it learned from you", style: "mirror", power: 1.0 },
];

// difficulty scales enemy damage, attack cadence and prediction. MEDIUM = original.
const DIFFICULTY = {
  EASY:   { dmg: 0.7,  cadence: 1.25, predict: 0.6, smart: 0.8,  label: "EASY" },
  MEDIUM: { dmg: 1.0,  cadence: 1.0,  predict: 1.0, smart: 1.0,  label: "MEDIUM" },
  HARD:   { dmg: 1.35, cadence: 0.78, predict: 1.5, smart: 1.25, label: "HARD" },
};

/* ----------------------------- helpers --------------------------------- */
function rad(d) { return d * Math.PI / 180; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(a, b) { return a + Math.random() * (b - a); }
function randint(a, b) { return Math.floor(rand(a, b + 1)); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rgba(rgb, a) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }
function angDiff(a, b) {
  let d = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}
function weightedChoice(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  if (total <= 0) return "jab";
  let r = Math.random() * total, upto = 0;
  for (const k in weights) { upto += weights[k]; if (r <= upto) return k; }
  return "jab";
}

/* ============================== AUDIO ================================== */
const Audio2 = (() => {
  let ctx = null, master = null;
  const NOTES = {
    C3:130.81,D3:146.83,E3:164.81,F3:174.61,G3:196.00,A3:220.00,B3:246.94,
    C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392.00,A4:440.00,B4:493.88,
    C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880.00,REST:0,
  };
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    // pre-build a noise buffer
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function tone(freq, t0, dur, type, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sweep(f0, f1, dur, vol) {
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, fadeIn) {
    const t0 = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const g = ctx.createGain();
    if (fadeIn) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.4);
    } else {
      g.gain.setValueAtTime(vol, t0);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur);
  }

  const FX = {
    jab:   () => tone(660, ctx.currentTime, 0.09, "square", 0.25),
    heavy: () => sweep(420, 130, 0.22, 0.35),
    wide:  () => noise(0.28, 0.22, true),
    kick:  () => sweep(220, 60, 0.18, 0.4),
    dash:  () => sweep(320, 880, 0.16, 0.18),
    block: () => { const t=ctx.currentTime; tone(880,t,0.12,"square",0.2); tone(1320,t,0.12,"square",0.12); },
    hurt:  () => noise(0.12, 0.22, false),
    ui:    () => tone(520, ctx.currentTime, 0.07, "square", 0.22),
    select:() => { const t=ctx.currentTime; tone(523,t,0.08,"square",0.22); tone(784,t+0.07,0.1,"square",0.22); },
    win:   () => { const t=ctx.currentTime; [523,659,784,1046].forEach((f,i)=>tone(f,t+i*0.1,0.18,"square",0.25)); },
    lose:  () => { const t=ctx.currentTime; [392,311,262].forEach((f,i)=>tone(f,t+i*0.14,0.26,"square",0.25)); },
    gong:  () => { const t=ctx.currentTime; tone(196,t,0.6,"square",0.3); tone(294,t,0.6,"triangle",0.18); },
    // glitchy "shadow self" reveal stinger for the YOU boss intro
    reveal:() => { const t=ctx.currentTime;
      [988,740,1245,659,1318].forEach((f,i)=>tone(f,t+i*0.055,0.11,"square",0.2));
      tone(110,t+0.30,0.7,"square",0.32); tone(110*1.5,t+0.30,0.7,"square",0.14);
      noise(0.32,0.16,false);
    },
  };
  function play(name) { if (!ctx) return; const f = FX[name]; if (f) try { f(); } catch (e) {} }

  /* ---- interactive music: lookahead scheduler, tempo by intensity ---- */
  const melodyMenu = ["E4","G4","A4","G4","E4","D4","C4","D4","E4","G4","A4","C5","B4","A4","G4","REST"];
  const bassMenu   = ["C3","C3","G3","G3","A3","A3","F3","G3","C3","C3","G3","G3","A3","F3","G3","C3"];
  const melodyFight= ["A4","A4","C5","A4","E4","A4","G4","E4","F4","F4","A4","F4","D4","F4","E4","D4"];
  const bassFight  = ["A3","A3","A3","A3","F3","F3","F3","F3","D3","D3","D3","D3","E3","E3","E3","E3"];
  // boss theme: darker, chromatic, relentless - "fighting your own shadow"
  const melodyBoss = ["A4","B4","C5","B4","A4","E5","D5","C5","D4","E4","F4","E4","D4","C5","B4","A4"];
  const bassBoss   = ["A3","A3","E3","E3","F3","F3","C3","C3","D3","D3","A3","A3","E3","E3","E3","E3"];
  const FIGHT_BPM = [138, 168, 200];
  const BOSS_BPM  = [174, 204, 236];   // faster + tenser than any rival theme

  let mWhich = null, mLevel = 0, mIndex = 0, mNextTime = 0, mTimer = null;

  function bpm() {
    if (mWhich === "menu") return 120;
    return (mWhich === "boss" ? BOSS_BPM : FIGHT_BPM)[mLevel];
  }
  function beatDur() { return 60 / bpm() / 2; }
  function tracks() {
    if (mWhich === "menu") return [melodyMenu, bassMenu];
    if (mWhich === "boss") return [melodyBoss, bassBoss];
    return [melodyFight, bassFight];
  }
  function scheduleNote(time) {
    const [mel, bass] = tracks();
    const i = mIndex % mel.length;
    const fm = NOTES[mel[i]], fb = NOTES[bass[i]];
    const boss = mWhich === "boss";
    const vol = (boss ? 0.62 : 0.5) + 0.12 * mLevel;
    const dur = beatDur() * 0.9;
    if (fm > 0) {
      tone(fm, time, dur, "square", 0.16 * vol);
      if (boss) tone(fm * 1.013, time, dur, "square", 0.07 * vol);   // detuned grit
    }
    if (fb > 0) {
      tone(fb, time, dur, "square", 0.12 * vol);
      if (boss) tone(fb / 2, time, dur, "square", 0.11 * vol);       // sub-octave drone
    }
  }
  function scheduler() {
    if (!ctx || mWhich === null) return;
    while (mNextTime < ctx.currentTime + 0.12) {
      scheduleNote(mNextTime);
      mNextTime += beatDur();
      mIndex++;
    }
  }
  function startMusic(which) {
    if (!ensure()) return;
    mWhich = which; mLevel = 0; mIndex = 0;
    mNextTime = ctx.currentTime + 0.05;
    if (!mTimer) mTimer = setInterval(scheduler, 25);
  }
  function setIntensity(playerFrac) {
    mLevel = playerFrac > 0.6 ? 0 : (playerFrac > 0.3 ? 1 : 2);
  }
  function stopMusic() { mWhich = null; }

  return { ensure, play, startMusic, setIntensity, stopMusic };
})();

/* ============================== FIGHTER ================================ */
class Fighter {
  constructor(x, y, color, name, isPlayer) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.color = color; this.name = name; this.isPlayer = !!isPlayer;
    this.hp = MAX_HP; this.energy = MAX_ENERGY; this.aim = 0;
    this.radius = FIGHTER_RADIUS; this.dmgMult = 1.0;
    this.attackName = null; this.attackPhase = null; this.attackTimer = 0;
    this.attackHitDone = false; this.facingAttackAngle = 0;
    this.blocking = false; this.blockFlash = 0; this.dashCd = 0;
    this.iframes = 0; this.hurtFlash = 0;
  }
  get busy() { return this.attackName !== null; }
  canAct() { return this.attackName === null; }

  startAttack(name) {
    const s = ATTACKS[name];
    if (this.energy < s.cost) return false;
    this.energy -= s.cost;
    this.attackName = name; this.attackPhase = "windup";
    this.attackTimer = s.windup; this.attackHitDone = false;
    this.facingAttackAngle = this.aim;
    return true;
  }
  startDash() {
    if (this.dashCd > 0 || this.energy < DASH_COST || this.busy) return false;
    this.energy -= DASH_COST;
    this.vx += Math.cos(this.aim) * DASH_IMPULSE;
    this.vy += Math.sin(this.aim) * DASH_IMPULSE;
    this.dashCd = DASH_COOLDOWN; this.iframes = DASH_IFRAMES;
    Audio2.play("dash");
    return true;
  }

  update(intent, opp) {
    this.aim = intent.aim;
    if (this.dashCd > 0) this.dashCd--;
    if (this.iframes > 0) this.iframes--;
    if (this.hurtFlash > 0) this.hurtFlash--;
    if (this.blockFlash > 0) this.blockFlash--;
    this.energy = Math.min(MAX_ENERGY, this.energy + ENERGY_REGEN);

    this.blocking = intent.block && this.canAct();
    if (intent.dash) this.startDash();
    if (intent.attack && this.canAct() && !this.blocking) this.startAttack(intent.attack);

    let speed = MOVE_SPEED;
    if (this.blocking) speed *= BLOCK_SPEED_MULT;
    if (this.busy) speed *= 0.35;
    const mlen = Math.hypot(intent.moveX, intent.moveY);
    if (mlen > 0) {
      this.vx += (intent.moveX / mlen) * speed * 0.6;
      this.vy += (intent.moveY / mlen) * speed * 0.6;
    }
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.78; this.vy *= 0.78;
    this.clampArena(); this.separate(opp);
    return this.advanceAttack(opp);
  }

  advanceAttack(opp) {
    if (this.attackName === null) return null;
    const s = ATTACKS[this.attackName];
    this.attackTimer--;
    if (this.attackPhase === "windup" && this.attackTimer <= 0) {
      this.attackPhase = "active"; this.attackTimer = s.active;
    } else if (this.attackPhase === "active") {
      let hit = null;
      if (!this.attackHitDone) hit = this.tryHit(opp, s);
      if (this.attackTimer <= 0) { this.attackPhase = "recovery"; this.attackTimer = s.recovery; }
      return hit;
    } else if (this.attackPhase === "recovery" && this.attackTimer <= 0) {
      this.attackName = null; this.attackPhase = null;
    }
    return null;
  }

  tryHit(opp, s) {
    const dx = opp.x - this.x, dy = opp.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > s.reach + opp.radius) return null;
    const angTo = Math.atan2(dy, dx);
    if (angDiff(angTo, this.facingAttackAngle) > rad(s.arc) / 2) return null;
    this.attackHitDone = true;
    if (opp.iframes > 0) return null;

    let damage = s.damage * this.dmgMult;
    let knockback = s.knockback;
    let blocked = false;
    if (opp.blocking) {
      const incoming = Math.atan2(this.y - opp.y, this.x - opp.x);
      if (angDiff(incoming, opp.aim) < BLOCK_FRONT_ARC / 2) {
        blocked = true;
        damage *= BLOCK_DAMAGE_MULT;
        knockback *= 0.3;
        opp.blockFlash = 8;
        Audio2.play("block");
      }
    }
    opp.hp = Math.max(0, opp.hp - damage);
    opp.vx += Math.cos(angTo) * knockback * 0.18;
    opp.vy += Math.sin(angTo) * knockback * 0.18;
    if (!blocked) {
      opp.hurtFlash = 8;
      Audio2.play((this.attackName === "heavy" || this.attackName === "kick") ? this.attackName : "hurt");
    }
    if (this.attackName === "jab" || this.attackName === "wide") Audio2.play(this.attackName);
    return { damage, blocked, name: this.attackName };
  }

  clampArena() {
    const r = this.radius;
    if (this.x < ARENA.x + r) { this.x = ARENA.x + r; this.vx = 0; }
    if (this.x > ARENA.x + ARENA.w - r) { this.x = ARENA.x + ARENA.w - r; this.vx = 0; }
    if (this.y < ARENA.y + r) { this.y = ARENA.y + r; this.vy = 0; }
    if (this.y > ARENA.y + ARENA.h - r) { this.y = ARENA.y + ARENA.h - r; this.vy = 0; }
  }
  separate(o) {
    const dx = this.x - o.x, dy = this.y - o.y;
    const d = Math.hypot(dx, dy), min = this.radius + o.radius;
    if (d > 0 && d < min) {
      const push = (min - d) / 2, nx = dx / d, ny = dy / d;
      this.x += nx * push; this.y += ny * push;
      o.x -= nx * push; o.y -= ny * push;
    }
  }
  distanceTo(o) { return Math.hypot(o.x - this.x, o.y - this.y); }
}

/* ============================== AI ===================================== */
class AIController {
  constructor(params, prediction) {
    this.p = params; this.prediction = prediction || 0;
    this.smart = params.smart != null ? params.smart : 0.35;
    this.attackCd = 0; this.decisionCd = 0;
    this.strafeDir = choice([-1, 1]); this.reactTimer = 0; this.blockHold = 0;
    this.backoff = 0;
  }
  update(me, opp) {
    const intent = { moveX: 0, moveY: 0, aim: 0, attack: null, block: false, dash: false };
    const dx = opp.x - me.x, dy = opp.y - me.y;
    const dist = Math.hypot(dx, dy);
    intent.aim = Math.atan2(dy, dx);
    if (this.attackCd > 0) this.attackCd--;
    if (this.decisionCd > 0) this.decisionCd--;
    if (this.reactTimer > 0) this.reactTimer--;
    if (this.blockHold > 0) this.blockHold--;
    if (this.backoff > 0) this.backoff--;
    const pref = this.p.pref_range;
    const smart = this.smart;
    const heavyReach = ATTACKS.heavy.reach;

    const threat = this.opponentThreat(me, opp, dist);
    const recovering = opp.busy && opp.attackPhase === "recovery";   // punishable whiff/commit
    const oppBlocking = opp.blocking;

    // ---- defensive reaction / prediction ----
    if (threat) {
      const reactChance = clamp(this.p.block_tendency + this.prediction + smart * 0.4, 0, 0.98);
      if (this.reactTimer === 0 && Math.random() < reactChance) {
        this.blockHold = randint(8, 16);
        this.reactTimer = Math.round((1 - smart) * 14);    // smarter = reacts sooner
      }
      if (this.prediction > 0 && Math.random() < this.prediction * 0.5) this.blockHold = Math.max(this.blockHold, 12);
    } else if (this.p.block_tendency > 0.45 && dist < pref + 30 && Math.random() < this.p.block_tendency * 0.08) {
      this.blockHold = randint(8, 18);
    }
    let wantBlock = this.blockHold > 0;
    // a smart fighter drops guard to punish a whiff instead of turtling
    if (recovering && dist <= heavyReach && smart > 0.3) wantBlock = false;
    intent.block = wantBlock;

    // ---- dashing ----
    if (me.dashCd === 0 && !wantBlock) {
      const dc = this.p.dash_tendency * 0.05;
      if (recovering && dist > pref && dist < 230 && Math.random() < 0.2 + smart * 0.5) {
        intent.dash = true;                                // burst in to punish the recovery
      } else if (dist > pref + 120 && Math.random() < dc * 2) {
        intent.dash = true;
      } else if (threat && this.p.dash_tendency > 0.4 && Math.random() < dc * 1.5) {
        intent.aim = Math.atan2(-dy, -dx);
        intent.dash = true;
        this.setMove(intent, me, opp, dist, pref, { evade: true });
        return intent;
      }
    }

    // ---- attacking ----
    if (!wantBlock && me.canAct() && dist <= heavyReach && me.energy >= 10) {
      if (recovering && this.attackCd <= 6 && Math.random() < 0.5 + smart * 0.45) {
        // free punish - heavy if there is room & it is in the kit, else a quick jab
        const name = (dist < heavyReach && (this.p.mix.heavy || 0) > 0 && Math.random() < 0.35 + smart * 0.3) ? "heavy" : "jab";
        if (me.energy >= ATTACKS[name].cost) { intent.attack = name; this.afterAttack(smart); }
      } else if (oppBlocking && smart > 0.35) {
        // don't feed the guard: shove with a kick, otherwise circle (handled in move)
        if (dist <= ATTACKS.kick.reach && this.attackCd === 0 && Math.random() < 0.4 && me.energy >= ATTACKS.kick.cost) {
          intent.attack = "kick"; this.afterAttack(smart);
        }
      } else if (this.attackCd === 0 && Math.random() < this.p.aggression * 0.5 + 0.1 + smart * 0.12) {
        const name = this.pickAttack(dist);
        if (name && me.energy >= ATTACKS[name].cost) { intent.attack = name; this.afterAttack(smart); }
      }
    }

    // ---- movement ----
    this.setMove(intent, me, opp, dist, pref, { flank: oppBlocking && smart > 0.35 });
    return intent;
  }

  afterAttack(smart) {
    const base = this.p.avg_gap || 45;
    const jitter = Math.floor(base * (1 - (this.p.rhythm || 0.3)) * 0.8);
    this.attackCd = Math.max(10, Math.floor(base) + randint(-jitter, jitter));
    if (smart > 0.4) this.backoff = randint(8, 16);        // reset spacing after committing (whiff-bait)
  }
  opponentThreat(me, opp, dist) {
    if (!opp.busy) return false;
    if (opp.attackPhase !== "windup" && opp.attackPhase !== "active") return false;
    const s = ATTACKS[opp.attackName];
    if (!s) return false;
    if (dist > s.reach + 50) return false;
    const angToMe = Math.atan2(me.y - opp.y, me.x - opp.x);
    return angDiff(opp.facingAttackAngle, angToMe) < rad(80);
  }
  pickAttack(dist) {
    const mix = Object.assign({}, this.p.mix);
    if (dist > 95) { mix.jab = (mix.jab || 0) * 0.5; mix.kick = (mix.kick || 0) * 0.5; }
    if (dist < 60) { mix.heavy = (mix.heavy || 0) * 0.6; }
    return weightedChoice(mix);
  }
  setMove(intent, me, opp, dist, pref, opt) {
    opt = opt || {};
    let dx = opp.x - me.x, dy = opp.y - me.y;
    if (dist < 1) dist = 1;
    const nx = dx / dist, ny = dy / dist;
    const px = -ny, py = nx;          // perpendicular (for strafing / circling)
    const approachBias = this.p.approach_bias != null ? this.p.approach_bias : 0.6;
    let mx = 0, my = 0;
    if (opt.evade) {
      mx = -nx; my = -ny;
    } else if (opt.flank) {
      // circle the guard to get around the frontal block, drifting in a little
      if (this.decisionCd === 0) { this.strafeDir = choice([-1, 1]); this.decisionCd = randint(25, 45); }
      mx = px * this.strafeDir + nx * 0.15;
      my = py * this.strafeDir + ny * 0.15;
    } else if (this.backoff > 0) {
      // bait: drift just out of range after committing, ready to punish the chase
      mx = -nx * 0.7 + px * this.strafeDir * 0.5;
      my = -ny * 0.7 + py * this.strafeDir * 0.5;
    } else if (dist > pref + 20) {
      mx = nx; my = ny;
    } else if (dist < pref - 30) {
      if (Math.random() > approachBias) { mx = -nx; my = -ny; }
    } else {
      if (this.decisionCd === 0) { this.strafeDir = choice([-1, 1]); this.decisionCd = randint(20, 50); }
      mx = px * this.strafeDir; my = py * this.strafeDir;
      mx += nx * 0.3 * approachBias; my += ny * 0.3 * approachBias;
    }
    if (me.x < ARENA.x + 70 && mx < 0) mx *= -0.5;
    if (me.x > ARENA.x + ARENA.w - 70 && mx > 0) mx *= -0.5;
    if (me.y < ARENA.y + 70 && my < 0) my *= -0.5;
    if (me.y > ARENA.y + ARENA.h - 70 && my > 0) my *= -0.5;
    intent.moveX = mx; intent.moveY = my;
  }
}

function makeOpponent(style, profile, diff) {
  let params, prediction;
  if (style === "aggressive") {
    params = { mix: { jab: 0.55, heavy: 0.15, wide: 0.1, kick: 0.2 }, pref_range: 78,
      aggression: 0.6, block_tendency: 0.12, dash_tendency: 0.35, rhythm: 0.35,
      avg_gap: 52, approach_bias: 0.82, smart: 0.5 };
    prediction = 0.1;
  } else if (style === "defensive") {
    params = { mix: { jab: 0.3, heavy: 0.15, wide: 0.42, kick: 0.13 }, pref_range: 105,
      aggression: 0.45, block_tendency: 0.6, dash_tendency: 0.2, rhythm: 0.5,
      avg_gap: 56, approach_bias: 0.4, smart: 0.65 };
    prediction = 0.28;
  } else if (style === "mobile") {
    params = { mix: { jab: 0.4, heavy: 0.13, wide: 0.12, kick: 0.35 }, pref_range: 90,
      aggression: 0.6, block_tendency: 0.28, dash_tendency: 0.8, rhythm: 0.3,
      avg_gap: 46, approach_bias: 0.58, smart: 0.6 };
    prediction = 0.2;
  } else if (style === "mirror") {
    // the boss "YOU" - built from the player's profile, and much, much sharper.
    const p = profile || {};
    const skill = p.skill != null ? p.skill : 0.5;
    params = {
      mix: Object.assign({ jab: 0.45, heavy: 0.2, wide: 0.2, kick: 0.15 }, p.mix || {}),
      pref_range: p.pref_range != null ? p.pref_range : 95,
      aggression: Math.min(1, (p.aggression != null ? p.aggression : 0.5) * 1.25 + 0.15),
      block_tendency: Math.min(0.9, (p.block_tendency != null ? p.block_tendency : 0.2) + 0.2),
      dash_tendency: Math.min(1, (p.dash_tendency != null ? p.dash_tendency : 0.3) + 0.2),
      rhythm: p.rhythm != null ? p.rhythm : 0.3,
      avg_gap: Math.max(16, (p.avg_gap != null ? p.avg_gap : 50) * 0.7),  // attacks faster than you do
      approach_bias: p.approach_bias != null ? p.approach_bias : 0.6,
      smart: 0.97,                                   // reads, punishes, flanks, baits
    };
    prediction = 0.45 + 0.45 * skill;                // knows your timing - the better you were, the deadlier it is
  }
  // apply difficulty: scales cadence, prediction and overall smarts
  params.smart = clamp((params.smart != null ? params.smart : 0.4) * diff.smart, 0, 1);
  params.avg_gap *= diff.cadence;
  prediction = Math.min(0.98, prediction * diff.predict);
  return new AIController(params, prediction);
}

/* ========================= STYLE TRACKER ============================== */
class StyleTracker {
  constructor() {
    this.attackCounts = { jab: 0, heavy: 0, wide: 0, kick: 0 };
    this.attackRanges = []; this.attackFrames = [];
    this.blockFrames = 0; this.totalFrames = 0; this.dashCount = 0;
    this.moveFrames = 0; this.approachFrames = 0; this.retreatFrames = 0;
    this.hitsLanded = 0; this.hitsTaken = 0; this._frame = 0;
  }
  onFrame(blocking, moving, approaching) {
    this._frame++; this.totalFrames++;
    if (blocking) this.blockFrames++;
    if (moving) { this.moveFrames++; if (approaching) this.approachFrames++; else this.retreatFrames++; }
  }
  onAttack(name, dist) {
    if (name in this.attackCounts) this.attackCounts[name]++;
    this.attackRanges.push(dist); this.attackFrames.push(this._frame);
  }
  onDash() { this.dashCount++; }
  onHitLanded() { this.hitsLanded++; }
  onHitTaken() { this.hitsTaken++; }
  build() {
    const total = this.attackCounts.jab + this.attackCounts.heavy + this.attackCounts.wide + this.attackCounts.kick;
    const tf = Math.max(1, this.totalFrames);
    let mix;
    if (total > 0) {
      mix = {}; for (const k in this.attackCounts) mix[k] = this.attackCounts[k] / total;
    } else mix = { jab: 0.5, heavy: 0.2, wide: 0.2, kick: 0.1 };
    let pref = this.attackRanges.length ? this.attackRanges.reduce((a, b) => a + b, 0) / this.attackRanges.length : 95;
    pref = clamp(pref, 50, 220);
    const aps = total / (tf / 60);
    const aggression = clamp(aps / 1.6, 0.05, 1);
    const blockTendency = clamp(this.blockFrames / tf, 0.02, 0.9);
    const dashRate = this.dashCount / (tf / 60);
    const dashTendency = clamp(dashRate / 0.8, 0, 1);
    const gaps = [];
    for (let i = 1; i < this.attackFrames.length; i++) gaps.push(this.attackFrames[i] - this.attackFrames[i - 1]);
    let avgGap = 60, rhythm = 0.3;
    if (gaps.length >= 2) {
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const varr = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
      avgGap = mean; rhythm = clamp(1 - Math.sqrt(varr) / (mean + 1e-6), 0, 1);
    }
    const approachBias = (this.approachFrames + this.retreatFrames) > 0
      ? this.approachFrames / (this.approachFrames + this.retreatFrames) : 0.5;
    let skill = 0.5;
    if (this.hitsLanded + this.hitsTaken > 0)
      skill = clamp(this.hitsLanded / (this.hitsLanded + this.hitsTaken), 0.15, 1);
    return { mix, pref_range: pref, aggression, block_tendency: blockTendency,
      dash_tendency: dashTendency, rhythm, avg_gap: avgGap, approach_bias: approachBias, skill };
  }
}

/* ============================== RENDER ================================= */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function text(s, size, color, x, y, align) {
  ctx.font = "bold " + size + "px Consolas, monospace";
  ctx.textAlign = align || "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
function drawArena() {
  ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = COL.BG2;
  roundRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h, 14, true, false);
  ctx.strokeStyle = COL.GRID; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = ARENA.x; gx < ARENA.x + ARENA.w; gx += 55) { ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h); }
  for (let gy = ARENA.y; gy < ARENA.y + ARENA.h; gy += 55) { ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy); }
  ctx.stroke();
  ctx.strokeStyle = COL.DARKGREY; ctx.lineWidth = 3;
  roundRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h, 14, false, true);
}
function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function drawFighter(f) {
  const cx = f.x, cy = f.y;
  if (f.busy && (f.attackPhase === "windup" || f.attackPhase === "active")) {
    const s = ATTACKS[f.attackName];
    const half = rad(s.arc) / 2;
    const alpha = f.attackPhase === "windup" ? 0.28 : 0.6;
    ctx.fillStyle = rgba(s.color, alpha);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, s.reach, f.facingAttackAngle - half, f.facingAttackAngle + half);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = f.hurtFlash > 0 ? COL.WHITE : f.color;
  ctx.beginPath(); ctx.arc(cx, cy, f.radius, 0, 2 * Math.PI); ctx.fill();
  ctx.strokeStyle = COL.BLACK; ctx.lineWidth = 2; ctx.stroke();
  // facing pointer
  ctx.strokeStyle = COL.WHITE; ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(f.aim) * f.radius, cy + Math.sin(f.aim) * f.radius);
  ctx.lineTo(cx + Math.cos(f.aim) * (f.radius + 16), cy + Math.sin(f.aim) * (f.radius + 16));
  ctx.stroke();
  if (f.blocking) {
    ctx.strokeStyle = f.blockFlash > 0 ? COL.YELLOW : COL.CYAN; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, f.radius + 14, f.aim - BLOCK_FRONT_ARC / 2, f.aim + BLOCK_FRONT_ARC / 2);
    ctx.stroke();
  }
  if (f.iframes > 0) {
    ctx.strokeStyle = COL.WHITE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, f.radius + 6, 0, 2 * Math.PI); ctx.stroke();
  }
  text(f.name, 16, f.isPlayer ? COL.WHITE : f.color, cx, cy - f.radius - 18);
}
function bar(x, y, w, h, frac, color) {
  frac = clamp(frac, 0, 1);
  ctx.fillStyle = COL.DARKGREY; roundRect(x, y, w, h, 4, true, false);
  if (frac > 0) { ctx.fillStyle = color; roundRect(x, y, w * frac, h, 4, true, false); }
  ctx.strokeStyle = COL.BLACK; ctx.lineWidth = 2; roundRect(x, y, w, h, 4, false, true);
}
function drawHud(g) {
  text("YOU", 22, COL.PLAYER, 50, 27, "left");
  bar(50, 44, 360, 22, g.player.hp / MAX_HP, COL.GREEN);
  bar(50, 70, 360, 10, g.player.energy / MAX_ENERGY, COL.BLUE);
  const cf = Math.min(1, g.charge / CHARGE_FULL);
  if (cf > 0) bar(50, 84, 360, 8, cf, cf >= 1 ? COL.ORANGE : COL.YELLOW);
  const opp = OPPONENTS[g.oppIndex];
  text(opp.name, 22, opp.color, W - 50, 27, "right");
  bar(W - 50 - 360, 44, 360, 22, g.enemy.hp / MAX_HP, COL.RED);
  bar(W - 50 - 360, 70, 360, 10, g.enemy.energy / MAX_ENERGY, COL.BLUE);
  for (let i = 0; i < ROUNDS_TO_WIN; i++) {
    ctx.fillStyle = i < g.pRounds ? COL.GREEN : COL.DARKGREY;
    ctx.beginPath(); ctx.arc(50 + 14 + i * 30, 104, 8, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = i < g.eRounds ? COL.RED : COL.DARKGREY;
    ctx.beginPath(); ctx.arc(W - 50 - 14 - i * 30, 104, 8, 0, 2 * Math.PI); ctx.fill();
  }
}

/* ============================== INPUT ================================= */
const keys = {};
const mouse = { x: W / 2, y: H / 2, left: false, mid: false };
let charging = false, charge = 0, blockWindow = 0, queuedAttack = null, dashRequest = false;

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
canvas.addEventListener("mousemove", e => { const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y; });
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("mousedown", e => {
  e.preventDefault(); Audio2.ensure(); GAME.onFirstInput();
  if (e.button === 0) { mouse.left = true; if (GAME.state === "fight") { charging = true; charge = 0; } GAME.click(); }
  else if (e.button === 2) { if (GAME.state === "fight") queuedAttack = "wide"; }
  else if (e.button === 1) { mouse.mid = true; if (GAME.state === "fight") blockWindow = Math.max(blockWindow, 6); }
});
window.addEventListener("mouseup", e => {
  if (e.button === 0) {
    mouse.left = false;
    if (GAME.state === "fight" && charging) {
      charging = false;
      queuedAttack = charge >= CHARGE_FULL ? "heavy" : "jab";
      charge = 0;
    }
  } else if (e.button === 1) mouse.mid = false;
});
canvas.addEventListener("wheel", e => { e.preventDefault(); if (GAME.state === "fight") blockWindow = 16; }, { passive: false });
// NOTE: we key off e.code (physical key, layout-independent) so movement works
// on any keyboard layout - e.key would be Cyrillic letters on a RU layout.
window.addEventListener("keydown", e => {
  Audio2.ensure(); GAME.onFirstInput();
  const code = e.code;
  keys[code] = true;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) e.preventDefault();
  if (GAME.state === "fight") {
    if (code === "Space" || code === "ShiftLeft" || code === "ShiftRight") dashRequest = true;
    else if (code === "KeyQ") queuedAttack = "kick";
  }
  GAME.key(code);
});
window.addEventListener("keyup", e => { keys[e.code] = false; });

/* ============================== GAME ================================== */
const GAME = {
  state: "menu", menuIndex: 0, menuItems: ["FIGHT", "HOW TO PLAY", "SETTINGS", "FULLSCREEN"],
  settingsIndex: 0,
  difficultyKeys: ["EASY", "MEDIUM", "HARD"],
  difficulty: localStorage.getItem("yvy_difficulty") || "MEDIUM",
  tracker: null, oppIndex: 0, profile: null, timer: 0, banner: "",
  player: null, enemy: null, ai: null, pRounds: 0, eRounds: 0, roundNum: 1,
  roundFreeze: 0, frame: 0, charge: 0, combatTrack: "fight",
  firstInputDone: false, defeatIndex: 0,

  onFirstInput() {
    if (!this.firstInputDone) {
      this.firstInputDone = true;
      if (this.state === "menu") Audio2.startMusic("menu");
    }
  },
  diff() { return DIFFICULTY[this.difficulty] || DIFFICULTY.MEDIUM; },

  /* ---- input dispatch ---- */
  key(code) {
    const confirm = code === "Enter" || code === "NumpadEnter" || code === "Space";
    if (this.state === "menu") {
      if (code === "ArrowDown" || code === "KeyS") { this.menuIndex = (this.menuIndex + 1) % this.menuItems.length; Audio2.play("ui"); }
      else if (code === "ArrowUp" || code === "KeyW") { this.menuIndex = (this.menuIndex - 1 + this.menuItems.length) % this.menuItems.length; Audio2.play("ui"); }
      else if (confirm) this.menuSelect();
    } else if (this.state === "settings") {
      if (code === "ArrowLeft" || code === "KeyA") this.cycleDifficulty(-1);
      else if (code === "ArrowRight" || code === "KeyD") this.cycleDifficulty(1);
      else if (code === "Escape" || code === "Enter" || code === "Backspace") { Audio2.play("ui"); this.state = "menu"; }
    } else if (this.state === "howto") {
      Audio2.play("ui"); this.state = "menu";
    } else if (this.state === "intro") {
      if (confirm && this.timer > 130) this.startFight();
    } else if (this.state === "victory") {
      if (this.timer > 40) this.toMenu();
    } else if (this.state === "gameover") {
      if (code === "ArrowLeft" || code === "ArrowRight" || code === "KeyA" || code === "KeyD") { this.defeatIndex ^= 1; Audio2.play("ui"); }
      else if (code === "KeyR") { this.defeatIndex = 0; this.confirmDefeat(); }
      else if (code === "KeyM") { this.defeatIndex = 1; this.confirmDefeat(); }
      else if (confirm) this.confirmDefeat();
    }
    if (code === "Escape" && ["fight", "intro", "round_end", "gameover", "revive"].includes(this.state)) this.toMenu();
  },
  click() {
    if (this.state === "menu") {
      // click handled via menu hit test in render-less way: use mouse pos
      for (let i = 0; i < this.menuItems.length; i++) {
        if (Math.abs(mouse.y - (372 + i * 60)) < 26 && Math.abs(mouse.x - W / 2) < 220) {
          this.menuIndex = i; this.menuSelect(); return;
        }
      }
    } else if (this.state === "settings") {
      for (let i = 0; i < this.difficultyKeys.length; i++) {
        const bx = W / 2 - 330 + i * 230;
        if (Math.abs(mouse.x - bx) < 100 && Math.abs(mouse.y - 320) < 60) {
          this.difficulty = this.difficultyKeys[i];
          localStorage.setItem("yvy_difficulty", this.difficulty);
          Audio2.play("select"); return;
        }
      }
      if (Math.abs(mouse.y - 520) < 40 && Math.abs(mouse.x - W / 2) < 160) { Audio2.play("ui"); this.state = "menu"; }
    } else if (this.state === "howto") { Audio2.play("ui"); this.state = "menu"; }
    else if (this.state === "intro") { if (this.timer > 130) this.startFight(); }
    else if (this.state === "victory") { if (this.timer > 40) this.toMenu(); }
    else if (this.state === "gameover") {
      const cx = W / 2;
      if (mouse.y > 470 && mouse.y < 545) {
        if (Math.abs(mouse.x - (cx - 150)) < 130) { this.defeatIndex = 0; this.confirmDefeat(); }
        else if (Math.abs(mouse.x - (cx + 150)) < 130) { this.defeatIndex = 1; this.confirmDefeat(); }
      }
    }
  },
  cycleDifficulty(dir) {
    let i = this.difficultyKeys.indexOf(this.difficulty);
    i = (i + dir + this.difficultyKeys.length) % this.difficultyKeys.length;
    this.difficulty = this.difficultyKeys[i];
    localStorage.setItem("yvy_difficulty", this.difficulty);
    Audio2.play("ui");
  },
  menuSelect() {
    Audio2.play("select");
    const choiceItem = this.menuItems[this.menuIndex];
    if (choiceItem === "FIGHT") this.startCampaign();
    else if (choiceItem === "HOW TO PLAY") this.state = "howto";
    else if (choiceItem === "SETTINGS") this.state = "settings";
    else if (choiceItem === "FULLSCREEN") {
      if (!document.fullscreenElement) { (document.documentElement.requestFullscreen || (()=>{})).call(document.documentElement); }
      else { (document.exitFullscreen || (()=>{})).call(document); }
    }
  },

  /* ---- campaign ---- */
  startCampaign() { this.tracker = new StyleTracker(); this.oppIndex = 0; this.profile = null; this.beginOpponent(); },
  beginOpponent() {
    this.pRounds = 0; this.eRounds = 0; this.roundNum = 1;
    const opp = OPPONENTS[this.oppIndex];
    if (opp.style === "mirror") this.profile = this.tracker.build();
    this.state = "intro"; this.timer = 0;
    this.combatTrack = opp.style === "mirror" ? "boss" : "fight";
    Audio2.startMusic(this.combatTrack);
  },
  startFight() {
    const opp = OPPONENTS[this.oppIndex];
    this.player = new Fighter(W * 0.3, H * 0.5, COL.PLAYER, "You", true);
    this.enemy = new Fighter(W * 0.7, H * 0.5, opp.color, opp.name, false);
    // the mirror hits exactly as hard as you do (1:1); rivals scale with difficulty
    this.enemy.dmgMult = opp.style === "mirror" ? 1.0 : opp.power * this.diff().dmg;
    this.ai = makeOpponent(opp.style, this.profile, this.diff());
    charging = false; charge = 0; blockWindow = 0; queuedAttack = null; dashRequest = false;
    this.charge = 0; this.roundFreeze = 70; this.banner = "ROUND " + this.roundNum;
    this.frame = 0; this.state = "fight";
  },
  resetRound() {
    const opp = OPPONENTS[this.oppIndex];
    this.player.hp = MAX_HP; this.player.energy = MAX_ENERGY;
    this.player.x = W * 0.3; this.player.y = H * 0.5; this.player.vx = this.player.vy = 0;
    this.player.attackName = null;
    this.enemy.hp = MAX_HP; this.enemy.energy = MAX_ENERGY;
    this.enemy.x = W * 0.7; this.enemy.y = H * 0.5; this.enemy.vx = this.enemy.vy = 0;
    this.enemy.attackName = null;
    this.ai = makeOpponent(opp.style, this.profile, this.diff());
    this.roundFreeze = 70; this.banner = "ROUND " + this.roundNum; this.state = "fight";
  },

  buildPlayerIntent() {
    const intent = { moveX: 0, moveY: 0, aim: 0, attack: null, block: false, dash: false };
    intent.aim = Math.atan2(mouse.y - this.player.y, mouse.x - this.player.x);
    let dx = 0, dy = 0;
    if (keys["KeyA"] || keys["ArrowLeft"]) dx -= 1;
    if (keys["KeyD"] || keys["ArrowRight"]) dx += 1;
    if (keys["KeyW"] || keys["ArrowUp"]) dy -= 1;
    if (keys["KeyS"] || keys["ArrowDown"]) dy += 1;
    intent.moveX = dx; intent.moveY = dy;
    if (blockWindow > 0) blockWindow--;
    intent.block = mouse.mid || blockWindow > 0;
    if (charging && !intent.block) charge = Math.min(CHARGE_MAX, charge + 1);
    this.charge = charge;
    if (queuedAttack && this.player.canAct() && !intent.block) intent.attack = queuedAttack;
    queuedAttack = null;
    if (dashRequest) { intent.dash = true; dashRequest = false; }
    return { intent, moving: dx !== 0 || dy !== 0 };
  },

  update() {
    if (this.state === "intro") {
      this.timer++;
      if (this.timer === 50) Audio2.play("gong");
      if (OPPONENTS[this.oppIndex].style === "mirror" && this.timer === 91) Audio2.play("reveal");
      if (this.timer > 200) this.startFight();
    } else if (this.state === "fight") {
      this.updateFight();
    } else if (this.state === "round_end") {
      this.timer++;
      if (this.timer >= 110) {
        if (this.pRounds >= ROUNDS_TO_WIN) this.winMatch();
        else if (this.eRounds >= ROUNDS_TO_WIN) this.loseMatch();
        else { this.roundNum++; this.resetRound(); }
      }
    } else if (this.state === "revive") {
      this.timer++;
      if (this.timer >= 80) this.reviveToFight();
    } else if (this.state === "gameover" || this.state === "victory") {
      this.timer++;
    }
  },

  updateFight() {
    this.frame++;
    if (this.frame % 15 === 0) Audio2.setIntensity(this.player.hp / MAX_HP);
    if (this.roundFreeze > 0) { this.roundFreeze--; return; }
    const { intent: pIntent, moving } = this.buildPlayerIntent();
    const aIntent = this.ai.update(this.enemy, this.player);

    // always record the player's style - even during the mirror fight, so a
    // retry can rebuild an even more accurate copy of how you play.
    const recording = true;
    if (recording) {
      const dist = this.player.distanceTo(this.enemy);
      const dxn = this.enemy.x - this.player.x, dyn = this.enemy.y - this.player.y;
      const approaching = (pIntent.moveX * dxn + pIntent.moveY * dyn) > 0;
      this.tracker.onFrame(pIntent.block, moving, approaching);
      if (pIntent.attack && this.player.canAct()) this.tracker.onAttack(pIntent.attack, dist);
      if (pIntent.dash && this.player.dashCd === 0 && this.player.energy >= DASH_COST) this.tracker.onDash();
    }
    const pHit = this.player.update(pIntent, this.enemy);
    const aHit = this.enemy.update(aIntent, this.player);
    if (recording) {
      if (pHit && !pHit.blocked) this.tracker.onHitLanded();
      if (aHit && !aHit.blocked) this.tracker.onHitTaken();
    }
    if (this.player.hp <= 0 || this.enemy.hp <= 0) this.endRound();
  },

  endRound() {
    if (this.enemy.hp <= 0 && this.player.hp > 0) { this.pRounds++; this.banner = "ROUND WON!"; Audio2.play("win"); }
    else if (this.player.hp <= 0 && this.enemy.hp > 0) { this.eRounds++; this.banner = "ROUND LOST"; Audio2.play("lose"); }
    else this.banner = "DOUBLE K.O.";
    this.state = "round_end"; this.timer = 0;
  },
  winMatch() {
    if (this.oppIndex >= OPPONENTS.length - 1) { this.state = "victory"; this.timer = 0; Audio2.stopMusic(); Audio2.play("win"); }
    else { this.oppIndex++; this.beginOpponent(); }
  },
  loseMatch() { this.state = "gameover"; this.timer = 0; this.defeatIndex = 0; Audio2.stopMusic(); Audio2.play("lose"); },
  confirmDefeat() {
    if (this.timer < 30) return;
    Audio2.play("select");
    if (this.defeatIndex === 0) this.startRevive();   // TRY AGAIN
    else this.toMenu();                               // MENU
  },
  startRevive() { this.state = "revive"; this.timer = 0; Audio2.play("gong"); },
  reviveToFight() {
    const opp = OPPONENTS[this.oppIndex];
    this.pRounds = 0; this.eRounds = 0; this.roundNum = 1;
    // rebuild the mirror from the now-larger pool of recorded data
    if (opp.style === "mirror") this.profile = this.tracker.build();
    this.combatTrack = opp.style === "mirror" ? "boss" : "fight";
    Audio2.startMusic(this.combatTrack);
    this.startFight();
  },
  toMenu() { this.state = "menu"; this.menuIndex = 0; Audio2.startMusic("menu"); },

  /* ---- render ---- */
  render() {
    if (this.state === "menu") this.drawMenu();
    else if (this.state === "settings") this.drawSettings();
    else if (this.state === "howto") this.drawHowto();
    else if (this.state === "intro") this.drawIntro();
    else if (this.state === "fight") this.drawFight();
    else if (this.state === "round_end") this.drawRoundEnd();
    else if (this.state === "revive") this.drawRevive();
    else if (this.state === "gameover") this.drawGameOver();
    else if (this.state === "victory") this.drawVictory();
  },
  drawMenu() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, t = performance.now() / 1000;
    text("YOU", 96, COL.PLAYER, cx, 110);
    text("VS", 56, COL.WHITE, cx, 178);
    text("YOU", 96, COL.RED, cx, 246 + Math.sin(t * 2) * 4);
    text("fight three rivals - then face yourself", 22, COL.GREY, cx, 308);
    for (let i = 0; i < this.menuItems.length; i++) {
      const sel = i === this.menuIndex;
      text(sel ? "> " + this.menuItems[i] + " <" : this.menuItems[i], 34, sel ? COL.YELLOW : COL.WHITE, cx, 372 + i * 60);
    }
    text("Difficulty: " + this.diff().label, 20, COL.CYAN, cx, 372 + this.menuItems.length * 60 + 6);
    text("Arrow keys / mouse to choose  -  Enter to select", 18, COL.DARKGREY, cx, H - 36);
  },
  drawSettings() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    text("SETTINGS", 48, COL.YELLOW, cx, 90);
    text("DIFFICULTY", 28, COL.WHITE, cx, 200);
    const descs = { EASY: "rivals hit softer & slower", MEDIUM: "the standard challenge", HARD: "rivals hit harder, faster, smarter" };
    for (let i = 0; i < this.difficultyKeys.length; i++) {
      const key = this.difficultyKeys[i];
      const bx = cx - 330 + i * 230, sel = key === this.difficulty;
      ctx.fillStyle = sel ? COL.YELLOW : COL.BG2;
      roundRect(bx - 100, 320 - 45, 200, 90, 10, true, false);
      ctx.strokeStyle = sel ? COL.WHITE : COL.DARKGREY; ctx.lineWidth = 3;
      roundRect(bx - 100, 320 - 45, 200, 90, 10, false, true);
      text(key, 30, sel ? COL.BLACK : COL.WHITE, bx, 320);
    }
    text(descs[this.difficulty], 22, COL.GREY, cx, 420);
    text("Left / Right or click to change", 18, COL.DARKGREY, cx, 460);
    ctx.fillStyle = COL.BG2; roundRect(cx - 100, 520 - 30, 200, 60, 10, true, false);
    ctx.strokeStyle = COL.DARKGREY; ctx.lineWidth = 3; roundRect(cx - 100, 520 - 30, 200, 60, 10, false, true);
    text("BACK", 28, COL.WHITE, cx, 520);
  },
  drawHowto() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    text("HOW TO PLAY", 48, COL.YELLOW, cx, 70);
    const lines = [
      ["WASD", "move around the arena"],
      ["Mouse", "your fighter always faces the cursor"],
      ["Left Click (tap)", "quick jab - fast, light"],
      ["Left Click (hold to full)", "charged STRAIGHT THRUST - slow, heavy"],
      ["Right Click", "WIDE SWEEP - long wind-up, wide arc"],
      ["Q", "kick - little damage, big knockback"],
      ["Mouse Wheel / Middle Btn", "BLOCK - guards your front"],
      ["Shift / Space", "DASH toward the cursor (brief i-frames)"],
    ];
    let y = 150;
    for (const [k, d] of lines) {
      text(k, 26, COL.CYAN, cx - 380, y, "left");
      text(d, 24, COL.WHITE, cx - 40, y, "left");
      y += 46;
    }
    text("Win 2 of 3 rounds to beat each rival.", 24, COL.GREEN, cx, y + 24);
    text("The final rival learns everything from how YOU fight.", 22, COL.RED, cx, y + 58);
    text("press any key to go back", 18, COL.DARKGREY, cx, H - 36);
  },
  drawIntro() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, opp = OPPONENTS[this.oppIndex], isMirror = opp.style === "mirror", t = this.timer;
    if (t > 10) { const a = Math.min(1, (t - 10) / 25); text("You", 90, COL.PLAYER, cx, 180 + (1 - a) * -60); }
    if (t > 50) { const sc = 1 + Math.max(0, 70 - t) * 0.04; text("VS", 70 * sc, COL.WHITE, cx, 350); }
    if (t > 90) { const a = Math.min(1, (t - 90) / 25); text(isMirror ? "YOU" : opp.name, 90, opp.color, cx, 520 + (1 - a) * 60); }
    if (t > 120) text(opp.subtitle, 24, isMirror ? COL.RED : COL.GREY, cx, 600);
    if (t > 135 && Math.floor(t / 18) % 2 === 0) text("click to begin", 20, COL.DARKGREY, cx, H - 36);
  },
  drawFight() {
    drawArena();
    drawFighter(this.enemy);
    drawFighter(this.player);
    drawHud(this);
    if (this.roundFreeze > 0) {
      text(this.banner, 80, COL.WHITE, W / 2, H / 2);
      if (this.roundFreeze < 25) text("FIGHT!", 50, COL.YELLOW, W / 2, H / 2 + 70);
    }
  },
  drawRoundEnd() {
    this.drawFight();
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H);
    text(this.banner, 80, this.banner.includes("WON") ? COL.GREEN : COL.RED, W / 2, H / 2);
  },
  drawGameOver() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, opp = OPPONENTS[this.oppIndex];
    text("DEFEATED", 84, COL.RED, cx, 190);
    text(opp.style === "mirror" ? "Your mirror broke you." : (opp.name + " was too much."), 30, COL.WHITE, cx, 285);
    text("Your style is still being learned — run it back.", 20, COL.GREY, cx, 335);
    const btn = (label, bx, sel, color) => {
      ctx.fillStyle = sel ? color : COL.BG2;
      roundRect(bx - 130, 470, 260, 72, 12, true, false);
      ctx.strokeStyle = sel ? COL.WHITE : COL.DARKGREY; ctx.lineWidth = 3;
      roundRect(bx - 130, 470, 260, 72, 12, false, true);
      text(label, 30, sel ? COL.BLACK : COL.WHITE, bx, 506);
    };
    btn("TRY AGAIN", cx - 150, this.defeatIndex === 0, COL.GREEN);
    btn("MENU", cx + 150, this.defeatIndex === 1, COL.YELLOW);
    text("< > to choose  -  Enter to confirm   (R = retry, M = menu)", 18, COL.DARKGREY, cx, 600);
  },
  drawRevive() {
    const cx = W / 2, cy = H / 2, t = this.timer, p = clamp(t / 80, 0, 1);
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    // expanding shockwave rings
    for (let k = 0; k < 3; k++) {
      const rp = clamp(p * 1.3 - k * 0.18, 0, 1);
      if (rp <= 0 || rp >= 1) continue;
      ctx.strokeStyle = rgba([90, 170, 255], (1 - rp) * 0.8);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, rp * 380, 0, 2 * Math.PI); ctx.stroke();
    }
    // the fighter reassembling from light
    const grow = clamp(p * 1.4, 0, 1);
    ctx.fillStyle = rgba([90, 170, 255], 0.4 + 0.6 * grow);
    ctx.beginPath(); ctx.arc(cx, cy, FIGHTER_RADIUS * grow, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = COL.WHITE; ctx.lineWidth = 2; ctx.stroke();
    // opening white flash
    if (t < 12) { ctx.fillStyle = rgba([235, 235, 245], (12 - t) / 12); ctx.fillRect(0, 0, W, H); }
    text("REMATCH", 72, COL.WHITE, cx, cy - 170);
    text("You rise again.", 24, COL.CYAN, cx, cy + 160);
  },
  drawVictory() {
    ctx.fillStyle = COL.BG; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, t = performance.now() / 1000;
    text("YOU WIN", 100, COL.YELLOW, cx, 230 + Math.sin(t * 3) * 6);
    text("You defeated all rivals - and your own mirror.", 28, COL.WHITE, cx, 340);
    text("Nobody knows your game better than you do.", 24, COL.GREEN, cx, 390);
    text("press any key for the menu", 22, COL.DARKGREY, cx, H - 60);
  },
};

/* ============================== LOOP ================================== */
let acc = 0, last = performance.now();
const STEP = 1000 / FPS;
function loop(now) {
  acc += now - last; last = now;
  let steps = 0;
  while (acc >= STEP && steps < 5) { GAME.update(); acc -= STEP; steps++; }
  GAME.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Our own little physics engine, for the cards in the finishers.
//
// It is a rigid-body engine for flat boxes (cards) lying on a table, with a height:
//  · each body has a position and an angle on the table, a speed and a spin; and a HEIGHT above the table (z) with its own gravity, bounce and landing,
//    and a TILT (how far it is turned up on an edge, in degrees) that tumbles freely in the air and rocks on a spring when it lands;
//  · bodies collide as real oriented boxes: separating-axis test, contact points found by clipping the edges, and the contacts are solved with sequential impulses
//    (normal impulses with restitution, Coulomb friction, the spin that an off-centre hit gives, and a soft push out of penetration), so cards knock each other round and
//    turn when they are hit at a corner; cards at different heights fly over each other;
//  · the table has Coulomb friction (sliding stops in a straight line, not by an exponential fade), and the screen's edges are walls;
//  · time is worked out in small FIXED steps (120 a second) and the result is interpolated for the frame that is drawn, so it is the same on a slow or an uneven frame;
//  · bodies that have come to rest go to sleep (they cost nothing) and wake up when something hits them or is done to them.
// There are no dependencies and nothing of the page in it: it can be tested on its own.

const STEP = 1 / 120;
const DEG = 180 / Math.PI;

export interface Body {
  x: number;
  y: number;
  /** Radians. */
  angle: number;
  vx: number;
  vy: number;
  /** Spin, radians a second. */
  w: number;
  /** Half the width and half the height. */
  hw: number;
  hh: number;
  invMass: number;
  invI: number;
  /** Height above the table, and its speed. */
  z: number;
  vz: number;
  /** Tilt about the two axes (degrees) and how fast it is changing (degrees a second). */
  tx: number;
  ty: number;
  vtx: number;
  vty: number;
  restitution: number;
  friction: number;
  /** Never moves (the walls). */
  isStatic: boolean;
  /** Moved by the caller, not by the engine (still pushes dynamic bodies that hit it? no: it is simply ignored). */
  kinematic: boolean;
  /** Its height is set by the caller (no gravity and no landing): hovering, being lifted. */
  hover: boolean;
  /** Collides whatever the height (the walls). */
  wall: boolean;
  asleep: boolean;
  sleepT: number;
  // forces, added up and used at the next step
  fx: number;
  fy: number;
  torque: number;
  // the state one step ago, for drawing between steps
  px: number;
  py: number;
  pa: number;
  pz: number;
  ptx: number;
  pty: number;
}

export function createBox(x: number, y: number, w: number, h: number, o: Partial<Body> = {}): Body {
  return {
    x, y, angle: 0, vx: 0, vy: 0, w: 0, hw: w / 2, hh: h / 2,
    invMass: 1, invI: 12 / (w * w + h * h), // (a mass of 1)
    z: 0, vz: 0, tx: 0, ty: 0, vtx: 0, vty: 0,
    restitution: 0.4, friction: 0.5, isStatic: false, kinematic: false, hover: false, wall: false, asleep: false, sleepT: 0,
    fx: 0, fy: 0, torque: 0,
    px: x, py: y, pa: 0, pz: 0, ptx: 0, pty: 0,
    ...o,
  };
}

interface Contact {
  a: Body;
  b: Body;
  nx: number;
  ny: number;
  px: number;
  py: number;
  depth: number;
  accN: number;
  accT: number;
  kN: number;
  kT: number;
  target: number;
  rax: number;
  ray: number;
  rbx: number;
  rby: number;
}

/** What a body looks like between two steps. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
  z: number;
  tx: number;
  ty: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class World {
  bodies: Body[] = [];
  walls: Body[] = [];
  gravity = 1900;
  /** Sliding friction on the table, as a slowing (pixels a second, every second). */
  groundFriction = 1100;
  /** How close in height two bodies have to be to touch. */
  reach = 34;
  iterations = 8;
  /** Called at the start of every fixed step, to apply forces that last (a pull, a wind): forces given here are used in that step, so they do not depend on the frame rate. */
  onStep: ((h: number) => void) | null = null;
  /** Called when something hits hard: a card landing, or two cards knocking (the strength is the speed of the hit, in pixels a second). */
  onImpact: ((strength: number) => void) | null = null;
  private acc = 0;
  private alpha = 0;
  private contacts: Contact[] = [];

  add(b: Body): Body {
    this.bodies.push(b);
    return b;
  }

  /** Four walls round a rectangle (the screen), thick and out of sight, so nothing can get out. */
  addWalls(width: number, height: number, x0 = 0, y0 = 0): void {
    const t = 400;
    const mk = (x: number, y: number, w: number, h: number) =>
      this.walls.push(createBox(x0 + x, y0 + y, w, h, { invMass: 0, invI: 0, isStatic: true, wall: true, asleep: true, restitution: 0.45, friction: 0.3 }));
    mk(-t / 2, height / 2, t, height + t * 2);
    mk(width + t / 2, height / 2, t, height + t * 2);
    mk(width / 2, -t / 2, width + t * 2, t);
    mk(width / 2, height + t / 2, width + t * 2, t);
  }

  wake(b: Body): void {
    b.asleep = false;
    b.sleepT = 0;
  }

  /** Moves the world on by `dt` seconds (in as many fixed steps as that needs). */
  update(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 12) {
      for (const b of this.bodies) {
        b.px = b.x;
        b.py = b.y;
        b.pa = b.angle;
        b.pz = b.z;
        b.ptx = b.tx;
        b.pty = b.ty;
      }
      this.step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 12) this.acc = 0; // (way behind: do not try to catch up)
    this.alpha = this.acc / STEP;
  }

  /** Where `b` is, between the last step and the next one. */
  pose(b: Body, out: Pose): Pose {
    const k = this.alpha;
    out.x = lerp(b.px, b.x, k);
    out.y = lerp(b.py, b.y, k);
    out.angle = lerp(b.pa, b.angle, k);
    out.z = lerp(b.pz, b.z, k);
    out.tx = lerp(b.ptx, b.tx, k);
    out.ty = lerp(b.pty, b.ty, k);
    return out;
  }

  /** Throws every body away from (x, y), the nearer the harder, up into the air and spinning and tumbling. `squash` flattens the push vertically (a table seen at a slant). */
  blast(x: number, y: number, strength: number, squash = 0.6): void {
    for (const b of this.bodies) {
      if (b.kinematic || b.isStatic) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy) || 1;
      const near = 1 / (1 + d / 260);
      const sp = strength * near + strength * 0.12;
      b.vx = (dx / d) * sp;
      b.vy = (dy / d) * sp * squash - strength * 0.05;
      b.vz = strength * (0.35 + near * 0.5) * (0.8 + Math.random() * 0.4);
      b.z = Math.max(b.z, 1);
      b.w = (Math.random() * 2 - 1) * 5.2 * (strength / 900);
      b.vtx = (Math.random() * 2 - 1) * 520 * near;
      b.vty = (Math.random() * 2 - 1) * 420 * near;
      this.wake(b);
    }
  }

  /** A knock to one body (any of the parts): speed added, and it is woken. */
  kick(b: Body, k: { vx?: number; vy?: number; vz?: number; w?: number; vtx?: number; vty?: number }): void {
    b.vx += k.vx ?? 0;
    b.vy += k.vy ?? 0;
    b.vz = Math.max(b.vz, k.vz ?? 0);
    if (k.vz) b.z = Math.max(b.z, 0.5);
    b.w += k.w ?? 0;
    b.vtx += k.vtx ?? 0;
    b.vty += k.vty ?? 0;
    this.wake(b);
  }

  // ───────────── one fixed step

  private step(h: number): void {
    const dyn = this.bodies;
    this.onStep?.(h);
    // 1. forces and the table: speeds change; heights and tilts move
    for (const b of dyn) {
      if (b.kinematic || b.isStatic || b.asleep) continue;
      b.vx += b.fx * b.invMass * h;
      b.vy += b.fy * b.invMass * h;
      b.w += b.torque * b.invI * h;
      b.fx = b.fy = b.torque = 0;
      const air = b.hover || b.z > 0.4 || b.vz > 0;
      if (air) {
        const k = Math.exp(-0.12 * h);
        b.vx *= k;
        b.vy *= k;
        b.w *= Math.exp(-0.2 * h);
        b.tx += b.vtx * h; // it tumbles freely
        b.ty += b.vty * h;
        if (!b.hover) {
          b.vz -= this.gravity * h;
          b.z += b.vz * h;
          if (b.z <= 0) this.land(b);
        }
      } else {
        b.z = 0; // (a hair above the table counts as on it)
        b.vz = 0;
        // on the table: sliding friction slows it in a straight line to a stop (it does not fade like a spring), spin too
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
          const k = Math.max(0, sp - this.groundFriction * h) / sp;
          b.vx *= k;
          b.vy *= k;
        }
        b.w = Math.sign(b.w) * Math.max(0, Math.abs(b.w) - 6.5 * h) * Math.exp(-1.2 * h);
        // the tilt is a spring that is a little under-damped: it settles flat after a couple of rocks
        b.vtx += (-120 * b.tx - 9 * b.vtx) * h;
        b.vty += (-120 * b.ty - 9 * b.vty) * h;
        b.tx += b.vtx * h;
        b.ty += b.vty * h;
      }
    }

    // 2. contacts between the bodies, and with the walls
    const contacts = this.contacts;
    contacts.length = 0;
    const n = dyn.length;
    for (let i = 0; i < n; i++) {
      const a = dyn[i];
      if (a.kinematic) continue;
      for (let j = i + 1; j < n; j++) {
        const b = dyn[j];
        if (b.kinematic) continue;
        if (a.asleep && b.asleep) continue;
        if (Math.abs(a.z - b.z) > this.reach) continue;
        this.collide(a, b, contacts);
      }
      if (a.asleep) continue;
      for (const w of this.walls) this.collide(w, a, contacts);
    }
    for (const c of contacts) {
      // something moving fast that touches a sleeper wakes it
      if (c.a.asleep && !c.a.isStatic && Math.hypot(c.b.vx, c.b.vy) > 30) this.wake(c.a);
      if (c.b.asleep && !c.b.isStatic && Math.hypot(c.a.vx, c.a.vy) > 30) this.wake(c.b);
    }

    // 3. the contacts are solved: each pushes the two bodies apart along its normal (never pulling), with friction along it
    const beta = 0.2;
    for (const c of contacts) {
      const { a, b } = c;
      c.rax = c.px - a.x;
      c.ray = c.py - a.y;
      c.rbx = c.px - b.x;
      c.rby = c.py - b.y;
      const raN = c.rax * c.ny - c.ray * c.nx;
      const rbN = c.rbx * c.ny - c.rby * c.nx;
      c.kN = a.invMass + b.invMass + a.invI * raN * raN + b.invI * rbN * rbN;
      const tx = -c.ny;
      const ty = c.nx;
      const raT = c.rax * ty - c.ray * tx;
      const rbT = c.rbx * ty - c.rby * tx;
      c.kT = a.invMass + b.invMass + a.invI * raT * raT + b.invI * rbT * rbT;
      const vn = this.relN(c);
      const e = Math.min(a.restitution, b.restitution);
      const bounce = vn < -140 ? -e * vn : 0; // (slow contacts do not bounce: they would buzz)
      const push = Math.min(260, (beta / h) * Math.max(0, c.depth - 0.6));
      c.target = Math.max(bounce, push);
      c.accN = 0;
      c.accT = 0;
    }
    for (let it = 0; it < this.iterations; it++) {
      for (const c of contacts) {
        const { a, b } = c;
        let vn = this.relN(c);
        let dP = (c.target - vn) / c.kN;
        const accN = Math.max(c.accN + dP, 0);
        dP = accN - c.accN;
        c.accN = accN;
        this.apply(c, dP * c.nx, dP * c.ny);
        // friction
        const tx = -c.ny;
        const ty = c.nx;
        const rvx = b.vx - b.w * c.rby - (a.vx - a.w * c.ray);
        const rvy = b.vy + b.w * c.rbx - (a.vy + a.w * c.rax);
        const vt = rvx * tx + rvy * ty;
        let dT = -vt / c.kT;
        const maxF = Math.sqrt(a.friction * b.friction) * c.accN;
        const accT = Math.max(-maxF, Math.min(maxF, c.accT + dT));
        dT = accT - c.accT;
        c.accT = accT;
        this.apply(c, dT * tx, dT * ty);
        vn = 0;
      }
    }
    // a hard hit pops a card up a little and rocks it on its edge
    for (const c of contacts) {
      if (c.accN < 60) continue;
      if (c.accN > 140 && !c.a.isStatic && !c.b.isStatic) this.onImpact?.(c.accN);
      for (const b of [c.a, c.b]) {
        if (b.isStatic || b.hover || b.z > 4) continue;
        b.vz = Math.max(b.vz, Math.min(200, c.accN * 0.1));
        b.z = Math.max(b.z, 0.5);
        b.vtx += (Math.random() * 2 - 1) * Math.min(220, c.accN * 0.25);
        b.vty += (Math.random() * 2 - 1) * Math.min(220, c.accN * 0.25);
      }
    }

    // 4. the bodies move
    for (const b of dyn) {
      if (b.kinematic || b.isStatic || b.asleep) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.angle += b.w * h;
      // 5. rest: on the table and still for half a second, it sleeps
      if (!b.hover && b.z === 0 && b.vz === 0 && Math.hypot(b.vx, b.vy) < 8 && Math.abs(b.w) < 0.15 && Math.abs(b.vtx) < 6 && Math.abs(b.tx) < 0.5 && Math.abs(b.ty) < 0.5) {
        b.sleepT += h;
        if (b.sleepT > 0.5) {
          b.asleep = true;
          b.vx = b.vy = b.w = b.vtx = b.vty = 0;
          b.tx = b.ty = 0;
        }
      } else b.sleepT = 0;
    }
  }

  /** It lands: a bounce that loses speed and spin and rocks it on its edge, or, if it is coming down gently, it just stops. */
  private land(b: Body): void {
    b.z = 0;
    b.tx -= 360 * Math.round(b.tx / 360); // (a whole number of turns is the same as none)
    b.ty -= 360 * Math.round(b.ty / 360);
    if (b.vz < -170) {
      const hit = -b.vz;
      if (hit > 230) this.onImpact?.(hit);
      b.vz = hit * 0.36;
      b.vx *= 0.78;
      b.vy *= 0.78;
      b.w *= 0.7;
      b.vtx = Math.max(-260, Math.min(260, b.vtx * 0.25 + (Math.random() * 2 - 1) * hit * 0.22));
      b.vty = Math.max(-260, Math.min(260, b.vty * 0.25 + (Math.random() * 2 - 1) * hit * 0.22));
    } else b.vz = 0;
  }

  private relN(c: Contact): number {
    const { a, b } = c;
    const rvx = b.vx - b.w * c.rby - (a.vx - a.w * c.ray);
    const rvy = b.vy + b.w * c.rbx - (a.vy + a.w * c.rax);
    return rvx * c.nx + rvy * c.ny;
  }

  private apply(c: Contact, px: number, py: number): void {
    const { a, b } = c;
    a.vx -= px * a.invMass;
    a.vy -= py * a.invMass;
    a.w -= a.invI * (c.rax * py - c.ray * px);
    b.vx += px * b.invMass;
    b.vy += py * b.invMass;
    b.w += b.invI * (c.rbx * py - c.rby * px);
  }

  /** Finds where two boxes touch (if they do): the axis they overlap least along, and the points of the edge of one that are inside the other. */
  private collide(A: Body, B: Body, out: Contact[]): void {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const ra = Math.hypot(A.hw, A.hh);
    const rb = Math.hypot(B.hw, B.hh);
    if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) return;
    const ca = Math.cos(A.angle);
    const sa = Math.sin(A.angle);
    const cb = Math.cos(B.angle);
    const sb = Math.sin(B.angle);
    const ax = [ca, -sa, cb, -sb];
    const ay = [sa, ca, sb, cb];
    let best = Infinity;
    let bi = -1;
    let bs = 1;
    for (let i = 0; i < 4; i++) {
      const ux = ax[i];
      const uy = ay[i];
      const pa = A.hw * Math.abs(ux * ca + uy * sa) + A.hh * Math.abs(-ux * sa + uy * ca);
      const pb = B.hw * Math.abs(ux * cb + uy * sb) + B.hh * Math.abs(-ux * sb + uy * cb);
      const dist = dx * ux + dy * uy;
      const overlap = pa + pb - Math.abs(dist);
      if (overlap <= 0) return;
      if (overlap < best - (i >= 2 ? 0.5 : 0)) {
        // (the first body's axes win a near tie: contacts keep to one face instead of flickering between two)
        best = overlap;
        bi = i;
        bs = dist < 0 ? -1 : 1;
      }
    }
    const nx = ax[bi] * bs; // from A to B
    const ny = ay[bi] * bs;
    const refIsA = bi < 2;
    const ref = refIsA ? A : B;
    const inc = refIsA ? B : A;
    const rnx = refIsA ? nx : -nx; // from the reference body towards the other
    const rny = refIsA ? ny : -ny;
    const hRef = bi % 2 === 0 ? ref.hw : ref.hh;
    const hTan = bi % 2 === 0 ? ref.hh : ref.hw;
    const tx = -rny;
    const ty = rnx;
    // the edge of the other body that faces the reference face most squarely
    const ci = Math.cos(inc.angle);
    const si = Math.sin(inc.angle);
    const d0 = rnx * ci + rny * si;
    const d1 = -rnx * si + rny * ci;
    const k0 = Math.abs(d0) > Math.abs(d1);
    const ukx = k0 ? ci : -si;
    const uky = k0 ? si : ci;
    const upx = k0 ? -si : ci;
    const upy = k0 ? ci : si;
    const hk = k0 ? inc.hw : inc.hh;
    const hp = k0 ? inc.hh : inc.hw;
    const s = (k0 ? d0 : d1) > 0 ? -1 : 1;
    const fcx = inc.x + ukx * s * hk;
    const fcy = inc.y + uky * s * hk;
    let p1x = fcx + upx * hp;
    let p1y = fcy + upy * hp;
    let p2x = fcx - upx * hp;
    let p2y = fcy - upy * hp;
    // clip that edge to the reference face's sides
    for (const sign of [1, -1]) {
      const o1 = (p1x - ref.x) * tx * sign + (p1y - ref.y) * ty * sign - hTan;
      const o2 = (p2x - ref.x) * tx * sign + (p2y - ref.y) * ty * sign - hTan;
      if (o1 > 0 && o2 > 0) return;
      if (o1 > 0) {
        const k = o1 / (o1 - o2);
        p1x += (p2x - p1x) * k;
        p1y += (p2y - p1y) * k;
      } else if (o2 > 0) {
        const k = o2 / (o2 - o1);
        p2x += (p1x - p2x) * k;
        p2y += (p1y - p2y) * k;
      }
    }
    for (const [px, py] of [[p1x, p1y], [p2x, p2y]]) {
      const sep = (px - ref.x) * rnx + (py - ref.y) * rny - hRef;
      if (sep > 0.5) continue;
      out.push({ a: A, b: B, nx, ny, px, py, depth: Math.max(0, -sep), accN: 0, accT: 0, kN: 1, kT: 1, target: 0, rax: 0, ray: 0, rbx: 0, rby: 0 });
    }
  }
}

export const toDegrees = DEG;

// Google マップ風の視点操作（Potree 1.8 の viewer 用）
//  マウス: 左ドラッグ = 地図を掴んで移動 / 右ドラッグ・Ctrl+左ドラッグ = 回転と傾き / ホイール = カーソルの場所へ拡大縮小
//          ダブルクリック = その場所へ寄る（Shift で引く）
//  タッチ: 1 本指 = 移動 / 2 本指 = つまんで拡大縮小・ひねって回転・そろえて上下に動かして傾き
//  キー:   矢印 = 移動 / + - = 拡大縮小 / Q E = 回転 / W S = 傾き
// 掴む点は、カーソルの下の点群を拾って決める。点がないところは、最後に掴んだ高さの水平面で代用する。
export class MapControls {
  constructor(viewer, opts = {}) {
    this.viewer = viewer;
    this.el = viewer.renderer.domElement;
    this.enabled = true;
    this.groundZ = opts.groundZ ?? 0;
    this.minDist = opts.minDist ?? 1.0;
    this.maxDist = opts.maxDist ?? 3000;
    this.minTilt = 2 * Math.PI / 180;   // 真上からの傾きの下限（真上ちょうどは向きが決まらない）
    this.maxTilt = 85 * Math.PI / 180;  // 水平近くまで傾けられる
    this.V3 = viewer.scene.getActiveCamera().position.constructor;
    this.pointers = new Map();
    this.onChange = opts.onChange || (() => {});
    const host = this.el.parentElement;
    // Potree 自身の操作より先に受け取り、伝わらないようにする（キャプチャで止める）
    const cap = { capture: true, passive: false };
    host.addEventListener('pointerdown', e => this.down(e), cap);
    host.addEventListener('pointermove', e => this.move(e), cap);
    host.addEventListener('pointerup', e => this.up(e), cap);
    host.addEventListener('pointercancel', e => this.up(e), cap);
    host.addEventListener('wheel', e => this.wheel(e), cap);
    host.addEventListener('dblclick', e => this.dbl(e), cap);
    host.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); }, cap);
    for (const t of ['mousedown', 'mousemove', 'mouseup', 'mousewheel', 'DOMMouseScroll', 'touchstart', 'touchmove', 'touchend'])
      host.addEventListener(t, e => { if (this.enabled) { e.stopPropagation(); if (t.startsWith('touch') || t.includes('wheel') || t === 'DOMMouseScroll') e.preventDefault(); } }, cap);
    window.addEventListener('keydown', e => this.key(e));
    this.el.style.touchAction = 'none';
  }

  get view() { return this.viewer.scene.view; }
  get camera() { return this.viewer.scene.getActiveCamera(); }

  local(e) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  ray(p) {
    const cam = this.camera, V3 = this.V3, v = this.view;
    // 描画を待たずに続けて動かせるよう、視点からカメラを毎回作り直す（Potree の update と同じ式）
    cam.position.copy(v.position);
    cam.rotation.order = 'ZXY';
    cam.rotation.x = Math.PI / 2 + v.pitch;
    cam.rotation.z = v.yaw;
    cam.updateMatrixWorld();
    const nx = p.x / this.el.clientWidth * 2 - 1, ny = -(p.y / this.el.clientHeight) * 2 + 1;
    const o = new V3().setFromMatrixPosition(cam.matrixWorld);
    const d = new V3(nx, ny, 0.5).unproject(cam).sub(o).normalize();
    return { o, d };
  }

  planeHit(p, z) {
    const { o, d } = this.ray(p);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = (z - o.z) / d.z;
    if (t <= 0) return null;
    return o.clone().add(d.multiplyScalar(t));
  }

  pick(p) {
    try {
      const pcs = this.viewer.scene.pointclouds;
      const I = Potree.Utils.getMousePointCloudIntersection(p, this.camera, this.viewer, pcs, { pickClipped: false });
      if (I && I.location) { this.groundZ = I.location.z; return I.location.clone(); }
    } catch (err) { /* 拾えないときは平面で代用 */ }
    return this.planeHit(p, this.groundZ) || this.view.getPivot();
  }

  tilt() { return Math.PI / 2 + this.view.pitch; }  // 0 = 真上から, π/2 = 水平

  // 中心点 P のまわりに、向き dyaw と傾き dtilt だけ回す
  orbit(P, dyaw, dtilt) {
    const v = this.view, V3 = this.V3;
    let off = new V3().subVectors(v.position, P);
    const t0 = this.tilt();
    const t1 = Math.min(this.maxTilt, Math.max(this.minTilt, t0 + dtilt));
    const side = new V3(Math.cos(v.yaw), Math.sin(v.yaw), 0);
    off.applyAxisAngle(side, t1 - t0);
    off.applyAxisAngle(new V3(0, 0, 1), dyaw);
    v.position.copy(P).add(off);
    v.yaw += dyaw;
    v.pitch = t1 - Math.PI / 2;
    this.clampHeight();
    this.onChange();
  }

  // 視点が地面（掴んだ点の高さ）より 1.5 m 下に潜らないようにする
  clampHeight() {
    const v = this.view, minZ = this.groundZ + 1.5;
    if (v.position.z < minZ) v.position.z = minZ;
  }

  zoomAt(P, factor) {
    const v = this.view;
    const d = v.position.distanceTo(P);
    const nd = Math.min(this.maxDist, Math.max(this.minDist, d * factor));
    v.position.sub(P).multiplyScalar(nd / d).add(P);
    this.clampHeight();
    this.onChange();
  }

  panTo(anchor, p) {
    const hit = this.planeHit(p, anchor.z);
    if (!hit) return;
    this.view.position.add(anchor.clone().sub(hit).setZ(0));
    this.onChange();
  }

  down(e) {
    if (!this.enabled) return;
    e.stopPropagation(); e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.el.focus?.();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const rotate = e.button === 2 || e.ctrlKey || e.metaKey || e.altKey;
    if (this.pointers.size === 1) {
      this.mode = rotate ? 'rotate' : 'pan';
      this.anchor = this.pick(p);
      this.last = p;
    } else if (this.pointers.size === 2) {
      this.startTouch2();
    }
  }

  startTouch2() {
    const [a, b] = [...this.pointers.values()];
    this.mode = 'touch2';
    this.t2 = { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    this.anchor = this.pick(this.t2.mid);
  }

  move(e) {
    if (!this.enabled || !this.pointers.has(e.pointerId)) return;
    e.stopPropagation(); e.preventDefault();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'pan' && this.pointers.size === 1) {
      this.panTo(this.anchor, p);
    } else if (this.mode === 'rotate' && this.pointers.size === 1) {
      const dx = p.x - this.last.x, dy = p.y - this.last.y;
      this.orbit(this.anchor, -dx * 0.006, -dy * 0.006);
      this.last = p;
    } else if (this.mode === 'touch2' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const s = this.t2;
      // 2 本指をそろえて上下に動かしたら傾き、それ以外は移動・拡大縮小・回転
      const dyA = a.y - s.a.y, dyB = b.y - s.b.y;
      if (Math.sign(dyA) === Math.sign(dyB) && Math.abs(dyA) > 2 && Math.abs(dyB) > 2 && Math.abs(dist - s.dist) < 12 && Math.abs(ang - s.ang) < 0.05) {
        this.orbit(this.anchor, 0, -(dyA + dyB) / 2 * 0.006);
      } else {
        this.panTo(this.anchor, mid);
        if (s.dist > 0 && dist > 0) this.zoomAt(this.anchor, s.dist / dist);
        let da = ang - s.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        this.orbit(this.anchor, -da, 0);
      }
      this.t2 = { a, b, mid, dist, ang };
    }
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.stopPropagation();
    this.pointers.delete(e.pointerId);
    this.el.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size === 1) {  // 2 本指から 1 本指に戻ったら、残った指で移動を続ける
      const p = [...this.pointers.values()][0];
      this.mode = 'pan'; this.anchor = this.pick(p); this.last = p;
    } else if (this.pointers.size === 0) this.mode = null;
  }

  wheel(e) {
    if (!this.enabled) return;
    e.stopPropagation(); e.preventDefault();
    const p = this.local(e);
    const P = this.pick(p);
    const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.zoomAt(P, Math.exp(step * 0.0015));
  }

  dbl(e) {
    if (!this.enabled) return;
    e.stopPropagation(); e.preventDefault();
    this.zoomAt(this.pick(this.local(e)), e.shiftKey ? 2 : 0.5);
  }

  key(e) {
    if (!this.enabled || e.target.closest?.('input, select, textarea')) return;
    const c = { x: this.el.clientWidth / 2, y: this.el.clientHeight / 2 };
    const P = this.planeHit(c, this.groundZ) || this.view.getPivot();
    const d = this.view.position.distanceTo(P) * 0.08, yaw = this.view.yaw, V3 = this.V3;
    const fwd = new V3(-Math.sin(yaw), Math.cos(yaw), 0), right = new V3(Math.cos(yaw), Math.sin(yaw), 0);
    const k = e.key;
    if (k === 'ArrowUp') this.view.position.addScaledVector(fwd, d);
    else if (k === 'ArrowDown') this.view.position.addScaledVector(fwd, -d);
    else if (k === 'ArrowLeft') this.view.position.addScaledVector(right, -d);
    else if (k === 'ArrowRight') this.view.position.addScaledVector(right, d);
    else if (k === '+' || k === '=') this.zoomAt(P, 0.8);
    else if (k === '-' || k === '_') this.zoomAt(P, 1.25);
    else if (k === 'q' || k === 'Q') this.orbit(P, 0.1, 0);
    else if (k === 'e' || k === 'E') this.orbit(P, -0.1, 0);
    else if (k === 'w' || k === 'W') this.orbit(P, 0, 0.08);
    else if (k === 's' || k === 'S') this.orbit(P, 0, -0.08);
    else return;
    e.preventDefault(); this.onChange();
  }

  // 画面中央の地面を中心に、向き・傾き・距離を指定して見る
  setMapView(center, { yaw = 0, tilt = 0, dist = 300 } = {}) {
    const v = this.view, V3 = this.V3;
    tilt = Math.min(this.maxTilt, Math.max(this.minTilt, tilt));
    const back = new V3(Math.sin(yaw) * Math.sin(tilt), -Math.cos(yaw) * Math.sin(tilt), Math.cos(tilt));
    v.position.copy(center).addScaledVector(back, dist);
    v.yaw = yaw; v.pitch = tilt - Math.PI / 2; v.radius = dist;
    this.groundZ = center.z;
    this.onChange();
  }

  centerHit() {
    const c = { x: this.el.clientWidth / 2, y: this.el.clientHeight / 2 };
    return this.planeHit(c, this.groundZ) || this.view.getPivot();
  }
}

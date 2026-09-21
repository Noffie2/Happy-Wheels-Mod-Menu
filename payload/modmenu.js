(() => {
  'use strict';

  const VERSION = '1.0.0';
  if (window.__HW_MODMENU__ && window.__HW_MODMENU__.version === VERSION) {
    window.__HW_MODMENU__.show?.();
    return 'Happy Wheels Mod Menu already loaded';
  }

  const LOG = (...a) => console.log('%c[HW Mod]', 'color:#e14b4b;font-weight:bold', ...a);
  const WARN = (...a) => console.warn('[HW Mod]', ...a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const safe = (fn, fallback = undefined) => { try { return fn(); } catch { return fallback; } };

  const defaults = {
    godMode: false,
    indestructible: false,
    noEject: false,
    noclip: false,
    freezePlayer: false,
    fly: false,
    flySpeed: 13,
    stabilizer: false,
    stabilizeStrength: 7,
    speedMult: 1,
    accelMult: 1,
    torqueMult: 1,
    leanMult: 1,
    jumpMult: 1,
    boostMult: 1,
    ejectMult: 1,
    gripMult: 1,
    bounceMult: 1,
    massMult: 1,
    size: 1,
    worldGravity: 1,
    timeScale: 1,
    noBlood: false,
    hud: true,
    menuOpacity: 0.94
  };

  const loadSettings = () => {
    try {
      return {...defaults, ...JSON.parse(localStorage.getItem('hwmod.settings') || '{}')};
    } catch { return {...defaults}; }
  };
  const settings = loadSettings();
  const saveSettings = () => safe(() => localStorage.setItem('hwmod.settings', JSON.stringify(settings)));

  let cfg = null;
  let req = null;
  let lastCharacter = null;
  let lastSession = null;
  let lastWorld = null;
  let lastFrame = performance.now();
  let fps = 0, fpsFrames = 0, fpsStamp = performance.now();
  let statusText = 'Waiting for Happy Wheels…';
  let statusKind = 'wait';

  let characterState = new WeakMap();
  let jointState = new WeakMap();
  let shapeState = new WeakMap();
  let worldState = new WeakMap();
  let bloodState = new WeakMap();
  let patchObjectIds = new WeakMap();
  let captureGeneration = Number(safe(() => window.__HW_CAPTURE_GENERATION__, 0)) || 0;
  let bodyGenerationSignature = '';
  let patchObjectCounter = 1;
  const keys = new Set();

  function discoverWebpackRequire() {
    if (req) return req;
    const names = ['webpackChunkhappy_wheels', ...Object.keys(window).filter(k => /^webpackChunk/i.test(k))];
    for (const name of [...new Set(names)]) {
      const chunks = safe(() => window[name]);
      if (!chunks || typeof chunks.push !== 'function') continue;
      let captured = null;
      const id = 800000000 + Math.floor(Math.random() * 100000000);
      try {
        chunks.push([[id], {}, r => { captured = r; }]);
      } catch (e) {
        continue;
      }
      if (captured) {
        req = captured;
        LOG('Captured webpack runtime from', name);
        return req;
      }
    }
    return null;
  }

  function looksLikeConfig(v) {
    if (!v || (typeof v !== 'function' && typeof v !== 'object')) return false;
    try {
      return ('currentSession' in v) && (Array.isArray(v.characterNames) || 'characterIndex' in v || 'bloodSetting' in v);
    } catch { return false; }
  }

  function inspectExports(mod) {
    if (!mod) return null;
    if (looksLikeConfig(mod)) return mod;
    const vals = [];
    if (typeof mod === 'object' || typeof mod === 'function') {
      for (const k of Object.keys(mod)) vals.push(mod[k]);
      if ('default' in mod) vals.push(mod.default);
    }
    return vals.find(looksLikeConfig) || null;
  }

  function discoverConfig() {
    if (cfg && looksLikeConfig(cfg)) return cfg;
    const r = discoverWebpackRequire();
    if (!r) return null;

    // The public HTML5 build uses module 15 for this singleton. Try it first.
    cfg = safe(() => inspectExports(r(15)), null);
    if (cfg) return cfg;

    const factories = r.m || {};
    for (const [id, factory] of Object.entries(factories)) {
      const src = safe(() => Function.prototype.toString.call(factory), '');
      if (!src.includes('currentSession')) continue;
      if (!(src.includes('characterNames') || src.includes('bloodSetting') || src.includes('characterIndex'))) continue;
      const candidate = safe(() => inspectExports(r(id)), null);
      if (candidate) {
        cfg = candidate;
        LOG('Located Happy Wheels config module', id);
        return cfg;
      }
    }
    return null;
  }

  function getSession() {
    const captured = safe(() => window.__HW_CAPTURED_SESSION__, null);
    if (captured && captured.m_world) return captured;
    const c = discoverConfig();
    return safe(() => c?.currentSession, null) || null;
  }

  function getCharacter(session = getSession()) {
    const direct = safe(() => window.__HW_CAPTURED_CHARACTER__, null);
    if (direct && typeof direct === 'object') return direct;
    if (!session) return null;
    return session.character || session._character || safe(() => session.characters?.[0], null) || null;
  }

  function isBody(v) {
    return !!v && typeof v === 'object' &&
      typeof v.GetPosition === 'function' &&
      typeof v.GetShapeList === 'function' &&
      (typeof v.SetLinearVelocity === 'function' || v.m_linearVelocity);
  }

  function isJoint(v) {
    return !!v && typeof v === 'object' &&
      (typeof v.SetMotorSpeed === 'function' || 'm_maxMotorTorque' in v || 'm_maxMotorForce' in v) &&
      ('m_body1' in v || 'm_body2' in v || typeof v.GetJointSpeed === 'function' || typeof v.GetMotorSpeed === 'function');
  }

  function childCharacters(ch) {
    const out = [ch];
    const names = ['kid','son','daughter','elf1','elf2','guy'];
    for (const n of names) {
      const v = ch?.[n];
      if (v && typeof v === 'object') out.push(v);
    }
    if (Array.isArray(ch?.characters)) for (const v of ch.characters) if (v && typeof v === 'object') out.push(v);
    return [...new Set(out)];
  }

  function collectValues(root, pred) {
    const out = new Set();
    if (!root || typeof root !== 'object') return out;
    const roots = childCharacters(root);
    for (const obj of roots) {
      for (const k of Object.keys(obj)) {
        if (k === '_session' || k === 'session' || k === 'sourceObject' || k === 'shapeGuide') continue;
        const v = safe(() => obj[k]);
        if (pred(v)) out.add(v);
        else if (Array.isArray(v)) for (const x of v) if (pred(x)) out.add(x);
      }
      if (Array.isArray(obj.paintVector)) for (const x of obj.paintVector) if (pred(x)) out.add(x);
      if (Array.isArray(obj.COMArray)) for (const x of obj.COMArray) if (pred(x)) out.add(x);
      if (Array.isArray(obj.antiGravArray)) for (const x of obj.antiGravArray) if (pred(x)) out.add(x);
    }
    return out;
  }

  const getBodies = ch => [...collectValues(ch, isBody)];
  const getJoints = ch => [...collectValues(ch, isJoint)];

  function bodyShapes(body) {
    const out = [];
    let s = safe(() => body.GetShapeList(), null);
    let guard = 0;
    while (s && guard++ < 128) {
      out.push(s);
      s = s.m_next || safe(() => s.GetNext(), null);
    }
    return out;
  }

  function allShapes(ch) {
    const out = new Set();
    for (const b of getBodies(ch)) for (const s of bodyShapes(b)) out.add(s);
    return [...out];
  }

  function stateFor(ch) {
    let st = characterState.get(ch);
    if (st) return st;
    st = {
      baseByObject: new WeakMap(),
      methodPatches: new Map(),
      currentSize: 1,
      noClipApplied: false,
      lastMassMult: 1,
      lastGripMult: 1,
      lastBounceMult: 1,
      visualBase: new WeakMap(),
      thresholdBase: new Map(),
      impulseBase: new Map()
    };
    characterState.set(ch, st);
    return st;
  }

  function baseFor(st, obj, ch, key) {
    let m = st.baseByObject.get(obj);
    if (!m) { m = new Map(); st.baseByObject.set(obj, m); }
    if (!m.has(key) && typeof obj[key] === 'number') m.set(key, obj[key]);
    return m.get(key);
  }

  function applyNumericModifiers(ch) {
    const st = stateFor(ch);
    for (const root of childCharacters(ch)) {
      const mulMap = {
        wheelMaxSpeed: settings.speedMult,
        accelStep: settings.accelMult,
        prisAccelStep: settings.accelMult,
        maxTorque: settings.torqueMult,
        impulseMagnitude: settings.leanMult,
        impulseLeft: settings.leanMult,
        impulseRight: settings.leanMult,
        maxSpinAV: Math.max(0.05, settings.leanMult),
        ejectImpulse: settings.ejectMult,
        jumpTranslation: settings.jumpMult,
        verticalTranslation: settings.jumpMult,
        bounceTranslation: settings.jumpMult,
        bounceSpeed: settings.jumpMult,
        retractSpeed: settings.jumpMult,
        boostMax: settings.boostMult,
        boostStepUp: settings.boostMult,
        maxStep: settings.leanMult
      };
      for (const [k, mult] of Object.entries(mulMap)) {
        if (typeof root[k] !== 'number') continue;
        const b = baseFor(st, root, ch, k);
        if (Number.isFinite(b)) root[k] = b * mult;
      }
    }

    for (const j of getJoints(ch)) {
      let js = jointState.get(j);
      if (!js) {
        js = {
          torque: typeof j.m_maxMotorTorque === 'number' ? j.m_maxMotorTorque : null,
          force: typeof j.m_maxMotorForce === 'number' ? j.m_maxMotorForce : null
        };
        jointState.set(j, js);
      }
      if (js.torque != null) j.m_maxMotorTorque = js.torque * settings.torqueMult;
      if (js.force != null) j.m_maxMotorForce = js.force * settings.torqueMult;
    }
  }

  function thresholdKeys(root) {
    return Object.keys(root).filter(k => typeof root[k] === 'number' && /(SmashLimit|BreakLimit|SnapLimit|LigamentLimit|spineLimit|intestineLimit|wheelSmashLimit|frameSmashLimit|helmetSmashLimit|copterSmashLimit|bladeSmashLimit)$/i.test(k));
  }

  function applyGodMode(ch) {
    const st = stateFor(ch);
    for (const root of childCharacters(ch)) {
      let tb = st.thresholdBase.get(root);
      if (!tb) { tb = new Map(); st.thresholdBase.set(root, tb); }
      for (const k of thresholdKeys(root)) if (!tb.has(k)) tb.set(k, root[k]);

      let ib = st.impulseBase.get(root);
      if (!ib) { ib = new Map(); st.impulseBase.set(root, ib); }
      if (root.contactImpulseDict && typeof root.contactImpulseDict.forEach === 'function') {
        root.contactImpulseDict.forEach((v, k) => { if (!ib.has(k) && Number.isFinite(v)) ib.set(k, v); });
      }

      if (settings.godMode) {
        safe(() => { root.dead = false; });
        safe(() => { root._dead = false; });
        safe(() => { root._dying = false; });
        safe(() => { root._bleedCounter = 0; });
        for (const k of tb.keys()) root[k] = 1e12;
        if (root.contactImpulseDict && typeof root.contactImpulseDict.forEach === 'function') {
          root.contactImpulseDict.forEach((v, k) => safe(() => root.contactImpulseDict.set(k, 1e12)));
        }
      } else {
        for (const [k,v] of tb) if (k in root) root[k] = v;
        if (root.contactImpulseDict && typeof root.contactImpulseDict.set === 'function') {
          for (const [k,v] of ib) if (root.contactImpulseDict.has(k)) safe(() => root.contactImpulseDict.set(k, v));
        }
      }
    }
  }

  function patchMethod(st, obj, name, replacement) {
    if (!patchObjectIds.has(obj)) patchObjectIds.set(obj, patchObjectCounter++);
    const key = `${patchObjectIds.get(obj)}::${name}`;
    if (st.methodPatches.has(key)) return;
    if (!(name in obj) || typeof obj[name] !== 'function') return;
    st.methodPatches.set(key, {obj, name, hadOwn: own(obj, name), value: obj[name]});
    obj[name] = replacement;
  }

  function restoreMethodPatches(st, filter = null) {
    for (const [key, p] of [...st.methodPatches]) {
      if (filter && !filter(key, p)) continue;
      try { if (p.hadOwn) p.obj[p.name] = p.value; else delete p.obj[p.name]; } catch {}
      st.methodPatches.delete(key);
    }
  }

  function collectPrototypeMethods(obj) {
    const out = new Set();
    let p = obj;
    let depth = 0;
    while (p && p !== Object.prototype && depth++ < 8) {
      for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor' && typeof safe(() => obj[n]) === 'function') out.add(n);
      p = Object.getPrototypeOf(p);
    }
    return [...out];
  }

  function applyProtectionPatches(ch) {
    const st = stateFor(ch);
    // Rebuild protection patches each tick if the settings changed externally.
    restoreMethodPatches(st);
    for (const root of childCharacters(ch)) {
      if (settings.noEject) {
        for (const n of ['eject','checkEject','remoteEject','userVehicleEject']) patchMethod(st, root, n, () => undefined);
      }
      if (settings.indestructible) {
        for (const n of collectPrototypeMethods(root)) {
          if (/(smash|break|impale|explodeShape|removeBody)/i.test(n) && !/(reset|create)/i.test(n)) patchMethod(st, root, n, () => undefined);
        }
      } else if (settings.godMode) {
        for (const n of ['die','headSmash1','chestSmash','pelvisSmash','shapeImpale']) patchMethod(st, root, n, () => undefined);
      }
    }
  }

  function snapshotShape(s) {
    let st = shapeState.get(s);
    if (!st) {
      st = {
        friction: finite(s.m_friction, null),
        restitution: finite(s.m_restitution, null),
        density: finite(s.m_density, null),
        lastNoclip: null, lastDensity: undefined, lastRestitution: undefined, lastFriction: undefined,
        filter: s.m_filter ? {
          categoryBits: s.m_filter.categoryBits,
          maskBits: s.m_filter.maskBits,
          groupIndex: s.m_filter.groupIndex
        } : null
      };
      shapeState.set(s, st);
    }
    return st;
  }

  function setFilter(s, data, world) {
    if (!s.m_filter || !data) return;
    s.m_filter.categoryBits = data.categoryBits;
    s.m_filter.maskBits = data.maskBits;
    s.m_filter.groupIndex = data.groupIndex;
    safe(() => s.SetFilterData(s.m_filter));
    safe(() => world?.Refilter(s));
  }

  function applyMaterialMods(ch, session) {
    const bodies = getBodies(ch);
    const world = session?.m_world;
    const wheelShapes = new Set();
    for (const root of childCharacters(ch)) {
      for (const [k, v] of Object.entries(root)) if (/wheel.*shape/i.test(k) && v && typeof v === 'object') wheelShapes.add(v);
    }
    for (const b of bodies) {
      let massDirty = false;
      for (const s of bodyShapes(b)) {
        const ss = snapshotShape(s);
        if (ss.restitution != null) {
          const target = ss.restitution * settings.bounceMult;
          if (ss.lastRestitution !== target) { s.m_restitution = target; ss.lastRestitution = target; }
        }
        if (ss.density != null && ss.density > 0) {
          const target = ss.density * settings.massMult;
          if (ss.lastDensity !== target) { s.m_density = target; ss.lastDensity = target; massDirty = true; }
        }
        if (wheelShapes.has(s) && ss.friction != null) {
          const target = ss.friction * settings.gripMult;
          if (ss.lastFriction !== target) { s.m_friction = target; ss.lastFriction = target; }
        }
        if (ss.filter && ss.lastNoclip !== settings.noclip) {
          setFilter(s, settings.noclip ? {...ss.filter, maskBits: 0} : ss.filter, world);
          ss.lastNoclip = settings.noclip;
        }
      }
      if (massDirty) safe(() => b.SetMassFromShapes());
    }
  }

  function makeVec(body, x, y) {
    const sample = safe(() => body.GetLinearVelocity(), null) || safe(() => body.GetPosition(), null);
    if (sample?.constructor) {
      try { return new sample.constructor(x, y); } catch {}
      try { const v = new sample.constructor(); v.x = x; v.y = y; return v; } catch {}
    }
    return {x, y};
  }

  function setBodyVelocity(body, x, y) {
    const v = makeVec(body, x, y);
    if (typeof body.SetLinearVelocity === 'function') body.SetLinearVelocity(v);
    else if (body.m_linearVelocity) { body.m_linearVelocity.x = x; body.m_linearVelocity.y = y; }
    safe(() => body.WakeUp());
  }

  function getVel(body) {
    const v = safe(() => body.GetLinearVelocity(), body.m_linearVelocity);
    return v ? {x: finite(v.x), y: finite(v.y)} : {x:0,y:0};
  }

  function mainBody(ch) {
    const names = ['frameBody','mainBody','chairBody','sleighBody','mowerBody','copterBody','pelvisBody','chestBody','head1Body','wheelBody','bigWheelBody'];
    for (const n of names) if (isBody(ch?.[n])) return ch[n];
    return getBodies(ch)[0] || null;
  }

  function applyMotionMods(ch, dt) {
    const bodies = getBodies(ch);
    if (!bodies.length) return;
    if (settings.freezePlayer) {
      for (const b of bodies) { setBodyVelocity(b, 0, 0); safe(() => b.SetAngularVelocity(0)); }
      return;
    }
    if (settings.fly) {
      let x = 0, y = 0;
      if (keys.has('KeyA')) x -= 1;
      if (keys.has('KeyD')) x += 1;
      if (keys.has('KeyW')) y -= 1;
      if (keys.has('KeyS')) y += 1;
      if (x || y) {
        const len = Math.hypot(x,y) || 1;
        x = x / len * settings.flySpeed;
        y = y / len * settings.flySpeed;
        for (const b of bodies) setBodyVelocity(b, x, y);
      } else {
        // Hover rather than dropping while fly is enabled.
        for (const b of bodies) {
          const v = getVel(b);
          setBodyVelocity(b, v.x * 0.92, v.y * 0.75);
        }
      }
    }
    if (settings.stabilizer) {
      const b = mainBody(ch);
      if (b) {
        const a = finite(safe(() => b.GetAngle(), 0));
        const normalized = Math.atan2(Math.sin(a), Math.cos(a));
        const targetAV = clamp(-normalized * settings.stabilizeStrength, -12, 12);
        safe(() => b.SetAngularVelocity(targetAV));
      }
    }
  }

  function ensureWorldMods(world) {
    if (!world) return;
    let ws = worldState.get(world);
    if (!ws) {
      ws = {
        gx: finite(world.m_gravity?.x, 0),
        gy: finite(world.m_gravity?.y, 10),
        originalStep: typeof world.Step === 'function' ? world.Step : null,
        wrapped: false
      };
      worldState.set(world, ws);
    }
    if (world.m_gravity) {
      world.m_gravity.x = ws.gx;
      world.m_gravity.y = ws.gy * settings.worldGravity;
    }
    if (ws.originalStep && !ws.wrapped) {
      world.Step = function(dt, iterations, ...rest) {
        return ws.originalStep.call(this, dt * settings.timeScale, iterations, ...rest);
      };
      ws.wrapped = true;
    }
  }

  function applyNoBlood(session) {
    const pc = session?.particleController;
    if (!pc) return;
    let bs = bloodState.get(pc);
    if (!bs) { bs = new Map(); bloodState.set(pc, bs); }
    const names = ['createBloodFlow','createBloodBurst','createPointBloodBurst','createBloodSpray','createBloodSpurt','createBlood'];
    for (const n of names) {
      if (settings.noBlood) {
        if (!bs.has(n) && typeof pc[n] === 'function') { bs.set(n, {hadOwn:own(pc,n), value:pc[n]}); pc[n] = () => null; }
      } else if (bs.has(n)) {
        const p = bs.get(n); if (p.hadOwn) pc[n] = p.value; else delete pc[n]; bs.delete(n);
      }
    }
  }

  function translatePlayer(ch, dx, dy) {
    for (const b of getBodies(ch)) {
      const p = safe(() => b.GetPosition(), null);
      if (!p) continue;
      const np = makeVec(b, p.x + dx, p.y + dy);
      const angle = finite(safe(() => b.GetAngle(), 0));
      if (typeof b.SetXForm === 'function') safe(() => b.SetXForm(np, angle));
      else if (typeof b.SetPosition === 'function') safe(() => b.SetPosition(np));
      else if (b.m_position) { b.m_position.x += dx; b.m_position.y += dy; }
      safe(() => b.WakeUp());
    }
  }

  function addVelocity(ch, dx, dy) {
    for (const b of getBodies(ch)) {
      const v = getVel(b);
      setBodyVelocity(b, v.x + dx, v.y + dy);
    }
  }

  function addSpin(ch, av) {
    for (const b of getBodies(ch)) safe(() => b.SetAngularVelocity(finite(safe(() => b.GetAngularVelocity(), 0)) + av));
  }

  function worldBodies(world) {
    const out = [];
    let b = world?.m_bodyList || null, guard = 0;
    while (b && guard++ < 10000) { out.push(b); b = b.m_next; }
    return out;
  }

  function radialImpulse(ch, world, power = 30, radius = 12, inward = false) {
    const centerBody = mainBody(ch); if (!centerBody || !world) return;
    const c = safe(() => centerBody.GetWorldCenter(), centerBody.GetPosition());
    const ownBodies = new Set(getBodies(ch));
    for (const b of worldBodies(world)) {
      if (ownBodies.has(b) || !isBody(b) || finite(safe(() => b.GetMass(), 0)) <= 0) continue;
      const p = safe(() => b.GetWorldCenter(), b.GetPosition());
      const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx,dy);
      if (!d || d > radius) continue;
      const s = (1 - d / radius) * power * (inward ? -1 : 1);
      const impulse = makeVec(b, dx / d * s, dy / d * s);
      if (typeof b.ApplyImpulse === 'function') safe(() => b.ApplyImpulse(impulse, p));
      else { const v=getVel(b); setBodyVelocity(b, v.x + dx/d*s, v.y + dy/d*s); }
    }
  }

  function freezeNearby(ch, world, radius = 12) {
    const cb = mainBody(ch); if (!cb || !world) return;
    const c = safe(() => cb.GetWorldCenter(), cb.GetPosition());
    const ownBodies = new Set(getBodies(ch));
    for (const b of worldBodies(world)) {
      if (ownBodies.has(b) || !isBody(b)) continue;
      const p = safe(() => b.GetWorldCenter(), b.GetPosition());
      if (Math.hypot(p.x-c.x,p.y-c.y) <= radius) { setBodyVelocity(b,0,0); safe(() => b.SetAngularVelocity(0)); }
    }
  }

  function scalePoint(v, ratio) { if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) { v.x *= ratio; v.y *= ratio; } }

  function scaleShapeGeometry(s, ratio, world) {
    // Supports the old Box2D-derived shape layout used by Happy Wheels.
    if (Number.isFinite(s.m_radius)) s.m_radius *= ratio;
    scalePoint(s.m_localPosition, ratio);
    scalePoint(s.m_localCentroid, ratio);
    if (s.m_localOBB) { scalePoint(s.m_localOBB.center, ratio); scalePoint(s.m_localOBB.extents, ratio); }
    if (Array.isArray(s.m_vertices)) for (let i=0;i<(s.m_vertexCount || s.m_vertices.length);i++) scalePoint(s.m_vertices[i], ratio);
    if (Array.isArray(s.m_coreVertices)) for (let i=0;i<(s.m_vertexCount || s.m_coreVertices.length);i++) scalePoint(s.m_coreVertices[i], ratio);
    if (Number.isFinite(s.m_maxRadius)) s.m_maxRadius *= ratio;
    safe(() => s.ResetProxy(world?.m_broadPhase));
  }

  function scaleJointGeometry(j, ratio) {
    scalePoint(j.m_localAnchor1, ratio); scalePoint(j.m_localAnchor2, ratio);
    scalePoint(j.m_localAnchorA, ratio); scalePoint(j.m_localAnchorB, ratio);
    for (const k of ['m_length','m_maxLength','m_minLength','m_lowerTranslation','m_upperTranslation']) if (Number.isFinite(j[k])) j[k] *= ratio;
  }

  function scaleVisuals(ch, ratio, st) {
    const seen = new Set();
    for (const root of childCharacters(ch)) {
      for (const [k,v] of Object.entries(root)) {
        if (!/MC$/i.test(k) || !v || typeof v !== 'object' || seen.has(v)) continue;
        seen.add(v);
        if (Number.isFinite(v.scaleX)) v.scaleX *= ratio;
        if (Number.isFinite(v.scaleY)) v.scaleY *= ratio;
      }
    }
  }

  function applySize(ch, session, target) {
    target = clamp(Number(target) || 1, 0.35, 3.0);
    const st = stateFor(ch);
    const ratio = target / st.currentSize;
    if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.001) return true;
    const bodies = getBodies(ch);
    if (!bodies.length) return false;
    const world = session?.m_world;
    const anchor = mainBody(ch) || bodies[0];
    const c = safe(() => anchor.GetWorldCenter(), anchor.GetPosition());
    try {
      // Geometry first.
      for (const b of bodies) {
        for (const s of bodyShapes(b)) scaleShapeGeometry(s, ratio, world);
        safe(() => b.SetMassFromShapes());
      }
      // Joint local anchors and lengths must track the resized bodies.
      for (const j of getJoints(ch)) scaleJointGeometry(j, ratio);
      // Spread body centres around the character anchor.
      for (const b of bodies) {
        const p = safe(() => b.GetPosition(), null); if (!p) continue;
        const np = makeVec(b, c.x + (p.x-c.x)*ratio, c.y + (p.y-c.y)*ratio);
        const a = finite(safe(() => b.GetAngle(), 0));
        if (typeof b.SetXForm === 'function') b.SetXForm(np, a);
        else if (typeof b.SetPosition === 'function') b.SetPosition(np);
        safe(() => b.WakeUp());
      }
      scaleVisuals(ch, ratio, st);
      st.currentSize = target;
      toast(`Player size applied: ${target.toFixed(2)}×`, 'ok');
      return true;
    } catch (e) {
      WARN('Size scaling failed', e);
      toast('Live size scaling failed on this character/build. Reset the level before continuing.', 'bad');
      return false;
    }
  }

  function restoreCharacter(ch, session) {
    const st = characterState.get(ch);
    if (!st) return;
    restoreMethodPatches(st);
    for (const root of childCharacters(ch)) {
      const tb = st.thresholdBase.get(root); if (tb) for (const [k,v] of tb) if (k in root) root[k] = v;
      const ib = st.impulseBase.get(root); if (ib && root.contactImpulseDict) for (const [k,v] of ib) if (root.contactImpulseDict.has(k)) root.contactImpulseDict.set(k,v);
      for (const k of ['wheelMaxSpeed','accelStep','prisAccelStep','maxTorque','impulseMagnitude','impulseLeft','impulseRight','maxSpinAV','ejectImpulse','jumpTranslation','verticalTranslation','bounceTranslation','bounceSpeed','retractSpeed','boostMax','boostStepUp','maxStep']) {
        const b = baseFor(st, root, ch, k); if (Number.isFinite(b)) root[k] = b;
      }
    }
    for (const j of getJoints(ch)) {
      const js = jointState.get(j); if (!js) continue;
      if (js.torque != null) j.m_maxMotorTorque = js.torque;
      if (js.force != null) j.m_maxMotorForce = js.force;
    }
    for (const b of getBodies(ch)) {
      let dirty = false;
      for (const s of bodyShapes(b)) {
        const ss = shapeState.get(s); if (!ss) continue;
        if (ss.friction != null) s.m_friction = ss.friction;
        if (ss.restitution != null) s.m_restitution = ss.restitution;
        if (ss.density != null) { s.m_density = ss.density; dirty = true; }
        if (ss.filter) setFilter(s, ss.filter, session?.m_world);
        ss.lastNoclip = false; ss.lastDensity = ss.density; ss.lastRestitution = ss.restitution; ss.lastFriction = ss.friction;
      }
      if (dirty) safe(() => b.SetMassFromShapes());
    }
    if (Math.abs(st.currentSize - 1) > 0.001) applySize(ch, session, 1);
  }

  function restoreWorld(world) {
    const ws = worldState.get(world); if (!ws) return;
    if (world.m_gravity) { world.m_gravity.x = ws.gx; world.m_gravity.y = ws.gy; }
    if (ws.wrapped && ws.originalStep) world.Step = ws.originalStep;
    ws.wrapped = false;
  }

  // ---------- UI ----------
  const css = `
#hwmod-root{position:fixed;z-index:2147483647;top:22px;right:22px;width:430px;max-height:calc(100vh - 44px);font:12px/1.35 Inter,Segoe UI,Arial,sans-serif;color:#f3f3f3;background:rgba(14,15,18,var(--op,.94));border:1px solid #3c4048;border-radius:12px;box-shadow:0 18px 50px #000a;overflow:hidden;user-select:none}
#hwmod-root *{box-sizing:border-box}#hwmod-root.hidden{display:none}
.hw-head{display:flex;align-items:center;gap:10px;padding:11px 13px;background:#1c1e23;border-bottom:1px solid #363941;cursor:move}.hw-title{font-size:14px;font-weight:800;letter-spacing:.2px;flex:1}.hw-badge{font-size:10px;padding:3px 7px;border-radius:99px;background:#8d2d2d;color:#fff}.hw-x{border:0;background:transparent;color:#aaa;font-size:18px;cursor:pointer}.hw-x:hover{color:#fff}
.hw-status{padding:7px 12px;border-bottom:1px solid #2d3036;color:#bbb}.hw-status.ok{color:#87d391}.hw-status.bad{color:#ff8585}.hw-tabs{display:flex;gap:4px;padding:7px;background:#15171a;border-bottom:1px solid #30333a;overflow-x:auto}.hw-tab{white-space:nowrap;border:1px solid #343840;background:#24272d;color:#bbb;padding:6px 8px;border-radius:7px;cursor:pointer}.hw-tab.on{background:#b33a3a;color:white;border-color:#d14a4a}
.hw-body{max-height:calc(100vh - 160px);overflow:auto;padding:10px}.hw-page{display:none}.hw-page.on{display:block}.hw-section{border:1px solid #30343b;border-radius:9px;margin-bottom:9px;overflow:hidden}.hw-section h3{font-size:11px;text-transform:uppercase;letter-spacing:.7px;margin:0;padding:7px 9px;background:#202329;color:#d3d3d3}.hw-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:7px 9px;border-top:1px solid #292c31}.hw-row:first-of-type{border-top:0}.hw-note{font-size:10px;color:#888;margin-top:2px}.hw-toggle{width:36px;height:20px;border-radius:12px;background:#484c54;position:relative;cursor:pointer}.hw-toggle:after{content:'';position:absolute;width:16px;height:16px;left:2px;top:2px;background:#ddd;border-radius:50%;transition:.12s}.hw-toggle.on{background:#b83c3c}.hw-toggle.on:after{left:18px;background:#fff}
.hw-select{min-width:170px;max-width:210px;border:1px solid #444952;background:#282b31;color:#eee;padding:6px 8px;border-radius:7px}.hw-slider{display:flex;align-items:center;gap:7px}.hw-slider input{width:130px}.hw-num{width:48px;text-align:right;color:#eee;font-variant-numeric:tabular-nums}.hw-btns{display:flex;gap:6px;flex-wrap:wrap}.hw-btn{border:1px solid #444952;background:#282b31;color:#eee;padding:6px 8px;border-radius:7px;cursor:pointer}.hw-btn:hover{background:#353942}.hw-btn.danger{border-color:#833;background:#421f1f}.hw-btn.primary{border-color:#a33;background:#7f2a2a}.hw-btn.full{width:100%}.hw-kbd{font:10px Consolas,monospace;padding:2px 5px;border:1px solid #555;border-bottom-width:2px;border-radius:4px;color:#ddd}.hw-hud{position:fixed;left:16px;top:16px;z-index:2147483646;padding:7px 9px;border-radius:7px;background:#000a;color:#fff;font:11px Consolas,monospace;pointer-events:none;white-space:pre}.hw-toast{position:fixed;left:50%;top:26px;transform:translateX(-50%);z-index:2147483647;padding:8px 12px;border-radius:8px;background:#222;color:#fff;border:1px solid #555;box-shadow:0 8px 30px #0008}.hw-toast.ok{border-color:#397d47}.hw-toast.bad{border-color:#9f3d3d}.hw-footer{padding:7px 10px;border-top:1px solid #30333a;color:#777;background:#15171a;font-size:10px}.hw-sep{height:1px;background:#2a2d33;margin:7px 0}
`;

  const style = document.createElement('style'); style.id = 'hwmod-style'; style.textContent = css; document.documentElement.appendChild(style);
  const root = document.createElement('div'); root.id = 'hwmod-root'; root.style.setProperty('--op', settings.menuOpacity);
  root.innerHTML = `
    <div class="hw-head"><div class="hw-title">Happy Wheels Mod Menu</div><div class="hw-badge">v${VERSION}</div><button class="hw-x" title="Hide">×</button></div>
    <div class="hw-status" id="hwmod-status">${statusText}</div>
    <div class="hw-tabs"></div><div class="hw-body"></div>
    <div class="hw-footer"><span class="hw-kbd">Insert</span> show/hide · Fly uses W/A/S/D · v1.0 · local physics only</div>`;
  document.documentElement.appendChild(root);
  const hud = document.createElement('div'); hud.className='hw-hud'; document.documentElement.appendChild(hud);

  function toast(msg, kind='') {
    const e=document.createElement('div'); e.className=`hw-toast ${kind}`; e.textContent=msg; document.documentElement.appendChild(e); setTimeout(()=>e.remove(),2200);
  }

  const controlBindings = [];
  const pages = new Map();
  const tabs = root.querySelector('.hw-tabs');
  const body = root.querySelector('.hw-body');
  function page(name) {
    const tab=document.createElement('button'); tab.className='hw-tab'; tab.textContent=name; tabs.appendChild(tab);
    const p=document.createElement('div'); p.className='hw-page'; body.appendChild(p); pages.set(name,{tab,p});
    tab.onclick=()=>showPage(name); return p;
  }
  function showPage(name){for(const [n,x] of pages){x.tab.classList.toggle('on',n===name);x.p.classList.toggle('on',n===name)}}
  function section(p,title){const s=document.createElement('div');s.className='hw-section';s.innerHTML=`<h3>${title}</h3>`;p.appendChild(s);return s}
  function row(sec,label,note=''){const r=document.createElement('div');r.className='hw-row';const l=document.createElement('div');l.innerHTML=`<div>${label}</div>${note?`<div class="hw-note">${note}</div>`:''}`;r.appendChild(l);sec.appendChild(r);return r}
  function toggle(sec,key,label,note=''){const r=row(sec,label,note),t=document.createElement('div');t.className='hw-toggle';const sync=()=>t.classList.toggle('on',!!settings[key]);controlBindings.push(sync);sync();t.onclick=()=>{settings[key]=!settings[key];sync();saveSettings();};r.appendChild(t);return t}
  function slider(sec,key,label,min,max,step=0.1,suffix='×',note=''){const r=row(sec,label,note),w=document.createElement('div');w.className='hw-slider';const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=settings[key];const render=()=>{i.value=settings[key];const val=Number(settings[key]);n.textContent=(step<0.1?val.toFixed(2):val.toFixed(step>=1?0:1))+suffix;};const n=document.createElement('div');n.className='hw-num';const sync=()=>{settings[key]=Number(i.value);render();saveSettings();};controlBindings.push(render);i.oninput=sync;render();w.append(i,n);r.appendChild(w);return i}
  function buttons(sec,label,defs,note=''){const r=row(sec,label,note),w=document.createElement('div');w.className='hw-btns';for(const d of defs){const b=document.createElement('button');b.className=`hw-btn ${d.cls||''}`;b.textContent=d.text;b.onclick=d.fn;w.appendChild(b)}r.appendChild(w);return w}

  const pPlayer=page('Player');
  let s=section(pPlayer,'Protection');
  toggle(s,'godMode','God mode','Prevents death/bleed-out and raises damage thresholds.');
  toggle(s,'indestructible','Indestructible','Blocks limb/body smash, break and impale methods.');
  toggle(s,'noEject','No ejection','Blocks automatic and manual ejection calls.');
  toggle(s,'noclip','Noclip','Sets player collision masks to zero; reversible.');
  toggle(s,'noBlood','No blood effects','Suppresses new blood emitter calls while enabled.');
  s=section(pPlayer,'Movement');
  toggle(s,'fly','Fly / hover','W/A/S/D controls all player bodies while enabled.');
  slider(s,'flySpeed','Fly speed',2,40,1,'','Physics units per second.');
  toggle(s,'freezePlayer','Freeze player');
  toggle(s,'stabilizer','Auto-upright','Rotates the primary vehicle body toward upright.');
  slider(s,'stabilizeStrength','Upright strength',1,15,0.5,'','Higher values correct rotation more aggressively.');
  buttons(s,'Teleport',[{text:'←',fn:()=>withCharacter(ch=>translatePlayer(ch,-5,0))},{text:'↑',fn:()=>withCharacter(ch=>translatePlayer(ch,0,-5))},{text:'↓',fn:()=>withCharacter(ch=>translatePlayer(ch,0,5))},{text:'→',fn:()=>withCharacter(ch=>translatePlayer(ch,5,0))}],'Moves the entire player assembly by 5 physics units.');
  buttons(s,'Impulse',[{text:'Jump',fn:()=>withCharacter(ch=>addVelocity(ch,0,-12))},{text:'Boost →',fn:()=>withCharacter(ch=>addVelocity(ch,18,0))},{text:'Boost ←',fn:()=>withCharacter(ch=>addVelocity(ch,-18,0))},{text:'Spin ↺',fn:()=>withCharacter(ch=>addSpin(ch,-8))},{text:'Spin ↻',fn:()=>withCharacter(ch=>addSpin(ch,8))}]);

  const pVehicle=page('Vehicle');
  s=section(pVehicle,'Drive physics');
  slider(s,'speedMult','Top speed',0.1,10,0.1,'×','Scales wheelMaxSpeed.');
  slider(s,'accelMult','Acceleration',0.1,15,0.1,'×','Scales wheel and prismatic acceleration steps.');
  slider(s,'torqueMult','Motor torque / force',0.1,50,0.1,'×','Scales live revolute torque and prismatic motor force.');
  slider(s,'gripMult','Wheel grip',0,8,0.1,'×','Scales friction on wheel shapes.');
  slider(s,'leanMult','Lean / air control',0.1,10,0.1,'×','Scales lean impulses and angular limit.');
  slider(s,'jumpMult','Jump / suspension power',0.1,8,0.1,'×');
  slider(s,'boostMult','Built-in boost capacity',0.1,10,0.1,'×');
  slider(s,'ejectMult','Ejection force',0,10,0.1,'×');
  s=section(pVehicle,'Body physics');
  slider(s,'massMult','Mass / density',0.1,8,0.1,'×','Recomputes mass from player shapes.');
  slider(s,'bounceMult','Bounciness',0,5,0.1,'×','Scales restitution on player shapes.');
  const sizeInput=slider(s,'size','Player size',0.35,3,0.05,'×','Experimental live Box2D + visual rescale. Apply only while a level is loaded.');
  buttons(s,'Size actions',[{text:'Apply Size',cls:'primary',fn:()=>withSession((ss,ch)=>applySize(ch,ss,settings.size))},{text:'Reset Size',fn:()=>withSession((ss,ch)=>{settings.size=1;sizeInput.value=1;sizeInput.dispatchEvent(new Event('input'));applySize(ch,ss,1);})}], 'Changing size repeatedly can stress unusual custom vehicles. Restart the level if geometry becomes unstable.');

  const pWorld=page('World');
  s=section(pWorld,'Simulation');
  slider(s,'worldGravity','World gravity',-2,4,0.05,'×','Negative values reverse gravity. Affects the whole level.');
  slider(s,'timeScale','Physics time scale',0.1,3,0.05,'×','Scales Box2D step dt. Extreme values can destabilize constraints.');
  s=section(pWorld,'Nearby objects');
  buttons(s,'Radial force',[{text:'Blast',fn:()=>withSession((ss,ch)=>radialImpulse(ch,ss.m_world,45,14,false))},{text:'Vacuum',fn:()=>withSession((ss,ch)=>radialImpulse(ch,ss.m_world,30,14,true))}], 'Pushes/pulls dynamic level bodies around the player.');
  buttons(s,'Control',[{text:'Freeze nearby',fn:()=>withSession((ss,ch)=>freezeNearby(ch,ss.m_world,14))}], 'Stops nearby dynamic bodies without touching the player.');

  const pPresets=page('Presets');
  s=section(pPresets,'One-click presets');
  function setMany(obj){Object.assign(settings,obj);saveSettings();syncAllControls();toast('Preset applied.','ok')}
  buttons(s,'Presets',[
    {text:'Tank',fn:()=>setMany({godMode:true,indestructible:true,noEject:true,torqueMult:8,speedMult:1.8,accelMult:2,massMult:3,gripMult:2,bounceMult:.5})},
    {text:'Rocket',fn:()=>setMany({speedMult:8,accelMult:12,torqueMult:25,leanMult:4,gripMult:2})},
    {text:'Moon',fn:()=>setMany({worldGravity:.25,bounceMult:1.5,leanMult:2})},
    {text:'Chaos',fn:()=>setMany({speedMult:5,accelMult:8,torqueMult:20,bounceMult:3,leanMult:6,worldGravity:.65})}
  ]);
  buttons(s,'Reset',[{text:'Reset all settings',cls:'danger',fn:resetAll}], 'Restores settings and attempts to restore the current character/world to captured vanilla values.');

  const pDebug=page('Debug');
  s=section(pDebug,'Diagnostics');
  toggle(s,'hud','HUD','Shows hook state, FPS, position, velocity, bodies and current character.');
  slider(s,'menuOpacity','Menu opacity',0.45,1,0.05,'','');
  buttons(s,'Actions',[{text:'Re-scan game hook',fn:()=>{cfg=null;req=null;const ss=getSession();toast(ss?'Live session found':'Waiting for a level/restart',ss?'ok':'bad')}},{text:'Dump player to console',fn:()=>withSession((ss,ch)=>{console.log('[HW Mod] session',ss);console.log('[HW Mod] character',ch);console.log('[HW Mod] bodies',getBodies(ch));console.log('[HW Mod] joints',getJoints(ch));toast('Dumped to DevTools console','ok')})}]);

  showPage('Player');

  function syncAllControls(){
    for (const fn of controlBindings) safe(fn);
    root.style.setProperty('--op',settings.menuOpacity);
  }


  function withSession(fn){const ss=getSession(),ch=getCharacter(ss);if(!ss||!ch){toast('Load into a level first.','bad');return}try{fn(ss,ch)}catch(e){WARN(e);toast('Action failed; see console.','bad')}}
  function withCharacter(fn){const ss=getSession(),ch=getCharacter(ss);if(!ch){toast('Load into a level first.','bad');return}try{fn(ch,ss)}catch(e){WARN(e);toast('Action failed; see console.','bad')}}

  function resetAll(){
    const ss=getSession(),ch=getCharacter(ss);
    if(ch) restoreCharacter(ch,ss);
    if(ss?.m_world) restoreWorld(ss.m_world);
    Object.assign(settings, defaults); saveSettings(); syncAllControls();
    toast('All mod settings restored to defaults.','ok');
  }


  // Dragging and input isolation. Capture-phase pointer listeners ensure releasing over the menu always ends the drag.
  let dragging=false, ox=0, oy=0, dragPointer=null;
  const head=root.querySelector('.hw-head');
  const stopDrag=()=>{dragging=false;dragPointer=null;document.documentElement.style.userSelect=''};
  head.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;dragging=true;dragPointer=e.pointerId;const r=root.getBoundingClientRect();ox=e.clientX-r.left;oy=e.clientY-r.top;document.documentElement.style.userSelect='none';try{head.setPointerCapture(e.pointerId)}catch{}e.preventDefault()});
  window.addEventListener('pointermove',e=>{if(!dragging||(dragPointer!==null&&e.pointerId!==dragPointer))return;root.style.left=clamp(e.clientX-ox,0,innerWidth-root.offsetWidth)+'px';root.style.top=clamp(e.clientY-oy,0,innerHeight-50)+'px';root.style.right='auto'},true);
  window.addEventListener('pointerup',stopDrag,true);
  window.addEventListener('pointercancel',stopDrag,true);
  window.addEventListener('mouseup',stopDrag,true);
  window.addEventListener('blur',stopDrag,true);
  root.querySelector('.hw-x').onclick=()=>root.classList.add('hidden');
  for(const ev of ['keydown','keyup','keypress','mousedown','mouseup','click','wheel']) root.addEventListener(ev,e=>e.stopPropagation());

  window.addEventListener('keydown',e=>{
    if(e.code==='Insert'){root.classList.toggle('hidden');e.preventDefault();e.stopPropagation();return}
    if(!e.repeat) keys.add(e.code);
  },true);
  window.addEventListener('keyup',e=>keys.delete(e.code),true);
  window.addEventListener('blur',()=>keys.clear());

  function updateStatus(ss,ch){
    const el=root.querySelector('#hwmod-status');
    const direct=!!safe(()=>window.__HW_CAPTURED_SESSION__,null);
    if(!ss){statusText=direct?'Direct hook ready — load/restart a level':'Waiting for Happy Wheels session hook…';statusKind='wait'}
    else if(!ch){statusText='Session captured — waiting for player';statusKind='ok'}
    else{statusText=`Direct hook — ${ch.tag||ch.charName||ch.constructor?.name||'character'} — Gen ${captureGeneration||1}`;statusKind='ok'}
    if(el){el.textContent=statusText;el.className=`hw-status ${statusKind}`}
  }

  function updateHud(ss,ch){
    hud.style.display=settings.hud?'block':'none';
    if(!settings.hud)return;
    if(!ss||!ch){hud.textContent=`HW MOD v${VERSION}\n${statusText}\nFPS ${fps}`;return}
    const b=mainBody(ch),p=b?safe(()=>b.GetPosition(),null):null,v=b?getVel(b):{x:0,y:0};
    hud.textContent=[`HW MOD v${VERSION}`,statusText,`FPS ${fps}`,`pos ${p?`${p.x.toFixed(2)}, ${p.y.toFixed(2)}`:'?'}`,`vel ${v.x.toFixed(2)}, ${v.y.toFixed(2)}  |v| ${Math.hypot(v.x,v.y).toFixed(2)}`,`bodies ${getBodies(ch).length}  joints ${getJoints(ch).length}`,settings.fly?'FLY W/A/S/D':''].filter(Boolean).join('\n');
  }

  function resetLifecycleState(reason) {
    characterState = new WeakMap();
    jointState = new WeakMap();
    shapeState = new WeakMap();
    worldState = new WeakMap();
    bloodState = new WeakMap();
    patchObjectIds = new WeakMap();
    lastCharacter = null;
    lastSession = null;
    lastWorld = null;
    bodyGenerationSignature = '';
    keys.clear();
    LOG('Lifecycle reset:', reason, 'generation', captureGeneration);
  }

  function bodySignature(ch) {
    if (!ch) return '';
    const bs = getBodies(ch);
    if (!bs.length) return '0';
    return `${bs.length}:` + bs.map(b => safe(() => `${b.m_xf?.position?.x ?? b.GetPosition?.().x ?? '?'}:${b.m_xf?.position?.y ?? b.GetPosition?.().y ?? '?'}`, '?')).slice(0,3).join('|');
  }

  function tick(now){
    const dt=clamp((now-lastFrame)/1000,0,0.1);lastFrame=now;
    fpsFrames++;if(now-fpsStamp>=500){fps=Math.round(fpsFrames*1000/(now-fpsStamp));fpsFrames=0;fpsStamp=now}
    root.style.setProperty('--op',settings.menuOpacity);
    const observedGen=Number(safe(()=>window.__HW_CAPTURE_GENERATION__,0))||0;
    if(observedGen && observedGen!==captureGeneration){captureGeneration=observedGen;resetLifecycleState('new character/session capture')}
    const ss=getSession(),ch=getCharacter(ss);
    if(ch){const sig=bodySignature(ch);if(bodyGenerationSignature && sig && sig!==bodyGenerationSignature && getBodies(ch).length){LOG('Physics body set changed after restart/reset');}bodyGenerationSignature=sig||bodyGenerationSignature;}
    if(ss&&ss!==lastSession){lastSession=ss;LOG('Session changed',ss)}
    if(ch&&ch!==lastCharacter){lastCharacter=ch;stateFor(ch);LOG('Character changed',ch)}
    if(ss?.m_world){lastWorld=ss.m_world;ensureWorldMods(ss.m_world)}
    if(ss)applyNoBlood(ss);
    if(ch){
      applyNumericModifiers(ch);
      applyGodMode(ch);
      applyProtectionPatches(ch);
      applyMaterialMods(ch,ss);
      applyMotionMods(ch,dt);
    }
    updateStatus(ss,ch);updateHud(ss,ch);
    requestAnimationFrame(tick);
  }

  window.__HW_MODMENU__={
    version:VERSION,
    settings,
    getSession,
    getCharacter:()=>getCharacter(getSession()),
    show:()=>root.classList.remove('hidden'),
    hide:()=>root.classList.add('hidden'),
    applySize:()=>withSession((ss,ch)=>applySize(ch,ss,settings.size)),
    reset:resetAll,
    diagnostics:()=>({cfg,generation:captureGeneration,session:getSession(),character:getCharacter(getSession())})
  };

  LOG('Loaded v'+VERSION);
  requestAnimationFrame(tick);
  return 'Happy Wheels Mod Menu v'+VERSION+' loaded';
})();

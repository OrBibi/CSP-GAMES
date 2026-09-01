/**
 * Ping Pong — 3D table from the player's viewpoint (same camera language as tennis).
 * Scoring stays first-to-11. Serves start at the far end and you return with a phone swing.
 */
import * as THREE from 'three';

const GAME_ID = 'pingpong';
const WIN = 11;
const WIN_BY = 2;

const i18n = window.CSPI18n;
const t = (key, params) => i18n.t(key, params);

const PAGE = new URLSearchParams(window.location.search);
const GUEST_SCREEN = PAGE.get('guest') === '1';
const JOIN_ROOM = (PAGE.get('room') || '').trim().toUpperCase();

/** Visual table, enlarged so the camera framing matches tennis. */
const TABLE = {
  halfLength: 3.55,
  halfWidth: 1.98,
  height: 0.76,
  thickness: 0.05,
  netHeight: 0.155,
  netThickness: 0.03,
  ballRadius: 0.04,
  gravity: -16.5,
  bounce: 0.72,
  airDrag: 0.08,
};

const HIT = {
  swingWindowMs: 1100,
  zoneDepth: 3.4,
  maxLateralMiss: 1.15,
  sideThreshold: 0.28,
  powerSpeeds: [7.4, 8.2, 9.0, 9.8, 10.6],
  powerUp: 3.15,
  maxFairAimX: 2.4,
  aiReturnChance: [0.92, 0.88, 0.84, 0.8, 0.75],
  runOverhang: 0.35,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function amplifyAimForCourt(aim) {
  const v = clamp(Number(aim) || 0, -1, 1);
  if (Math.abs(v) < 0.1) return v;
  const sign = Math.sign(v) || 1;
  return clamp(sign * (0.28 + Math.abs(v) * 0.72), -1, 1);
}

function powerLevelFromIntensity(intensity) {
  const level = clamp(Number(intensity) || 0.3, 0, 1);
  if (level < 0.22) return 1;
  if (level < 0.4) return 2;
  if (level < 0.58) return 3;
  if (level < 0.76) return 4;
  return 5;
}

function swingLabel(side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}

function phoneToLogicSide(raw) {
  if (raw === 'left') return 'right';
  if (raw === 'right') return 'left';
  return raw;
}

function aimPlacementLabel(aim) {
  const v = Number(aim) || 0;
  if (v > 0.2) return t('tennis.place.sameSide');
  if (v < -0.2) return t('tennis.place.cross');
  return t('tennis.place.center');
}

function drawQr(canvas, text, imgId) {
  const img = document.getElementById(imgId || 'qr-img');
  if (img) img.src = `/api/qr?text=${encodeURIComponent(text)}&t=${Date.now()}`;
}

function createTableSfx() {
  let ctx = null;
  let master = null;
  function ensure() {
    if (ctx) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      return true;
    } catch (_) {
      return false;
    }
  }
  async function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {
        /* ignore */
      }
    }
  }
  function noiseBurst(dur, vol, freq) {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = n.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = n;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
  }
  function tone(freq, dur, vol, type) {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  return {
    unlock,
    hit(level) {
      const lv = clamp(Number(level) || 3, 1, 5);
      noiseBurst(0.05 + lv * 0.008, 0.12 + lv * 0.03, 1400 + lv * 180);
      tone(420 + lv * 70, 0.07, 0.05 + lv * 0.012, 'sine');
    },
    table() {
      noiseBurst(0.035, 0.08, 900);
      tone(210, 0.05, 0.03, 'sine');
    },
    point() {
      tone(660, 0.12, 0.07, 'triangle');
      tone(880, 0.16, 0.05, 'sine');
    },
    miss() {
      tone(180, 0.18, 0.06, 'sawtooth');
    },
  };
}

class PingPongGame {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });
    this.room = null;
    this.controllerUrl = '';
    this.isGuestScreen = GUEST_SCREEN;
    this.setupMode = GUEST_SCREEN ? 'remote' : 'couch';
    this.guestView = false;
    this.controllers = { p1: false, p2: false, ready1: false, ready2: false };
    this.playerNames = { p1: '', p2: '' };
    this.mode = null;
    this.running = false;
    this.winner = 0;
    this.scores = { p1: 0, p2: 0 };
    this.servingSlot = 2;
    this.lastHitter = 0;
    this.bouncesThisSide = 0;
    this.messageTimer = 0;
    this.servePause = 0;
    this.statusKey = 'status.connecting';
    this.statusParams = null;
    this.messageKey = null;
    this.messageParams = null;
    this.lastHumanPower = 3;
    this.ai = { x: 0, reactedThisApproach: false };
    this.sfx = createTableSfx();
    this.clock = new THREE.Clock();
    this.sceneReady = false;
    this.hitAnims = [];
    this.inputs = {
      1: { pendingSwing: false, swingAt: 0, side: null, phoneSide: null, aim: 0, intensity: 0.5, powerLevel: 3 },
      2: { pendingSwing: false, swingAt: 0, side: null, phoneSide: null, aim: 0, intensity: 0.5, powerLevel: 3 },
    };
    this.ball = {
      pos: new THREE.Vector3(0, TABLE.height + 0.4, 0),
      vel: new THREE.Vector3(),
      alive: false,
      inPlay: false,
    };
    this._buildDom();
    this._bindSocket();
    this._bindUi();
    this._updateSetupUi();
    this._bindKeyboard();
    this._joinAsScreen();
    this._initGraphics();
  }

  _buildDom() {
    this.el = {
      lobby: document.getElementById('lobby'),
      hud: document.getElementById('hud'),
      roomCode: document.getElementById('room-code'),
      lobbyStatus: document.getElementById('lobby-status'),
      controllerUrl: document.getElementById('controller-url'),
      qr: document.getElementById('qr-canvas'),
      dotP1: document.getElementById('dot-p1'),
      dotP2: document.getElementById('dot-p2'),
      pillP1: document.getElementById('pill-p1'),
      pillP2: document.getElementById('pill-p2'),
      readyP1: document.getElementById('ready-p1'),
      readyP2: document.getElementById('ready-p2'),
      btnAi: document.getElementById('btn-ai'),
      btnLocal: document.getElementById('btn-local'),
      btnBack: document.getElementById('btn-back'),
      btnCopyRoom: document.getElementById('btn-copy-room'),
      btnJoinRoom: document.getElementById('btn-join-room'),
      joinRoomInput: document.getElementById('join-room-input'),
      setupMode: document.getElementById('setup-mode'),
      couchPanel: document.getElementById('couch-panel'),
      remoteGuestPanel: document.getElementById('remote-guest-panel'),
      roomCodePill: document.getElementById('room-code-pill'),
      qrBlockP1: document.getElementById('qr-block-p1'),
      qrBlockP2: document.getElementById('qr-block-p2'),
      nameP1: document.getElementById('pp-name-p1'),
      nameP2: document.getElementById('pp-name-p2'),
      sideP1: document.getElementById('pp-side-p1'),
      sideP2: document.getElementById('pp-side-p2'),
      scoreP1: document.getElementById('score-p1'),
      scoreP2: document.getElementById('score-p2'),
      matchStatus: document.getElementById('match-status'),
      message: document.getElementById('message'),
      swingBadge: document.getElementById('swing-badge'),
      victoryOverlay: document.getElementById('victory-overlay'),
      victoryTitle: document.getElementById('victory-title'),
      victorySub: document.getElementById('victory-sub'),
      btnVictoryLobby: document.getElementById('btn-victory-lobby'),
      canvas: document.getElementById('game-canvas'),
    };
  }

  _initGraphics() {
    try {
      this._buildScene();
      this.sceneReady = true;
      this._onResize();
      this._animate();
    } catch (err) {
      console.error('3D init failed', err);
      this._setStatus('status.noGraphics');
    }
  }

  displayName(slot) {
    if (slot === 2 && this.mode === 'ai') return t('common.computer');
    const stored = slot === 1 ? this.playerNames.p1 : this.playerNames.p2;
    if (stored && stored !== 'P1' && stored !== 'P2') return stored;
    return t(slot === 1 ? 'common.player1' : 'common.player2');
  }

  _setStatus(key, params) {
    this.statusKey = key;
    this.statusParams = params || null;
    if (this.el.lobbyStatus) this.el.lobbyStatus.textContent = t(key, params);
  }

  _setStatusRaw(text) {
    this.statusKey = null;
    this.statusParams = null;
    if (this.el.lobbyStatus) this.el.lobbyStatus.textContent = text;
  }

  _showMessage(key, params, sec = 1.2) {
    this.messageKey = key;
    this.messageParams = params || null;
    if (this.el.message) this.el.message.textContent = t(key, params);
    this.messageTimer = sec;
  }

  _buildScene() {
    const canvas = this.el.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x16110c, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a221c);
    this.scene.fog = new THREE.Fog(0x2a221c, 16, 36);

    // Elevated over-the-shoulder, same language as tennis (behind P1, looking down the table).
    const zCam = -TABLE.halfLength - 4.55;
    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.08, 80);
    this.camera.position.set(0, 3.55, zCam);
    this.camera.lookAt(0, TABLE.height + 0.18, 0.85);

    this.camera2 = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.08, 80);
    this.camera2.position.set(0, 3.55, TABLE.halfLength + 4.55);
    this.camera2.lookAt(0, TABLE.height + 0.18, -0.85);

    const hemi = new THREE.HemisphereLight(0xffe8c8, 0x4a3424, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1d6, 1.35);
    key.position.set(4.5, 8.5, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 28;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88a0c8, 0.32);
    fill.position.set(-6, 4.2, 4);
    this.scene.add(fill);
    const lamp = new THREE.PointLight(0xffe0b0, 0.55, 18, 1.6);
    lamp.position.set(0, 4.2, 0);
    this.scene.add(lamp);

    this._addRoom();
    this._addTable();

    this.player1 = this._createPlayer(0x2563eb, 1);
    this.player2 = this._createPlayer(0xdc2626, 2);
    this.racket1 = this.player1;
    this.racket2 = this.player2;
    this.player1.position.set(0, 0, -TABLE.halfLength - 0.48);
    this.player2.position.set(0, 0, TABLE.halfLength + 0.48);
    this.player2.rotation.y = Math.PI;
    this.scene.add(this.player1, this.player2);

    this.p1Marker = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 24),
      new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    this.p1Marker.rotation.x = -Math.PI / 2;
    this.p1Marker.position.set(0, 0.02, -TABLE.halfLength - 0.48);
    this.scene.add(this.p1Marker);

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(TABLE.ballRadius, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0xfb923c,
        roughness: 0.45,
        metalness: 0.05,
        emissive: 0x7c2d12,
        emissiveIntensity: 0.12,
      })
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = TABLE.height + 0.011;
    this.scene.add(this.ballShadow);

    window.addEventListener('resize', () => this._onResize());
  }

  _addRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.88 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a3b30, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(28, 8), wallMat);
    back.position.set(0, 4, 10);
    back.rotation.y = Math.PI;
    this.scene.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(22, 8), wallMat);
    left.position.set(-8.5, 4, 0);
    left.rotation.y = Math.PI / 2;
    this.scene.add(left);
    const right = left.clone();
    right.position.x = 8.5;
    right.rotation.y = -Math.PI / 2;
    this.scene.add(right);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 22),
      new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 5.4;
    this.scene.add(ceiling);

    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.85,
    });
    [-2.4, 2.4].forEach((z) => {
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.48, 0.12, 16), fixtureMat);
      shade.position.set(0, 4.85, z);
      this.scene.add(shade);
      const bulb = new THREE.PointLight(0xffe0b0, 0.7, 14, 1.8);
      bulb.position.set(0, 4.5, z);
      this.scene.add(bulb);
    });
  }

  _addTable() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7, metalness: 0.08 });
    const green = new THREE.MeshStandardMaterial({ color: 0x147a4b, roughness: 0.55, metalness: 0.04 });
    const white = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      emissive: 0xffffff,
      emissiveIntensity: 0.06,
    });

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.halfWidth * 2, TABLE.thickness, TABLE.halfLength * 2),
      green
    );
    top.position.y = TABLE.height;
    top.receiveShadow = true;
    top.castShadow = true;
    this.scene.add(top);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.halfWidth * 2 + 0.08, 0.09, TABLE.halfLength * 2 + 0.08),
      wood
    );
    apron.position.y = TABLE.height - 0.06;
    apron.castShadow = true;
    this.scene.add(apron);

    const addLine = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), white);
      m.position.set(x, TABLE.height + TABLE.thickness / 2 + 0.002, z);
      this.scene.add(m);
    };
    const W = TABLE.halfWidth * 2;
    const L = TABLE.halfLength * 2;
    addLine(W, 0.035, 0, -TABLE.halfLength + 0.02);
    addLine(W, 0.035, 0, TABLE.halfLength - 0.02);
    addLine(0.035, L, -TABLE.halfWidth + 0.02, 0);
    addLine(0.035, L, TABLE.halfWidth - 0.02, 0);
    addLine(0.028, L, 0, 0);

    const legGeo = new THREE.BoxGeometry(0.08, TABLE.height - 0.08, 0.08);
    [
      [-TABLE.halfWidth + 0.18, -TABLE.halfLength + 0.18],
      [TABLE.halfWidth - 0.18, -TABLE.halfLength + 0.18],
      [-TABLE.halfWidth + 0.18, TABLE.halfLength - 0.18],
      [TABLE.halfWidth - 0.18, TABLE.halfLength - 0.18],
    ].forEach(([x, z]) => {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(x, (TABLE.height - 0.08) / 2, z);
      leg.castShadow = true;
      this.scene.add(leg);
    });

    const postMat = new THREE.MeshStandardMaterial({ color: 0xd6b07a, metalness: 0.25, roughness: 0.5 });
    const postGeo = new THREE.BoxGeometry(0.04, TABLE.netHeight + 0.08, 0.04);
    const lp = new THREE.Mesh(postGeo, postMat);
    const rp = new THREE.Mesh(postGeo, postMat);
    lp.position.set(-TABLE.halfWidth - 0.04, TABLE.height + TABLE.netHeight / 2, 0);
    rp.position.set(TABLE.halfWidth + 0.04, TABLE.height + TABLE.netHeight / 2, 0);
    this.scene.add(lp, rp);

    const net = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.halfWidth * 2 + 0.08, TABLE.netHeight, TABLE.netThickness),
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        transparent: true,
        opacity: 0.42,
        roughness: 0.95,
        side: THREE.DoubleSide,
      })
    );
    net.position.y = TABLE.height + TABLE.netHeight / 2;
    this.scene.add(net);
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.halfWidth * 2 + 0.1, 0.018, TABLE.netThickness + 0.02),
      white
    );
    tape.position.y = TABLE.height + TABLE.netHeight;
    this.scene.add(tape);
  }

  _createPlayer(teamColor, slot) {
    const group = new THREE.Group();
    const facing = slot === 1 ? 1 : -1;
    const skin = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.82 });
    const shirt = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.62 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78 });
    const parts = { slot, facing, runPhase: 0, prevX: 0, moveSpeed: 0 };

    parts.root = new THREE.Group();
    group.add(parts.root);
    parts.hips = new THREE.Group();
    parts.hips.position.y = 0.92;
    parts.root.add(parts.hips);
    parts.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.48, 5, 10), shirt);
    parts.torso.position.y = 0.34;
    parts.torso.castShadow = true;
    parts.hips.add(parts.torso);
    parts.head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
    parts.head.position.set(0, 0.64, 0.02);
    parts.head.castShadow = true;
    parts.torso.add(parts.head);

    const makeLeg = (sign) => {
      const hip = new THREE.Group();
      hip.position.set(sign * 0.13, 0, 0);
      parts.hips.add(hip);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.4, 8), shorts);
      upper.position.y = -0.2;
      upper.castShadow = true;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.38, 8), skin);
      lower.position.y = -0.18;
      knee.add(lower);
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.06, 0.26),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc })
      );
      foot.position.set(0, -0.4, 0.05 * facing);
      knee.add(foot);
      return { hip, knee };
    };
    parts.legL = makeLeg(-1);
    parts.legR = makeLeg(1);

    const makeArm = (sign, isPaddle) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.32 * facing, 0.48, 0);
      parts.torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 8), skin);
      upper.position.y = -0.16;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.28, 8), skin);
      fore.position.y = -0.14;
      elbow.add(fore);
      const hand = new THREE.Group();
      hand.position.y = -0.28;
      elbow.add(hand);
      if (isPaddle) {
        const paddle = new THREE.Group();
        const blade = new THREE.Mesh(
          new THREE.CylinderGeometry(0.155, 0.155, 0.012, 28),
          new THREE.MeshStandardMaterial({ color: 0xd6b07a, roughness: 0.55, metalness: 0.08 })
        );
        blade.rotation.x = Math.PI / 2;
        blade.position.set(0, 0.18, 0);
        paddle.add(blade);
        const rubber = new THREE.Mesh(
          new THREE.CylinderGeometry(0.148, 0.148, 0.01, 28),
          new THREE.MeshStandardMaterial({
            color: teamColor,
            roughness: 0.55,
            emissive: new THREE.Color(teamColor),
            emissiveIntensity: 0.1,
          })
        );
        rubber.rotation.x = Math.PI / 2;
        rubber.position.set(0, 0.18, 0.012);
        rubber.castShadow = true;
        paddle.add(rubber);
        const handle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.022, 0.16, 8),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
        );
        handle.position.y = 0.02;
        paddle.add(handle);
        paddle.rotation.set(1.15, 0.12 * facing, 0.35 * facing);
        hand.add(paddle);
        parts.racket = paddle;
        parts.racketFace = rubber;
      }
      return { shoulder, elbow, hand };
    };
    parts.armOff = makeArm(-1, false);
    parts.armHit = makeArm(1, true);
    parts.armHit.shoulder.rotation.z = -0.55 * facing;
    parts.armHit.shoulder.rotation.x = -0.35;
    parts.armHit.elbow.rotation.x = -0.85;
    parts.armOff.shoulder.rotation.z = 0.28 * facing;
    group.userData.parts = parts;
    return group;
  }

  _onResize() {
    if (!this.camera || !this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.camera2) {
      this.camera2.aspect = w / h;
      this.camera2.updateProjectionMatrix();
    }
  }

  _renderScene() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.guestView && this.camera2 ? this.camera2 : this.camera);
  }

  _updateCameras() {
    const p1x = this.player1?.position.x || 0;
    const follow = this.running && this.ball.inPlay ? this.ball.pos.x * 0.16 + p1x * 0.35 : p1x * 0.2;
    const lookZ = this.running ? 0.85 : 0.45;
    this.camera.position.x += (follow - this.camera.position.x) * 0.1;
    this.camera.lookAt(follow * 0.45, TABLE.height + 0.16, lookZ);
    this.camera2.position.x += (-follow - this.camera2.position.x) * 0.1;
    this.camera2.lookAt(-follow * 0.45, TABLE.height + 0.16, -lookZ);
    if (this.p1Marker) {
      this.p1Marker.position.x = p1x;
      this.p1Marker.position.z = this.player1.position.z;
    }
  }

  _isLocalDev() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  }

  async _resolvePhoneBaseUrl(lanIp) {
    if (!this._isLocalDev()) return window.location.origin;
    try {
      const res = await fetch('/tunnel.json?ts=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.url) return data.url.replace(/\/$/, '');
      }
    } catch (_) {
      /* ignore */
    }
    if (lanIp) return `http://${lanIp}:${window.location.port || '3000'}`;
    return window.location.origin;
  }

  _showPhoneUrl(url) {
    this.controllerUrl = url;
    const linked = i18n.withLang(url);
    if (this.el.controllerUrl) this.el.controllerUrl.textContent = linked;
    drawQr(this.el.qr, linked, 'qr-p1');
    drawQr(this.el.qr, linked, 'qr-p2');
  }

  async _applyPhoneUrl(room, lanIp, serverUrls) {
    if (!this._isLocalDev() && serverUrls?.controllerUrlHttps) {
      this._showPhoneUrl(serverUrls.controllerUrlHttps);
      this._setStatus('status.scanQr');
      return;
    }
    const base = await this._resolvePhoneBaseUrl(lanIp);
    this._showPhoneUrl(`${base}/controller?game=${GAME_ID}&room=${encodeURIComponent(room)}`);
    this._setStatus('status.scanQr');
  }

  _joinAsScreen() {
    if (this._joining) return;
    this._joining = true;
    this._setStatus('status.settingUp');
    if (GUEST_SCREEN && JOIN_ROOM) {
      this.socket.emit('join', { role: 'screen', game: GAME_ID, room: JOIN_ROOM, guestScreen: true }, (res) => {
        this._joining = false;
        if (!res?.ok) {
          this._setStatusRaw(i18n.tError(res, 'status.joinFailed'));
          return;
        }
        this.room = res.room;
        this.isGuestScreen = true;
        this.guestView = true;
        this.controllers = res.controllers || this.controllers;
        this.el.roomCode.textContent = this.room;
        this._setStatus('status.joinedAsP2');
        this._showPhoneUrl(res.controllerUrlHttps || res.controllerUrl);
        this._refreshLobby();
        this._updateSetupUi();
      });
      return;
    }
    this.socket.emit('join', { role: 'screen', game: GAME_ID }, async (res) => {
      this._joining = false;
      if (!res?.ok) {
        this._setStatusRaw(i18n.tError(res, 'status.createFailed'));
        return;
      }
      this.room = res.room;
      this.controllers = res.controllers || this.controllers;
      this.el.roomCode.textContent = this.room;
      try {
        await this._applyPhoneUrl(this.room, res.lanIp, res);
      } catch (_) {
        this._showPhoneUrl(res.controllerUrlHttps || res.controllerUrl);
      }
      this._refreshLobby();
    });
  }

  _bindSocket() {
    this.socket.on('connect', () => {
      if (!this.room) this._joinAsScreen();
    });
    this.socket.on('connect_error', () => this._setStatus('status.connectionProblem'));
    this.socket.on('disconnect', () => this._setStatus('status.connectionLost'));
    this.socket.on('roomState', (state) => {
      this.controllers = state;
      this._refreshLobby();
    });
    this.socket.on('controllerJoined', (data) => {
      this.controllers = data.controllers || this.controllers;
      this._setStatus('status.playerJoined', { player: this.displayName(data.slot) });
      this._refreshLobby();
    });
    this.socket.on('playerReady', (data) => {
      if (data?.controllers) this.controllers = data.controllers;
      if (data?.slot) {
        this._setStatus(data.ready ? 'status.playerIsReady' : 'status.playerNotReady', {
          player: this.displayName(data.slot),
        });
      }
      this._refreshLobby();
    });
    this.socket.on('playerName', (data) => {
      if (data?.controllers) this.controllers = data.controllers;
      this._refreshLobby();
    });
    this.socket.on('controllerLeft', (data) => {
      this.controllers = data.controllers || this.controllers;
      this._setStatus('status.playerLeft', { player: this.displayName(data.slot) });
      this._refreshLobby();
      if (this.running && data.slot === 1) {
        this._showMessage('pingpong.msg.p1Left', { player: this.displayName(1) }, 2);
        setTimeout(() => this._returnToLobby(), 1200);
      }
    });
    this.socket.on('startDenied', (data) => this._setStatusRaw(i18n.tError(data, 'status.cannotStart')));
    this.socket.on('swing', (data) => {
      const slot = data.slot;
      if (!this.inputs[slot]) return;
      const raw = data.side === 'left' || data.side === 'right' ? data.side : null;
      if (!raw) return;
      this.inputs[slot].pendingSwing = true;
      const netLag = data.ts ? Math.max(0, Math.min(400, Date.now() - data.ts)) : 0;
      this.inputs[slot].swingAt = performance.now() - netLag;
      this.inputs[slot].side = phoneToLogicSide(raw);
      this.inputs[slot].phoneSide = raw;
      this.inputs[slot].intensity = clamp(Number(data.intensity) || 0.5, 0.1, 1);
      this.inputs[slot].aim = clamp(Number(data.aim) || 0, -1, 1);
      this.inputs[slot].powerLevel = clamp(
        Math.round(Number(data.powerLevel) || 0) || powerLevelFromIntensity(this.inputs[slot].intensity),
        1,
        5
      );
      if (this.running && !this.isGuestScreen) this._tryHit(slot);
    });
    this.socket.on('gameStarted', (data) => {
      if (!this.isGuestScreen) return;
      this.mode = data?.mode === 'local' ? 'local' : 'ai';
      this.running = true;
      this._hideVictory();
      this._applyNames();
      this.el.lobby.classList.add('hidden');
      this.el.hud.classList.remove('hidden');
    });
    this.socket.on('gameSync', (payload) => {
      if (!this.isGuestScreen || !payload) return;
      if (payload.scores) {
        this.scores = payload.scores;
        this.el.scoreP1.textContent = String(this.scores.p1);
        this.el.scoreP2.textContent = String(this.scores.p2);
      }
      if (payload.ball) {
        this.ball.pos.set(payload.ball.x, payload.ball.y, payload.ball.z);
        this.ball.vel.set(payload.ball.vx, payload.ball.vy, payload.ball.vz);
        this.ball.inPlay = payload.ball.inPlay !== false;
        this.ball.alive = this.ball.inPlay;
      }
      if (payload.r1 != null && this.racket1) this.racket1.position.x = payload.r1;
      if (payload.r2 != null && this.racket2) this.racket2.position.x = payload.r2;
      if (payload.servingSlot) this.servingSlot = payload.servingSlot;
      if (payload.winner) {
        this.winner = payload.winner;
        this.running = false;
        this._showVictory();
      }
    });
    this.socket.on('screenDisconnected', () => this._setStatus('status.connectionLost'));
  }

  _bindUi() {
    this.el.btnAi?.addEventListener('click', () => this._startGame('ai'));
    this.el.btnLocal?.addEventListener('click', () => this._startGame('local'));
    this.el.btnBack?.addEventListener('click', () => this._returnToLobby());
    this.el.btnVictoryLobby?.addEventListener('click', () => this._returnToLobby());
    this.el.btnCopyRoom?.addEventListener('click', async () => {
      if (!this.room) return;
      try {
        await navigator.clipboard.writeText(this.room);
        this._setStatus('status.roomCopied', { code: this.room });
      } catch {
        this._setStatus('status.roomCode', { code: this.room });
      }
    });
    this.el.setupMode?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-setup]');
      if (!btn || this.isGuestScreen) return;
      this.setupMode = btn.dataset.setup === 'remote' ? 'remote' : 'couch';
      this._updateSetupUi();
      if (this.setupMode === 'remote') {
        this._setStatus(this.room ? 'status.shareCodeWith' : 'status.shareCode', { code: this.room });
      } else {
        this._setStatus('status.scanBothQr');
      }
    });
    this.el.btnJoinRoom?.addEventListener('click', () => {
      const code = (this.el.joinRoomInput?.value || '').trim().toUpperCase();
      if (code.length !== 4) {
        this._setStatus('status.codeLength');
        return;
      }
      location.href = `${location.origin}/games/pingpong?guest=1&room=${encodeURIComponent(code)}`;
    });
    window.addEventListener('csp:langchange', () => this._relocalize());
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.running || this.isGuestScreen) return;
      let side = null;
      if (e.code === 'KeyQ' || e.code === 'ArrowLeft') side = 'left';
      else if (e.code === 'KeyE' || e.code === 'ArrowRight') side = 'right';
      if (!side) return;
      e.preventDefault();
      const slot = this.mode === 'local' && this.controllers.p1 && !this.controllers.p2 ? 2 : 1;
      const input = this.inputs[slot];
      input.pendingSwing = true;
      input.swingAt = performance.now();
      input.side = side;
      input.phoneSide = side;
      input.intensity = 0.75;
      input.aim = 0;
      input.powerLevel = 3;
      this._tryHit(slot);
    });
  }

  _refreshLobby() {
    const c = this.controllers;
    this.el.dotP1?.classList.toggle('on', !!c.p1);
    this.el.dotP2?.classList.toggle('on', !!c.p2);
    this.el.pillP1?.classList.toggle('is-ready', !!c.ready1);
    this.el.pillP2?.classList.toggle('is-ready', !!c.ready2);
    if (this.el.readyP1) this.el.readyP1.textContent = !c.p1 ? '—' : c.ready1 ? t('common.ready') : '…';
    if (this.el.readyP2) this.el.readyP2.textContent = !c.p2 ? '—' : c.ready2 ? t('common.ready') : '…';
    this.el.qrBlockP1?.classList.toggle('is-connected', !!c.p1);
    this.el.qrBlockP2?.classList.toggle('is-connected', !!c.p2);
    if (c.name1) this.playerNames.p1 = c.name1;
    if (c.name2) this.playerNames.p2 = c.name2;
    this._applyNames();
    const host = !this.isGuestScreen;
    if (this.el.btnAi) this.el.btnAi.disabled = !host || !(c.p1 && c.ready1);
    if (this.el.btnLocal) this.el.btnLocal.disabled = !host || !(c.p1 && c.ready1 && c.p2 && c.ready2);
  }

  _applyNames() {
    if (this.el.nameP1) this.el.nameP1.textContent = this.displayName(1);
    if (this.el.nameP2) this.el.nameP2.textContent = this.displayName(2);
  }

  _updateSetupUi() {
    const remote = this.setupMode === 'remote';
    this.el.setupMode?.querySelectorAll('[data-setup]').forEach((btn) => {
      btn.classList.toggle('format-active', (btn.dataset.setup === 'remote') === remote);
    });
    this.el.couchPanel?.classList.toggle('hidden', remote);
    this.el.remoteGuestPanel?.classList.toggle('hidden', !remote || this.isGuestScreen);
    this.el.roomCodePill?.classList.toggle('hidden', !remote);
    this.el.qrBlockP1?.classList.toggle('hidden', remote && this.isGuestScreen);
    this.el.qrBlockP2?.classList.toggle('hidden', remote && !this.isGuestScreen);
    this.el.setupMode?.classList.toggle('hidden', this.isGuestScreen);
  }

  _relocalize() {
    if (this.statusKey) this._setStatus(this.statusKey, this.statusParams);
    this._refreshLobby();
    if (this.messageKey && this.messageTimer > 0 && this.el.message) {
      this.el.message.textContent = t(this.messageKey, this.messageParams);
    }
    if (this.el.matchStatus && !this.winner && this.running) {
      this.el.matchStatus.textContent = t('pingpong.playing');
    }
    if (this.winner) this._showVictory();
    if (this.controllerUrl) this._showPhoneUrl(this.controllerUrl);
  }

  _nextServer() {
    const played = this.scores.p1 + this.scores.p2;
    const deuce = this.scores.p1 >= 10 && this.scores.p2 >= 10;
    const block = deuce ? 1 : 2;
    return Math.floor(played / block) % 2 === 0 ? 2 : 1;
  }

  _serve() {
    this.servingSlot = this._nextServer();
    const fromFar = this.servingSlot === 2;
    const speed = HIT.powerSpeeds[1];
    const x = (Math.random() - 0.5) * TABLE.halfWidth * 0.7;
    this.ball.pos.set(
      x,
      TABLE.height + 0.32,
      fromFar ? TABLE.halfLength - 0.45 : -TABLE.halfLength + 0.45
    );
    this.ball.vel.set(
      -x * 0.35 + (Math.random() - 0.5) * 0.4,
      HIT.powerUp + 0.15,
      fromFar ? -speed : speed
    );
    this.ball.inPlay = true;
    this.ball.alive = true;
    this.lastHitter = this.servingSlot;
    this.bouncesThisSide = 0;
    this.ai.reactedThisApproach = false;
    this.inputs[1].pendingSwing = false;
    this.inputs[2].pendingSwing = false;
    this.el.sideP1?.classList.toggle('is-serving', this.servingSlot === 1);
    this.el.sideP2?.classList.toggle('is-serving', this.servingSlot === 2);
    this._showMessage(this.servingSlot === 1 ? 'pingpong.msg.serveNear' : 'pingpong.msg.serveFar', null, 1.4);
    this.sfx.table();
  }

  _receivingSide() {
    if (this.lastHitter === 1) return 2;
    if (this.lastHitter === 2) return 1;
    return this.servingSlot === 1 ? 2 : 1;
  }

  _onTable(x, z) {
    return Math.abs(x) <= TABLE.halfWidth && Math.abs(z) <= TABLE.halfLength;
  }

  _neededSwingSide(slot) {
    const x = this.ball.pos.x;
    const th = HIT.sideThreshold;
    if (slot === 2) {
      if (x > th) return 'left';
      if (x < -th) return 'right';
      return null;
    }
    if (x > th) return 'right';
    if (x < -th) return 'left';
    return null;
  }

  _playerRightSign(slot) {
    return slot === 1 ? 1 : -1;
  }

  _inHitZone(slot) {
    const z = this.ball.pos.z;
    if (slot === 1) return z <= 0.15 && z >= -TABLE.halfLength - 0.55;
    return z >= -0.15 && z <= TABLE.halfLength + 0.55;
  }

  _approaching(slot) {
    return slot === 1 ? this.ball.vel.z < -0.4 : this.ball.vel.z > 0.4;
  }

  _showSwingBadge(side, mode = 'hit') {
    const el = this.el.swingBadge;
    if (!el) return;
    el.classList.remove('hidden', 'left', 'right', 'center', 'hint');
    const shown = swingLabel(side);
    if (shown === 'left') {
      el.textContent = mode === 'hint' ? `← ${t('tennis.badge.left')}` : t('tennis.badge.left');
      el.classList.add('left');
    } else if (shown === 'right') {
      el.textContent = mode === 'hint' ? `${t('tennis.badge.right')} →` : t('tennis.badge.right');
      el.classList.add('right');
    } else {
      el.textContent = t('tennis.badge.center');
      el.classList.add('center');
    }
    if (mode === 'hint') el.classList.add('hint');
    if (mode === 'hit') {
      clearTimeout(this._swingBadgeTimer);
      this._swingBadgeTimer = setTimeout(() => el.classList.add('hidden'), 900);
    }
  }

  _updateSwingHint() {
    if (!this.running || !this.ball.inPlay) return;
    const slot = this._approaching(1) && this._inHitZone(1) ? 1 : this._approaching(2) && this._inHitZone(2) ? 2 : null;
    if (!slot) return;
    const needed = this._neededSwingSide(slot);
    if (needed === 'left' || needed === 'right') this._showSwingBadge(needed, 'hint');
  }

  _tryHit(slot) {
    const input = this.inputs[slot];
    if (!input.pendingSwing || !this.ball.inPlay) return false;
    if (this.mode === 'ai' && slot === 2) return false;
    const fresh = performance.now() - input.swingAt < HIT.swingWindowMs;
    if (!fresh) {
      input.pendingSwing = false;
      this._showMessage('pingpong.msg.tooEarly', null, 0.9);
      return false;
    }
    if (!(this._inHitZone(slot) && this._approaching(slot))) return false;
    input.pendingSwing = false;

    const racket = slot === 1 ? this.racket1 : this.racket2;
    const swingSide = input.side === 'left' || input.side === 'right' ? input.side : null;
    if (!swingSide) {
      this._showMessage('tennis.msg.needSwing', null, 0.9);
      return false;
    }
    this._showSwingBadge(swingSide, 'hit');
    const needed = this._neededSwingSide(slot);
    const wrongSide = !!(needed && swingSide !== needed);
    const powerLevel = clamp(Number(input.powerLevel) || 3, 1, 5);
    const speed = HIT.powerSpeeds[powerLevel - 1];
    const dirZ = slot === 1 ? 1 : -1;
    const rightSign = this._playerRightSign(slot);
    const startZ = slot === 1 ? -TABLE.halfLength + 0.35 : TABLE.halfLength - 0.35;

    if (wrongSide) {
      const outSign = swingSide === 'right' ? rightSign : -rightSign;
      this.ball.vel.set(outSign * 4.2, 1.2, dirZ * speed * 0.35);
      this._showMessage(
        needed === 'right' ? 'pingpong.msg.wrongSideRight' : 'pingpong.msg.wrongSideLeft',
        null,
        1.1
      );
      this.socket.emit('haptic', { slot, reason: 'miss' });
      this.sfx.miss();
      this.lastHitter = slot;
      return true;
    }

    const aimBias = amplifyAimForCourt(clamp(Number(input.aim) || 0, -1, 1));
    const placementSide =
      input.phoneSide === 'left' || input.phoneSide === 'right' ? input.phoneSide : swingSide;
    const sameSign = placementSide === 'right' ? rightSign : -rightSign;
    const landX = sameSign * aimBias * (TABLE.halfWidth - 0.35);
    const landZ = dirZ * (TABLE.halfLength - 1.15);
    const startX = clamp(this.ball.pos.x, -TABLE.halfWidth + 0.2, TABLE.halfWidth - 0.2);
    const flightT = Math.abs(landZ - startZ) / Math.max(speed, 1);
    let aimX = (landX - startX) / Math.max(flightT, 0.45);
    aimX = clamp(aimX, -HIT.maxFairAimX, HIT.maxFairAimX);

    this.ball.pos.set(startX, Math.max(this.ball.pos.y, TABLE.height + 0.18), startZ);
    this.ball.vel.set(aimX, HIT.powerUp + (powerLevel - 1) * 0.08, dirZ * speed);
    this.bouncesThisSide = 0;
    this.lastHitter = slot;
    this.lastHumanPower = powerLevel;
    this.ai.reactedThisApproach = false;
    this._showMessage(
      swingSide === 'right' ? 'pingpong.msg.hitRight' : 'pingpong.msg.hitLeft',
      { place: aimPlacementLabel(aimBias), power: powerLevel },
      0.75
    );
    this.socket.emit('haptic', { slot, reason: 'hit', powerLevel });
    this.sfx.hit(powerLevel);
    this._playHitFlash(racket);
    return true;
  }

  _playHitFlash(player) {
    const face = player?.userData?.parts?.racketFace;
    if (!face?.material) return;
    const mat = face.material;
    const prev = mat.emissiveIntensity || 0;
    mat.emissiveIntensity = 0.85;
    setTimeout(() => {
      mat.emissiveIntensity = prev;
    }, 140);
  }

  _updateAi(dt) {
    if (this.mode !== 'ai' || !this.ball.inPlay) return;
    const coming = this.ball.vel.z > 0.3;
    const maxX = TABLE.halfWidth + HIT.runOverhang;
    let target = this.ball.pos.x;
    if (coming && Math.abs(this.ball.vel.z) > 0.05) {
      const tHit = (TABLE.halfLength - 0.4 - this.ball.pos.z) / this.ball.vel.z;
      if (tHit > 0 && tHit < 2.5) target = this.ball.pos.x + this.ball.vel.x * Math.min(tHit, 0.8);
    }
    this.ai.x += (clamp(target, -maxX, maxX) - this.ai.x) * (1 - Math.exp(-14 * dt));
    this.racket2.position.x = this.ai.x;
    if (coming && this._inHitZone(2) && !this.ai.reactedThisApproach) {
      this.ai.reactedThisApproach = true;
      const chance = HIT.aiReturnChance[clamp(this.lastHumanPower, 1, 5) - 1];
      if (Math.random() < chance) this._aiReturn();
    }
    if (!coming && this.ball.pos.z < 0.4) this.ai.reactedThisApproach = false;
  }

  _aiReturn() {
    const speed = HIT.powerSpeeds[1 + Math.floor(Math.random() * 3)];
    const landX = (Math.random() * 2 - 1) * (TABLE.halfWidth - 0.45);
    const startX = clamp(this.ball.pos.x, -TABLE.halfWidth + 0.2, TABLE.halfWidth - 0.2);
    const startZ = TABLE.halfLength - 0.4;
    const landZ = -TABLE.halfLength + 1.2;
    const flightT = (startZ - landZ) / speed;
    this.ball.pos.set(startX, TABLE.height + 0.2, startZ);
    this.ball.vel.set(
      clamp((landX - startX) / Math.max(flightT, 0.4), -HIT.maxFairAimX, HIT.maxFairAimX),
      HIT.powerUp + 0.2,
      -speed
    );
    this.bouncesThisSide = 0;
    this.lastHitter = 2;
    this.sfx.hit(3);
    this._playHitFlash(this.racket2);
  }

  _awardPoint(slot) {
    if (!this.running || this.winner) return;
    this.scores[slot === 1 ? 'p1' : 'p2'] += 1;
    this.ball.inPlay = false;
    this.ball.alive = false;
    this.el.scoreP1.textContent = String(this.scores.p1);
    this.el.scoreP2.textContent = String(this.scores.p2);
    this.socket.emit('scoreUpdate', {
      scores: { ...this.scores },
      p1: this.scores.p1,
      p2: this.scores.p2,
      display: `${this.scores.p1} – ${this.scores.p2}`,
      game: GAME_ID,
    });
    this.socket.emit('haptic', { slot, reason: 'point' });
    this.socket.emit('haptic', { slot: slot === 1 ? 2 : 1, reason: 'miss' });
    this.sfx.point();
    if (this.scores.p1 >= WIN && this.scores.p1 - this.scores.p2 >= WIN_BY) this._finishMatch(1);
    else if (this.scores.p2 >= WIN && this.scores.p2 - this.scores.p1 >= WIN_BY) this._finishMatch(2);
    else this.servePause = 0.9;
  }

  _finishMatch(slot) {
    this.running = false;
    this.winner = slot;
    this.ball.inPlay = false;
    this._showVictory();
  }

  _showVictory() {
    if (!this.winner) return;
    const name = this.displayName(this.winner);
    if (this.el.matchStatus) this.el.matchStatus.textContent = t('controller.hudWins', { player: name });
    if (this.el.victoryTitle) {
      this.el.victoryTitle.textContent = name;
      this.el.victoryTitle.classList.toggle('win-p1', this.winner === 1);
      this.el.victoryTitle.classList.toggle('win-p2', this.winner === 2);
    }
    if (this.el.victorySub) {
      this.el.victorySub.textContent = t('pingpong.victory.sub', {
        score: `${this.scores.p1}–${this.scores.p2}`,
      });
    }
    const wasHidden = this.el.victoryOverlay?.classList.contains('hidden');
    this.el.victoryOverlay?.classList.remove('hidden');
    if (wasHidden) {
      this.socket.emit('hud', {
        slot: this.winner,
        messageKey: 'controller.hudWins',
        messageParams: { player: name },
      });
    }
  }

  _hideVictory() {
    this.el.victoryOverlay?.classList.add('hidden');
    this.winner = 0;
  }

  _updateRackets(dt) {
    const maxX = TABLE.halfWidth + HIT.runOverhang;
    const follow = 1 - Math.exp(-14 * Math.max(dt, 0.001));
    if (this.ball.inPlay && this.ball.alive) {
      const t1 = clamp(this.ball.pos.x + this.ball.vel.x * 0.12, -maxX, maxX);
      this.racket1.position.x += (t1 - this.racket1.position.x) * follow;
    } else {
      this.racket1.position.x += (0 - this.racket1.position.x) * (1 - Math.exp(-3 * dt));
    }
    this.racket1.position.x = clamp(this.racket1.position.x, -maxX, maxX);
    if (this.mode === 'ai') this._updateAi(dt);
    else if (this.ball.inPlay) {
      const t2 = clamp(this.ball.pos.x + this.ball.vel.x * 0.12, -maxX, maxX);
      this.racket2.position.x += (t2 - this.racket2.position.x) * follow;
    } else {
      this.racket2.position.x += (0 - this.racket2.position.x) * (1 - Math.exp(-3 * dt));
    }
    this.racket2.position.x = clamp(this.racket2.position.x, -maxX, maxX);
    this._updateLocomotion(this.racket1, dt);
    this._updateLocomotion(this.racket2, dt);
  }

  _updateLocomotion(player, dt) {
    const parts = player?.userData?.parts;
    if (!parts) return;
    const dx = player.position.x - parts.prevX;
    parts.prevX = player.position.x;
    parts.moveSpeed += (Math.abs(dx / Math.max(dt, 0.001)) - parts.moveSpeed) * 0.2;
    const moving = parts.moveSpeed > 0.25;
    if (moving) parts.runPhase += dt * clamp(parts.moveSpeed * 0.8, 0, 10);
    const lean = clamp(dx * 2.4, -0.28, 0.28);
    parts.hips.rotation.z = -lean * 0.5;
    parts.torso.rotation.z = -lean * 0.35;
    const swing = moving ? Math.sin(parts.runPhase) * 0.45 : 0.08;
    parts.legL.hip.rotation.x = swing;
    parts.legR.hip.rotation.x = -swing;
    player.rotation.y =
      (parts.facing === 1 ? 0 : Math.PI) +
      (parts.facing === 1 ? -player.position.x * 0.04 : player.position.x * 0.04);
  }

  _updateBall(dt) {
    if (!this.ball.alive || !this.ball.inPlay) {
      if (this.ballMesh) this.ballMesh.visible = false;
      if (this.ballShadow) this.ballShadow.visible = false;
      return;
    }
    this.ballMesh.visible = true;
    this.ballShadow.visible = true;
    const p = this.ball.pos;
    const v = this.ball.vel;
    v.y += TABLE.gravity * dt;
    v.multiplyScalar(Math.max(0, 1 - TABLE.airDrag * dt));
    p.addScaledVector(v, dt);

    const onTable = this._onTable(p.x, p.z);
    const top = TABLE.height + TABLE.ballRadius;
    if (onTable && p.y < top && v.y < 0) {
      p.y = top;
      v.y = Math.abs(v.y) * TABLE.bounce;
      if (v.y < 1.4) v.y = 1.4;
      v.x *= 0.96;
      v.z *= 0.96;
      this.sfx.table();
      const sideNow = p.z < 0 ? 1 : 2;
      const receiver = this._receivingSide();
      if (sideNow === receiver) {
        this.bouncesThisSide += 1;
        if (this.bouncesThisSide >= 2) {
          this._awardPoint(receiver === 1 ? 2 : 1);
          return;
        }
      }
    }

    if (
      Math.abs(p.z) < TABLE.netThickness + TABLE.ballRadius &&
      p.y < TABLE.height + TABLE.netHeight &&
      Math.abs(p.x) < TABLE.halfWidth + 0.1
    ) {
      this._awardPoint(this.lastHitter === 1 ? 2 : 1);
      return;
    }

    if (p.y < TABLE.ballRadius) {
      const receiver = this._receivingSide();
      this._awardPoint(receiver === 1 ? 2 : 1);
      return;
    }

    if (p.z < -TABLE.halfLength - 0.7 && v.z < 0) {
      this._awardPoint(this.bouncesThisSide >= 1 ? 2 : 1);
      return;
    }
    if (p.z > TABLE.halfLength + 0.7 && v.z > 0) {
      this._awardPoint(this.bouncesThisSide >= 1 ? 1 : 2);
      return;
    }

    this.ballMesh.position.copy(p);
    this.ballMesh.rotation.x += v.z * dt * 0.4;
    this.ballShadow.position.x = p.x;
    this.ballShadow.position.z = p.z;
    this.ballShadow.visible = onTable;
    const shadowScale = clamp(1.3 - (p.y - TABLE.height) * 1.4, 0.35, 1.2);
    this.ballShadow.scale.setScalar(shadowScale);
  }

  _startGame(nextMode) {
    if (!this.controllers.p1 || !this.controllers.ready1) {
      this._setStatus('status.needP1Ready', { player: this.displayName(1) });
      return;
    }
    if (nextMode === 'local' && (!this.controllers.p2 || !this.controllers.ready2)) {
      this._setStatus('status.needP1Ready', { player: this.displayName(2) });
      return;
    }
    this.mode = nextMode;
    this.running = true;
    this.scores = { p1: 0, p2: 0 };
    this.winner = 0;
    this._hideVictory();
    this._applyNames();
    this.el.scoreP1.textContent = '0';
    this.el.scoreP2.textContent = '0';
    if (this.el.matchStatus) this.el.matchStatus.textContent = t('pingpong.playing');
    this.el.lobby.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.sfx.unlock();
    this.socket.emit('startGame', { mode: nextMode });
    this._showMessage(nextMode === 'ai' ? 'pingpong.msg.youAreBlue' : 'pingpong.msg.goodLuck', null, 1.4);
    this.servePause = 0.75;
  }

  _returnToLobby() {
    this.running = false;
    this.mode = null;
    this.ball.inPlay = false;
    this.ball.alive = false;
    this._hideVictory();
    this.el.hud.classList.add('hidden');
    this.el.lobby.classList.remove('hidden');
    this._setStatus('status.backInLobby');
    this._refreshLobby();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (!this.renderer || !this.scene || !this.camera) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) {
        this.messageKey = null;
        this.messageParams = null;
        if (this.el.message) this.el.message.textContent = '\u00a0';
      }
    }

    try {
      if (this.running && !this.isGuestScreen) {
        if (this.servePause > 0) {
          this.servePause -= dt;
          if (this.servePause <= 0 && !this.winner && !this.ball.inPlay) this._serve();
        } else if (!this.ball.inPlay && !this.winner) {
          this._serve();
        } else {
          this._updateBall(dt);
          this._updateRackets(dt);
          this._updateSwingHint();
          this._tryHit(1);
          this._tryHit(2);
        }
        this.socket.emit('gameSync', {
          scores: { ...this.scores },
          ball: {
            x: this.ball.pos.x,
            y: this.ball.pos.y,
            z: this.ball.pos.z,
            vx: this.ball.vel.x,
            vy: this.ball.vel.y,
            vz: this.ball.vel.z,
            inPlay: this.ball.inPlay,
          },
          r1: this.racket1?.position.x ?? 0,
          r2: this.racket2?.position.x ?? 0,
          servingSlot: this.servingSlot,
          winner: this.winner,
        });
      } else if (!this.running && this.racket1 && this.racket2) {
        const tNow = performance.now() * 0.001;
        this.racket1.position.x = Math.sin(tNow) * 0.55;
        this.racket2.position.x = Math.cos(tNow * 0.9) * 0.55;
        this._updateLocomotion(this.racket1, 0.016);
        this._updateLocomotion(this.racket2, 0.016);
        if (this.ballMesh) {
          this.ballMesh.visible = true;
          this.ballMesh.position.set(
            Math.sin(tNow * 0.8) * 0.7,
            TABLE.height + 0.28 + Math.sin(tNow * 2.2) * 0.12,
            Math.cos(tNow * 0.55) * 1.4
          );
          this.ballShadow.position.set(this.ballMesh.position.x, TABLE.height + 0.011, this.ballMesh.position.z);
          this.ballShadow.visible = this._onTable(this.ballMesh.position.x, this.ballMesh.position.z);
        }
      } else if (this.isGuestScreen && this.running && this.ballMesh) {
        this.ballMesh.position.copy(this.ball.pos);
        this.ballMesh.visible = this.ball.alive;
        this._updateLocomotion(this.racket1, dt);
        this._updateLocomotion(this.racket2, dt);
      }
      this._updateCameras();
      this._renderScene();
    } catch (err) {
      console.error('frame error', err);
    }
  }
}

new PingPongGame();

/**
 * Desktop game screen: Three.js tennis court, physics, AI, Socket.io lobby.
 */
import * as THREE from '/vendor/three/build/three.module.js';
import { CrowdAudio } from './crowd-audio.js';

const GAME_ID = 'tennis';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const GUEST_SCREEN = PAGE_PARAMS.get('guest') === '1';
const JOIN_ROOM_PARAM = (PAGE_PARAMS.get('room') || '').trim().toUpperCase();

const COURT = {
  halfLength: 12, // Z extent each side from net
  halfWidth: 5.5, // X extent
  netHeight: 1.05,
  netThickness: 0.08,
  ballRadius: 0.18,
  gravity: -14,
  bounce: 0.68,
  airDrag: 0.04,
};

const HIT = {
  zoneDepth: 5.5,
  zoneHeight: 3.6,
  maxLateralMiss: 2.8,
  /** 5 pace tiers — clear steps, but top end not extreme */
  powerSpeeds: [10.2, 11.4, 12.6, 13.8, 15.0],
  /** Same lob for tiers 2–5; tier 1 uses this ~90% of the time */
  powerUp: 6.7,
  /** AI return chance by incoming human power level 1..5 */
  aiReturnChance: [0.9, 0.85, 0.8, 0.75, 0.7],
  swingWindowMs: 550,
  /** How far past the sideline players may auto-run */
  runOverhang: 2.2,
  /** |ball.x| above this = clearly left/right side of court */
  sideThreshold: 0.55,
  /** Max |vx| on a fair hit so the ball usually stays in */
  maxFairAimX: 2.8,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Map continuous intensity → power level 1..5 */
function powerLevelFromIntensity(intensity) {
  const t = clamp(Number(intensity) || 0.3, 0, 1);
  if (t < 0.22) return 1;
  if (t < 0.4) return 2;
  if (t < 0.58) return 3;
  if (t < 0.76) return 4;
  return 5;
}

/** +1 same side (down the line), −1 cross-court, 0 center. */
function aimPlacementLabel(aim) {
  const v = Number(aim) || 0;
  if (v > 0.2) return 'same side';
  if (v < -0.2) return 'cross';
  return 'center';
}

function amplifyAimForCourt(aim) {
  const v = clamp(Number(aim) || 0, -1, 1);
  if (Math.abs(v) < 0.1) return v;
  const sign = Math.sign(v) || 1;
  const mag = Math.abs(v);
  return clamp(sign * (0.28 + mag * 0.72), -1, 1);
}

/** UI / animation name for a swing (logic side is mirrored vs how the player names it). */
function swingLabel(side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}

/** Convert phone-reported side to court logic side (same mapping for both players). */
function phoneToLogicSide(raw) {
  if (raw === 'left') return 'right';
  if (raw === 'right') return 'left';
  return raw;
}

function drawQr(canvas, text, imgId) {
  const img = document.getElementById(imgId || 'qr-img');
  if (img) {
    img.src = `/api/qr?text=${encodeURIComponent(text)}&t=${Date.now()}`;
    img.classList.remove('hidden');
  }
  if (typeof qrcode !== 'function' || !canvas) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const size = canvas.width;
    const cell = size / count;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
      }
    }
  } catch (_) {
    /* server QR is enough */
  }
}

class TennisGame {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'], upgrade: true, rememberUpgrade: true });
    this.room = null;
    this.controllerUrl = '';
    this.isGuestScreen = GUEST_SCREEN;
    this.setupMode = GUEST_SCREEN ? 'remote' : 'couch';
    this.guestView = false;
    this._syncFrame = 0;
    this.controllers = { p1: false, p2: false, ready1: false, ready2: false, name1: 'P1', name2: 'P2' };
    this.playerNames = { p1: 'P1', p2: 'P2' };
    this.mode = null; // 'ai' | 'local'
    this.running = false;
    this.splitScreen = false;
    this._fireworks = null;
    /** How many sets needed to win the match: 1 / 2 (Bo3) / 3 (Bo5) */
    this.matchFormat = { bestOf: 3, setsToWin: 2 };

    this.match = this._freshMatch();
    this.servingSide = 1; // 1 or 2
    this.bouncesThisSide = 0;
    this.lastHitter = 0;
    this.messageTimer = 0;

    this.inputs = {
      1: { x: 0, swingAt: 0, intensity: 0.55, aim: 0, powerLevel: 3, pendingSwing: false, side: 'center', phoneSide: null },
      2: { x: 0, swingAt: 0, intensity: 0.55, aim: 0, powerLevel: 3, pendingSwing: false, side: 'center', phoneSide: null },
    };

    this.keys = new Set();
    this.ai = {
      x: 0,
      nextSwing: 0,
      error: 0,
      reactedThisApproach: false,
    };
    this.lastHumanPowerLevel = 1;

    this.crowd = new CrowdAudio();
    this.crowdMuted = localStorage.getItem('psg-crowd-muted') === '1';
    this.crowd.setMuted(this.crowdMuted);
    this.spectators = [];
    this.cheerWave = 0;
    this.ballSquash = null;

    this.ball = {
      pos: new THREE.Vector3(0, 1.2, -COURT.halfLength + 2),
      vel: new THREE.Vector3(0, 0, 0),
      alive: false,
      inPlay: false,
    };

    this.clock = new THREE.Clock();
    this.sceneReady = false;
    this._buildDom();
    this._bindSocket();
    this._bindUi();
    this._updateSetupModeUi();
    this._bindKeyboard();
    this._joinAsScreen();
    this._initGraphics();
  }

  _initGraphics() {
    if (this.sceneReady && this.renderer) {
      this._onResize();
      return;
    }
    try {
      this._buildScene();
      this.sceneReady = true;
      this._onResize();
      if (!this._animating) {
        this._animating = true;
        this._animate();
      }
    } catch (err) {
      console.error('3D init failed', err);
      this.sceneReady = false;
      const msg = 'This device could not load 3D graphics. Try another browser or computer.';
      if (this.el?.lobbyStatus) this.el.lobbyStatus.textContent = msg;
      if (this.el?.message) this.el.message.textContent = msg;
    }
  }

  _freshMatch() {
    return {
      sets: { p1: 0, p2: 0 },
      games: { p1: 0, p2: 0 },
      points: { p1: 0, p2: 0 },
      advantage: 0,
      tiebreak: false,
      tbPoints: { p1: 0, p2: 0 },
      matchOver: false,
      setsToWin: this.matchFormat?.setsToWin || 2,
      bestOf: this.matchFormat?.bestOf || 3,
    };
  }

  _formatLabel() {
    const bestOf = this.matchFormat?.bestOf || 3;
    if (bestOf === 1) return '1 Set';
    return `Best of ${bestOf}`;
  }

  _ensureGraphics() {
    this._initGraphics();
    return !!(this.sceneReady && this.renderer && this.scene && this.camera);
  }

  _buildDom() {
    this.el = {
      lobby: document.getElementById('lobby'),
      hud: document.getElementById('hud'),
      roomCode: document.getElementById('room-code'),
      lobbyStatus: document.getElementById('lobby-status'),
      controllerUrl: document.getElementById('controller-url'),
      qr: document.getElementById('qr-canvas'),
      qrImg: document.getElementById('qr-img'),
      dotP1: document.getElementById('dot-p1'),
      dotP2: document.getElementById('dot-p2'),
      btnAi: document.getElementById('btn-ai'),
      btnLocal: document.getElementById('btn-local'),
      btnBack: document.getElementById('btn-back'),
      btnCrowdMute: document.getElementById('btn-crowd-mute'),
      setsP1: document.getElementById('sets-p1'),
      setsP2: document.getElementById('sets-p2'),
      gamesP1: document.getElementById('games-p1'),
      gamesP2: document.getElementById('games-p2'),
      pointsP1: document.getElementById('points-p1'),
      pointsP2: document.getElementById('points-p2'),
      nameP1: document.getElementById('name-p1'),
      nameP2: document.getElementById('name-p2'),
      serveP1: document.getElementById('serve-p1'),
      serveP2: document.getElementById('serve-p2'),
      matchLabel: document.getElementById('match-label'),
      message: document.getElementById('message'),
      swingBadge: document.getElementById('swing-badge'),
      canvas: document.getElementById('game-canvas'),
      connectHint: document.getElementById('connect-hint'),
      btnCopyUrl: document.getElementById('btn-copy-url'),
      readyP1: document.getElementById('ready-p1'),
      readyP2: document.getElementById('ready-p2'),
      formatPills: document.getElementById('format-pills'),
      splitDivider: document.getElementById('split-divider'),
      splitLabelP1: document.getElementById('split-label-p1'),
      splitLabelP2: document.getElementById('split-label-p2'),
      victoryOverlay: document.getElementById('victory-overlay'),
      victoryTitle: document.getElementById('victory-title'),
      victorySub: document.getElementById('victory-sub'),
      btnVictoryLobby: document.getElementById('btn-victory-lobby'),
      fireworksCanvas: document.getElementById('fireworks-canvas'),
      setupModePills: document.getElementById('setup-mode'),
      couchPanel: document.getElementById('couch-panel'),
      remoteGuestPanel: document.getElementById('remote-guest-panel'),
      joinRoomInput: document.getElementById('join-room-input'),
      btnJoinRoom: document.getElementById('btn-join-room'),
      btnCopyRoom: document.getElementById('btn-copy-room'),
      roomCodePill: document.getElementById('room-code-pill'),
      qrBlockP1: document.getElementById('qr-block-p1'),
      qrBlockP2: document.getElementById('qr-block-p2'),
      qrP1: document.getElementById('qr-p1'),
      qrP2: document.getElementById('qr-p2'),
    };
  }

  _makeCourtTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3d9b5a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const g = 55 + Math.random() * 35;
      ctx.fillStyle = `rgba(${g - 10},${g + 40},${g - 5},0.08)`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (let y = 0; y < size; y += 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 8);
    tex.anisotropy = 8;
    return tex;
  }

  _addStadium() {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.08 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.35, roughness: 0.45 });

    const buildStand = (zSign) => {
      const root = new THREE.Group();
      for (let row = 0; row < 5; row += 1) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(28, 0.55, 2.2), row % 2 ? seatMat : standMat);
        tier.position.set(0, 0.35 + row * 0.62, zSign * (COURT.halfLength + 5 + row * 1.8));
        tier.castShadow = true;
        tier.receiveShadow = true;
        root.add(tier);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(28.5, 0.12, 0.18), railMat);
      rail.position.set(0, 3.6, zSign * (COURT.halfLength + 4.2));
      root.add(rail);
      return root;
    };

    this.scene.add(buildStand(-1), buildStand(1));

    const sideStandGeo = new THREE.BoxGeometry(3.5, 2.8, COURT.halfLength * 2 + 10);
    const leftStand = new THREE.Mesh(sideStandGeo, standMat);
    leftStand.position.set(-COURT.halfWidth - 6.5, 1.4, 0);
    leftStand.receiveShadow = true;
    const rightStand = leftStand.clone();
    rightStand.position.x = COURT.halfWidth + 6.5;
    this.scene.add(leftStand, rightStand);

    const colors = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981, 0xa855f7, 0xf97316, 0xec4899, 0x06b6d4];
    this.spectators = [];
    const addSpectator = (x, y, z) => {
      const body = new THREE.Group();
      const shirtColor = colors[Math.floor(Math.random() * colors.length)];
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.14, 0.28, 4, 8),
        new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.75 })
      );
      torso.position.y = 0.22;
      torso.castShadow = true;
      body.add(torso);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffddb8, roughness: 0.85 })
      );
      head.position.y = 0.48;
      body.add(head);
      body.position.set(x, y, z);
      body.rotation.y = Math.atan2(-x, -z) + (Math.random() - 0.5) * 0.5;
      body.userData.baseY = y;
      body.userData.phase = Math.random() * Math.PI * 2;
      body.userData.amp = 0.04 + Math.random() * 0.07;
      this.scene.add(body);
      this.spectators.push(body);
    };

    for (let row = 0; row < 5; row += 1) {
      for (let i = 0; i < 18; i += 1) {
        const t = i / 17;
        const x = (t - 0.5) * 24;
        addSpectator(x, 0.55 + row * 0.62, -(COURT.halfLength + 4.8 + row * 1.8));
        addSpectator(x, 0.55 + row * 0.62, COURT.halfLength + 4.8 + row * 1.8);
      }
    }
    for (let row = 0; row < 3; row += 1) {
      for (let i = 0; i < 8; i += 1) {
        addSpectator(-COURT.halfWidth - 5.5, 0.8 + row * 0.55, (i / 7 - 0.5) * (COURT.halfLength * 2 + 6));
        addSpectator(COURT.halfWidth + 5.5, 0.8 + row * 0.55, (i / 7 - 0.5) * (COURT.halfLength * 2 + 6));
      }
    }
  }

  _updateSpectators(dt) {
    const cheering = this.crowd?.isCheering?.() || this.cheerWave > 0;
    if (this.cheerWave > 0) this.cheerWave = Math.max(0, this.cheerWave - dt);
    const cheerAmp = cheering ? 0.22 : 0.025;
    const t = performance.now() * 0.001;
    for (const sp of this.spectators) {
      const bob = Math.sin(t * (cheering ? 9 : 2.2) + sp.userData.phase) * sp.userData.amp * (cheering ? 3.5 : 1);
      sp.position.y = sp.userData.baseY + bob;
      if (cheering) sp.rotation.x = Math.sin(t * 10 + sp.userData.phase) * 0.08;
      else sp.rotation.x *= 0.9;
    }
  }

  _triggerCrowdCheer(intensity = 0.5) {
    this.cheerWave = 0.8 + intensity * 0.8;
    this.crowd?.cheer(intensity);
  }

  /** +1 = player-named right swing, -1 = left, for animation mirroring per slot. */
  _animSign(slot, displaySide) {
    if (displaySide === 'right') return slot === 1 ? 1 : -1;
    if (displaySide === 'left') return slot === 1 ? -1 : 1;
    return 0;
  }

  _buildScene() {
    const canvas = this.el.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x87b5e8, 1);
    this.renderer.shadowMap.enabled = true;

    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec8e8);
    this.scene.fog = new THREE.Fog(0x9fd4f0, 45, 85);

    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(0, 8.2, -COURT.halfLength - 7.2);
    this.camera.lookAt(0, 1.4, 1.5);

    this.camera2 = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera2.position.set(0, 8.2, COURT.halfLength + 7.2);
    this.camera2.lookAt(0, 1.4, -1.5);

    const hemi = new THREE.HemisphereLight(0xdff4ff, 0x3d6b35, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.25);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.bias = -0.00015;
    this.scene.add(sun);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(0x88b4ff, 0.35);
    fill.position.set(-8, 10, -6);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 64),
      new THREE.MeshStandardMaterial({ color: 0x3f7a44, roughness: 0.95, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const courtTex = this._makeCourtTexture();
    const court = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.halfWidth * 2, 0.1, COURT.halfLength * 2),
      new THREE.MeshStandardMaterial({
        map: courtTex,
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.02,
      })
    );
    court.position.y = 0.05;
    court.receiveShadow = true;
    this.scene.add(court);

    this._addCourtLines();
    this._addNet();
    this._addStadium();

    this.player1 = this._createPlayer(0x38bdf8, 1);
    this.player2 = this._createPlayer(0xf97316, 2);
    this.racket1 = this.player1;
    this.racket2 = this.player2;
    this.player1.position.set(0, 0, -COURT.halfLength + 1.6);
    this.player2.position.set(0, 0, COURT.halfLength - 1.6);
    this.player2.rotation.y = Math.PI;
    this.scene.add(this.player1, this.player2);

    // Bright floor marker under blue player so lateral auto-move is obvious
    this.p1Marker = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 28),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    this.p1Marker.rotation.x = -Math.PI / 2;
    this.p1Marker.position.set(0, 0.11, -COURT.halfLength + 1.6);
    this.scene.add(this.p1Marker);

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(COURT.ballRadius, 32, 24),
      new THREE.MeshStandardMaterial({
        color: 0xe8f060,
        emissive: 0x334400,
        emissiveIntensity: 0.08,
        roughness: 0.55,
        metalness: 0.05,
      })
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.09;
    this.scene.add(this.ballShadow);

    window.addEventListener('resize', () => this._onResize());
  }

  _addCourtLines() {
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      emissive: 0xffffff,
      emissiveIntensity: 0.08,
    });
    const addLine = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, d), lineMat);
      m.position.set(x, 0.105, z);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    const W = COURT.halfWidth * 2;
    const L = COURT.halfLength * 2;
    addLine(W, 0.08, 0, -COURT.halfLength);
    addLine(W, 0.08, 0, COURT.halfLength);
    addLine(0.08, L, -COURT.halfWidth, 0);
    addLine(0.08, L, COURT.halfWidth, 0);
    addLine(0.06, COURT.halfLength, 0, -COURT.halfLength / 2);
    addLine(0.06, COURT.halfLength, 0, COURT.halfLength / 2);
    addLine(W, 0.06, 0, -COURT.halfLength / 2);
    addLine(W, 0.06, 0, COURT.halfLength / 2);
  }

  _addNet() {
    const postGeo = new THREE.CylinderGeometry(0.055, 0.07, COURT.netHeight + 0.35, 12);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.4, roughness: 0.55 });
    const left = new THREE.Mesh(postGeo, postMat);
    const right = new THREE.Mesh(postGeo, postMat);
    left.position.set(-COURT.halfWidth - 0.18, (COURT.netHeight + 0.35) / 2, 0);
    right.position.set(COURT.halfWidth + 0.18, (COURT.netHeight + 0.35) / 2, 0);
    left.castShadow = right.castShadow = true;
    this.scene.add(left, right);

    const netMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      transparent: true,
      opacity: 0.48,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.halfWidth * 2 + 0.15, COURT.netHeight, COURT.netThickness),
      netMat
    );
    net.position.y = COURT.netHeight / 2;
    this.scene.add(net);

    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(COURT.halfWidth * 2 + 0.2, 0.05, COURT.netThickness + 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.12 })
    );
    tape.position.y = COURT.netHeight + 0.02;
    this.scene.add(tape);
    this.netMesh = net;
  }

  _createPlayer(teamColor, slot) {
    const group = new THREE.Group();
    const facing = slot === 1 ? 1 : -1;
    const skin = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.82 });
    const shirt = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.62, metalness: 0.05 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
    const sock = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85 });

    const parts = { slot, facing, runPhase: Math.random() * Math.PI * 2, prevX: 0, moveSpeed: 0 };

    parts.root = new THREE.Group();
    parts.root.position.y = 0;
    group.add(parts.root);

    parts.hips = new THREE.Group();
    parts.hips.position.y = 0.92;
    parts.root.add(parts.hips);

    parts.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.52, 6, 12), shirt);
    parts.torso.position.y = 0.36;
    parts.torso.castShadow = true;
    parts.hips.add(parts.torso);

    parts.head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), skin);
    parts.head.position.set(0, 0.68, 0.02);
    parts.head.castShadow = true;
    parts.torso.add(parts.head);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.55 })
    );
    cap.position.set(0, 0.08, 0);
    cap.rotation.x = -0.15;
    parts.head.add(cap);

    const makeLeg = (sign) => {
      const hip = new THREE.Group();
      hip.position.set(sign * 0.14, 0, 0);
      parts.hips.add(hip);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.42, 8), shorts);
      upper.position.y = -0.21;
      upper.castShadow = true;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.4, 8), sock);
      lower.position.y = -0.2;
      lower.castShadow = true;
      knee.add(lower);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.28), shoe);
      foot.position.set(0, -0.42, 0.06 * facing);
      foot.castShadow = true;
      knee.add(foot);
      return { hip, knee, upper, lower, foot };
    };
    parts.legL = makeLeg(-1);
    parts.legR = makeLeg(1);

    const makeArm = (sign, isRacket) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.34 * facing, 0.52, 0);
      parts.torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.34, 8), skin);
      upper.position.y = -0.17;
      upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.3, 8), skin);
      fore.position.y = -0.15;
      fore.castShadow = true;
      elbow.add(fore);
      const hand = new THREE.Group();
      hand.position.y = -0.3;
      elbow.add(hand);
      if (isRacket) {
        const racket = new THREE.Group();
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          roughness: 0.35,
          metalness: 0.45,
        });
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.82 });
        const stringCanvas = document.createElement('canvas');
        stringCanvas.width = 64;
        stringCanvas.height = 96;
        const sctx = stringCanvas.getContext('2d');
        sctx.fillStyle = '#f8fafc';
        sctx.fillRect(0, 0, 64, 96);
        sctx.strokeStyle = '#cbd5e1';
        sctx.lineWidth = 1;
        for (let i = 6; i < 64; i += 5) {
          sctx.beginPath();
          sctx.moveTo(i, 8);
          sctx.lineTo(i, 88);
          sctx.stroke();
        }
        for (let j = 8; j < 90; j += 5) {
          sctx.beginPath();
          sctx.moveTo(6, j);
          sctx.lineTo(58, j);
          sctx.stroke();
        }
        const stringTex = new THREE.CanvasTexture(stringCanvas);
        const face = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.78, 0.04),
          new THREE.MeshStandardMaterial({
            map: stringTex,
            color: teamColor,
            roughness: 0.45,
            metalness: 0.15,
            emissive: new THREE.Color(teamColor),
            emissiveIntensity: 0.12,
          })
        );
        face.position.set(0, 0.4, 0);
        face.castShadow = true;
        face.name = 'racketFace';
        racket.add(face);
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(0.27, 0.028, 10, 28),
          frameMat
        );
        rim.position.set(0, 0.4, 0.02);
        rim.rotation.y = Math.PI / 2;
        racket.add(rim);
        const throat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.03), frameMat);
        throat.position.set(0, 0.06, 0);
        racket.add(throat);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.42, 10), gripMat);
        handle.position.y = -0.18;
        handle.castShadow = true;
        racket.add(handle);
        const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 10), frameMat);
        butt.position.y = -0.4;
        racket.add(butt);
        hand.add(racket);
        parts.racket = racket;
        parts.racketFace = face;
      }
      return { shoulder, elbow, upper, fore, hand };
    };

    parts.armOff = makeArm(-1, false);
    parts.armHit = makeArm(1, true);

    parts.armHit.shoulder.rotation.z = -0.35 * facing;
    parts.armHit.elbow.rotation.x = -0.55;
    parts.armOff.shoulder.rotation.z = 0.25 * facing;

    group.userData.label = slot === 1 ? 'P1' : 'P2';
    group.userData.parts = parts;
    return group;
  }

  _onResize() {
    if (!this.camera || !this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.splitScreen && this.camera2) {
      const aspect = Math.max(w * 0.5, 1) / h;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      this.camera2.aspect = aspect;
      this.camera2.updateProjectionMatrix();
    } else {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  _setSplitScreen(on) {
    this.splitScreen = !!on;
    this.el.splitDivider?.classList.toggle('on', this.splitScreen);
    this.el.splitLabelP1?.classList.toggle('hidden', !this.splitScreen);
    this.el.splitLabelP2?.classList.toggle('hidden', !this.splitScreen);
    this._onResize();
  }

  _setGuestCamera() {
    this.guestView = true;
    this._onResize();
  }

  _applyGameSync(payload) {
    if (payload.match) this.match = payload.match;
    if (payload.playerNames) {
      this.playerNames = payload.playerNames;
      this._applyNamesToHud();
    }
    if (payload.servingSide) this.servingSide = payload.servingSide;
    if (payload.mode) this.mode = payload.mode;
    if (payload.ball) {
      this.ball.pos.x = payload.ball.pos?.x ?? this.ball.pos.x;
      this.ball.pos.y = payload.ball.pos?.y ?? this.ball.pos.y;
      this.ball.pos.z = payload.ball.pos?.z ?? this.ball.pos.z;
      this.ball.vel.x = payload.ball.vel?.x ?? this.ball.vel.x;
      this.ball.vel.y = payload.ball.vel?.y ?? this.ball.vel.y;
      this.ball.vel.z = payload.ball.vel?.z ?? this.ball.vel.z;
      this.ball.inPlay = !!payload.ball.inPlay;
      this.ball.alive = payload.ball.alive !== false;
    }
    if (payload.r1 != null && this.racket1) this.racket1.position.x = payload.r1;
    if (payload.r2 != null && this.racket2) this.racket2.position.x = payload.r2;
    this._updateScoreHud();
  }

  _emitGameSync() {
    if (this.isGuestScreen || !this.running || !this.room) return;
    this.socket.emit('gameSync', {
      match: this.match,
      playerNames: this.playerNames,
      servingSide: this.servingSide,
      mode: this.mode,
      ball: {
        pos: { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z },
        vel: { x: this.ball.vel.x, y: this.ball.vel.y, z: this.ball.vel.z },
        inPlay: this.ball.inPlay,
        alive: this.ball.alive,
      },
      r1: this.racket1?.position.x ?? 0,
      r2: this.racket2?.position.x ?? 0,
    });
  }

  _renderScene() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.splitScreen && this.camera2) {
      this.renderer.setScissorTest(true);
      // Left half — P1
      this.renderer.setViewport(0, 0, w / 2, h);
      this.renderer.setScissor(0, 0, w / 2, h);
      this.renderer.render(this.scene, this.camera);
      // Right half — P2
      this.renderer.setViewport(w / 2, 0, w / 2, h);
      this.renderer.setScissor(w / 2, 0, w / 2, h);
      this.renderer.render(this.scene, this.camera2);
      this.renderer.setScissorTest(false);
    } else if (this.guestView && this.camera2) {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera2);
    } else {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** True when running on localhost / LAN dev (tunnel may be needed for iOS). */
  _isLocalDev() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  }

  /** Prefer public HTTPS tunnel (iPhone sensors) in LAN dev. Cloud uses same origin. */
  async _resolvePhoneBaseUrl(lanIp) {
    if (!this._isLocalDev()) {
      return window.location.origin;
    }
    try {
      const res = await fetch('/tunnel.json?ts=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.url) return data.url.replace(/\/$/, '');
      }
    } catch (_) {}
    const host = window.location.hostname;
    const port = window.location.port || '3000';
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal && host) {
      return window.location.protocol + '//' + host + (port ? ':' + port : '');
    }
    if (lanIp) return 'http://' + lanIp + ':' + port;
    return window.location.origin;
  }

  _buildControllerUrl(room, serverUrl, lanIp) {
    const gameQs = 'game=' + GAME_ID + '&room=' + encodeURIComponent(room);
    if (serverUrl && !this._isLocalDev()) {
      const u = new URL(serverUrl, window.location.origin);
      u.searchParams.set('game', GAME_ID);
      u.searchParams.set('room', room);
      return u.toString();
    }
    const host = window.location.hostname;
    const port = window.location.port || '3000';
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal && host) {
      return window.location.protocol + '//' + host + (port ? ':' + port : '') + '/controller?' + gameQs;
    }
    if (lanIp) return 'http://' + lanIp + ':' + port + '/controller?' + gameQs;
    return serverUrl || window.location.origin + '/controller?' + gameQs;
  }

  _showPhoneUrl(url) {
    this.controllerUrl = url;
    this.el.controllerUrl.textContent = url;
    drawQr(this.el.qr, url, 'qr-p1');
    drawQr(this.el.qr, url, 'qr-p2');
  }

  async _applyPhoneUrl(room, lanIp, serverUrls) {
    if (!this._isLocalDev() && serverUrls?.controllerUrlHttps) {
      this._showPhoneUrl(serverUrls.controllerUrlHttps);
      this.el.lobbyStatus.textContent = 'Scan the QR code with your phone.';
      return;
    }

    const base = await this._resolvePhoneBaseUrl(lanIp);
    this._showPhoneUrl(
      base + '/controller?game=' + GAME_ID + '&room=' + encodeURIComponent(room)
    );
    this.el.lobbyStatus.textContent = 'Scan the QR code with your phone.';
  }

  _joinAsGuestScreen(code) {
    if (this._joining) return;
    this._joining = true;
    this.el.lobbyStatus.textContent = 'Joining the room…';
    this.socket.emit(
      'join',
      { role: 'screen', game: GAME_ID, room: code, guestScreen: true },
      async (res) => {
        this._joining = false;
        if (!res?.ok) {
          this.el.lobbyStatus.textContent = res?.error || 'Could not join room.';
          return;
        }
        this.room = res.room;
        this.isGuestScreen = true;
        this.controllers = res.controllers || this.controllers;
        this.el.roomCode.textContent = this.room;
        this.el.lobbyStatus.textContent =
          'Joined as Player 2 — scan the QR code below with your phone. Player 1 starts the match.';
        this.controllerUrl = this._buildControllerUrl(res.room, res.controllerUrlHttps || res.controllerUrl, res.lanIp);
        await this._applyPhoneUrl(this.room, res.lanIp, res);
        this._refreshLobby();
        this._updateSetupModeUi();
      }
    );
  }

  _joinAsScreen() {
    if (this._joining) return;
    this._joining = true;
    this.el.lobbyStatus.textContent = 'Setting up…';
    this.socket.emit('join', { role: 'screen', game: GAME_ID }, async (res) => {
      this._joining = false;
      if (!res || !res.ok) {
        this.el.lobbyStatus.textContent = (res && res.error) || 'Could not start a game. Please reload.';
        return;
      }
      this.room = res.room;
      this.controllers = res.controllers || { p1: false, p2: false };
      this.el.roomCode.textContent = this.room;
      this.controllerUrl = this._buildControllerUrl(res.room, res.controllerUrlHttps || res.controllerUrl, res.lanIp);
      try {
        await this._applyPhoneUrl(this.room, res.lanIp, res);
      } catch (err) {
        console.error(err);
        this._showPhoneUrl(this.controllerUrl);
      }
      this._refreshLobby();
      if (this._tunnelTimer) clearInterval(this._tunnelTimer);
      if (this._isLocalDev()) {
        this._tunnelTimer = setInterval(() => {
          if (!this.room) return;
          this._applyPhoneUrl(this.room, res.lanIp, res);
        }, 1500);
      }
    });
  }

  _bindSocket() {
    this.socket.on('connect', () => {
      this.el.lobbyStatus.textContent = this.room ? 'Reconnected.' : 'Setting up…';
      if (!this.room) {
        if (GUEST_SCREEN && JOIN_ROOM_PARAM) this._joinAsGuestScreen(JOIN_ROOM_PARAM);
        else this._joinAsScreen();
        return;
      }
      this.socket.emit(
        'join',
        {
          role: 'screen',
          game: GAME_ID,
          room: this.room,
          guestScreen: this.isGuestScreen,
        },
        (res) => {
          if (res?.ok) {
            this.controllers = res.controllers;
            this._refreshLobby();
          }
        }
      );
    });

    this.socket.on('connect_error', () => {
      this.el.lobbyStatus.textContent = 'Connection problem — check your internet and reload.';
    });

    this.socket.on('disconnect', () => {
      this.el.lobbyStatus.textContent = 'Connection lost — reconnecting…';
    });

    this.socket.on('roomState', (state) => {
      this.controllers = state;
      this._syncNamesFromControllers(state);
      this._refreshLobby();
    });

    this.socket.on('controllerJoined', (data) => {
      this.controllers = data.controllers;
      this._syncNamesFromControllers(data.controllers);
      this.el.lobbyStatus.textContent = `Player ${data.slot} joined — tap Ready on the phone.`;
      this._refreshLobby();
    });

    this.socket.on('playerReady', (data) => {
      if (data.controllers) {
        this.controllers = data.controllers;
        this._syncNamesFromControllers(data.controllers);
      }
      this.el.lobbyStatus.textContent = data.ready
        ? `Player ${data.slot} is ready.`
        : `Player ${data.slot} is not ready.`;
      this._refreshLobby();
    });

    this.socket.on('playerName', (data) => {
      if (data.controllers) {
        this.controllers = data.controllers;
        this._syncNamesFromControllers(data.controllers);
      } else if (data.slot && data.name) {
        if (data.slot === 1) this.playerNames.p1 = data.name;
        if (data.slot === 2) this.playerNames.p2 = data.name;
        this._applyNamesToHud();
      }
      this._refreshLobby();
    });

    this.socket.on('startDenied', (data) => {
      this.el.lobbyStatus.textContent = data?.error || 'Cannot start yet.';
    });

    this.socket.on('controllerLeft', (data) => {
      this.controllers = data.controllers;
      this._syncNamesFromControllers(data.controllers);
      this.el.lobbyStatus.textContent = `Player ${data.slot} left.`;
      this._refreshLobby();
      if (this.running && data.slot === 1) {
        this._showMessage('Player 1 left — back to the lobby');
        setTimeout(() => this._returnToLobby(), 1200);
      }
    });

    this.socket.on('tilt', (data) => {
      const slot = data.slot;
      if (!this.inputs[slot]) return;
      // x: -1..1 from phone
      this.inputs[slot].x = clamp(Number(data.x) || 0, -1, 1);
    });

    this.socket.on('swing', (data) => {
      const slot = data.slot;
      if (!this.inputs[slot] || (this.isGuestScreen && !this.running)) return;
      const raw =
        data.side === 'left' || data.side === 'right' ? data.side : null;
      if (!raw) return;
      const side = phoneToLogicSide(raw);
      this.inputs[slot].pendingSwing = true;
      const netLag = data.ts ? Math.max(0, Math.min(400, Date.now() - data.ts)) : 0;
      this.inputs[slot].swingAt = performance.now() - netLag;
      this.inputs[slot].intensity = clamp(Number(data.intensity) || 0.55, 0.1, 1);
      this.inputs[slot].aim = clamp(Number(data.aim) || 0, -1, 1);
      const pl = Math.round(Number(data.powerLevel) || 0);
      this.inputs[slot].powerLevel =
        pl >= 1 && pl <= 5 ? pl : powerLevelFromIntensity(this.inputs[slot].intensity);
      this.inputs[slot].side = side;
      this.inputs[slot].phoneSide = raw;
      if (this.running && !this.isGuestScreen) {
        this._tryHit(slot);
      }
    });

    this.socket.on('gameSync', (payload) => {
      if (!this.isGuestScreen || !payload) return;
      this._applyGameSync(payload);
    });

    this.socket.on('gameStarted', (data) => {
      if (!this.isGuestScreen) return;
      this.mode = data?.mode === 'local' ? 'local' : 'ai';
      this.running = true;
      this.el.lobby.classList.add('hidden');
      this.el.hud.classList.remove('hidden');
      this._setSplitScreen(false);
      this._setGuestCamera();
      if (data?.controllers) this.controllers = data.controllers;
      this._syncNamesFromControllers(this.controllers);
      this._applyNamesToHud();
      this._updateScoreHud();
      this._showMessage('Match started — good luck!');
      this.crowd.unlock();
      this.crowd.startAmbience();
    });

    this.socket.on('calibrate', (data) => {
      if (this.inputs[data.slot]) this.inputs[data.slot].x = 0;
      this._showMessage(`P${data.slot} calibrated`);
    });
  }

  _bindUi() {
    this.el.btnAi.addEventListener('click', () => this._startGame('ai'));
    this.el.btnLocal.addEventListener('click', () => this._startGame('local'));
    this.el.btnBack.addEventListener('click', () => this._returnToLobby());
    this.el.btnVictoryLobby?.addEventListener('click', () => this._returnToLobby());
    this.el.formatPills?.addEventListener('click', (e) => {
      const btn = e.target.closest('.format-btn');
      if (!btn) return;
      const bestOf = Number(btn.dataset.format) || 3;
      const setsToWin = Number(btn.dataset.setsToWin) || 2;
      this.matchFormat = { bestOf, setsToWin };
      this.el.formatPills.querySelectorAll('.format-btn').forEach((el) => {
        el.classList.toggle('format-active', el === btn);
      });
    });
    this.el.btnCopyRoom?.addEventListener('click', async () => {
      if (!this.room) return;
      try {
        await navigator.clipboard.writeText(this.room);
        this.el.lobbyStatus.textContent = `Room code ${this.room} copied.`;
      } catch {
        this.el.lobbyStatus.textContent = `Room code: ${this.room}`;
      }
    });
    this.el.setupModePills?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-setup]');
      if (!btn || this.isGuestScreen) return;
      this._setSetupMode(btn.dataset.setup);
    });
    this.el.btnJoinRoom?.addEventListener('click', () => {
      const code = (this.el.joinRoomInput?.value || '').trim().toUpperCase();
      if (code.length !== 4) {
        this.el.lobbyStatus.textContent = 'Room codes are 4 characters.';
        return;
      }
      const url = `${location.origin}/games/tennis?guest=1&room=${encodeURIComponent(code)}`;
      window.location.href = url;
    });
    this.el.btnCrowdMute?.addEventListener('click', () => {
      this.crowdMuted = this.crowd.toggleMuted();
      localStorage.setItem('psg-crowd-muted', this.crowdMuted ? '1' : '0');
      this._updateCrowdMuteButton();
    });
    this._updateCrowdMuteButton();
  }

  _updateCrowdMuteButton() {
    const btn = this.el.btnCrowdMute;
    if (!btn) return;
    btn.textContent = this.crowdMuted ? '🔇 Crowd' : '🔊 Crowd';
    btn.setAttribute('aria-pressed', this.crowdMuted ? 'true' : 'false');
    btn.classList.toggle('crowd-muted', this.crowdMuted);
  }

  _syncNamesFromControllers(c = this.controllers) {
    if (!c) return;
    if (c.name1) this.playerNames.p1 = c.name1;
    if (c.name2) this.playerNames.p2 = c.name2;
    if (this.mode === 'ai') this.playerNames.p2 = 'AI';
    this._applyNamesToHud();
  }

  _applyNamesToHud() {
    if (this.el.nameP1) this.el.nameP1.textContent = this.playerNames.p1 || 'P1';
    if (this.el.nameP2) {
      this.el.nameP2.textContent =
        this.mode === 'ai' ? 'AI' : this.playerNames.p2 || 'P2';
    }
    if (this.el.splitLabelP1) this.el.splitLabelP1.textContent = this.playerNames.p1 || 'P1';
    if (this.el.splitLabelP2) {
      this.el.splitLabelP2.textContent =
        this.mode === 'ai' ? 'AI' : this.playerNames.p2 || 'P2';
    }
  }

  _displayName(slot) {
    if (slot === 2 && this.mode === 'ai') return 'AI';
    return slot === 1 ? this.playerNames.p1 || 'P1' : this.playerNames.p2 || 'P2';
  }

  /** Keyboard drives P1 when alone, or P2 when a phone is already P1 (local 2P). */
  _keyboardSlot() {
    if (!this.controllers.p1) return 1;
    if (this.mode === 'local' && !this.controllers.p2) return 2;
    return null;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!this.running) return;
      const slot = this._keyboardSlot();
      if (!slot) return;
      let side = null;
      if (e.code === 'Space') side = 'center';
      else if (e.code === 'KeyQ' || e.code === 'ArrowLeft') side = 'left';
      else if (e.code === 'KeyE' || e.code === 'ArrowRight') side = 'right';
      // Overhead disabled for now
      if (!side) return;
      e.preventDefault();
      this.inputs[slot].pendingSwing = true;
      this.inputs[slot].swingAt = performance.now();
      this.inputs[slot].intensity = 0.75;
      this.inputs[slot].aim = 0;
      this.inputs[slot].side = side;
      this.inputs[slot].phoneSide = side === 'left' || side === 'right' ? side : null;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  _refreshLobby() {
    const c = this.controllers || {};
    this.el.dotP1.classList.toggle('on', !!c.p1);
    this.el.dotP2.classList.toggle('on', !!c.p2);
    if (this.el.readyP1) {
      this.el.readyP1.textContent = !c.p1 ? '—' : c.ready1 ? 'Ready' : '…';
      this.el.readyP1.className = c.ready1 ? 'text-emerald-400' : 'text-slate-500';
    }
    if (this.el.readyP2) {
      this.el.readyP2.textContent = !c.p2 ? '—' : c.ready2 ? 'Ready' : '…';
      this.el.readyP2.className = c.ready2 ? 'text-emerald-400' : 'text-slate-500';
    }
    const hostControls = !this.isGuestScreen;
    if (this.el.btnAi) this.el.btnAi.disabled = !hostControls || !(c.p1 && c.ready1);
    if (this.el.btnLocal) {
      this.el.btnLocal.disabled =
        !hostControls || !(c.p1 && c.ready1 && ((c.p2 && c.ready2) || !c.p2));
    }
  }

  /**
   * One screen: both QR codes, no room code.
   * Two computers: room code + only this screen's own QR (P1 for host, P2 for guest).
   */
  _updateSetupModeUi() {
    const remote = this.setupMode === 'remote';
    this.el.setupModePills?.querySelectorAll('[data-setup]').forEach((btn) => {
      btn.classList.toggle('format-active', (btn.dataset.setup === 'remote') === remote);
    });
    this.el.couchPanel?.classList.toggle('hidden', remote);
    this.el.remoteGuestPanel?.classList.toggle('hidden', !remote || this.isGuestScreen);
    this.el.roomCodePill?.classList.toggle('hidden', !remote);
    this.el.qrBlockP1?.classList.toggle('hidden', remote && this.isGuestScreen);
    this.el.qrBlockP2?.classList.toggle('hidden', remote && !this.isGuestScreen);
    this.el.setupModePills?.classList.toggle('hidden', this.isGuestScreen);
  }

  _setSetupMode(mode) {
    this.setupMode = mode === 'remote' ? 'remote' : 'couch';
    this._updateSetupModeUi();
    if (this.setupMode === 'remote') {
      this.el.lobbyStatus.textContent = this.room
        ? `Your room code is ${this.room} — give it to the other player, then scan the QR with your phone.`
        : 'Share your room code with the other player.';
    } else {
      this.el.lobbyStatus.textContent = 'Scan the QR codes — one phone per player.';
    }
  }

  _startGame(mode) {
    if (!this.controllers.p1 || !this.controllers.ready1) {
      this.el.lobbyStatus.textContent = 'Player 1 needs to tap Ready on the phone first.';
      return;
    }
    if (mode === 'local' && this.controllers.p2 && !this.controllers.ready2) {
      this.el.lobbyStatus.textContent = 'Player 2 needs to tap Ready on the phone first.';
      return;
    }
    if (!this._ensureGraphics()) {
      this.el.message.textContent = 'Could not load the 3D court — please reload the page.';
      return;
    }
    this.mode = mode;
    this.running = true;
    this.match = this._freshMatch();
    this.servingSide = 1;
    this.el.lobby.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    const fmt = this._formatLabel();
    this.el.matchLabel.textContent =
      mode === 'ai' ? `${fmt} · vs AI` : `${fmt} · 2 Players`;
    this._syncNamesFromControllers(this.controllers);
    if (mode === 'ai') this.playerNames.p2 = 'AI';
    this._applyNamesToHud();
    this._hideVictory();
    this._setSplitScreen(mode === 'local' && this.setupMode === 'couch');
    this._updateScoreHud();
    this.socket.emit('startGame', {
      mode,
      bestOf: this.matchFormat.bestOf,
      setsToWin: this.matchFormat.setsToWin,
    });
    this._onResize();
    this._serve();
    this._showMessage(
      mode === 'ai'
        ? `${fmt} — you are the blue player`
        : `${fmt} — good luck!`
    );
    this._pushHud();
    this.crowd.unlock();
    this.crowd.startAmbience();
  }

  _returnToLobby() {
    this.running = false;
    this.mode = null;
    this.ball.inPlay = false;
    this.ball.alive = false;
    this.crowd.stopAmbience();
    this._hideVictory();
    this._setSplitScreen(false);
    this.el.hud.classList.add('hidden');
    this.el.lobby.classList.remove('hidden');
    this.el.lobbyStatus.textContent = 'Back in the lobby — tap Ready on the phones to play again.';
    this._refreshLobby();
  }

  _pointLabel(side) {
    const m = this.match;
    if (m.tiebreak) {
      return String(side === 1 ? m.tbPoints.p1 : m.tbPoints.p2);
    }
    const mine = side === 1 ? m.points.p1 : m.points.p2;
    const theirs = side === 1 ? m.points.p2 : m.points.p1;
    if (mine >= 3 && theirs >= 3) {
      if (m.advantage === side) return 'AD';
      return '40';
    }
    return ['0', '15', '30', '40'][Math.min(mine, 3)];
  }

  _scorePayload() {
    const m = this.match;
    return {
      sets: { ...m.sets },
      games: { ...m.games },
      pointsP1: this._pointLabel(1),
      pointsP2: this._pointLabel(2),
      advantage: m.advantage,
      tiebreak: m.tiebreak,
      tbPoints: { ...m.tbPoints },
      servingSide: this.servingSide,
      matchOver: m.matchOver,
      display: `${m.sets.p1}-${m.sets.p2} | ${m.games.p1}-${m.games.p2} | ${this._pointLabel(1)}-${this._pointLabel(2)}`,
      bestOf: m.bestOf,
      setsToWin: m.setsToWin,
    };
  }

  _updateScoreHud() {
    const m = this.match;
    if (this.el.setsP1) this.el.setsP1.textContent = String(m.sets.p1);
    if (this.el.setsP2) this.el.setsP2.textContent = String(m.sets.p2);
    if (this.el.gamesP1) this.el.gamesP1.textContent = String(m.games.p1);
    if (this.el.gamesP2) this.el.gamesP2.textContent = String(m.games.p2);
    if (this.el.pointsP1) this.el.pointsP1.textContent = this._pointLabel(1);
    if (this.el.pointsP2) this.el.pointsP2.textContent = this._pointLabel(2);
    this.el.serveP1?.classList.toggle('on', this.servingSide === 1);
    this.el.serveP2?.classList.toggle('on', this.servingSide === 2);
    this.el.nameP1?.classList.toggle('serving', this.servingSide === 1);
    this.el.nameP2?.classList.toggle('serving', this.servingSide === 2);
    const payload = this._scorePayload();
    this.socket.emit('scoreUpdate', payload);
  }

  _pushHud(extra = {}) {
    const payload = {
      ...this._scorePayload(),
      p1: this.match.sets.p1,
      p2: this.match.sets.p2,
      message: this.el.message.textContent,
      ...extra,
    };
    this.socket.emit('hud', payload);
  }

  _showMessage(text, duration = 1.8) {
    this.el.message.textContent = text;
    this.messageTimer = duration;
    this._pushHud({ message: text });
  }

  _haptic(slot, pattern, reason, powerLevel = 3) {
    this.socket.emit('haptic', {
      slot,
      pattern,
      reason,
      powerLevel: clamp(Number(powerLevel) || 3, 1, 5),
    });
  }

  _serve() {
    const side = this.servingSide;
    const z = side === 1 ? -COURT.halfLength + 2.5 : COURT.halfLength - 2.5;
    const dir = side === 1 ? 1 : -1;
    // High lob serve so the ball reliably clears the net and reaches the far side
    this.ball.pos.set((Math.random() - 0.5) * 5.5, 1.6, z);
    this.ball.vel.set((Math.random() - 0.5) * 6.5, 6.5, dir * 11.5);
    this.ball.alive = true;
    this.ball.inPlay = true;
    this.bouncesThisSide = 0;
    this.lastHitter = 0;
    this.ai.reactedThisApproach = false;
    this._showMessage(side === 1 ? 'Serve — your side (blue)' : 'Serve — far side', 1.2);
  }

  _awardPoint(winner) {
    if (!this.running || this.match.matchOver) return;
    this.ball.inPlay = false;
    this.ball.alive = false;

    if (winner === 1) {
      this._haptic(1, [30, 40, 30], 'point');
      this._haptic(2, [80], 'miss');
    } else {
      this._haptic(2, [30, 40, 30], 'point');
      this._haptic(1, [80], 'miss');
    }

    const prevMatchOver = this.match.matchOver;
    if (this.match.tiebreak) this._awardTiebreakPoint(winner);
    else this._awardGamePoint(winner);

    this._updateScoreHud();
    this._pushHud();

    if (this.match.matchOver && !prevMatchOver) {
      const w = this.match.sets.p1 >= this.match.setsToWin ? 1 : 2;
      this._showVictory(w);
      return;
    }

    setTimeout(() => {
      if (this.running && !this.match.matchOver) this._serve();
    }, 1200);
  }

  _awardGamePoint(winner) {
    const wKey = winner === 1 ? 'p1' : 'p2';
    const lKey = winner === 1 ? 'p2' : 'p1';
    const pw = this.match.points[wKey];
    const pl = this.match.points[lKey];

    if (pw >= 3 && pl >= 3) {
      if (this.match.advantage === winner) {
        this._winGame(winner);
        return;
      }
      if (this.match.advantage && this.match.advantage !== winner) {
        this.match.advantage = 0;
        this._showMessage('Deuce', 1.1);
        this.crowd.playDeuce();
        return;
      }
      this.match.advantage = winner;
      this._showMessage(winner === 1 ? 'Advantage P1' : 'Advantage P2', 1.1);
      return;
    }

    this.match.points[wKey] = pw + 1;
    if (this.match.points[wKey] >= 4 && this.match.points[lKey] < 3) {
      this._winGame(winner);
      return;
    }
    if (this.match.points.p1 >= 3 && this.match.points.p2 >= 3) {
      this.match.advantage = 0;
      this._showMessage('Deuce', 1.1);
      this.crowd.playDeuce();
      return;
    }
    this._showMessage(
      `${this._pointLabel(1)}–${this._pointLabel(2)}`,
      1.0
    );
    this.crowd.playPoint(winner, 'point');
    this._triggerCrowdCheer(0.42);
  }

  _awardTiebreakPoint(winner) {
    const wKey = winner === 1 ? 'p1' : 'p2';
    const lKey = winner === 1 ? 'p2' : 'p1';
    this.match.tbPoints[wKey] += 1;
    const tw = this.match.tbPoints[wKey];
    const tl = this.match.tbPoints[lKey];
    this._showMessage(`TB ${this.match.tbPoints.p1}–${this.match.tbPoints.p2}`, 1.0);
    if (tw >= 7 && tw - tl >= 2) {
      this.match.games[wKey] += 1;
      this._winSet(winner);
    } else {
      this.crowd.playPoint(winner, 'point');
      this._triggerCrowdCheer(0.38);
    }
  }

  _winGame(winner) {
    const wKey = winner === 1 ? 'p1' : 'p2';
    const lKey = winner === 1 ? 'p2' : 'p1';
    this.match.points = { p1: 0, p2: 0 };
    this.match.advantage = 0;
    this.match.games[wKey] += 1;
    this.servingSide = this.servingSide === 1 ? 2 : 1;

    const gw = this.match.games[wKey];
    const gl = this.match.games[lKey];
    this._showMessage(`Game P${winner} · ${this.match.games.p1}–${this.match.games.p2}`, 1.4);
    this.crowd.playPoint(winner, 'game');
    this._triggerCrowdCheer(0.65);

    if (gw >= 6 && gw - gl >= 2) {
      this._winSet(winner);
    } else if (gw === 6 && gl === 6) {
      this.match.tiebreak = true;
      this.match.tbPoints = { p1: 0, p2: 0 };
      this._showMessage('Tiebreak!', 1.6);
    }
  }

  _winSet(winner) {
    const wKey = winner === 1 ? 'p1' : 'p2';
    this.match.sets[wKey] += 1;
    this.match.games = { p1: 0, p2: 0 };
    this.match.points = { p1: 0, p2: 0 };
    this.match.advantage = 0;
    this.match.tiebreak = false;
    this.match.tbPoints = { p1: 0, p2: 0 };

    if (this.match.sets[wKey] >= this.match.setsToWin) {
      this.match.matchOver = true;
    } else {
      this._showMessage(
        `Set ${this._displayName(winner)}! Sets ${this.match.sets.p1}–${this.match.sets.p2}`,
        2
      );
      this.crowd.playPoint(winner, 'set');
      this._triggerCrowdCheer(0.85);
    }
  }

  _hideVictory() {
    this._stopFireworks();
    this.el.victoryOverlay?.classList.add('hidden');
    if (this.el.victoryTitle) {
      this.el.victoryTitle.classList.remove('win-p1', 'win-p2');
    }
  }

  _showVictory(winner) {
    const name = this._displayName(winner);
    const score = `${this.match.sets.p1}–${this.match.sets.p2}`;
    this._showMessage(`${name} wins the match!`, 8);
    if (this.el.victoryTitle) {
      this.el.victoryTitle.textContent = name;
      this.el.victoryTitle.classList.remove('win-p1', 'win-p2');
      this.el.victoryTitle.classList.add(winner === 1 ? 'win-p1' : 'win-p2');
    }
    if (this.el.victorySub) {
      this.el.victorySub.textContent = `Wins the match · Sets ${score}`;
    }
    this.el.victoryOverlay?.classList.remove('hidden');
    this._startFireworks(winner);
    this.crowd.playPoint(winner, 'match');
    this._triggerCrowdCheer(1);
    this._pushHud({ message: `${name} wins!`, matchOver: true });
  }

  _startFireworks(winner) {
    this._stopFireworks();
    const canvas = this.el.fireworksCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const colors =
      winner === 1
        ? ['#38bdf8', '#7dd3fc', '#fbbf24', '#ffffff', '#a5f3fc']
        : ['#ef4444', '#fb7185', '#fbbf24', '#ffffff', '#fdba74'];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const bursts = [];
    const spawnBurst = () => {
      const cx = canvas.width * (0.2 + Math.random() * 0.6);
      const cy = canvas.height * (0.15 + Math.random() * 0.35);
      const count = 36 + Math.floor(Math.random() * 24);
      for (let i = 0; i < count; i += 1) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 2.2 + Math.random() * 4.5;
        bursts.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 1,
          decay: 0.012 + Math.random() * 0.014,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 1.6 + Math.random() * 2.4,
        });
      }
    };

    spawnBurst();
    let spawnAcc = 0;
    let raf = 0;
    const tick = () => {
      spawnAcc += 1;
      if (spawnAcc % 28 === 0) spawnBurst();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = bursts.length - 1; i >= 0; i -= 1) {
        const p = bursts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;
        p.vx *= 0.99;
        p.life -= p.decay;
        if (p.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    this._fireworks = {
      onResize: resize,
      stop: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
    };
    window.addEventListener('resize', resize);
  }

  _stopFireworks() {
    if (this._fireworks?.stop) this._fireworks.stop();
    this._fireworks = null;
  }

  _autoTrackTargetX(slot) {
    const maxX = COURT.halfWidth + HIT.runOverhang;
    if (!this.ball.inPlay || !this.ball.alive) return 0;
    const bx = this.ballMesh ? this.ballMesh.position.x : this.ball.pos.x;
    const vx = this.ball.vel.x;
    return clamp(bx + vx * 0.5, -maxX, maxX);
  }

  _racketHasHitAnim(player) {
    return !!(this.hitAnims && this.hitAnims.some((a) => a.player === player));
  }

  _updateRackets(dt) {
    if (!this.racket1 || !this.racket2) return;

    const maxX = COURT.halfWidth + HIT.runOverhang;
    const follow = 1 - Math.exp(-16 * Math.max(dt, 0.001));

    // BLUE P1: always glue toward the ball's X while the rally is live
    if (this.ball.inPlay && this.ball.alive) {
      const target = this._autoTrackTargetX(1);
      this.racket1.position.x += (target - this.racket1.position.x) * follow;
    } else {
      this.racket1.position.x += (0 - this.racket1.position.x) * (1 - Math.exp(-3 * dt));
    }
    this.racket1.position.x = clamp(this.racket1.position.x, -maxX, maxX);

    if (this.p1Marker) {
      this.p1Marker.position.x = this.racket1.position.x;
      this.p1Marker.position.z = this.racket1.position.z;
    }

    if (this.mode === 'ai') {
      this._updateAi(dt);
      // AI racket snaps to target (already updated in _updateAi)
      this.racket2.position.x = clamp(this.ai.x, -maxX, maxX);
    } else if (this.ball.inPlay && this.ball.alive) {
      const target2 = this._autoTrackTargetX(2);
      this.racket2.position.x += (target2 - this.racket2.position.x) * follow;
      this.racket2.position.x = clamp(this.racket2.position.x, -maxX, maxX);
    } else {
      this.racket2.position.x += (0 - this.racket2.position.x) * (1 - Math.exp(-3 * dt));
      this.racket2.position.x = clamp(this.racket2.position.x, -maxX, maxX);
    }

    if (!this._racketHasHitAnim(this.racket1)) {
      this.racket1.rotation.z = 0;
    }
    if (!this._racketHasHitAnim(this.racket2)) {
      this.racket2.rotation.z = 0;
    }

    this._updatePlayerLocomotion(this.racket1, dt);
    this._updatePlayerLocomotion(this.racket2, dt);
    this._updateHitAnims(dt);
  }

  _playHitAnimation(slot, displaySide, quality) {
    const player = slot === 1 ? this.racket1 : this.racket2;
    const parts = this._playerParts(player);
    if (!player || !parts || !this.ballMesh) return;

    const animSign = this._animSign(slot, displaySide);
    const fromRight = displaySide === 'right';
    const fromLeft = displaySide === 'left';
    const color = fromRight ? 0x38bdf8 : fromLeft ? 0xf97316 : 0xe2e8f0;
    const bp = this.ballMesh.position.clone();

    const slash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 2.4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    slash.position.set(bp.x - animSign * 1.1, bp.y + 0.35, bp.z);
    slash.lookAt(bp.x + animSign * 0.45, bp.y + 0.15, bp.z);
    slash.rotateZ(fromRight ? 0.9 * animSign : fromLeft ? -0.9 * animSign : 0);
    this.scene.add(slash);

    const trail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 1.6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    trail.position.copy(slash.position);
    trail.position.y -= 0.08;
    trail.rotation.copy(slash.rotation);
    trail.rotation.z -= 0.35 * animSign;
    this.scene.add(trail);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.42, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.position.copy(bp);
    ring.lookAt(this.camera.position);
    this.scene.add(ring);

    const sparks = [];
    for (let i = 0; i < 6; i += 1) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
      );
      spark.position.copy(bp);
      spark.userData.vel = new THREE.Vector3(
        animSign * (0.8 + Math.random()),
        0.4 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.6
      );
      this.scene.add(spark);
      sparks.push(spark);
    }

    if (!this.hitAnims) this.hitAnims = [];
    this.hitAnims.push({
      player,
      parts,
      slash,
      trail,
      ring,
      sparks,
      displaySide,
      animSign,
      slot,
      t: 0,
      duration: 0.72,
      quality: quality || 0.7,
      startBall: bp,
      startRootZ: player.position.z,
      startRootY: parts.root.position.y,
    });
  }

  _updateHitAnims(dt) {
    if (!this.hitAnims || !this.hitAnims.length) return;
    const keep = [];
    for (const anim of this.hitAnims) {
      anim.t += dt;
      const u = Math.min(1, anim.t / anim.duration);
      const prep = clamp(u / 0.22, 0, 1);
      const prepEase = 1 - Math.pow(1 - prep, 2);
      const contactU = clamp((u - 0.18) / 0.16, 0, 1);
      const contact = contactU * contactU * (3 - 2 * contactU);
      const follow = clamp((u - 0.34) / 0.66, 0, 1);
      const followEase = 1 - Math.pow(1 - follow, 2);
      const easeOut = 1 - Math.pow(1 - u, 3);

      const sign = anim.animSign;
      const coil = prepEase * (1 - contact * 0.35);
      const strike = contact * (1 - follow * 0.45);
      const shoulderWind = sign * (0.35 * coil + 1.05 * strike);
      const elbowWind = sign * (0.25 * coil + 1.35 * strike);

      anim.parts.hips.rotation.x = 0.06 + prepEase * 0.1 + strike * 0.22;
      anim.parts.hips.rotation.y = shoulderWind * 0.42;
      anim.parts.torso.rotation.y = shoulderWind * 0.72;
      anim.parts.torso.rotation.z = -shoulderWind * 0.32;
      anim.parts.torso.rotation.x = -strike * 0.18;

      anim.parts.armHit.shoulder.rotation.x = -0.12 - coil * 0.75 - strike * 1.15;
      anim.parts.armHit.shoulder.rotation.y = -shoulderWind * 0.95;
      anim.parts.armHit.shoulder.rotation.z =
        -0.35 * anim.parts.facing - coil * 0.35 * anim.parts.facing - strike * 0.55 * anim.parts.facing;
      anim.parts.armHit.elbow.rotation.x = -0.35 - coil * 0.45 - elbowWind * 1.2;
      anim.parts.armHit.elbow.rotation.y = -strike * 0.35 * anim.parts.facing;
      if (anim.parts.racket) {
        anim.parts.racket.rotation.x = 0.12 + coil * 0.25 + strike * 0.65;
        anim.parts.racket.rotation.z = -elbowWind * 0.42 - followEase * 0.2;
        anim.parts.racket.rotation.y = strike * 0.18 * anim.parts.facing;
      }

      anim.parts.armOff.shoulder.rotation.x = coil * 0.35 + strike * 0.55;
      anim.parts.armOff.shoulder.rotation.z = sign * -0.15 * strike;
      anim.parts.armOff.elbow.rotation.x = -0.2 - coil * 0.25 - strike * 0.35;
      anim.parts.legL.hip.rotation.x = coil * 0.15 * -sign + strike * 0.35 * -sign;
      anim.parts.legR.hip.rotation.x = coil * 0.2 * sign + strike * 0.55 * sign;
      anim.parts.legL.knee.rotation.x = strike * 0.45;
      anim.parts.legR.knee.rotation.x = strike * 0.65;

      const lunge = strike * 0.55 * anim.parts.facing;
      anim.player.position.z = anim.startRootZ + lunge;
      anim.parts.root.position.y = anim.startRootY - prepEase * 0.06 + strike * 0.02;

      if (anim.slash) {
        anim.slash.position.x = anim.startBall.x + anim.animSign * (-1.25 + easeOut * 2.5);
        anim.slash.position.y = anim.startBall.y + 0.38 - easeOut * 0.2;
        anim.slash.material.opacity = 0.92 * (1 - u);
        anim.slash.scale.set(1 + easeOut * 0.5, 1 + easeOut * 1.0, 1);
      }
      if (anim.trail) {
        anim.trail.position.copy(anim.slash.position);
        anim.trail.material.opacity = 0.55 * (1 - u * 0.95);
        anim.trail.scale.set(1 + easeOut * 0.3, 1 + easeOut * 0.55, 1);
      }
      if (anim.ring) {
        anim.ring.scale.setScalar(1 + easeOut * 3.0 * anim.quality);
        anim.ring.material.opacity = 0.9 * (1 - u);
      }
      for (const spark of anim.sparks || []) {
        spark.position.addScaledVector(spark.userData.vel, dt * (1 - u * 0.85));
        spark.userData.vel.y -= 2.8 * dt;
        spark.material.opacity = 0.85 * (1 - u);
        spark.scale.setScalar(1 - u * 0.65);
      }

      if (u >= 1) {
        for (const key of ['slash', 'trail', 'ring']) {
          const mesh = anim[key];
          if (!mesh) continue;
          mesh.geometry.dispose();
          mesh.material.dispose();
          this.scene.remove(mesh);
        }
        for (const spark of anim.sparks || []) {
          spark.geometry.dispose();
          spark.material.dispose();
          this.scene.remove(spark);
        }
        anim.player.position.z = anim.startRootZ;
        anim.parts.root.position.y = anim.startRootY;
        anim.parts.torso.rotation.set(0, 0, 0);
        anim.parts.torso.rotation.x = 0;
        anim.parts.hips.rotation.x = 0.04;
        anim.parts.hips.rotation.y = 0;
      } else {
        keep.push(anim);
      }
    }
    this.hitAnims = keep;
  }

  _updateAi(dt) {
    const maxX = COURT.halfWidth + HIT.runOverhang;
    if (!this.ball.inPlay || !this.ball.alive) {
      this.ai.x += (0 - this.ai.x) * (1 - Math.exp(-5 * dt));
      this.ai.reactedThisApproach = false;
      return;
    }

    const p = this.ball.pos;
    const v = this.ball.vel;
    const hitZ = COURT.halfLength - 1.4;
    const comingToAi = v.z > 0.05;

    if (!comingToAi && p.z < 1) {
      this.ai.reactedThisApproach = false;
    }

    // Lock onto predicted intercept — no positioning error
    let target = p.x;
    if (comingToAi && Math.abs(v.z) > 0.05) {
      const tHit = (hitZ - p.z) / v.z;
      if (tHit > 0 && tHit < 4) target = p.x + v.x * Math.min(tHit, 1.2);
      else target = p.x + v.x * 0.5;
    }
    target = clamp(target, -maxX, maxX);

    const follow = 1 - Math.exp(-22 * Math.max(dt, 0.001));
    this.ai.x += (target - this.ai.x) * follow;
    if (this.racket2) this.racket2.position.x = this.ai.x;

    // Very generous hit window — return almost anything that reaches AI half
    const inReach =
      comingToAi &&
      p.z > COURT.halfLength - HIT.zoneDepth - 3.5 &&
      p.z < COURT.halfLength + 1.0 &&
      p.y > 0.02 &&
      p.y < HIT.zoneHeight + 1.4;

    if (inReach && !this.ai.reactedThisApproach) {
      this.ai.reactedThisApproach = true;
      this.ai.x = clamp(p.x, -maxX, maxX);
      if (this.racket2) this.racket2.position.x = this.ai.x;
      // Return chance drops as the incoming human shot gets harder (levels 1..5)
      const lvl = clamp(this.lastHumanPowerLevel || 1, 1, 5);
      const chance = HIT.aiReturnChance[lvl - 1] ?? 0.9;
      if (Math.random() < chance) {
        this._aiForceReturn();
      }
    }
  }

  /** Guaranteed AI reply — variable power, clears net, lands inside human half. */
  _aiForceReturn() {
    const p = this.ball.pos;
    const needed = this._neededSwingSide(2);
    const side = needed || (p.x >= 0 ? 'left' : 'right');

    // Weighted random power 1..5 (favor mid, still use soft/hard often enough)
    const roll = Math.random();
    let powerLevel = 3;
    if (roll < 0.14) powerLevel = 1;
    else if (roll < 0.34) powerLevel = 2;
    else if (roll < 0.58) powerLevel = 3;
    else if (roll < 0.8) powerLevel = 4;
    else powerLevel = 5;

    const speed = HIT.powerSpeeds[powerLevel - 1];
    const up = HIT.powerUp + 0.35;
    const startX = clamp(p.x, -COURT.halfWidth + 0.4, COURT.halfWidth - 0.4);
    const startZ = COURT.halfLength - 2.0;

    const landX = (Math.random() * 2 - 1) * (COURT.halfWidth - 1.4);
    const landZ = -COURT.halfLength + 3.2 + (powerLevel - 1) * 0.25;
    const flightT = (startZ - landZ) / speed;
    let aimX = (landX - startX) / Math.max(flightT, 0.85);
    aimX = clamp(aimX, -HIT.maxFairAimX, HIT.maxFairAimX);

    this.ball.pos.set(startX, Math.max(p.y, 1.3), startZ);
    this.ball.vel.set(aimX, up, -speed);
    this.bouncesThisSide = 0;
    this.lastHitter = 2;
    this._flashRacket(this.racket2);
    this.crowd.playHit(powerLevel);
    this._playHitAnimation(2, swingLabel(side), powerLevel / 5);
  }

  _showSwingBadge(side, mode = 'hit') {
    const el = this.el.swingBadge;
    if (!el) return;
    el.classList.remove('hidden', 'left', 'right', 'center', 'overhead', 'hint');
    if (side === 'left') {
      el.textContent = mode === 'hint' ? '← SWING LEFT' : 'LEFT SWING';
      el.classList.add('left');
    } else if (side === 'right') {
      el.textContent = mode === 'hint' ? 'SWING RIGHT →' : 'RIGHT SWING';
      el.classList.add('right');
    } else if (side === 'overhead') {
      el.textContent = mode === 'hint' ? '↑ OVERHEAD' : 'OVERHEAD SMASH';
      el.classList.add('overhead');
    } else {
      el.textContent = 'CENTER SWING';
      el.classList.add('center');
    }
    if (mode === 'hint') el.classList.add('hint');
    if (mode === 'hit') {
      clearTimeout(this._swingBadgeTimer);
      this._swingBadgeTimer = setTimeout(() => {
        el.classList.add('hidden');
      }, 900);
    }
  }

  _updateSwingHint() {
    if (!this.running || !this.ball.inPlay) return;
    const slot =
      this.ball.vel.z < -0.5 && this.ball.pos.z < 0
        ? 1
        : this.ball.vel.z > 0.5 && this.ball.pos.z > 0
          ? 2
          : null;
    if (!slot) return;
    const needed = this._neededSwingSide(slot);
    if (needed === 'right' || needed === 'left') {
      this._showSwingBadge(swingLabel(needed), 'hint');
    }
  }

  /**
   * Court side → required swing from that player's perspective.
   * P1 faces +Z: world +X = player's right. P2 faces −Z: world +X = player's left.
   */
  _neededSwingSide(slot) {
    const x = this.ball.pos.x;
    const t = HIT.sideThreshold;
    if (slot === 2) {
      if (x > t) return 'left';
      if (x < -t) return 'right';
      return null;
    }
    if (x > t) return 'right';
    if (x < -t) return 'left';
    return null;
  }

  _tryHit(slot) {
    const input = this.inputs[slot];
    if (!input.pendingSwing) return false;
    input.pendingSwing = false;

    // AI returns via _aiForceReturn — never through this path
    if (this.mode === 'ai' && slot === 2) return false;

    if (!this.ball.inPlay) return false;

    const racket = slot === 1 ? this.racket1 : this.racket2;
    const nearZ = slot === 1 ? -COURT.halfLength + 1.6 : COURT.halfLength - 1.6;
    const zoneMinZ = slot === 1 ? nearZ - 0.8 : nearZ - HIT.zoneDepth;
    const zoneMaxZ = slot === 1 ? nearZ + HIT.zoneDepth : nearZ + 0.8;

    const inDepth = this.ball.pos.z >= zoneMinZ && this.ball.pos.z <= zoneMaxZ;
    const approaching =
      slot === 1 ? this.ball.vel.z <= 2.5 : this.ball.vel.z >= -2.5;
    const dx = this.ball.pos.x - racket.position.x;
    const lateral = Math.abs(dx);
    const heightOk = this.ball.pos.y > 0.12 && this.ball.pos.y < HIT.zoneHeight;
    const fresh = performance.now() - input.swingAt < HIT.swingWindowMs;
    const maxLat = HIT.maxLateralMiss;

    const swingSide =
      input.side === 'left' || input.side === 'right' ? input.side : null;
    const shown = swingSide ? swingLabel(swingSide) : 'center';

    this._showSwingBadge(shown, 'hit');

    if (!(inDepth && approaching && heightOk && lateral < maxLat && fresh)) {
      this._showMessage('Too early / too far — swing when the ball is near you', 1.0);
      return false;
    }

    if (!swingSide) {
      this._showMessage('Need a LEFT or RIGHT swing', 0.9);
      return false;
    }

    // Ball on right side of board → must swing right; left side → must swing left
    const needed = this._neededSwingSide(slot);
    const wrongSide = !!(needed && swingSide !== needed);
    const needShown = needed ? swingLabel(needed) : null;

    // 5 discrete power levels — same loft, faster pace only
    const rawPower = clamp(Number(input.intensity) || 0.3, 0.1, 1);
    const powerLevel = clamp(
      Number(input.powerLevel) || powerLevelFromIntensity(rawPower),
      1,
      5
    );
    const power = powerLevel / 5;
    const contactQ = clamp(1 - lateral / maxLat, 0.2, 1);
    const quality = clamp(0.45 + 0.55 * contactQ, 0.35, 1);

    const dirZ = slot === 1 ? 1 : -1;
    const speed = HIT.powerSpeeds[powerLevel - 1];
    // Tier 1: ~90% clear net / ~10% clip. Tiers 2–5: always enough loft.
    let up = HIT.powerUp;
    if (powerLevel === 1) {
      if (Math.random() < 0.1) up = 4.95;
    } else {
      up = HIT.powerUp + 0.2;
    }

    const startX = clamp(this.ball.pos.x, -COURT.halfWidth + 0.35, COURT.halfWidth - 0.35);
    const startZ = nearZ + dirZ * 0.9;

    let aimX;
    let aimBias = 0;
    const rightSign = this._playerRightSign(slot);
    if (wrongSide) {
      const outSign = swingSide === 'right' ? rightSign : -rightSign;
      aimX = outSign * (COURT.halfWidth + 5 + rawPower * 5);
      this._showMessage(
        needShown === 'right'
          ? 'Wrong side! Need RIGHT — ball OUT'
          : 'Wrong side! Need LEFT — ball OUT',
        1.15
      );
      this._haptic(slot, [50, 30, 50], 'miss');
      this.crowd.playFault();
    } else {
      // aim: +1 = same side (down the line), −1 = cross-court (e.g. my right → opp. right)
      const margin = 1.3;
      const maxAbs = COURT.halfWidth - margin;
      aimBias = amplifyAimForCourt(clamp(Number(input.aim) || 0, -1, 1));
      const placementSide =
        input.phoneSide === 'left' || input.phoneSide === 'right'
          ? input.phoneSide
          : swingSide;
      const sameSign = placementSide === 'right' ? rightSign : -rightSign;
      let landX = sameSign * aimBias * maxAbs;
      landX += (Math.random() - 0.5) * 0.32;
      landX = clamp(landX, -maxAbs, maxAbs);
      // Slightly deeper on harder pace, still mid-court
      const landZ =
        dirZ * (COURT.halfLength - 5.4 + (powerLevel - 1) * 0.35 - Math.random() * 0.9);
      const flightT = Math.abs(landZ - startZ) / Math.max(speed, 1);
      aimX = (landX - startX) / Math.max(flightT, 0.85);
      aimX = clamp(aimX, -2.6, 2.6);
      const peakX = startX + aimX * flightT;
      if (Math.abs(peakX) > maxAbs) {
        aimX = ((Math.sign(peakX) || 1) * maxAbs - startX) / Math.max(flightT, 0.85);
        aimX = clamp(aimX, -2.6, 2.6);
      }
    }

    this.ball.vel.set(aimX, Math.max(5.0, up), dirZ * speed);
    this.ball.pos.x = startX;
    this.ball.pos.y = Math.max(this.ball.pos.y, 1.15);
    this.ball.pos.z = startZ;
    this.bouncesThisSide = 0;
    this.lastHitter = slot;
    if (!wrongSide) {
      this.lastHumanPowerLevel = powerLevel;
      this._haptic(slot, null, 'hit', powerLevel);
      this.crowd.playHit(powerLevel);
      this.ballSquash = { t: 0, dur: 0.14, amount: 0.12 + powerLevel * 0.02 };
    }
    this._flashRacket(racket);
    this._playHitAnimation(slot, shown, quality);

    if (!wrongSide) {
      const label = shown === 'right' ? 'RIGHT' : 'LEFT';
      const place = aimPlacementLabel(aimBias);
      this._showMessage(`${label} · ${place} · power ${powerLevel}/5`, 0.85);
    }
    return true;
  }

  _playerParts(player) {
    return player?.userData?.parts || null;
  }

  _flashRacket(player) {
    const parts = this._playerParts(player);
    const face = parts?.racketFace;
    if (!face?.material?.emissive) return;
    const mat = face.material;
    const prev = mat.emissiveIntensity;
    mat.emissiveIntensity = 0.95;
    setTimeout(() => {
      mat.emissiveIntensity = prev;
    }, 160);
  }

  _updatePlayerLocomotion(player, dt) {
    const parts = this._playerParts(player);
    if (!parts) return;

    const slot = parts.slot;
    const dx = player.position.x - parts.prevX;
    parts.prevX = player.position.x;
    parts.moveSpeed += (Math.abs(dx / Math.max(dt, 0.001)) - parts.moveSpeed) * (1 - Math.exp(-8 * dt));

    const moving = parts.moveSpeed > 0.35;
    const runRate = clamp(parts.moveSpeed * 0.55, 0, 9);
    if (moving) parts.runPhase += dt * runRate;

    const leanX = clamp(dx * 2.2, -0.35, 0.35);
    const ballApproaching =
      this.ball.inPlay &&
      this.ball.alive &&
      ((slot === 1 && this.ball.vel.z < -1.5 && this.ball.pos.z < 2) ||
        (slot === 2 && this.ball.vel.z > 1.5 && this.ball.pos.z > -2));
    const ballDx = this.ball.inPlay ? this.ball.pos.x - player.position.x : 0;
    const ballDz =
      slot === 1 ? this.ball.pos.z - player.position.z : player.position.z - this.ball.pos.z;
    const anticipate = clamp(ballDx * 0.04 * parts.facing, -0.28, 0.28);
    const ready = ballApproaching && ballDz > 0.5 && ballDz < 8;

    parts.root.position.y = moving
      ? Math.abs(Math.sin(parts.runPhase * 2)) * 0.045
      : ready
        ? 0.03
        : 0;
    parts.hips.rotation.x = moving ? 0.14 + Math.sin(parts.runPhase) * 0.07 : ready ? 0.18 : 0.06;
    parts.hips.rotation.z = -leanX * 0.55;
    parts.torso.rotation.z = -leanX * 0.38 + anticipate;
    parts.torso.rotation.y = anticipate * 0.75;
    parts.torso.rotation.x = ready ? -0.12 : moving ? -0.04 : 0;

    const legSwing = moving ? Math.sin(parts.runPhase) * 0.62 : ready ? 0.18 : 0.06;
    const split = ready ? 0.22 : 0;
    parts.legL.hip.rotation.x = legSwing + split;
    parts.legR.hip.rotation.x = -legSwing - split * 0.65;
    parts.legL.knee.rotation.x = moving ? Math.max(0, -legSwing) * 0.9 : ready ? 0.35 : 0.06;
    parts.legR.knee.rotation.x = moving ? Math.max(0, legSwing) * 0.9 : ready ? 0.42 : 0.06;

    if (!this._racketHasHitAnim(player)) {
      parts.armOff.shoulder.rotation.x = moving ? Math.sin(parts.runPhase + 0.6) * 0.38 : ready ? 0.25 : 0.1;
      parts.armOff.elbow.rotation.x = -0.35 - (moving ? Math.abs(Math.sin(parts.runPhase)) * 0.22 : 0);
      parts.armHit.shoulder.rotation.y = anticipate * 0.55 + (ready ? parts.facing * -0.12 : 0);
      parts.armHit.shoulder.rotation.x = ready ? -0.35 : -0.15 + (moving ? -0.08 : 0);
      parts.armHit.elbow.rotation.x = ready ? -0.72 : -0.55;
      parts.armHit.elbow.rotation.z = 0.08 * parts.facing;
      if (parts.racket) {
        parts.racket.rotation.x = ready ? 0.35 : 0.15;
        parts.racket.rotation.y = (ready ? 0.22 : 0.1) * parts.facing;
      }
    }

    const sign = parts.facing;
    player.rotation.y =
      (parts.facing === 1 ? 0 : Math.PI) +
      (parts.facing === 1 ? -player.position.x * 0.018 : player.position.x * 0.018);
  }

  /** World +X sign of this player's right-hand side. */
  _playerRightSign(slot) {
    return slot === 1 ? -1 : 1;
  }

  /** Only bounces on the receiving half-court count toward a double-bounce fault. */
  _receivingSide() {
    if (this.lastHitter === 1) return 2;
    if (this.lastHitter === 2) return 1;
    // During serve: receiver is opposite the server
    return this.servingSide === 1 ? 2 : 1;
  }

  _updateBall(dt) {
    if (!this.ball.alive || !this.ball.inPlay) {
      this.ballMesh.visible = false;
      this.ballShadow.visible = false;
      return;
    }
    this.ballMesh.visible = true;
    this.ballShadow.visible = true;

    const p = this.ball.pos;
    const v = this.ball.vel;

    v.y += COURT.gravity * dt;
    v.multiplyScalar(Math.max(0, 1 - COURT.airDrag * dt));
    p.addScaledVector(v, dt);

    // Ground bounce — only receiver-side bounces end the rally
    if (p.y < COURT.ballRadius) {
      p.y = COURT.ballRadius;
      v.y = Math.abs(v.y) * COURT.bounce;
      if (v.y < 2.2) v.y = 2.2; // keep the rally lively
      v.x *= 0.95;
      v.z *= 0.95;

      const sideNow = p.z < 0 ? 1 : 2;
      const receiver = this._receivingSide();
      if (sideNow === receiver) {
        this.bouncesThisSide += 1;
        if (this.bouncesThisSide === 1) {
          const now = performance.now();
          if (!this._lastBounceSound || now - this._lastBounceSound > 120) {
            this._lastBounceSound = now;
            this.crowd.playBounce();
          }
        }
        if (this.bouncesThisSide >= 2) {
          const winner = receiver === 1 ? 2 : 1;
          this._awardPoint(winner);
          return;
        }
      }
    }

    // Net: clearly under the tape while crossing
    if (
      Math.abs(p.z) < COURT.netThickness + COURT.ballRadius * 1.0 &&
      p.y < COURT.netHeight - 0.12 &&
      Math.abs(p.x) < COURT.halfWidth + 0.2
    ) {
      // Bounce up over / drop short — treat as net fault for the last hitter (or server)
      if (this.lastHitter) {
        this._awardPoint(this.lastHitter === 1 ? 2 : 1);
      } else {
        this._awardPoint(this.servingSide === 1 ? 2 : 1);
      }
      return;
    }

    // Out of bounds (wide)
    if (Math.abs(p.x) > COURT.halfWidth + 1.1) {
      if (this.lastHitter) {
        this._awardPoint(this.lastHitter === 1 ? 2 : 1);
      } else {
        this._awardPoint(this.servingSide === 1 ? 2 : 1);
      }
      return;
    }

    // Past baseline = winner for the other side
    if (p.z < -COURT.halfLength - 0.35 && v.z < 0) {
      this._awardPoint(2);
      return;
    }
    if (p.z > COURT.halfLength + 0.35 && v.z > 0) {
      this._awardPoint(1);
      return;
    }

    this.ballMesh.position.copy(p);
    if (this.ballSquash) {
      this.ballSquash.t += dt;
      const su = Math.min(1, this.ballSquash.t / this.ballSquash.dur);
      const squash = 1 + this.ballSquash.amount * (1 - su) * (1 - su);
      const stretch = 1 - this.ballSquash.amount * 0.45 * (1 - su);
      this.ballMesh.scale.set(stretch, squash, stretch);
      if (su >= 1) {
        this.ballMesh.scale.set(1, 1, 1);
        this.ballSquash = null;
      }
    }
    this.ballMesh.rotation.x += v.z * dt * 0.08;
    this.ballMesh.rotation.z -= v.x * dt * 0.08;
    this.ballShadow.position.x = p.x;
    this.ballShadow.position.z = p.z;
    const shadowScale = clamp(1.4 - p.y * 0.2, 0.4, 1.3);
    this.ballShadow.scale.setScalar(shadowScale);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (!this.renderer || !this.scene || !this.camera) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && this.el.message) this.el.message.textContent = '\u00a0';
    }

    try {
      if (this.running) {
        if (!this.isGuestScreen) {
          this._updateBall(dt);
          this._updateRackets(dt);
          this._updateSwingHint();
          this._tryHit(1);
          this._tryHit(2);
          this._syncFrame += 1;
          if (this._syncFrame % 2 === 0) this._emitGameSync();
        } else if (this.ballMesh) {
          this.ballMesh.position.set(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z);
          this.ballMesh.visible = this.ball.alive;
          if (this.racket1 && this.racket2) {
            this._updatePlayerLocomotion(this.racket1, dt);
            this._updatePlayerLocomotion(this.racket2, dt);
          }
        }
      } else if (this.racket1 && this.racket2 && this.ballMesh) {
        const t = performance.now() * 0.001;
        this.racket1.position.x = Math.sin(t) * 1.5;
        this.racket2.position.x = Math.cos(t * 0.9) * 1.5;
        this._updatePlayerLocomotion(this.racket1, 0.016);
        this._updatePlayerLocomotion(this.racket2, 0.016);
        this.ballMesh.position.set(Math.sin(t * 0.7) * 2, 1.2 + Math.sin(t * 2) * 0.2, Math.cos(t * 0.5) * 3);
        this.ballMesh.visible = true;
        this.ballShadow.position.set(this.ballMesh.position.x, 0.09, this.ballMesh.position.z);
        this.ballShadow.visible = true;
      }
      if (this.spectators?.length) this._updateSpectators(dt);
      this._renderScene();
    } catch (err) {
      console.error('frame error', err);
    }
  }
}

// eslint-disable-next-line no-new
new TennisGame();

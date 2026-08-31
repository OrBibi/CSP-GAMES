/** Shared placement helpers (server tests + optional client parity). */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function phoneToLogicSide(raw) {
  if (raw === 'left') return 'right';
  if (raw === 'right') return 'left';
  return raw;
}

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

module.exports = {
  clamp,
  phoneToLogicSide,
  aimPlacementLabel,
  amplifyAimForCourt,
};

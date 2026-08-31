/** Ping pong scoring and collision helpers. */

const WINNING_SCORE = 11;
const WIN_BY = 2;

function addPoint(scores, player) {
  const next = { ...scores };
  if (player === 1) next.p1 = (next.p1 || 0) + 1;
  else if (player === 2) next.p2 = (next.p2 || 0) + 1;
  return next;
}

function checkWinner(scores) {
  const { p1 = 0, p2 = 0 } = scores;
  if (p1 >= WINNING_SCORE && p1 - p2 >= WIN_BY) return 1;
  if (p2 >= WINNING_SCORE && p2 - p1 >= WIN_BY) return 2;
  return null;
}

function reflectY(vy) {
  return -vy;
}

function paddleBounceAngle(paddleX, ballX, tableHalfWidth) {
  const rel = (ballX - paddleX) / Math.max(tableHalfWidth * 0.5, 1);
  return Math.max(-0.85, Math.min(0.85, rel));
}

function wallBounceX(x, vx, minX, maxX) {
  let nx = x + vx;
  let nvx = vx;
  if (nx <= minX) {
    nx = minX + (minX - nx);
    nvx = Math.abs(vx);
  } else if (nx >= maxX) {
    nx = maxX - (nx - maxX);
    nvx = -Math.abs(vx);
  }
  return { x: nx, vx: nvx };
}

module.exports = {
  WINNING_SCORE,
  WIN_BY,
  addPoint,
  checkWinner,
  reflectY,
  paddleBounceAngle,
  wallBounceX,
};

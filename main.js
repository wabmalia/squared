/**
 * @typedef State
 * @type {object}
 * @property {'idle' | 'increase' | 'drop' | 'celebrate'} phase
 * @property {number} level - current level
 */
/** @type {State} */
let state = {};

const canvas = Canvas("game");

newGame();

function newGame() {
  state = {
    phase: "idle",
    level: 1,
    square: {
      x: 0.5,
      y: 0.7,
      size: 0.1,
    },
    platforms: {
      gap: 0.2,
      guards: 0.05,
    },
  };
  canvas.draw(state);
}

// Events
function increaseSquare() {}

function dropSquare() {}

// Canvas
function Canvas(id) {
  const canvas = document.getElementById(id);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");

  function draw(state) {
    ctx.save();

    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);

    drawBackground();
    drawPlatform(state);
    drawSquare(state);

    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = "#58A8D8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawPlatform({ platforms }) {
    ctx.fillStyle = "#152A47";

    const gap = Math.round((canvas.width - platforms.gap * canvas.width) / 2);
    const guards = Math.round(
      (canvas.width - (platforms.gap + platforms.guards) * canvas.width) / 2
    );

    ctx.fillRect(0, 0, gap, canvas.height / 8);
    ctx.fillRect(canvas.width, 0, -gap, canvas.height / 8);

    ctx.fillRect(0, 0, guards, canvas.height / 5);
    ctx.fillRect(canvas.width, 0, -guards, canvas.height / 5);
  }

  function drawSquare(state) {
    ctx.fillStyle = "#152A47";
    const realWidth = state.square.size * canvas.width;
    ctx.fillRect(
      state.square.x * canvas.width - realWidth / 2,
      state.square.y * canvas.height - realWidth / 2,
      realWidth,
      state.square.size * canvas.width
    );
  }

  return { draw };
}

(() => {
  "use strict";

  const COLS = 5;
  const ROWS = 4;
  const PIECE_TOTAL = COLS * ROWS;
  const image = new Image();
  image.src = "core.jpg";

  const canvas = document.querySelector("#puzzle");
  const context = canvas.getContext("2d");
  const status = document.querySelector("#status");
  const pieceCount = document.querySelector("#piece-count");
  const restartButton = document.querySelector("#restart-button");
  const hintButton = document.querySelector("#hint-button");
  const soundButton = document.querySelector("#sound-button");
  const mediaQuery = window.matchMedia("(max-width: 640px)");

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let layout = null;
  let pieces = [];
  let trayOrder = [];
  let dragging = null;
  let hintVisible = false;
  let completedCount = 0;
  let imageReady = false;
  let audioContext = null;
  let masterGain = null;
  let musicGain = null;
  let musicTimer = null;
  let musicNote = 0;
  let soundEnabled = false;

  function createAudioContext() {
    if (!AudioContextClass) {
      soundButton.disabled = true;
      soundButton.textContent = "เบราว์เซอร์ไม่รองรับเสียง";
      return false;
    }

    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.65;
    masterGain.connect(audioContext.destination);

    musicGain = audioContext.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(masterGain);
    return true;
  }

  function playTone(frequency, duration, volume, destination = masterGain) {
    if (!soundEnabled || !audioContext || !destination) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(0.001, now);
    envelope.gain.exponentialRampToValueAtTime(volume, now + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function playMusicNote() {
    const melody = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    playTone(melody[musicNote % melody.length], 1.1, 0.12, musicGain);
    musicNote += 1;
  }

  function startMusic() {
    if (!soundEnabled || document.hidden || !audioContext || !musicGain || musicTimer) return;
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.setTargetAtTime(0.35, audioContext.currentTime, 0.25);
    playMusicNote();
    musicTimer = window.setInterval(playMusicNote, 1450);
  }

  function stopMusic() {
    if (musicTimer) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
    if (audioContext && musicGain) {
      musicGain.gain.cancelScheduledValues(audioContext.currentTime);
      musicGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
    }
  }

  async function toggleSound() {
    if (!audioContext && !createAudioContext()) return;

    if (soundEnabled) {
      soundEnabled = false;
      stopMusic();
      soundButton.textContent = "เปิดเสียง";
      soundButton.setAttribute("aria-pressed", "false");
      return;
    }

    await audioContext.resume();
    soundEnabled = true;
    soundButton.textContent = "ปิดเสียง";
    soundButton.setAttribute("aria-pressed", "true");
    startMusic();
    playTone(523.25, 0.12, 0.08);
  }

  function makeEdges() {
    const edges = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ top: 0, right: 0, bottom: 0, left: 0 }))
    );

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const edge = edges[row][col];
        if (col < COLS - 1) {
          edge.right = Math.random() < 0.5 ? 1 : -1;
          edges[row][col + 1].left = -edge.right;
        }
        if (row < ROWS - 1) {
          edge.bottom = Math.random() < 0.5 ? 1 : -1;
          edges[row + 1][col].top = -edge.bottom;
        }
      }
    }

    return edges;
  }

  function traceEdge(ctx, startX, startY, endX, endY, normalX, normalY, sign) {
    const dx = endX - startX;
    const dy = endY - startY;
    const depth = Math.min(Math.hypot(dx, dy) * 0.23, layout.tabDepth);
    const outward = sign * depth;
    const point = (t, n) => [
      startX + dx * t + normalX * n,
      startY + dy * t + normalY * n
    ];
    if (sign === 0) {
      ctx.lineTo(endX, endY);
      return;
    }

    const p0 = point(0.35, 0);
    ctx.lineTo(p0[0], p0[1]);
    const p1 = point(0.39, 0);
    const p2 = point(0.39, outward * 0.62);
    const p3 = point(0.46, outward * 0.62);
    ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    const p4 = point(0.46, outward);
    const p5 = point(0.54, outward);
    const p6 = point(0.54, outward * 0.62);
    ctx.bezierCurveTo(p4[0], p4[1], p5[0], p5[1], p6[0], p6[1]);
    const p7 = point(0.61, outward * 0.62);
    const p8 = point(0.61, 0);
    const p9 = point(0.65, 0);
    ctx.bezierCurveTo(p7[0], p7[1], p8[0], p8[1], p9[0], p9[1]);
    ctx.lineTo(endX, endY);
  }

  function drawPieceBuffer(piece) {
    const buffer = document.createElement("canvas");
    buffer.width = Math.ceil(layout.pieceWidth);
    buffer.height = Math.ceil(layout.pieceHeight);
    const ctx = buffer.getContext("2d");
    const x = layout.margin;
    const y = layout.margin;
    const right = x + layout.cellWidth;
    const bottom = y + layout.cellHeight;
    const edges = piece.edges;

    ctx.beginPath();
    ctx.moveTo(x, y);
    traceEdge(ctx, x, y, right, y, 0, -1, edges.top);
    traceEdge(ctx, right, y, right, bottom, 1, 0, edges.right);
    traceEdge(ctx, right, bottom, x, bottom, 0, 1, edges.bottom);
    traceEdge(ctx, x, bottom, x, y, -1, 0, edges.left);
    ctx.closePath();

    ctx.save();
    ctx.clip();
    ctx.drawImage(
      image,
      x - piece.col * layout.cellWidth,
      y - piece.row * layout.cellHeight,
      layout.boardWidth,
      layout.boardHeight
    );
    ctx.restore();

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fffafd";
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#a85e7d99";
    ctx.stroke();
    ctx.restore();
    piece.buffer = buffer;
  }

  function computeLayout() {
    const width = canvas.clientWidth;
    if (!width || !imageReady) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const mobile = mediaQuery.matches;
    const sidePadding = mobile ? 12 : 14;
    const trayGap = mobile ? 8 : 10;
    const imageRatio = image.height / image.width;
    const pieceWidthRatio = 1 / COLS + 0.54 * imageRatio / ROWS;
    const pieceHeightRatio = imageRatio / ROWS * 1.54;
    const availableHeight = Math.max(
      240,
      window.innerHeight - canvas.getBoundingClientRect().top - (mobile ? 20 : 88)
    );
    const widthLimit = mobile
      ? width - sidePadding * 2
      : (width - sidePadding * 2 - trayGap * 2) / (1 + 2 * pieceWidthRatio);
    const heightLimit = mobile
      ? Number.POSITIVE_INFINITY
      : (availableHeight - 2 * sidePadding - trayGap * 2) /
        (imageRatio + 2 * pieceHeightRatio);
    const boardWidth = Math.min(widthLimit, heightLimit, mobile ? 540 : 660);
    const boardHeight = boardWidth * imageRatio;
    const cellWidth = boardWidth / COLS;
    const cellHeight = boardHeight / ROWS;
    const margin = Math.min(cellWidth, cellHeight) * 0.27;
    const pieceWidth = cellWidth + margin * 2;
    const pieceHeight = cellHeight + margin * 2;
    const trayLeft = sidePadding;
    const trayWidth = width - sidePadding * 2;
    const columns = Math.max(1, Math.floor((trayWidth + trayGap) / (pieceWidth + trayGap)));
    const boardX = (width - boardWidth) / 2;
    const trayY = sidePadding;
    const boardY = mobile ? trayY : trayY + pieceHeight + trayGap;
    const bottomTrayY = boardY + boardHeight + trayGap;
    const mobileTrayRows = Math.ceil(PIECE_TOTAL / columns);
    const canvasHeight = mobile
      ? bottomTrayY + mobileTrayRows * (pieceHeight + trayGap) + sidePadding
      : bottomTrayY + pieceHeight + sidePadding;

    layout = {
      mobile,
      pixelRatio,
      width,
      canvasHeight,
      boardX,
      boardY,
      boardWidth,
      boardHeight,
      cellWidth,
      cellHeight,
      margin,
      tabDepth: margin * 0.8,
      pieceWidth,
      pieceHeight,
      trayLeft,
      trayWidth,
      trayY,
      bottomTrayY,
      trayGap,
      columns
    };
    canvas.style.height = `${canvasHeight}px`;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(canvasHeight * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    for (const piece of pieces) drawPieceBuffer(piece);
    if (pieces.length) {
      for (const piece of pieces) {
        if (piece.locked) {
          const target = targetPosition(piece);
          piece.x = target.x;
          piece.y = target.y;
        }
      }
      arrangePieces(false);
    }
    draw();
  }

  function arrangePieces(shuffle) {
    if (!layout) return;
    let order = trayOrder.filter((piece) => !piece.locked);
    if (shuffle) {
      order = pieces.filter((piece) => !piece.locked);
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      trayOrder = order.slice();
    }

    order.forEach((piece, index) => {
      if (!layout.mobile) {
        const col = index % COLS;
        if (index < COLS) {
          piece.x = layout.boardX + col * layout.cellWidth - layout.margin;
          piece.y = layout.trayY;
        } else if (index < COLS * 2) {
          piece.x = layout.boardX + col * layout.cellWidth - layout.margin;
          piece.y = layout.bottomTrayY;
        } else {
          const sideIndex = index < COLS * 3 ? index - COLS * 2 : index - COLS * 3;
          const sideX = index < COLS * 3
            ? layout.boardX - layout.trayGap - layout.pieceWidth
            : layout.boardX + layout.boardWidth + layout.trayGap;
          const sideRange = layout.canvasHeight - 2 * layout.trayY - layout.pieceHeight;
          piece.x = sideX;
          piece.y = layout.trayY + sideIndex * sideRange / (COLS - 1);
        }
        return;
      }

      const col = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const slotWidth = layout.trayWidth / layout.columns;
      piece.x = layout.trayLeft + col * slotWidth + (slotWidth - layout.pieceWidth) / 2;
      piece.y = layout.bottomTrayY + row * (layout.pieceHeight + layout.trayGap);
    });
  }

  function initializeGame() {
    if (!imageReady || !layout) return;
    const edges = makeEdges();
    pieces = [];
    trayOrder = [];
    completedCount = 0;
    dragging = null;

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        pieces.push({
          row,
          col,
          edges: edges[row][col],
          x: 0,
          y: 0,
          locked: false
        });
      }
    }

    for (const piece of pieces) drawPieceBuffer(piece);
    arrangePieces(true);
    updateStatus();
    draw();
  }

  function targetPosition(piece) {
    return {
      x: layout.boardX + piece.col * layout.cellWidth - layout.margin,
      y: layout.boardY + piece.row * layout.cellHeight - layout.margin
    };
  }

  function draw() {
    if (!layout) return;
    const { width, canvasHeight, boardX, boardY, boardWidth, boardHeight } = layout;
    context.clearRect(0, 0, width, canvasHeight);

    context.save();
    context.shadowColor = "#c9688b22";
    context.shadowBlur = 18;
    context.shadowOffsetY = 7;
    context.fillStyle = "#fff0f6";
    context.fillRect(boardX, boardY, boardWidth, boardHeight);
    context.restore();

    context.save();
    context.globalAlpha = hintVisible ? 0.31 : 0.12;
    context.drawImage(image, boardX, boardY, boardWidth, boardHeight);
    context.restore();

    context.save();
    context.strokeStyle = "#d78baa66";
    context.lineWidth = 1;
    for (let col = 0; col <= COLS; col += 1) {
      const x = boardX + col * layout.cellWidth;
      context.beginPath();
      context.moveTo(x, boardY);
      context.lineTo(x, boardY + boardHeight);
      context.stroke();
    }
    for (let row = 0; row <= ROWS; row += 1) {
      const y = boardY + row * layout.cellHeight;
      context.beginPath();
      context.moveTo(boardX, y);
      context.lineTo(boardX + boardWidth, y);
      context.stroke();
    }
    context.strokeStyle = "#d58aa8";
    context.lineWidth = 1.5;
    context.strokeRect(boardX, boardY, boardWidth, boardHeight);
    context.restore();

    context.save();
    context.fillStyle = "#ad718a";
    context.font = "600 12px Segoe UI, sans-serif";
    context.textAlign = "left";
    if (layout.mobile) {
      context.fillText("กระดาน", boardX, boardY + boardHeight + 24);
      context.fillText("ชิ้นส่วน", layout.trayLeft, layout.bottomTrayY - 12);
    } else {
      context.fillText("ชิ้นส่วน", boardX, layout.trayY - 5);
      context.fillText("ชิ้นส่วน", boardX, layout.bottomTrayY + layout.pieceHeight + 10);
    }
    context.restore();

    for (const piece of pieces) {
      if (piece === dragging) continue;
      drawPiece(piece, false);
    }
    if (dragging) drawPiece(dragging, true);
  }

  function drawPiece(piece, active) {
    if (!piece.buffer) return;
    context.save();
    if (active) {
      context.shadowColor = "#bf5b844d";
      context.shadowBlur = 18;
      context.shadowOffsetY = 8;
    }
    context.drawImage(piece.buffer, piece.x, piece.y);
    context.restore();
  }

  function updateStatus() {
    pieceCount.textContent = `${completedCount} / ${PIECE_TOTAL} ชิ้น`;
    if (completedCount === PIECE_TOTAL) {
      status.textContent = "เยี่ยมมาก! คุณประกอบภาพสำเร็จแล้ว";
    } else {
      status.textContent = completedCount
        ? `ประกอบแล้ว ${completedCount} ชิ้น ไปต่อกันเลย!`
        : "ลากชิ้นส่วนไปวางบนกระดาน";
    }
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * layout.width / rect.width,
      y: (event.clientY - rect.top) * layout.canvasHeight / rect.height
    };
  }

  function onPointerDown(event) {
    if (!layout || !imageReady) return;
    const point = pointerPosition(event);
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i];
      if (piece.locked) continue;
      if (
        point.x >= piece.x &&
        point.x <= piece.x + layout.pieceWidth &&
        point.y >= piece.y &&
        point.y <= piece.y + layout.pieceHeight
      ) {
        dragging = piece;
        dragging.dragOffsetX = point.x - piece.x;
        dragging.dragOffsetY = point.y - piece.y;
        canvas.setPointerCapture(event.pointerId);
        playTone(440, 0.08, 0.16);
        draw();
        event.preventDefault();
        return;
      }
    }
  }

  function onPointerMove(event) {
    if (!dragging || !layout) return;
    const point = pointerPosition(event);
    dragging.x = point.x - dragging.dragOffsetX;
    dragging.y = point.y - dragging.dragOffsetY;
    draw();
  }

  function onPointerUp() {
    if (!dragging || !layout) return;
    const piece = dragging;
    dragging = null;
    const target = targetPosition(piece);
    const distance = Math.hypot(piece.x - target.x, piece.y - target.y);
    const snapDistance = Math.min(layout.cellWidth, layout.cellHeight) * 0.42;

    if (distance <= snapDistance) {
      piece.x = target.x;
      piece.y = target.y;
      piece.locked = true;
      completedCount += 1;
      updateStatus();
      playTone(659.25, 0.16, 0.2);
      window.setTimeout(() => playTone(783.99, 0.2, 0.16), 75);
    } else {
      playTone(293.66, 0.12, 0.12);
    }
    draw();
  }

  function onResize() {
    computeLayout();
  }

  image.addEventListener("load", () => {
    imageReady = true;
    computeLayout();
    initializeGame();
  });

  image.addEventListener("error", () => {
    status.textContent = "โหลดภาพ core.jpg ไม่สำเร็จ กรุณาตรวจสอบว่าไฟล์อยู่ในโฟลเดอร์เดียวกับเกม";
  });

  restartButton.addEventListener("click", initializeGame);
  soundButton.addEventListener("click", toggleSound);
  hintButton.addEventListener("click", () => {
    hintVisible = !hintVisible;
    hintButton.setAttribute("aria-pressed", String(hintVisible));
    hintButton.textContent = hintVisible ? "ซ่อนภาพใบ้" : "แสดงภาพใบ้";
    draw();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onResize);
  mediaQuery.addEventListener("change", onResize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopMusic();
    } else {
      startMusic();
    }
  });

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(canvas.parentElement);
})();

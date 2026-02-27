// 1️⃣ 当前轮到哪一方（1＝黑，2＝白），以服务器为准，仅用于前端显示
let currentColor = 1;
// 防止在一次落子流程尚未结束时连续点击，导致“多下一手”的情况
let isBusy = false;

// 2️⃣ 颜色名称映射（用于 CSS class）
const colorName = {1: 'black', 2: 'white'};

// 3️⃣ 重置按钮
document.getElementById('reset-board').addEventListener('click', async () => {
  const res = await fetch('/reset', {method: 'POST'});
  const data = await res.json();
  if (data.success) {
    await loadBoard();  // 重新渲染棋盘
  } else {
    console.error(data.error);
  }
});

// 4️⃣ 根据后端返回的数据更新计分器
function updateScoreboard(data) {
  const {captures, score} = data;
  if (!captures || !score) return;

  const blackStonesEl = document.getElementById('black-stones');
  const whiteStonesEl = document.getElementById('white-stones');
  const blackTerritoryEl = document.getElementById('black-territory');
  const whiteTerritoryEl = document.getElementById('white-territory');
  const blackCapturesEl = document.getElementById('black-captures');
  const whiteCapturesEl = document.getElementById('white-captures');
  const blackTotalEl = document.getElementById('black-total');
  const whiteTotalEl = document.getElementById('white-total');
  const komiEl = document.getElementById('komi');

  if (blackStonesEl) blackStonesEl.textContent = score.black.stones;
  if (whiteStonesEl) whiteStonesEl.textContent = score.white.stones;
  if (blackTerritoryEl) blackTerritoryEl.textContent = score.black.territory;
  if (whiteTerritoryEl) whiteTerritoryEl.textContent = score.white.territory;
  if (blackCapturesEl) blackCapturesEl.textContent = captures.black;
  if (whiteCapturesEl) whiteCapturesEl.textContent = captures.white;
  if (blackTotalEl) blackTotalEl.textContent = score.black.total.toFixed(1);
  if (whiteTotalEl) whiteTotalEl.textContent = score.white.total.toFixed(1);
  if (komiEl) {
    // 通过总分与实子+地的差值推算贴目（仅展示用）
    const inferredKomi = score.white.total - (score.white.stones + score.white.territory);
    komiEl.textContent = inferredKomi.toFixed(1);
  }
}

// 5️⃣ 获取并绘制棋盘（包括当前该谁走与计分）
async function loadBoard() {
  const res = await fetch('/state');
  const data = await res.json();
  const board = data.board;          // N×N 数组
  currentColor = data.nextColor;     // 由服务器计算当前行棋方

  // 更新 UI 上的“当前轮到”
  const currentPlayerSpan = document.getElementById('current-player');
  if (currentPlayerSpan) {
    currentPlayerSpan.textContent = currentColor === 1 ? '黑' : '白';
  }

  // 更新计分器
  updateScoreboard(data);

  const boardDiv = document.getElementById('board');
  boardDiv.innerHTML = '';       // 清空旧格子

  const size = board.length;

  // 生成 size × size 的格子
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = document.createElement('div');
      const stone = board[y][x];
      cell.className = 'cell';

      // 如果该位置有棋子，则在交叉点中心插入一个石子元素
      if (stone) {
        const stoneDiv = document.createElement('div');
        stoneDiv.className = `stone ${colorName[stone]}`;
        cell.appendChild(stoneDiv);
      }

      cell.dataset.x = x;          // 记录坐标
      cell.dataset.y = y;
      // 点击格子落子
      cell.addEventListener('click', async () => {
        if (isBusy) return;
        // 先检查该格子是否已被占用
        if (stone) {
          alert('该点已有棋子！');
          return;
        }
        isBusy = true;
        try {
          const res = await fetch('/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            // 颜色由服务器根据当前局面和规则自动判定，这里只传坐标
            body: JSON.stringify({
              x: parseInt(cell.dataset.x),
              y: parseInt(cell.dataset.y)
            })
          });
          const data = await res.json();
          if (data.success) {
            const captured = data.captured || [];

            // 如果一次性提子数 >= 2，则在前端做一个酷炫特效 + 浮动文字
            if (captured.length >= 2) {
              // 连续击破 X
              showComboBanner(captured.length);

              captured.forEach(([cx, cy]) => {
                const cellEl = document.querySelector(
                  `#board .cell[data-x="${cx}"][data-y="${cy}"] .stone`
                );
                if (cellEl) {
                  cellEl.classList.add('capture-effect');
                }
              });
              // 等待动画结束再刷新棋盘
              setTimeout(async () => {
                await loadBoard();
                isBusy = false;
              }, 450);
            } else {
              // 普通落子或单提子直接刷新
              await loadBoard();
              isBusy = false;
            }
          } else {
            alert(data.error);
            isBusy = false;
          }
        } catch (e) {
          console.error(e);
          isBusy = false;
        }
      });
      boardDiv.appendChild(cell);
    }
  }
}

// 6️⃣ 连续击破浮动文字
function showComboBanner(count) {
  const root = document.getElementById('combo-banner-root') || document.body;
  const banner = document.createElement('div');
  banner.className = 'combo-banner';
  banner.textContent = `连续击破 ${count}`;
  root.appendChild(banner);

  setTimeout(() => {
    banner.remove();
  }, 3000);
}

// 页面加载完后先绘制一次棋盘
loadBoard();

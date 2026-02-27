// 1️⃣ 当前落子颜色（1＝黑，2＝白）
let currentColor = 1;

// 2️⃣ 颜色名称映射
const colorName = {1: 'black', 2: 'white'};

// 3️⃣ 颜色切换按钮
document.getElementById('toggle-color').addEventListener('click', () => {
  currentColor = currentColor === 1 ? 2 : 1;
  alert(`现在要落 ${currentColor === 1 ? '黑' : '白'} 了`);
});

// 4️⃣ 重置按钮
document.getElementById('reset-board').addEventListener('click', async () => {
  const res = await fetch('/reset', {method: 'POST'});
  const data = await res.json();
  if (data.success) {
    await loadBoard();  // 重新渲染棋盘
  } else {
    console.error(data.error);
  }
});

// 5️⃣ 获取并绘制棋盘
async function loadBoard() {
  const res = await fetch('/state');
  const data = await res.json();
  const board = data.board;      // 9×9 数组

  const boardDiv = document.getElementById('board');
  boardDiv.innerHTML = '';       // 清空旧格子

  // 生成 9×9 的格子
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const cell = document.createElement('div');
      const stone = board[y][x];
      if (stone) cell.className = colorName[stone]; // 给石子着色
      cell.dataset.x = x;          // 记录坐标
      cell.dataset.y = y;
      // 点击格子落子
      cell.addEventListener('click', async () => {
        // 先检查该格子是否已被占用
        if (stone) {
          alert('该点已有棋子！');
          return;
        }
        const res = await fetch('/move', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({x: parseInt(cell.dataset.x), y: parseInt(cell.dataset.y), color: currentColor})
        });
        const data = await res.json();
        if (data.success) {
          // 落子成功后重新加载棋盘
          await loadBoard();
          // 颜色切换
          currentColor = currentColor === 1 ? 2 : 1;
        } else {
          alert(data.error);
        }
      });
      boardDiv.appendChild(cell);
    }
  }
}

// 页面加载完后先绘制一次棋盘
loadBoard();

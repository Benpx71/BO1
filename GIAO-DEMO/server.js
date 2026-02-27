// 1️⃣ 依赖
const express   = require('express');
const cors      = require('cors');
const sqlite3   = require('sqlite3').verbose();
const bodyParser = require('body-parser');

// 2️⃣ 创建 Express 应用
const app = express();

// 3️⃣ 让后端可以接受跨域请求（可选，但不失礼）
app.use(cors());

// 4️⃣ 解析请求体（JSON 格式）
app.use(bodyParser.json());

// 5️⃣ 让浏览器直接访问 /public 里的文件（HTML / CSS / JS）
app.use(express.static('public'));

// 6️⃣ 初始化数据库（文件 go.db，会自动创建）
const db = new sqlite3.Database('./go.db');

// 棋盘大小（标准 19×19 棋盘）
const BOARD_SIZE = 19;
// 贴目（中国规则一般白方 6.5 目）
const KOMI = 6.5;

// 工具：创建一个空棋盘
function createEmptyBoard() {
  return Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(0));
}

// 工具：拷贝棋盘
function cloneBoard(board) {
  return board.map(row => row.slice());
}

// 工具：棋盘转为字符串（用于简单的局面比较）
function boardToString(board) {
  return board.map(row => row.join('')).join('');
}

// 工具：根据当前棋盘计算双方实子数与地（采用接近中国规则的面积计分，不处理复杂劫争/共活细节）
function computeScore(board) {
  let blackStones = 0;
  let whiteStones = 0;

  const visited = new Set();
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const v = board[y][x];
      if (v === 1) blackStones++;
      else if (v === 2) whiteStones++;
    }
  }

  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const queue = [[x, y]];
      const region = [];
      const borderColors = new Set();

      while (queue.length) {
        const [cx, cy] = queue.shift();
        const ck = `${cx},${cy}`;
        if (visited.has(ck)) continue;
        visited.add(ck);
        region.push([cx, cy]);

        for (const [dx, dy] of dirs) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
          const v = board[ny][nx];
          if (v === 0) {
            queue.push([nx, ny]);
          } else {
            borderColors.add(v);
          }
        }
      }

      if (borderColors.size === 1) {
        const only = [...borderColors][0];
        if (only === 1) blackTerritory += region.length;
        else if (only === 2) whiteTerritory += region.length;
      }
    }
  }

  const blackTotal = blackStones + blackTerritory;
  const whiteTotal = whiteStones + whiteTerritory + KOMI;

  return {
    black: {stones: blackStones, territory: blackTerritory, total: blackTotal},
    white: {stones: whiteStones, territory: whiteTerritory, total: whiteTotal}
  };
}

// 工具：根据数据库中的落子记录还原当前棋盘
function loadBoardFromMoves(callback) {
  db.all('SELECT id, x, y, color FROM moves ORDER BY id', (err, rows) => {
    if (err) return callback(err);
    const board = createEmptyBoard();
    rows.forEach(r => {
      if (
        Number.isInteger(r.x) &&
        Number.isInteger(r.y) &&
        r.x >= 0 && r.x < BOARD_SIZE &&
        r.y >= 0 && r.y < BOARD_SIZE
      ) {
        board[r.y][r.x] = r.color;
      }
    });
    callback(null, board, rows);
  });
}

// 工具：获取一块棋（同色连通块）的所有棋子与气
function getGroupAndLiberties(board, x, y) {
  const color = board[y][x];
  if (!color) return {stones: [], liberties: 0};

  const visited = new Set();
  const stack = [[x, y]];
  const stones = [];
  let liberties = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  while (stack.length) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (visited.has(key)) continue;
    visited.add(key);
    stones.push([cx, cy]);

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      const v = board[ny][nx];
      if (v === 0) {
        liberties++;
      } else if (v === color) {
        stack.push([nx, ny]);
      }
    }
  }

  return {stones, liberties};
}

// 7️⃣ 第一次运行时，创建存放落子记录的表 + 可选的局面记录表 + 计分表
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      color INTEGER NOT NULL,
      time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 记录每一个合法落子后的局面，用于简单防止完全重复局面（类劫争规则）
  db.run(`
    CREATE TABLE IF NOT EXISTS board_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL UNIQUE
    )
  `);

  // 记录提子数（黑吃掉白的子数、白吃掉黑的子数），始终只有一行（id = 1）
  db.run(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      black_captures INTEGER NOT NULL DEFAULT 0,
      white_captures INTEGER NOT NULL DEFAULT 0
    )
  `);

  // 确保计分表里有一行初始数据
  db.run(
    `INSERT OR IGNORE INTO scores (id, black_captures, white_captures) VALUES (1, 0, 0)`
  );
});

// 8️⃣ GET /state —— 读取棋盘 + 计算当前该谁走 + 计分信息
app.get('/state', (req, res) => {
  loadBoardFromMoves((err, board, rows) => {
    if (err) return res.status(500).json({error: err.message});

    const moveCount = rows.length;
    const nextColor = moveCount % 2 === 0 ? 1 : 2; // 黑先，之后轮流

    const score = computeScore(board);

    db.get(
      'SELECT black_captures, white_captures FROM scores WHERE id = 1',
      (err2, row) => {
        if (err2) return res.status(500).json({error: err2.message});
        const captures = row || {black_captures: 0, white_captures: 0};

        res.json({
          board,
          nextColor,
          captures: {
            black: captures.black_captures,
            white: captures.white_captures
          },
          score
        });
      }
    );
  });
});

// 9️⃣ POST /move —— 根据围棋规则落子（禁占点、自杀禁手、提子、简单的重复局面检查）
app.post('/move', (req, res) => {
  const {x, y} = req.body;

  // 参数校验
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({error: '坐标必须是整数'});
  }
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
    return res.status(400).json({error: '坐标越界'});
  }

  // 读取当前棋盘和落子记录
  loadBoardFromMoves((err, board, rows) => {
    if (err) return res.status(500).json({error: err.message});

    // 判断该位置是否已被占用
    if (board[y][x] !== 0) {
      return res.status(400).json({error: '该点已落子'});
    }

    // 服务器根据当前步数决定轮到谁（黑先）
    const moveCount = rows.length;
    const color = moveCount % 2 === 0 ? 1 : 2;

    const opponentColor = color === 1 ? 2 : 1;
    const tempBoard = cloneBoard(board);

    // 先在临时棋盘上落子
    tempBoard[y][x] = color;

    const capturedStones = [];
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    // 检查四邻的对方棋块是否没有气，如果没有，则提掉
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      if (tempBoard[ny][nx] !== opponentColor) continue;

      const {stones, liberties} = getGroupAndLiberties(tempBoard, nx, ny);
      if (liberties === 0) {
        // 该块被提子
        for (const [sx, sy] of stones) {
          if (tempBoard[sy][sx] === opponentColor) {
            tempBoard[sy][sx] = 0;
            capturedStones.push([sx, sy]);
          }
        }
      }
    }

    // 检查自己这块是否自杀（如果没有提任何子且本块无气，则判为非法）
    const selfGroup = getGroupAndLiberties(tempBoard, x, y);
    if (selfGroup.liberties === 0 && capturedStones.length === 0) {
      return res.status(400).json({error: '自杀禁手：该手落下后本方整块无气'});
    }

    // 简单的“重复局面”检查：不允许新局面与任意已记录局面完全相同
    const newStateString = boardToString(tempBoard);
    const currentStateString = boardToString(board);

    db.serialize(() => {
      // 先保证当前局面字符串被记录（如果之前没存过）
      db.run(
        'INSERT OR IGNORE INTO board_states (state) VALUES (?)',
        [currentStateString],
        err2 => {
          if (err2) {
            return res.status(500).json({error: err2.message});
          }

          // 查询新局面是否已经存在（防止完全重复局面）
          db.get(
            'SELECT 1 FROM board_states WHERE state = ?',
            [newStateString],
            (err3, row) => {
              if (err3) {
                return res.status(500).json({error: err3.message});
              }

              if (row) {
                return res
                  .status(400)
                  .json({error: '该手会产生与之前完全相同的局面（简单劫争规则禁止）'});
              }

              // 正式写入数据库（提子 + 新落子），尽量原子化执行
              db.run('BEGIN TRANSACTION');

              const deleteStmt = db.prepare(
                'DELETE FROM moves WHERE x = ? AND y = ?'
              );
              for (const [sx, sy] of capturedStones) {
                deleteStmt.run(sx, sy);
              }
              deleteStmt.finalize();

              db.run(
                'INSERT INTO moves (x, y, color) VALUES (?, ?, ?)',
                [x, y, color],
                err4 => {
                  if (err4) {
                    db.run('ROLLBACK');
                    return res.status(500).json({error: err4.message});
                  }

                  // 更新提子数
                  const capturedCount = capturedStones.length;
                  const capturesSql =
                    color === 1
                      ? 'UPDATE scores SET black_captures = black_captures + ? WHERE id = 1'
                      : 'UPDATE scores SET white_captures = white_captures + ? WHERE id = 1';

                  db.run(capturesSql, [capturedCount], errCaptures => {
                    if (errCaptures) {
                      db.run('ROLLBACK');
                      return res.status(500).json({error: errCaptures.message});
                    }

                    // 记录新局面
                    db.run(
                      'INSERT OR IGNORE INTO board_states (state) VALUES (?)',
                      [newStateString],
                      err5 => {
                        if (err5) {
                          db.run('ROLLBACK');
                          return res.status(500).json({error: err5.message});
                        }

                        db.run('COMMIT');
                        return res.json({
                          success: true,
                          color,
                          captured: capturedStones
                        });
                      }
                    );
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

// 🔟 POST /reset —— 清空棋盘和局面记录以及计分
app.post('/reset', (req, res) => {
  db.serialize(() => {
    db.run('DELETE FROM moves');
    db.run('DELETE FROM board_states');
    db.run(
      'UPDATE scores SET black_captures = 0, white_captures = 0 WHERE id = 1'
    );

    // 重置为一个“空棋盘局面”
    const emptyState = boardToString(createEmptyBoard());
    db.run(
      'INSERT OR IGNORE INTO board_states (state) VALUES (?)',
      [emptyState],
      err2 => {
        if (err2) return res.status(500).json({error: err2.message});
        res.json({success: true});
      }
    );
  });
});

// 1️⃣1️⃣ 开始监听
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`围棋 Demo 服务器已启动，地址：http://localhost:${PORT}`));

let gameData = {
    columns: [],
    stock: []
};
let currentDragCards = []; 
let undoStack = []; 

// --- 计时与计步变量 ---
let moveCount = 0;
let secondsElapsed = 0;
let timerInterval = null;

// 收牌槽
let completedSets = 0; // 记录收齐了几组

async function initGame(difficulty = 1) {
    // 1. 本地生成 104 张牌 (蜘蛛纸牌总数)
    const suits = ['♠', '♥', '♣', '♦'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];

    // 根据难度分配花色 (1色:全黑桃, 2色:黑桃红桃, 4色:全花色)
    const usedSuits = suits.slice(0, difficulty);
    const setsNeeded = 8 / usedSuits.length;

    for (let s = 0; s < usedSuits.length; s++) {
        for (let i = 0; i < setsNeeded; i++) {
            ranks.forEach(v => {
                deck.push({
                    suit: usedSuits[s],
                    rank: v,
                    isVisible: false,
                    color: (usedSuits[s] === '♥' || usedSuits[s] === '♦') ? 'red' : 'black'
                });
            });
        }
    }

    // 2. 洗牌算法 (Fisher-Yates)
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // 3. 分配初始阵型 (10列, 前4列6张, 后6列5张)
    gameData.columns = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < 54; i++) {
        const card = deck.pop();
        const colIndex = i % 10;
        // 每列最后一张翻开
        if (i >= 44 || (i < 44 && i % 10 === i)) { 
             // 这里逻辑稍微简化：发完所有初始牌后再统一翻开每列最后一张
        }
        gameData.columns[colIndex].push(card);
    }
    
    // 统一翻开每列最后一张
    gameData.columns.forEach(col => {
        if (col.length > 0) col[col.length - 1].isVisible = true;
    });

    gameData.stock = deck; // 剩下的 50 张进入发牌堆

    // 4. 重置状态
    moveCount = 0;
    completedSets = 0;
    undoStack = [];
    updateCompletedSlots();
    updateMoveDisplay();
    updateStockCount();
    startTimer();
    renderBoard(gameData.columns);
}

// 点击发牌堆
document.getElementById('stock-pile').onclick = async () => {
    const hasEmptyColumn = gameData.columns.some(col => col.length === 0);
    if (hasEmptyColumn) {
        alert("每一列都必须至少有一张牌才能发牌！");
        return;
    }

    if (!gameData.stock || gameData.stock.length === 0) {
        alert("发牌堆已经空了！");
        return;
    }

    saveState(); 

    for (let i = 0; i < 10; i++) {
        if (gameData.stock.length > 0) {
            const card = gameData.stock.pop();
            card.isVisible = true;
            gameData.columns[i].push(card);
        }
    }

    moveCount++; 
    updateMoveDisplay();
    renderBoard(gameData.columns);

    // 【修改点1】发牌后使用 for...of 配合 await，确保异步收牌逻辑不会冲突
    for (let i = 0; i < 10; i++) {
        await checkAndRemoveSet(i); 
    }
};

function renderBoard(columns) {
    const container = document.getElementById('columns-container');
    if (!container) return;
    container.innerHTML = '';

    columns.forEach((colData, colIndex) => {
        const colDiv = document.createElement('div');
        colDiv.className = 'column';
        colDiv.dataset.colIndex = colIndex;

        colDiv.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        };

        colDiv.ondrop = (e) => {
            handleDrop(e, colIndex);
        };

        colData.forEach((card, cardIndex) => {
            const cardDiv = document.createElement('div');
            const isRed = card.isVisible && (card.suit === '♥' || card.suit === '♦');
            cardDiv.className = `card ${card.isVisible ? '' : 'back'} ${isRed ? 'red' : ''}`;
            cardDiv.style.top = `${cardIndex * 25}px`;
            cardDiv.style.zIndex = cardIndex;

            if (card.isVisible) {
                cardDiv.innerHTML = `
                    <div class="card-index">
                        <span class="rank">${card.rank}</span>
                        <span class="suit">${card.suit}</span>
                    </div>
                `;
                
                if (isMovableGroup(colData, cardIndex)) {
                    cardDiv.draggable = true;
                    cardDiv.style.cursor = 'grab';

                    cardDiv.ondragstart = (e) => {
                        const dragData = { colIndex, cardIndex };
                        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));

                        const columnNode = e.target.parentElement;
                        currentDragCards = Array.from(columnNode.children).slice(cardIndex);

                        const dragGroup = document.createElement('div');
                        dragGroup.id = 'temp-drag-image';
                        dragGroup.style.position = 'absolute';
                        dragGroup.style.top = '-1000px';
                        
                        currentDragCards.forEach((cardNode, i) => {
                            const clone = cardNode.cloneNode(true);
                            clone.style.top = `${i * 25}px`;
                            clone.style.position = 'absolute';
                            dragGroup.appendChild(clone);
                        });

                        document.body.appendChild(dragGroup);
                        e.dataTransfer.setDragImage(dragGroup, 40, 20);

                        setTimeout(() => {
                            currentDragCards.forEach(el => el.style.opacity = '0');
                        }, 0);
                    };

                    cardDiv.ondragend = (e) => {
                        if (currentDragCards.length > 0) {
                            currentDragCards.forEach(el => el.style.opacity = '1');
                            currentDragCards = []; 
                        }
                        const tempImage = document.getElementById('temp-drag-image');
                        if (tempImage) tempImage.remove();
                    };
                }
            }
            colDiv.appendChild(cardDiv);
        });
        container.appendChild(colDiv);
    });

    updateStockCount();
    updateStatusDisplay();
}

function updateStatusDisplay() {
    const oldOverlay = document.getElementById('game-over-overlay');
    if (oldOverlay) oldOverlay.remove();

    if (isGameOver()) {
        const overlay = document.createElement('div');
        overlay.id = 'game-over-overlay';
        overlay.innerHTML = `
            <div class="game-over-content">
                <h2>⚠️ 当前已无合法移动，死局！</h2>
                <p>别担心，你可以返回游戏并尝试撤销到上一步，或者直接重开。</p>
                <div class="game-over-btns">
                    <button class="undo-btn" id="btn-undo-death">返回游戏</button>
                    <button class="new-game-btn" id="btn-new-game">开始新游戏</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('btn-undo-death').onclick = () => {
            undo(); 
            overlay.remove(); 
        };

        document.getElementById('btn-new-game').onclick = () => {
            location.reload(); 
        };
    }
}

function isMovableGroup(column, startIndex) {
    for (let i = startIndex; i < column.length - 1; i++) {
        const current = column[i];
        const next = column[i + 1];
        if (next.suit !== current.suit || getRankValue(current.rank) !== getRankValue(next.rank) + 1) {
            return false;
        }
    }
    return true;
}

function getRankValue(rank) {
    const map = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
    return map[rank] || parseInt(rank);
}

// 拖拽放下
async function handleDrop(e, targetColIndex) {
    e.preventDefault();
    const rawData = e.dataTransfer.getData('text/plain');
    if (!rawData) return;

    const { colIndex: sColIdx, cardIndex: sCardIdx } = JSON.parse(rawData);
    if (sColIdx === targetColIndex) return;

    const sourceColumn = gameData.columns[sColIdx];
    const targetColumn = gameData.columns[targetColIndex];
    const movingCards = sourceColumn.slice(sCardIdx);
    const firstMovingCard = movingCards[0];

    let canPlace = false;
    if (targetColumn.length === 0) {
        canPlace = true;
    } else {
        const lastCard = targetColumn[targetColumn.length - 1];
        if (getRankValue(lastCard.rank) === getRankValue(firstMovingCard.rank) + 1) {
            canPlace = true;
        }
    }

    if (canPlace) {
        saveState(); 

        sourceColumn.splice(sCardIdx); 
        if (sourceColumn.length > 0) {
            sourceColumn[sourceColumn.length - 1].isVisible = true;
        }
        gameData.columns[targetColIndex] = targetColumn.concat(movingCards);

        moveCount++; 
        updateMoveDisplay();

        renderBoard(gameData.columns);
        // 【修改点2】确保 handleDrop 触发收牌
        await checkAndRemoveSet(targetColIndex);
    }
}

// --- 核心收牌逻辑（保留你原本的判断逻辑，修正数据操作顺序） ---
async function checkAndRemoveSet(colIndex) {
    const col = gameData.columns[colIndex];
    if (!col || col.length < 13) return;

    const last13 = col.slice(-13);
    const targetSuit = last13[0].suit;
    const isComplete = last13.every((card, i) => {
        return card.isVisible && 
               card.suit === targetSuit && 
               getRankValue(card.rank) === (13 - i);
    });

    if (isComplete) {
        // 先获取 DOM 节点准备动画
        const colDiv = document.querySelector(`.column[data-col-index="${colIndex}"]`);
        if (colDiv) {
            const cardNodes = Array.from(colDiv.children).slice(-13);
            cardNodes.forEach(node => {
                node.classList.add('card-complete-animation');
            });
        }

        // 等待动画
        await new Promise(resolve => setTimeout(resolve, 400));

        // 【修改点3】在这里保存一次状态，方便撤销由于收牌带来的翻牌变化
        // 如果你希望撤销回到收牌前，可以在 if (isComplete) 第一行加 saveState()

        col.splice(-13);
        completedSets++; 
        updateCompletedSlots();

        if (col.length > 0) {
            col[col.length - 1].isVisible = true;
        }

        renderBoard(gameData.columns);

        if (checkWin()) {
            stopTimer(); 
            showWinMessage();
        }
        
        // 递归检查
        await checkAndRemoveSet(colIndex);
    }
}

function checkWin() {
    // 胜利条件：所有列为空且牌堆为空
    const allColumnsEmpty = gameData.columns.every(col => col.length === 0);
    const stockEmpty = !gameData.stock || gameData.stock.length === 0;
    return allColumnsEmpty && stockEmpty;
}

function showWinMessage() {
    if (document.getElementById('win-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'win-overlay';
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8); color: gold; display: flex;
        flex-direction: column; align-items: center; justify-content: center;
        font-size: 3em; z-index: 10000; font-family: 'serif';
    `;
    const timerEl = document.getElementById('timer');
    const finalTime = timerEl ? timerEl.innerText : '00:00';
    overlay.innerHTML = `
        <h1>🏆 完美通关！</h1>
        <p style="font-size: 0.4em;">用时: ${finalTime} | 总步数: ${moveCount}</p>
        <button onclick="location.reload()" style="font-size: 0.5em; padding: 10px 20px; cursor: pointer;">再来一局</button>
    `;
    document.body.appendChild(overlay);
}

function isGameOver() {
    if (!gameData.stock || gameData.stock.length > 0) return false;

    for (let i = 0; i < gameData.columns.length; i++) {
        const sourceCol = gameData.columns[i];
        if (sourceCol.length === 0) continue;

        for (let j = 0; j < sourceCol.length; j++) {
            if (!sourceCol[j].isVisible) continue;
            
            if (isMovableGroup(sourceCol, j)) {
                const movingCard = sourceCol[j];
                for (let k = 0; k < gameData.columns.length; k++) {
                    if (i === k) continue;
                    const targetCol = gameData.columns[k];
                    if (targetCol.length === 0) return false;
                    const lastCard = targetCol[targetCol.length - 1];
                    if (getRankValue(lastCard.rank) === getRankValue(movingCard.rank) + 1) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
        undo();
    }
});

function saveState() {
    const snapshot = JSON.stringify({
        columns: gameData.columns,
        stock: gameData.stock,
        moveCount: moveCount,
        completedSets: completedSets 
    });
    undoStack.push(snapshot);
    if (undoStack.length > 30) undoStack.shift();
}

function undo() {
    if (undoStack.length === 0) {
        alert("没有可以撤销的步骤了！");
        return;
    }
    const lastState = JSON.parse(undoStack.pop());
    gameData.columns = lastState.columns;
    gameData.stock = lastState.stock;
    moveCount = lastState.moveCount;
    completedSets = lastState.completedSets || 0; 
    
    updateMoveDisplay();
    updateCompletedSlots(); 
    renderBoard(gameData.columns);
    updateStatusDisplay();
}

function updateStockCount() {
    const stockPile = document.getElementById('stock-pile');
    if (!stockPile) return;
    const count = gameData.stock ? gameData.stock.length : 0;
    const rounds = Math.ceil(count / 10); 
    
    stockPile.innerHTML = `
        <div style="font-size: 10px;">发牌剩余</div>
        <div style="font-size: 24px; font-weight: bold;">${rounds}</div>
        <div style="font-size: 10px;">次</div>
    `;

    stockPile.style.opacity = rounds === 0 ? "0.3" : "1";
    stockPile.style.cursor = rounds === 0 ? "not-allowed" : "pointer";
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval); 
    secondsElapsed = 0;
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const secs = String(secondsElapsed % 60).padStart(2, '0');
        const timerEl = document.getElementById('timer');
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function updateMoveDisplay() {
    const moveEl = document.getElementById('move-count');
    if (moveEl) moveEl.innerText = moveCount;
}

function updateCompletedSlots() {
    const slots = document.querySelectorAll('.slot');
    slots.forEach((slot, index) => {
        if (index < completedSets) {
            slot.classList.add('filled');
        } else {
            slot.classList.remove('filled');
        }
    });
}

initGame(1);
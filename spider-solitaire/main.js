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
        
        // 注意：蜘蛛纸牌规则初始时每列只有最后一张是翻开的
        card.isVisible = false; 
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
        // 1. 获取发牌堆元素
        const stockBtn = document.getElementById('stock-pile');
        
        // 2. 添加晃动类
        stockBtn.classList.add('shake-warning');
        
        // 3. 这里的逻辑很关键：等 10ms 让 CSS 动画触发，然后再弹 alert
        setTimeout(() => {
            alert("每一列都必须至少有一张牌才能发牌！");
            
            // 4. 用户关掉 alert 后，移除这个类，方便下次再次触发
            stockBtn.classList.remove('shake-warning');
        }, 10);
        
        return;
    }

    if (!gameData.stock || gameData.stock.length === 0) return;

    saveState(); 

    const stockBtn = document.getElementById('stock-pile');
    const btnRect = stockBtn.getBoundingClientRect();

    // 1. 逻辑更新：移动数据
    const newCardsInfo = [];
    for (let i = 0; i < 10; i++) {
        if (gameData.stock.length > 0) {
            const card = gameData.stock.pop();
            card.isVisible = true;
            card.isNew = true; // 打上一个“新发牌”的标记
            gameData.columns[i].push(card);
            newCardsInfo.push({ colIndex: i, cardData: card });
        }
    }

    // 2. 先执行一次渲染，但要把“新牌”变透明
    // 在你的 renderBoard 函数逻辑里，需要根据 card.isNew 给它加上 opacity: 0
    renderBoard(gameData.columns);

    // 3. 视觉表现：创建飞行影子
    const animationPromises = newCardsInfo.map((info, index) => {
        return new Promise(resolve => {
            setTimeout(() => {
                // 找到刚才 renderBoard 生成的目标占位符（即每列最后一张牌）
                const colEl = document.querySelector(`.column[data-col-index="${info.colIndex}"]`);
                const targetCardEl = colEl.lastElementChild; 
                const targetRect = targetCardEl.getBoundingClientRect();

                const flyer = document.createElement('div');
                // 沿用你卡片的 CSS 类名
                flyer.className = `card ${info.cardData.suit === '♥' || info.cardData.suit === '♦' ? 'red' : ''}`;
                flyer.style.position = 'fixed';
                flyer.style.left = `${btnRect.left}px`;
                flyer.style.top = `${btnRect.top}px`;
                flyer.style.zIndex = 1000;
                flyer.style.margin = '0'; // 消除可能的偏移
                flyer.style.transition = 'all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
                flyer.innerHTML = `
                    <div class="card-index">
                        <span class="rank">${info.cardData.rank}</span>
                        <span class="suit">${info.cardData.suit}</span>
                    </div>
                `;
                document.body.appendChild(flyer);

                flyer.getClientRects(); // 强制重绘
                
                flyer.style.left = `${targetRect.left}px`;
                flyer.style.top = `${targetRect.top}px`;

                setTimeout(() => {
                    // 飞到的一瞬间，把真正的牌显示出来，把影子删掉
                    targetCardEl.style.opacity = '1'; 
                    delete info.cardData.isNew; // 移除标记，防止下次重绘又变透明
                    flyer.remove();
                    resolve();
                }, 400);
            }, index * 60); 
        });
    });

    await Promise.all(animationPromises);

    moveCount++; 
    updateMoveDisplay();
    
    // 4. 收牌检查
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

            if (card.isNew) cardDiv.style.opacity = '0';

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
        
        // 这里的 style 可以直接写，或者在 CSS 里定义
        overlay.style = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); display: flex; 
            align-items: center; justify-content: center; z-index: 20000;
        `;

        overlay.innerHTML = `
            <div class="game-over-content">
                <h2 style="color: #d9534f;">⚠️ 当前已无合法移动，死局！</h2>
                <p>别担心，你可以返回游戏并尝试撤销到上一步，或者直接重开。</p>
                <div class="game-over-btns" style="margin-top: 20px;">
                    <button class="undo-btn" id="btn-undo-death" style="padding: 10px 20px; cursor: pointer;">返回游戏</button>
                    <button class="new-game-btn" id="btn-new-game" style="padding: 10px 20px; cursor: pointer; margin-left: 10px;">开始新游戏</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // --- 核心改动：获取内容框并触发晃动 ---
        const content = overlay.querySelector('.game-over-content');
        if (content) {
            content.classList.add('shake-death');
        }

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
        // 触发收牌检查
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
        // --- 动画开始 ---
        const colDiv = document.querySelector(`.column[data-col-index="${colIndex}"]`);
        if (colDiv) {
            const cardNodes = Array.from(colDiv.children).slice(-13);
            
            // 1. 触发原有的闪烁动画
            cardNodes.forEach(node => node.classList.add('card-complete-animation'));
            
            // 等待闪烁动画播到高潮 (500ms)
            await new Promise(resolve => setTimeout(resolve, 200));

            // 2. 获取收牌槽（左下角）的目标位置
            const slots = document.querySelectorAll('#completed-container .slot');
            const targetSlot = slots[completedSets] || slots[slots.length - 1];
            const targetRect = targetSlot.getBoundingClientRect();

            // 3. 执行飞行动画
            const flightPromises = cardNodes.map((node, index) => {
                return new Promise(resolve => {
                    const rect = node.getBoundingClientRect();
                    
                    // 转换为 fixed 定位以脱离原本的堆叠
                    node.style.position = 'fixed';
                    node.style.left = rect.left + 'px';
                    node.style.top = rect.top + 'px';
                    node.style.margin = '0';
                    node.classList.add('flying-to-slot');

                    // 强制重绘
                    node.getClientRects();

                    // 飞向目标 (加一点点 index 延迟，形成扇形展开飞入的效果)
                    setTimeout(() => {
                        node.style.left = targetRect.left + 'px';
                        node.style.top = targetRect.top + 'px';
                        node.style.transform = 'scale(0.5)'; // 飞入槽位时缩小
                        node.style.opacity = '0.5';
                    }, index * 30);

                    // 飞行完成后移除
                    setTimeout(resolve, 500); 
                });
            });

            await Promise.all(flightPromises);
        }

        // --- 数据更新逻辑 (保持不变) ---
        col.splice(-13);
        completedSets++; 
        updateCompletedSlots(); // 这里会把槽位填满 K

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

    // --- 启动瀑布动画 ---
    triggerVictoryWaterfall();

    const overlay = document.createElement('div');
    overlay.id = 'win-overlay';

    // 保留你的样式逻辑，特别是 pointer-events: none 
    // 这允许玩家点击到背景里的瀑布卡片（如果卡片本身有点击效果的话）
    overlay.style = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); color: gold; display: flex;
        flex-direction: column; align-items: center; justify-content: center;
        font-size: 3em; z-index: 10005; font-family: 'serif';
        pointer-events: none; 
    `;

    const timerEl = document.getElementById('timer');
    const finalTime = timerEl ? timerEl.innerText : '00:00';

    // --- 核心修复：在 button 的 style 中显式加入 pointer-events: auto ---
    overlay.innerHTML = `
        <h1 style="pointer-events: none;">🏆 完美通关！</h1>
        <p style="font-size: 0.4em; pointer-events: none;">用时: ${finalTime} | 总步数: ${moveCount}</p>
        <button onclick="location.reload()" 
                style="font-size: 0.5em; padding: 10px 20px; cursor: pointer; pointer-events: auto;">
            再来一局
        </button>
    `;
    document.body.appendChild(overlay);
}

/**
 * 核心死局判定逻辑
 * 只有当“发牌堆已空”且“场面上没有任何合法移动”时，才判定为死局
 */
function isGameOver() {
    // 1. 如果胜利了，显然不是死局
    if (typeof checkWin === 'function' && checkWin()) return false;

    // 2. 如果发牌堆还有牌，玩家总能发牌来改变局势，不算死局
    if (gameData.stock && gameData.stock.length > 0) return false;

    // 3. 如果存在空列，且其它列有可见牌，不算死局
    // 因为任何单张可见牌或合法序列都可以移入空列
    const hasEmptyColumn = gameData.columns.some(col => col.length === 0);
    const hasVisibleCards = gameData.columns.some(col => col.some(c => c.isVisible));
    if (hasEmptyColumn && hasVisibleCards) return false;

    // 4. 深度检查所有可能的移动
    for (let i = 0; i < gameData.columns.length; i++) {
        const sourceCol = gameData.columns[i];
        if (sourceCol.length === 0) continue;

        // 核心修正：遍历列中每一个“可见”的卡片作为潜在移动组的开头
        // 蜘蛛纸牌允许你只移动一个长序列中的末尾部分（只要它是同花色连续的）
        for (let k = 0; k < sourceCol.length; k++) {
            const cardToMove = sourceCol[k];
            if (!cardToMove.isVisible) continue;

            // 检查从索引 k 开始到结尾的这部分牌是否是一个合法的“可移动组”
            if (isMovableGroup(sourceCol, k)) {
                
                // 尝试将这个组移动到其它非空的列
                for (let j = 0; j < gameData.columns.length; j++) {
                    if (i === j) continue;
                    const targetCol = gameData.columns[j];
                    if (targetCol.length === 0) continue; // 空列已在步骤3处理

                    const targetCard = targetCol[targetCol.length - 1];
                    // 规则：只要目标牌的点数比移动组的第一张大 1，就可以移动（不限花色）
                    if (getRankValue(targetCard.rank) === getRankValue(cardToMove.rank) + 1) {
                        return false; // 只要找到一种移动方式，就不是死局
                    }
                }
            }
        }
    }

    // 只有经过以上所有检查都没找到出路，才是真正的死局
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

async function undo() {
    if (undoStack.length === 0) {
        alert("没有可以撤销的步骤了！");
        return;
    }

    // 1. 获取上一步状态
    const rawState = undoStack.pop();
    const lastState = (typeof rawState === 'string') ? JSON.parse(rawState) : rawState;

    try {
        // 2. 执行动画（这里是异步等待）
        if (lastState.completedSets < completedSets) {
            const targetCol = lastState.columns.findIndex((col, i) => col.length > gameData.columns[i].length);
            if (targetCol !== -1) await animateUndoCollection(targetCol);
        } 
        else if (lastState.stock.length > gameData.stock.length) {
            await animateUndoDeal();
        }
    } catch (e) {
        console.warn("动画播放失败，直接恢复数据", e);
    }

    // 3. 关键数据恢复：确保这里的变量名和你全局定义的一致
    gameData.columns = lastState.columns;
    gameData.stock = lastState.stock;
    moveCount = lastState.moveCount;
    completedSets = lastState.completedSets || 0; 
    
    // 4. 重新渲染页面
    updateMoveDisplay();
    updateCompletedSlots(); 
    renderBoard(gameData.columns); // 如果这里执行了，列就一定会显示出来
    if (typeof updateStatusDisplay === 'function') updateStatusDisplay();
}

/**
 * 辅助动画：撤销发牌（各列最后一张牌飞回发牌堆）
 */
async function animateUndoDeal() {
    const stockPile = document.getElementById('stock-pile');
    if (!stockPile) return;
    const targetRect = stockPile.getBoundingClientRect();
    const promises = [];

    document.querySelectorAll('.column').forEach((col) => {
        const lastCard = col.lastElementChild;
        if (lastCard && lastCard.classList.contains('card')) {
            promises.push(new Promise(resolve => {
                const rect = lastCard.getBoundingClientRect();
                const flyer = lastCard.cloneNode(true);
                
                flyer.style.position = 'fixed';
                flyer.style.left = rect.left + 'px';
                flyer.style.top = rect.top + 'px';
                flyer.style.zIndex = 10000;
                flyer.style.transition = 'all 0.3s ease-in';
                
                document.body.appendChild(flyer);
                lastCard.style.visibility = 'hidden'; // 原位隐藏，防止重影

                requestAnimationFrame(() => {
                    flyer.style.left = targetRect.left + 'px';
                    flyer.style.top = targetRect.top + 'px';
                    flyer.style.opacity = '0';
                    flyer.style.transform = 'scale(0.5)';
                });

                setTimeout(() => {
                    flyer.remove();
                    resolve();
                }, 300);
            }));
        }
    });
    await Promise.all(promises);
}

/**
 * 辅助动画：撤销收牌（从左下角飞回指定列）
 */
async function animateUndoCollection(colIndex) {
    const slots = document.querySelectorAll('#completed-container .slot.filled');
    const lastSlot = slots[slots.length - 1];
    if (!lastSlot) return;

    const startRect = lastSlot.getBoundingClientRect();
    const colEl = document.querySelector(`.column[data-col-index="${colIndex}"]`);
    const promises = [];

    // 模拟 13 张牌飞回
    for (let i = 0; i < 13; i++) {
        promises.push(new Promise(resolve => {
            const flyer = document.createElement('div');
            flyer.className = 'card back'; // 回去时显示背面更有“撤回”感
            flyer.style.position = 'fixed';
            flyer.style.left = startRect.left + 'px';
            flyer.style.top = startRect.top + 'px';
            flyer.style.zIndex = 10000 + i;
            flyer.style.transition = `all 0.4s ease-out ${i * 0.02}s`;
            
            document.body.appendChild(flyer);

            requestAnimationFrame(() => {
                const colRect = colEl.getBoundingClientRect();
                // 飞向大致的列末尾位置
                flyer.style.left = colRect.left + 'px';
                flyer.style.top = (colRect.top + 100) + 'px'; 
                flyer.style.opacity = '0';
            });

            setTimeout(() => {
                flyer.remove();
                resolve();
            }, 500);
        }));
    }
    await Promise.all(promises);
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


function triggerVictoryWaterfall() {
    // 找到所有已经收好的牌或者桌面上的牌
    // 这里我们直接创建一些牌来模拟喷涌效果
    const suits = ['♠', '♥', '♣', '♦'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    // 我们可以从左下角的收牌槽位置作为发射源
    const slots = document.querySelectorAll('#completed-container .slot');
    
    let cardCount = 0;
    const maxCards = 104; // 蜘蛛纸牌总共两副牌

    const interval = setInterval(() => {
        if (cardCount >= maxCards) {
            clearInterval(interval);
            return;
        }

        const suit = suits[Math.floor(Math.random() * suits.length)];
        const rank = ranks[Math.floor(Math.random() * ranks.length)];
        const slotIdx = cardCount % 8; // 轮流从 8 个槽位发射
        const startRect = slots[slotIdx].getBoundingClientRect();

        createBouncingCard(startRect.left, startRect.top, suit, rank);
        cardCount++;
    }, 100); // 每 100ms 喷出一张
}

function createBouncingCard(startX, startY, suit, rank) {
    const card = document.createElement('div');
    card.className = `victory-card card ${suit === '♥' || suit === '♦' ? 'red' : ''}`;
    card.innerHTML = `
        <div class="card-index">
            <span class="rank">${rank}</span>
            <span class="suit">${suit}</span>
        </div>
    `;
    document.body.appendChild(card);

    // 物理参数
    let posX = startX;
    let posY = startY;
    let vx = (Math.random() - 0.5) * 15; // 左右随机初速度
    let vy = -Math.random() * 15 - 5;    // 向上初速度
    const gravity = 0.8;
    const friction = 0.7;               // 弹跳损耗
    const ground = window.innerHeight - 110;

    function update() {
        vx *= 0.99; // 空气阻力
        vy += gravity;
        posX += vx;
        posY += vy;

        // 碰到地板反弹
        if (posY > ground) {
            posY = ground;
            vy = -vy * friction;
            // 如果纵向速度很小了，给点横向冲力让它滚出屏幕
            if (Math.abs(vy) < 2) vx *= 1.1;
        }

        card.style.left = posX + 'px';
        card.style.top = posY + 'px';
        
        // 旋转效果
        card.style.transform = `rotate(${posX * 0.5}deg)`;

        // 如果飞出左右边界或完全静止，移除
        if (posX < -100 || posX > window.innerWidth + 100) {
            card.remove();
        } else {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

initGame(1);
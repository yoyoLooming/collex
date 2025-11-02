// ==UserScript==
// @name         采词
// @version      0.7.4
// @description  可以在阅读中学习单词.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==


/**
 *  简介
 *
 *  「采词」意为采集阅读中的词汇，「Collex」源自 Collect（收集）与 Lexis（词汇）的结合，象征高效的语言积累。
 *
 *   "采词" means harvesting words from texts, while "Collex" blends Collect + Lexis, embodying smart language accumulation.
 *
 *
 *  更新日志
 *
 *  25/08/09  v0.1    增加监听事件.
 *  25/08/09  v0.2    增加GM设置面板.
 *  25/08/09  v0.3    优化代码, 将非必要的`let`声明修改为`const`.
 *  25/08/09  v0.4    获取单词和语境.
 *  25/08/10  v0.5    修复输入状态下触发脚本的bug;
 *                    修复在行内标签无法获取完整句子的bug;
 *                    修复裁剪句子的逻辑bug;
 *                    有关句子的bug应该告一段落了...吧.
 *  25/08/10  v0.6    优化代码结构.
 *  25/08/10  v0.7    开始实现查词卡片
 *  25/08/11  v0.7.1  初步编写弹出卡片, 并显示内容.
 *  25/08/11  v0.7.2  实现了一个后端的查词api;
 *                    调查了一些常见的英语学习词典
 *                    设计了查词前端api的结构: 一个中间件请求后端或网络api获取单词信息, 转换为json格式提供给前端卡片渲染.
 *  25/08/17  v0.7.3  初步实现卡片的展示函数
 *  25/08/17  v0.7.4  完成移除卡片和避免重复打开卡片的逻辑

任务
1. [功能]完成与后端的连接
2. [功能]编写中间件
3. [功能]渲染前端: 可以交给AI(似乎可以做一下多词典的布局.)
4. [功能]与anki连接
    4.1 需要连接anki的http接口, 并写一个持续的检测是否在线
    4.2 需要写好与anki的字段的对应
    4.3 需要在浏览器上再采集一些信息(url, 网页title, 甚至截图)
5. [优化]拆分选停选词和按键选词在监听事件中的逻辑
6. [优化]重写debugLog, 一方面更规范化方便调试时的filter, 一方面给debug分级.
5. [优化]调整卡片出现的位置
    5.1 出现位置由鼠标决定修改为选区的四个角座标决定
    5.2 默认右下角, 如果下方没有位置出现在右上角, 右方没有位置出现在左上角, 都没有位置仍然右下角.
5. [优化](没什么jb用)给卡片的三个小方块加一点点特效, 鼠标悬浮时, 红方块颜色变深, 蓝方块移动, 黄方块改变形状
6. [优化]写一个langchain, 可以查单词的词源或例句, 还可以根据单词出现的句子来直接推断是哪个释义, 直接放在最前面! 可以和mdict联动, 包裹起来.
   也许可以放在中间件, 因为我觉得可以复用词典的中间件, json化的数据似乎更适合AI处理...
7. [优化]以后再说啦, 改写成浏览器的插件, 火狐和chrome.
8. [优化]也许总有无法提取出句子的时候, 可以加一个手动模式, 复制单词, 句子, 甚至截图.

 */

(function () {
    'use strict';
    // ======== 全局对象 ========
    const g_selection = window.getSelection();
    const g_card = {
        cardElement: null,
        contentElement: null,
        debugElement: null,
        exists: false,
        containsPoint(x, y) {
            if (!this.cardElement || !this.exists) return false;
            // 获取卡片在视口中的位置和尺寸（包含 Shadow DOM 内部元素）
            const rect = this.cardElement.getBoundingClientRect();
            // 基础边界检查
            const isInBounds = (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            );
            return isInBounds;
        },
        fetchDict: {
            cobuild: async function(word, before = null, after = null) {
                const url = `http://127.0.0.1:5000/query?dict=COBUILD&q=${encodeURIComponent(word)}`;
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const response = await fetch(url, {
                        signal: controller.signal,
                        headers: { 'Accept': 'text/plain' }
                    });
                    clearTimeout(timeoutId);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return await response.text();
                } catch (error) {
                    console.error('[Dict Fetch Error]', error);
                    return Promise.reject(`查询失败: ${error.message || '未知错误'}`);
                }
                //},
                const data = await WebUtils.fetchDict(word)
                this.debugShow(data);
            },
        }, // 用来将词典提供的各种结构的数据转换成统一结构的json数据
        debugShow(html_debuginfo) {
            if (!this.debugElement || !html_debuginfo) return;
            debugLog('按键/定位/获取/处理/请求/格式', html_debuginfo)
            const debugItem = document.createElement('p');
            debugItem.innerHTML = html_debuginfo;
            this.debugElement.appendChild(debugItem);
        },
        contentShow(json_content) {
            if (!this.contentElement || !json_content) return;
            this.debugShow(json_content);

            // Create combined sentence with highlighted word
            const html = `
                    <div class="word-card">
                        <div class="sentence">
                            ${json_content.before || ''}
                            <span class="highlight-word">${json_content.word || ''}</span>
                            ${json_content.after || ''}
                        </div>
                    </div>
                `;

            // insert
            this.contentElement.innerHTML = html;

            // Add styling
            const style = document.createElement('style');
            style.textContent = `
                    .word-card {
                        padding: 10px;
                        font-family: Arial, sans-serif;
                        line-height: 1.5;
                        text-align: left; /* 强制左对齐 */
                    }
                    .sentence {
                        word-break: break-word;
                    }
                    .highlight-word {
                        font-weight: bold;
                        color: #0066cc;
                        background-color: rgba(0, 102, 204, 0.1);
                        padding: 2px 1px;
                        border-radius: 3px;
                    }
                `;
            this.contentElement.appendChild(style);
        },
        remove: function() {
            if (!this.exists || this.cardElement === null) {
                debugLog('按键/定位/获取/处理/请求/格式/结束', 'error', 'remove card but the card does not exist');
                return;
            }
            this.cardElement.remove();
            this.exists = false;
            this.cardElement = null;
            this.contentElement= null;
            this.debugElement= null;
            debugLog('按键/定位/获取/处理/请求/格式/结束', '-------------')
        },
        create: async function(query) {
            if (this.exists) {
                debugLog('按键/定位/获取/处理/绘制',  'old card removed')
                this.remove()
            }
            // 外层容器（挂在页面上）
            const wrapper = document.createElement('div');
            wrapper.style.position = 'fixed';
            wrapper.style.left = `${mousePos.x}px`;
            wrapper.style.top = `${mousePos.y}px`;
            wrapper.style.zIndex = 999999;

            // 创建 Shadow DOM
            const shadow = wrapper.attachShadow({ mode: 'open' });

            // 内部主容器
            const container = document.createElement('div');
            container.style.width = '400px';
            container.style.height = '300px';
            container.style.border = '1px solid #ccc';
            container.style.background = '#f9f9f9';
            container.style.overflow = 'auto';
            container.style.boxSizing = 'content-box';
            shadow.appendChild(container);

            const contentP = document.createElement('p');
            contentP.innerText = "content"
            container.appendChild(contentP)

            const contentDiv = document.createElement('div');
            contentDiv.id = 'content-div'
            container.appendChild(contentDiv)
            this.contentElement = contentDiv

            const debugP = document.createElement('p');
            debugP.innerText = "debug"
            container.appendChild(debugP)

            const debugDiv = document.createElement('div');
            debugDiv.id = 'debug-div'
            container.appendChild(debugDiv)
            this.debugElement = debugDiv

            // 注入样式（只作用于 shadow 内部）
            const style = document.createElement('style');
            style.textContent = `
                .handle {
                    position: absolute;
                    width: 12px;
                    height: 12px;
                    border-radius: 2px;
                }
                .resize {
                    right: 0;
                    bottom: 0;
                    background: #09f;
                    cursor: nwse-resize;
                    transform: translate(50%, 50%);
                }

                .move {
                    left: 0;
                    bottom: 0;
                    background: yellow;
                    cursor: move;
                    transform: translate(-50%, 50%);
                }

                .close {
                    right: 0;
                    top: 0;
                    background: red;
                    cursor: pointer;
                    transform: translate(50%, -50%);
                }

            `;
            shadow.appendChild(style);

            // 内容区
            const content = document.createElement('div');
            container.appendChild(content);

            // 右下角蓝色方块（缩放）
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'handle resize';
            container.appendChild(resizeHandle);

            // 左下角黄色方块（移动）
            const moveHandle = document.createElement('div');
            moveHandle.className = 'handle move';
            container.appendChild(moveHandle);

            // 右上角红色方块（关闭）
            const closeHandle = document.createElement('div');
            closeHandle.className = 'handle close';
            closeHandle.title = '关闭';
            closeHandle.addEventListener('click', () => wrapper.remove());
            container.appendChild(closeHandle);

            // 缩放逻辑
            let isResizing = false;
            resizeHandle.addEventListener('mousedown', e => {
                e.preventDefault();
                isResizing = true;
            });

            // 移动逻辑
            let isMoving = false;
            let offsetX = 0, offsetY = 0;
            moveHandle.addEventListener('mousedown', e => {
                e.preventDefault();
                isMoving = true;
                const rect = wrapper.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
            });

            document.addEventListener('mousemove', e => {
                if (isResizing) {
                    const newWidth = e.clientX - wrapper.getBoundingClientRect().left;
                    const newHeight = e.clientY - wrapper.getBoundingClientRect().top;
                    container.style.width = Math.max(newWidth, 50) + 'px';
                    container.style.height = Math.max(newHeight, 30) + 'px';
                } else if (isMoving) {
                    wrapper.style.left = (e.clientX - offsetX) + 'px';
                    wrapper.style.top = (e.clientY - offsetY) + 'px';
                }
            });

            document.addEventListener('mouseup', () => {
                isResizing = false;
                isMoving = false;
            });

            this.cardElement = wrapper;
            this.exists = true;
            document.body.appendChild(wrapper);


            const json_content = await this.fetchDict.cobuild(query.word);
            /*
            // 请求网络数据并内容填充
            const json_string = `{
                "before": ${JSON.stringify(query.before)},
                "word": ${JSON.stringify(query.word)},
                "after": ${JSON.stringify(query.after)}
            }`;
            const json_content = JSON.parse(json_string);
            // debugLog('json content:', json_content)
            */
            this.contentShow(json_content)


        },
    };


    // ======== 默认设置 ========
    const defaultSettings = {
        hotkey: 'Control',
        enableMouseSelection: true,
        enableHoverSelection: true,
        enableDebugMode: false
    };
    const settings = loadSettings();

    function loadSettings() {
        const loaded = {};
        for (const key in defaultSettings) {
            loaded[key] = GM_getValue(key, defaultSettings[key]);
        }
        return loaded;
    }

    function saveSettings() {
        for (const key in settings) {
            GM_setValue(key, settings[key]);
        }
    }


    // ======== Debug 输出工具 ========
    function debugLog(category, ...args) {
        if (settings.enableDebugMode) {
            console.log(`Collex Debug > [${category}] `, ...args);
        }
    }

    // ======== 事件监听 ========
    let hotkeyPressed = false;
    let lastWordRange = null;
    let mousePos = {x: 0, y: 0}

    document.addEventListener('keydown', (e) => {
        if (isInputTarget(e.target)) return;
        if (e.key !== settings.hotkey) return;
        if (hotkeyPressed) return;

        hotkeyPressed = true;
        debugLog('按键', `Hotkey "${settings.hotkey}" pressed.`, 'Mouse position:', mousePos);

    });

    document.addEventListener('keyup', (e) => {
        // if (isInputTarget(e.target)) debugLog('input target')
        if (isInputTarget(e.target)) return;
        if (e.key !== settings.hotkey) return;
        hotkeyPressed = false;

        // 判断是否在卡片外部查词.
        if (g_card.exists && g_card.containsPoint(mousePos.x, mousePos.y)) {
            debugLog('按键', 'keyup', 'event in card')
            return;
        }
        if (g_card.exists && !g_card.containsPoint(mousePos.x, mousePos.y)) {
            debugLog('按键', 'keyup', 'event out card')
        }
        const caret = document.caretPositionFromPoint(mousePos.x, mousePos.y)
        debugLog('按键/定位', 'keyup get caret', caret)
        const wordRange = getWordRangeFromCaret(caret);
        debugLog('按键/定位/获取', 'get word range', wordRange);
        if (wordRange === null) return;

        lastWordRange = wordRange
        g_selection.removeAllRanges();
        g_selection.addRange(lastWordRange);
        debugLog('按键/定位/获取', 'current word range changed', lastWordRange)
        queryWord(wordRange)


    });

    let lastMouseLogTime = 0;
    document.addEventListener('mousemove', (e) => {
        mousePos = { x: e.clientX, y: e.clientY };
        if (!settings.enableHoverSelection) return;
        if (!hotkeyPressed) return;
        if (isInputTarget(e.target)) return;
        if (g_card.exists && g_card.cardElement.contains(e.target)) {
            debugLog('按键', 'mousemove', 'event in card')
            return;
        }
        // if (g_card.exists && !g_card.cardElement.contains(e.target)) debugLog('mousemove', 'event out card')
        const caret = document.caretPositionFromPoint(mousePos.x, mousePos.y)
        const wordRange = getWordRangeFromCaret(caret);
        const currentTime = Date.now();
        if (currentTime - lastMouseLogTime >= 1000) {
            lastMouseLogTime = currentTime;
            debugLog('按键', 'Mouse move under hotkey pressed', mousePos);
            debugLog('按键/定位', 'Mouse move get caret', caret);
            debugLog('按键/定位/获取', 'get word range', wordRange);
        }
        // 如果当前选中的词变化了, 才查新的词.
        if (wordRange === null || lastWordRange && areRangesEqual(lastWordRange, wordRange)) return;

        lastWordRange = wordRange
        if (wordRange === null) return;
        g_selection.removeAllRanges();
        g_selection.addRange(wordRange);
        debugLog('按键/定位/获取', 'current word range changed', lastWordRange)
        queryWord(wordRange)


    });

    document.addEventListener('mouseup', (e) => {
        if (g_card.exists && !g_card.cardElement.contains(e.target)) {
            g_card.remove();
            debugLog('按键', 'mouseup', 'event out card');
            return;
        }
        if (!settings.enableMouseSelection) {
            debugLog('按键', 'mouseup', 'mouse selection disabled');
        };
        if (isInputTarget(e.target)) {
            debugLog('按键', 'mouseup', 'event in input');
            return;
        }
        if (g_card.exists && g_card.cardElement.contains(e.target)) {
            debugLog('按键', 'mouseup', 'event in card')
            return;
        }
        if (g_selection.rangeCount === 0) {
            debugLog('按键', 'mouseup', 'no selection')
            return;
        }

        const wordRange = g_selection.getRangeAt(0)
        if (wordRange.toString().trim() === "") return;
        debugLog('按键/定位/获取', 'mouse up selection range', wordRange)
        queryWord(wordRange);
    });


    // ======== 工具函数 ========
    function isInputTarget(target) {
        const tag = target.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    }

    function isInputActive() {
        const activeElement = document.activeElement;
        const inputTypes = ['input', 'textarea', 'select', 'button', 'a'];

        return (
            activeElement &&
            (inputTypes.includes(activeElement.tagName.toLowerCase()) ||
             activeElement.isContentEditable)
        );
    }

    function areRangesEqual(range1, range2) {
        return (
            range1.startContainer === range2.startContainer &&
            range1.startOffset === range2.startOffset &&
            range1.endContainer === range2.endContainer &&
            range1.endOffset === range2.endOffset
        );
    }

    function getRangeOffsetsInCommonAncestor(startContainer, startOffset, endContainer, endOffset, rootContainer) {
        if (!rootContainer || !(rootContainer instanceof Node)) {
            throw new Error('rootContainer 必须是 Node 对象');
        }

        let foundStart = false;
        let foundEnd = false;
        let charCount = 0;
        let startCharOffset = null;
        let endCharOffset = null;

        // 递归遍历 rootContainer 下所有文本节点，累计字符长度
        function traverse(node) {
            if (foundEnd) return; // 都找到了就停止遍历

            if (node.nodeType === Node.TEXT_NODE) {
                if (!foundStart && node === startContainer) {
                    startCharOffset = charCount + startOffset;
                    foundStart = true;
                }
                if (!foundEnd && node === endContainer) {
                    endCharOffset = charCount + endOffset;
                    foundEnd = true;
                }
                charCount += node.textContent.length;
            } else {
                for (let child of node.childNodes) {
                    traverse(child);
                    if (foundEnd) break;
                }
            }
        }

        traverse(rootContainer);

        if (startCharOffset === null || endCharOffset === null) {
            throw new Error('未能在公共祖先节点内找到 Range 的起止容器');
        }

        return {
            containerNode: rootContainer,
            startOffset: startCharOffset,
            endOffset: endCharOffset,
        };
    }

    // 选择单词
    // 返回range
    function getWordRangeFromCaret(caret) {
        if (!caret) return null;

        let node = caret.offsetNode;
        let offset = caret.offset;

        // 如果不是文本节点，尝试找第一个文本节点
        if (node.nodeType !== Node.TEXT_NODE) {
            let walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
            node = walker.nextNode();
            if (!node) return null;
            offset = 0;
        }

        const text = node.textContent;
        if (!text) return null;

        // 匹配字符规则：字母、数字、下划线、横杠
        const isWordChar = (ch) => /[A-Za-z0-9_-]/.test(ch);

        // 找左边界
        let start = offset;
        while (start > 0 && isWordChar(text[start - 1])) start--;

        // 找右边界
        let end = offset;
        while (end < text.length && isWordChar(text[end])) end++;

        // 避免单词开头或结尾出现横杠
        while (start < end && text[start] === '-') start++;
        while (end > start && text[end - 1] === '-') end--;

        if (start >= end) return null; // 没有有效单词

        // 创建 range
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);

        return range;
    }

    // ======== web 工具类 ========
    const WebUtils = {
        /**
         * 查询词典 API
         * @param {string} word 要查询的单词
         * @param {string} dictName 词典类型 (默认 'collins')
         * @param {number} timeout 超时时间 (默认 3000ms)
         * @returns {Promise<string>} 返回原始字符串数据
         */
        fetchDict: async function(word, dictName = 'COBUILD', timeout = 3000) {
            const url = `http://127.0.0.1:5000/query?dict=${encodeURIComponent(dictName)}&q=${encodeURIComponent(word)}`;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: { 'Accept': 'text/plain' }
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.text();
            } catch (error) {
                console.error('[Dict Fetch Error]', error);
                return Promise.reject(`查询失败: ${error.message || '未知错误'}`);
            }
        },
    }
    // ======== GM 菜单开关 ========

    function registerMenus() {
        GM_registerMenuCommand(`启用 Debug Mode: ${settings.enableDebugMode ? '✅' : '❌'}`, () => {
            settings.enableDebugMode = !settings.enableDebugMode;
            saveSettings();
            registerMenus();
        }, {
            id: 'enable-debug-mode',
        });

        GM_registerMenuCommand(`启用 鼠标选择: ${settings.enableMouseSelection ? '✅' : '❌'}`, () => {
            settings.enableMouseSelection = !settings.enableMouseSelection;
            saveSettings();
            registerMenus();
        }, {
            id: 'enable-mouse-selection',
        });

        GM_registerMenuCommand(`启用 悬浮选择: ${settings.enableHoverSelection ? '✅' : '❌'}`, () => {
            settings.enableHoverSelection = !settings.enableHoverSelection;
            saveSettings();
            registerMenus();
        }, {
            id: 'enable-hover-selection',
        });

        GM_registerMenuCommand(`设置快捷键 (当前: ${settings.hotkey})`, () => {
            const key = prompt('请输入快捷键名称（例如 Control / Alt / Shift / F2）', settings.hotkey);
            if (key) {
                settings.hotkey = key;
                saveSettings();
                registerMenus();
            }
        }, {
            id: 'set-hotkey',
        });
        debugLog('初始化', "update GM menu settings", settings)
    }

    // ======== 查词页面 ========
    function queryWord(range) {
        // { containerNode, startOffset, endOffset }
        const wordRange = getRangeOffsetsInCommonAncestor(
            range.startContainer, range.startOffset,
            range.endContainer, range.endOffset,
            range.commonAncestorContainer);

        const fullText = wordRange.containerNode.textContent; // 或 textNode.nodeValue
        const selectedWord = fullText.slice(wordRange.startOffset, wordRange.endOffset);
        debugLog('按键/定位/获取', 'selected text:', selectedWord);

        // ==== 查找的单词所在句子 ====
        const {before, after} = extractSentence(wordRange.containerNode, wordRange.startOffset, wordRange.endOffset);
        debugLog('按键/定位/获取/处理',
                 'Extract sentence',
                 `\n[before] "${before}"`,
                 `\n[word]   "${selectedWord}"`,
                 `\n[after]  "${after}"`);

        // ==== 唤起查词页面 ====
        g_card.create({before, word: selectedWord, after})
    }

    function extractSentence(containerNode, startOffset, endOffset) {
        const sentenceBoundary = /([.!?])(?=\s+["'“”]?[A-Z]|$)/;

        function getFirstTextNode(el) {
            if (el.nodeType === Node.TEXT_NODE) return el;
            for (let child of el.childNodes) {
                let found = getFirstTextNode(child);
                if (found) return found;
            }
            return null;
        }

        function getLastTextNode(el) {
            if (el.nodeType === Node.TEXT_NODE) return el;
            for (let i = el.childNodes.length - 1; i >= 0; i--) {
                let found = getLastTextNode(el.childNodes[i]);
                if (found) return found;
            }
            return null;
        }

        function collectBackward(node, offset) {
            let text = node.textContent.slice(0, offset);
            let current = node;

            while (true) {
                debugLog('按键/定位/获取/处理', 
                    '[collect backward] 当前节点:', current, '当前文本:', JSON.stringify(text));

                if (sentenceBoundary.test(text)) {
                    debugLog('按键/定位/获取/处理', '[collect backward] 命中句子边界，停止');
                    break;
                }

                if (!current.previousSibling) {
                    // 如果当前节点是行内元素的子节点，则跳到父节点继续向上找
                    if (
                        current.parentNode &&
                        current.parentNode.nodeType === Node.ELEMENT_NODE &&
                        window.getComputedStyle(current.parentNode).display === 'inline'
                    ) {
                        current = current.parentNode;
                        continue; // 再次尝试 previousSibling
                    }
                    break; // 块级元素或到根节点，停止
                }

                current = current.previousSibling;

                if (current.nodeType === Node.TEXT_NODE) {
                    text = current.textContent + text;
                } else if (current.nodeType === Node.ELEMENT_NODE) {
                    if (window.getComputedStyle(current).display === 'block') break;
                    let lastText = getLastTextNode(current);
                    if (lastText) {
                        text = lastText.textContent + text;
                    }
                }
            }

            return text;
        }

        function collectForward(node, offset) {
            let text = node.textContent.slice(offset);
            let current = node;

            while (true) {
                debugLog('按键/定位/获取/处理', '[collect forward] 当前节点:', current, '当前拼接文本:', JSON.stringify(text));

                if (sentenceBoundary.test(text)) {
                    debugLog('按键/定位/获取/处理', '[collect forward] 命中句子边界，停止');
                    break;
                }

                if (!current.nextSibling) {
                    // 如果父节点是行内元素，则跳到父节点继续向后找
                    if (
                        current.parentNode &&
                        current.parentNode.nodeType === Node.ELEMENT_NODE &&
                        window.getComputedStyle(current.parentNode).display === 'inline'
                    ) {
                        current = current.parentNode;
                        continue; // 再次尝试 nextSibling
                    } else {
                        break; // 块级元素或到根节点，停止
                    }
                }

                current = current.nextSibling;

                if (current.nodeType === Node.TEXT_NODE) {
                    text += current.textContent;
                } else if (current.nodeType === Node.ELEMENT_NODE) {
                    if (window.getComputedStyle(current).display === "block") break;
                    const firstText = getFirstTextNode(current);
                    if (firstText) {
                        text += firstText.textContent;
                    }
                }
            }
            return text;
        }


        let before = collectBackward(containerNode, startOffset);
        let after = collectForward(containerNode, endOffset);
        // 将换行符替换为空格
        before = before.replace(/\n/g, ' ');
        after = after.replace(/\n/g, ' ');
        debugLog('按键/定位/获取/处理', 'Extract context',
                 `\n[before] "${before}"`,
                 `\n[word]   "${containerNode.textContent.slice(startOffset, endOffset)}"`,
                 `\n[after]  "${after}"`);

        // 这段真是完美的代码啊.
        // 打脸了.
        before = before.trim()
        after = after.trim()
        let sentenceStartIdx = 0;
        let relativeStartIdx = 0;
        while (relativeStartIdx !== -1) {
            relativeStartIdx = before.slice(sentenceStartIdx).search(sentenceBoundary)
            sentenceStartIdx = sentenceStartIdx + relativeStartIdx + 1
        }

        let sentenceEndIdx = after.length;
        const relativeEndIdx = after.search(sentenceBoundary);
        if (relativeEndIdx !== -1) sentenceEndIdx = relativeEndIdx + 1;

        return {
            before: before.slice(sentenceStartIdx, before.length).trim(),
            after: after.slice(0, sentenceEndIdx).trim()
        };
    }



    registerMenus();
})();
 
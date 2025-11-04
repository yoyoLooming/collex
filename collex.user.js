// ==UserScript==
// @name         采词
// @version      0.8
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
 *  25/11/02  v0.8    0.8版本要重构代码!!!!!!!!
 *                    将项目结构重构为 app 和几个 manager:
 *                      dict, settings, selection, utils, card.
 *  25/11/03  v0.9    懒得继续重构了. 重构完, 写了一天, 没bug了, 所以继续写新功能了.
 *                    新功能将会暂时很简单. 释义直接问ai, 然后直接投入到anki的连接里面.
 *                    还需要重新写一下展示卡片位置的事情. 直接传入rects吧.

任务
1. [功能]完成与后端的连接
2. [功能]编写中间件
3. [功能]渲染前端: 可以交给AI(似乎可以做一下多词典的布局.)
4. [功能]与anki连接
    4.1 需要连接anki的http接口, 并写一个持续的检测是否在线
    4.2 需要写好与anki的字段的对应
    4.3 需要在浏览器上再采集一些信息(url, 网页title, 甚至截图)
5. [优化]拆分选停选词和按键选词在监听事件中的逻辑
6. [优化]重写Utils.debug_log, 一方面更规范化方便调试时的filter, 一方面给debug分级.
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

    class CollexApp {
        constructor() {
            this.settingsManager = new SettingsManager();
            Utils.init(() => this.settingsManager.get('enableDebugMode'))
            this.rangeManager = new RangeManager();
            this.cardManager = new CardManager();
            this.dictManager = new DictManager(
                this.settingsManager.get.bind(this.settingsManager),
            );
            this.eventManager = new EventManager(
                this.settingsManager.get.bind(this.settingsManager),
                this.cardManager.cardExists.bind(this.cardManager),
                this.cardManager.isPointInCard.bind(this.cardManager),
                this.cardManager.isMouseInCard.bind(this.cardManager),
                this.cardManager.removeCard.bind(this.cardManager),
                this.queryFromPoint.bind(this),
                this.queryFromSelection.bind(this),
                this.rangeManager.resetLastSelection.bind(this.rangeManager)
            );
            this.init();
        }

        init() {
            this.settingsManager.load();
            this.eventManager.bindEvents();
            this.settingsManager.registerMenus();
        }

        queryFromPoint(x, y) {

            const wordRange = this.rangeManager.getRangeFromPoint(x, y)
            if (wordRange === null) return;
            if (this.rangeManager.tryUpdateSelectionbyPoint(wordRange)) this.queryWord(wordRange)
        }

        queryFromSelection() {
            if (!this.rangeManager.selectionExists()) return;
            const wordRange = this.rangeManager.getSelectedRange();
            this.queryWord(wordRange)
        }

        async queryWord(range) {
            Utils.debug_log('[app] [query range]' + range.toString())
            let info = {
                pre: null,
                word: null,
                post: null,
                meaning: null,
                url: null,
                title: null,
                favicon: null,
            };
            Object.assign(info, this.rangeManager.extractContext(range))
            Utils.debug_log("[app] [info]" + JSON.stringify(info))
            Object.assign(info, Utils.collectContext())
            info.meaning = this.dictManager.query(info)
            const pos = this.rangeManager.getRangeCorners()
            this.cardManager.createCard(pos, info)
        }
    };
    /**
     * 词典管理
     */
    class DictManager {
        async query(context) {
            /* context = {
                pre: null,
                word: null,
                post: null,
                url: null,
                title: null,
                favicon: null,
            };
            */
            // "meaning xxx"
            return this.dict_ai(context);
        }

        async dict_ai(context) {
            const DEEPSEEK_API_KEY = ""; // 请替换为你的API密钥
            const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"; // DeepSeek API端点

            try {
                // 构建完整的句子
                const fullSentence = `${context.pre || ''} [ ${context.word} ] ${context.post || ''}`.trim();

                // 构建提示词，明确要求单词解释
                let prompt = `"${fullSentence}"\n请解释上面句子中"${context.word}"这个词的含义\n`;
                // 可选：添加辅助信息（根据实验效果决定是否使用）
                const additionalInfo = [];
                if (context.title) additionalInfo.push(`标题: ${context.title}`);

                if (additionalInfo.length > 0) {
                    prompt += `\n\n辅助信息:\n${additionalInfo.join('\n')}`;
                }

                const requestBody = {
                    model: "deepseek-chat", // 根据可用的模型调整
                    messages: [
                        {
                            role: "system",
                            content: `
你是一个专业的语言教师，专注于提供单词在具体语境中的准确解释。
用户的英语水平是中高级学习者, 了解常见的语言知识.
如果用户询问的phrase是一个单词或者很常用的固定搭配, 就请首先, 
在这个单词的所有的通用解释(就是和语境无关, 会在词典中看到的那样)中选择那个当前语境使用了的那个释义,
并用英语提供, 使用vocabulary.com风格;
然后再结合语境(意思不是解释语境这句话, 而是说你给的词要蕴含着语境的信息, 这要求你选择最恰当的那个词), 用中文, 只用一个词来解释用户询问的东西.
else, 如果用户提供的phrase是一个句子, 或者不完整的句子, 并不是固定搭配, 就请简单提供它的中文翻译.
如果用户提交的phrase涉及到的单词非常简单, 那么他也许是不明白其中涉及到的概念, 请你解释一下.
我希望输出结果不要带有markdown标点. `
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    max_tokens: 500,
                    stream: false,
                    temperature: 0.5 // 较低的温度以获得更确定的回答
                };

                const response = await fetch(DEEPSEEK_API_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();

                // 提取回答内容
                const meaning = data.choices[0]?.message?.content?.trim();

                if (!meaning) {
                    throw new Error("未能获取有效的解释");
                }

                Utils.debug_log(`[dict manager] [ask ai] deepseek: ${meaning}`)

                return meaning;

            } catch (error) {
                Utils.debug_log("[dict manager] [fetch] 调用DeepSeek API时出错:" + error);

                // 降级方案：返回基本解释或错误信息
                return `无法获取"${context.word}"的解释。错误: ${error.message}`
            }
        }
        /**
         * 查询词典 API
         * @param {string} word 要查询的单词
         * @param {string} dictName 词典类型 (默认 'collins')
         * @param {number} timeout 超时时间 (默认 3000ms)
         * @returns {Promise<string>} 返回原始字符串数据
         */
        fetchDict = async function (word, dictName = 'COBUILD', timeout = 3000) {
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
        }
    }
    // ======== 设置管理 ========
    class SettingsManager {
        constructor() {
            this.defaultSettings = {
                hotkey: 'Control',
                enableMouseSelection: true,
                enableHoverSelection: true,
                enableDebugMode: false
            };
            this.settings = {};
        }

        load() {
            const loaded = {};
            for (const key in this.defaultSettings) {
                loaded[key] = GM_getValue(key, this.defaultSettings[key]);
            }
            this.settings = loaded;
            return this.settings;
        }

        save() {
            for (const key in this.settings) {
                GM_setValue(key, this.settings[key]);
            }
        }

        get(key) {
            return this.settings[key];
        }

        set(key, value) {
            this.settings[key] = value;
            this.save();
        }

        toggle(key) {
            this.settings[key] = !this.settings[key];
            this.save();
            return this.settings[key];
        }

        registerMenus() {
            GM_registerMenuCommand(`启用 Debug Mode: ${this.get('enableDebugMode') ? '✅' : '❌'}`, () => {
                this.toggle('enableDebugMode');
                this.registerMenus(); // 刷新菜单
            }, { id: 'enable-debug-mode' });

            GM_registerMenuCommand(`启用 鼠标选择: ${this.get('enableMouseSelection') ? '✅' : '❌'}`, () => {
                this.toggle('enableMouseSelection');
                this.registerMenus();
            }, { id: 'enable-mouse-selection' });

            GM_registerMenuCommand(`启用 悬浮选择: ${this.get('enableHoverSelection') ? '✅' : '❌'}`, () => {
                this.toggle('enableHoverSelection');
                this.registerMenus();
            }, { id: 'enable-hover-selection' });

            GM_registerMenuCommand(`设置快捷键 (当前: ${this.get('hotkey')})`, () => {
                const key = prompt('请输入快捷键名称（例如 Control / Alt / Shift / F2）', this.get('hotkey'));
                if (key) {
                    this.set('hotkey', key);
                    this.registerMenus();
                }
            }, { id: 'set-hotkey' });
        }

        // 便捷方法
        isDebugEnabled() {
            return this.get('enableDebugMode');
        }

        isMouseSelectionEnabled() {
            ``
            return this.get('enableMouseSelection');
        }

        isHoverSelectionEnabled() {
            return this.get('enableHoverSelection');
        }

        getHotkey() {
            return this.get('hotkey');
        }

        setHotKey(value) {
            this.set('hotkey', value)
        }
    }
    class RangeManager {
        constructor() {
            this.selection = window.getSelection();
            this.lastRangeFromPoint = null;
        }
        getRangeCorners() {
            const rects = this.selection.getRangeAt(0).getClientRects();
            const firstRect = rects[0];
            const lastRect = rects[rects.length - 1];

            return {
                top_left: {
                    x: firstRect.left,
                    y: firstRect.top
                },
                top_right: {
                    x: firstRect.right,
                    y: firstRect.top
                },
                bottom_left: {
                    x: lastRect.left,
                    y: lastRect.bottom
                },
                bottom_right: {
                    x: lastRect.right,
                    y: lastRect.bottom
                }
            };
        }
        getSelectedRange() {
            return this.selection.getRangeAt(0);
        }
        tryUpdateSelectionbyPoint(range) {
            if (RangeManager.rangeEquals(range, this.lastRangeFromPoint)) return false;
            this.lastRangeFromPoint = range
            this.selection.removeAllRanges();
            this.selection.addRange(range);
            return true
        }
        resetLastSelection() {
            this.lastRangeFromPoint = null;
        }
        static rangeEquals(range1, range2) {
            return (
                range1 !== null && range2 !== null &&
                range1.startContainer === range2.startContainer &&
                range1.startOffset === range2.startOffset &&
                range1.endContainer === range2.endContainer &&
                range1.endOffset === range2.endOffset
            );
        }

        selectionExists() {
            // todo
            if (this.selection.rangeCount === 0) return false;
            const wordRange = this.selection.getRangeAt(0)
            if (wordRange.toString().trim() === "") return false;
            return true
        }

        extractContext(range) {
            // node, startOffset, endOffset
            const wordRangeX = this.getRangeOffsetsInCommonAncestor(
                range.startContainer, range.startOffset,
                range.endContainer, range.endOffset,
                range.commonAncestorContainer);
            Utils.debug_log('[range manager] [word range x]' + JSON.stringify(wordRangeX))
            const fullText = wordRangeX.containerNode.textContent; // 或 textNode.nodeValue
            const selectedWord = fullText.slice(wordRangeX.startOffset, wordRangeX.endOffset);
            Utils.debug_log('[range manager]' + 'selected text:' + selectedWord);

            // ==== 查找的单词所在句子 ====
            const { pre, post } = this.extractSentence(wordRangeX.containerNode, wordRangeX.startOffset, wordRangeX.endOffset);
            Utils.debug_log('[range manager]' +
                'Extract sentence' +
                `\n[pre] "${pre}"` +
                `\n[word]   "${selectedWord}"` +
                `\n[post]  "${post}"`);
            return {
                pre,
                word: selectedWord,
                post,
            }
        }

        getRangeOffsetsInCommonAncestor = function (startContainer, startOffset, endContainer, endOffset, rootContainer) {
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

        getRangeFromPoint(x, y) {
            const caret = document.caretPositionFromPoint(x, y)
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

        // 选择单词
        // 返回range
        getWordRangeFromCaret = function (caret) {
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
        extractSentence = function (containerNode, startOffset, endOffset) {
            Utils.debug_log(`[range manager] [extract sentence] offsets: [${startOffset}, ${endOffset}] text: ${containerNode.textContent}`)
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
                    // Utils.debug_log('按键/定位/获取/处理', '[collect backward] 当前节点:', current, '当前文本:', JSON.stringify(text));

                    if (sentenceBoundary.test(text)) {
                        // Utils.debug_log('按键/定位/获取/处理', '[collect backward] 命中句子边界，停止');
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
                    // Utils.debug_log('按键/定位/获取/处理', '[collect forward] 当前节点:', current, '当前拼接文本:', JSON.stringify(text));

                    if (sentenceBoundary.test(text)) {
                        // Utils.debug_log('按键/定位/获取/处理', '[collect forward] 命中句子边界，停止');
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
                pre: before.slice(sentenceStartIdx, before.length).trim(),
                post: after.slice(0, sentenceEndIdx).trim()
            };
        }

    }


    class WordCard {
        constructor(pos, info) {
            this.CARD_WIDTH = 400;
            this.CARD_HEIGHT = 300;
            this.cardElement = null;
            this.contentElement = null;
            this.debugElement = null;
            this.exists = false;

            this.create(pos)
            this.showLoading();
            this.renderContent(info);

            // 挂载到页面
            document.body.appendChild(this.cardElement);
            this.exists = true;
        }
        showLoading() {
            this.contentElement.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
                <div style="text-align: center;">
                    <div style="margin-bottom: 8px;">加载中...</div>
                    <div style="width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #007cba; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        }
        create(pos) {

            const CARD_WIDTH = 400;
            const CARD_HEIGHT = 300;

            const finalPos = this.computePosition(pos, CARD_WIDTH, CARD_HEIGHT);

            const wrapper = document.createElement('div');
            wrapper.style.position = 'fixed';
            wrapper.style.left = `${finalPos.left}px`;
            wrapper.style.top = `${finalPos.top}px`;
            wrapper.style.zIndex = 999;

            const shadow = wrapper.attachShadow({ mode: 'open' });

            const container = document.createElement('div');
            container.style.width = `${CARD_WIDTH}px`;
            container.style.height = `${CARD_HEIGHT}px`;
            container.style.border = '1px solid #ccc';
            container.style.background = '#f9f9f9';
            container.style.overflow = 'auto';
            container.style.overflowWrap = 'break-word'
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
        };


        showError(message) {
            this.debugElement.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #d32f2f;">
                <div style="text-align: center;">
                    <div style="margin-bottom: 8px;">❌</div>
                    <div>${message}</div>
                </div>
            </div>
        `;
        }
        escapeHtml(unsafe) {
            if (typeof unsafe !== 'string') return unsafe;
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;")
                ;
        }

        async renderContent(info) {

            info.meaning = await info.meaning;
            let contentHTML = '';

            // 标题区域（如果有标题信息）
            if (info.title || info.siteName) {
                contentHTML += `
                <div style="margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 12px;">
                    ${info.title ? `<div style="font-weight: bold; font-size: 16px; margin-bottom: 4px;">${this.escapeHtml(info.title)}</div>` : ''}
                    ${info.siteName ? `<div style="font-size: 12px; color: #666;">${this.escapeHtml(info.siteName)}</div>` : ''}
                </div>
            `;
            }

            // 核心词汇信息
            contentHTML += `
            <div style="margin-bottom: 16px;">
                ${info.pre ? `<span style="color: #666;">${this.escapeHtml(info.pre)}</span>` : ''}
                <span style="font-weight: bold; color: #007cba; background: #f0f8ff; padding: 2px 4px; border-radius: 3px;">${this.escapeHtml(info.word || '')}</span>
                ${info.post ? `<span style="color: #666;">${this.escapeHtml(info.post)}</span>` : ''}
            </div>
        `;

            // 词义解释
            if (info.meaning) {
                contentHTML += `
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: bold; margin-bottom: 8px; color: #333;">释义</div>
                    <div style="color: #555; line-height: 1.5;">${this.escapeHtml(info.meaning)}</div>
                </div>
            `;
            }

            // 如果没有核心内容，显示提示
            if (!info.word && !info.meaning) {
                contentHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">
                    <div style="text-align: center;">
                        <div>暂无可用信息</div>
                    </div>
                </div>
            `;
            }
            contentHTML += `
    <div style="margin-top: 20px; text-align: center;">
        <button id="add-to-anki-btn"
            style="background-color: #007cba; color: white; border: none;
                   padding: 8px 16px; border-radius: 5px; cursor: pointer;
                   transition: background-color 0.3s;">
            添加到 Anki
        </button>
    </div>
`;
            this.contentElement.innerHTML = contentHTML;


            // === 绑定按钮事件 ===
            const btn = this.contentElement.querySelector("#add-to-anki-btn");
            const openAnkiNote = (noteId) => {
                const browsePayload = {
                    action: "guiBrowse",
                    version: 6,
                    params: {
                        query: `nid:${noteId}` // 使用 note ID 进行查询
                    }
                };

                // 尝试发送请求到 AnkiConnect
                fetch("http://127.0.0.1:8765", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(browsePayload)
                })
                    .then(response => response.json())
                    .then(result => {
                        if (result.error) {
                            console.error("AnkiConnect guiBrowse Error:", result.error);
                            // 可以在这里给用户一些反馈，比如一个短暂的提示
                        } else {
                            console.log("Successfully opened Anki browser to note:", noteId);
                        }
                    })
                    .catch(err => {
                        console.error("Fetch Error for guiBrowse:", err);
                    });
            };
            if (btn) {
                btn.onclick = async () => {
                    btn.style.backgroundColor = "#f1c40f"; // 黄色：发送中
                    btn.textContent = "正在发送...";
                    const payload = {
                        action: "addNote",
                        version: 6,
                        params: {
                            note: {
                                deckName: "read",
                                modelName: "collex",
                                fields: {
                                    word: info.word || '',
                                    pre: info.pre || '',
                                    post: info.post || '',
                                    meaning: Utils.wrapHTML(info.meaning) || '',
                                    url: info.url || '',
                                    title: info.title || '',
                                    favicon: info.favicon || '',
                                },
                            }
                        }
                    };

                    try {
                        const response = await fetch("http://127.0.0.1:8765", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        });
                        const result = await response.json();

                        if (result.error) {
                            console.error("AnkiConnect Error:", result.error);
                            btn.style.backgroundColor = "#e74c3c"; // 红色：失败
                            btn.textContent = "添加失败";
                        } else {
                            // 🚀 成功处理部分的关键修改
                            const newNoteId = result.result; // AnkiConnect 成功返回 noteId

                            btn.style.backgroundColor = "#2ecc71"; // 绿色：成功
                            btn.textContent = "添加成功, 点击查看";

                            // 移除旧的点击事件监听器（如果它还存在）
                            // 注意：为了简单，这里直接用新的替换，但如果需要防止内存泄漏，
                            // 更好的做法是在添加新的监听器前移除旧的，或者使用一次性监听器。

                            // 移除旧的（发送）事件监听器
                            // 由于您在函数作用域内，直接替换其功能更简单:
                            // btn.onclick = null; // 清除当前行内或绑定的任何 click 处理器

                            // // 绑定新的点击事件：打开 Anki
                            // btn.addEventListener("click", () => {
                            //     openAnkiNote(newNoteId);
                            // }, { once: true }); // 使用 once: true 确保只绑定一次

                            btn.onclick = () => openAnkiNote(newNoteId)
                        }
                    } catch (err) {
                        console.error("Fetch Error:", err);
                        btn.style.backgroundColor = "#e74c3c";
                        btn.textContent = "连接失败";
                    }
                };
            }
        }


        computePosition(pos, cardWidth, cardHeight) {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            const candidates = [
                { left: pos.bottom_right.x, top: pos.bottom_right.y },
                { left: pos.top_right.x, top: pos.top_right.y - cardHeight },
                { left: pos.bottom_left.x - cardWidth, top: pos.bottom_left.y },
                { left: pos.top_left.x - cardWidth, top: pos.top_left.y - cardHeight }
            ];

            return candidates.find(c =>
                c.left >= 0 &&
                c.top >= 0 &&
                c.left + cardWidth <= viewportWidth &&
                c.top + cardHeight <= viewportHeight
            ) || candidates[0];
        }

        isPointInCard(x, y) {
            const rect = this.cardElement.getBoundingClientRect();
            return (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            );
        }

        isMouseInCard(target) {
            return this.cardElement.contains(target) ||
                this.cardElement.shadowRoot.contains(target);
        }

        destroy() {
            // 移除全局事件监听器
            if (this._mouseMoveHandler) {
                document.removeEventListener('mousemove', this._mouseMoveHandler);
            }
            if (this._mouseUpHandler) {
                document.removeEventListener('mouseup', this._mouseUpHandler);
            }

            // 移除DOM元素
            if (this.cardElement && this.cardElement.parentNode) {
                this.cardElement.parentNode.removeChild(this.cardElement);
            }

            this.exists = false;
        }
    }

    class CardManager {
        constructor() {
            this.card = null;
        }

        cardExists() {
            return this.card !== null && this.card.exists;
        }
        isPointInCard(x, y) {
            return this.cardExists() && this.card.isPointInCard(x, y);
        }
        isMouseInCard(target) {
            return this.cardExists() && this.card.isMouseInCard(target);
        }

        createCard(pos, info) {
            if (this.cardExists()) this.removeCard()
            this.card = new WordCard(pos, info)
        }
        removeCard() {
            if (this.cardExists()) {
                this.card.destroy()
                this.card = null
            }
        }
    }

    class EventManager {
        // ======== 事件监听 ========
        constructor(
            getSetting,
            cardExists,
            isPointInCard,
            isMouseInCard,
            removeCard,
            queryFromPoint,
            queryFromSelection,
            resetLastSelection,
        ) {
            this.getSetting = getSetting;
            this.cardExists = cardExists;
            this.isPointInCard = isPointInCard;
            this.isMouseInCard = isMouseInCard;
            this.removeCard = removeCard;
            this.queryFromPoint = queryFromPoint;
            this.queryFromSelection = queryFromSelection;
            this.resetLastSelection = resetLastSelection;
            this.hotkeyPressed = false;
            this.lastWordRange = null;
            this.mousePos = { x: 0, y: 0 }
            this.lastMouseLogTime = 0;
            this.mouseLogInterval = 1000; // 1秒
        }

        bindEvents() {

            Utils.debug_log("[event manager] [init]")

            /**
             * 按下热键:
             *  - 设置按下状态为true
             */
            document.addEventListener('keydown', (e) => {
                if (Utils.isTargetInInput(e.target) ||
                    e.key !== this.getSetting('hotkey') ||
                    this.hotkeyPressed
                ) return;
                Utils.debug_log(`[Event manager] [keydown] key '${e.key}' pressed.`)
                this.hotkeyPressed = true;
            });

            /**
             * 松开热键:
             *  - 设置按下状态为false
             *  - 从鼠标处触发query from point
             */
            document.addEventListener('keyup', (e) => {
                if (Utils.isTargetInInput(e.target) ||
                    e.key !== this.getSetting('hotkey')
                ) return;
                this.hotkeyPressed = false;
                // 如果点击在卡片内部, 就不触发.
                if (this.isPointInCard(this.mousePos.x, this.mousePos.y)) return;

                Utils.debug_log(`[Event manager] [keyup] key '${e.key} released.`)
                this.queryFromPoint(this.mousePos.x, this.mousePos.y)
                this.resetLastSelection();
            });

            /**
             * 鼠标移动:
             *  - 悬浮选词
             */
            document.addEventListener('mousemove', (e) => {
                this.mousePos = { x: e.clientX, y: e.clientY };
                if (!this.getSetting('enableHoverSelection') || // 未开启悬停选词设置
                    !this.hotkeyPressed ||                      // 未按住快捷键
                    Utils.isTargetInInput(e.target) ||            // 目标在输入框里
                    this.isMouseInCard(e.target)                // 目标在卡片里
                ) return;

                // 节流输出日志
                const currentTime = Date.now();
                if (currentTime - this.lastMouseLogTime >= this.mouseLogInterval) {
                    Utils.debug_log(`[Event manager] [mousemove] mouse moving at (${this.mousePos.x}, ${this.mousePos.y})`);
                    this.lastMouseLogTime = currentTime;
                }

                this.queryFromPoint(this.mousePos.x, this.mousePos.y)
            });

            /**
             * 鼠标松开:
             *  - 移除卡片
             *  - 获得选区
             */
            document.addEventListener('mouseup', (e) => {
                if (this.cardExists() && !this.isMouseInCard(e.target)) this.removeCard()

                if (!this.getSetting('enableMouseSelection') ||
                    Utils.isTargetInInput(e.target) ||
                    this.isMouseInCard(e.target)
                ) return;

                Utils.debug_log(`[Event manager] [mouseup] mouse released at (${this.mousePos.x}, ${this.mousePos.y})`);
                this.queryFromSelection();
            });
        }

    }
    class Utils {
        static isDebugEnabled = null;
        static init(isDebugEnabled) {
            this.isDebugEnabled = isDebugEnabled;
        }
        static debug_log(msg) {
            if (this.isDebugEnabled()) {
                console.log(`Collex Debug > ${msg}`);
            }
        }
        static isTargetInInput(target) {
            const tag = target.tagName.toLowerCase();
            return tag === 'input' || tag === 'textarea' || target.isContentEditable;
        }
        static isInputActive() {
            const activeElement = document.activeElement;
            const inputTypes = ['input', 'textarea', 'select', 'button', 'a'];

            return (
                activeElement &&
                (inputTypes.includes(activeElement.tagName.toLowerCase()) ||
                    activeElement.isContentEditable)
            );
        }
        static collectContext() {
            return {
                url: location.href,
                title: document.title,
                favicon: document.querySelector('link[rel~="icon"]')?.href || '',
            };
        }
        /**
         * 将字符串用<div>标签包裹，并将每段用<p>标签包裹
         * 
         * @param {string} text - 输入的字符串
         * @returns {string} 处理后的HTML字符串
         */
        static wrapHTML(text) {

            if (!text || !text.trim()) {
                return "<div></div>";
            }

            // 分割字符串为段落（按换行符分割）
            const paragraphs = text.split('\n');

            // 过滤掉空段落并去除首尾空格
            const nonEmptyParagraphs = paragraphs
                .map(p => p.trim())
                .filter(p => p.length > 0);

            // 用<p>标签包裹每个段落
            const wrappedParagraphs = nonEmptyParagraphs.map(paragraph =>
                `<p>${paragraph}</p>`
            );

            // 将所有段落组合并用<div>标签包裹
            const result = `<div>${wrappedParagraphs.join('')}</div>`;

            return result;
        }

    }

    let app = new CollexApp()
})();

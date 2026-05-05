// ==UserScript==
// @name         采词
// @version      1.0.1
// @description  可以在阅读中学习单词.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.deepseek.com
// @connect      127.0.0.1
// @connect      localhost
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
 *  25/11/29  v1.0    正式发布1.0版本.
 *                    修改了查词的prompt
 *                    修改了anki卡片模板 (现在是使用 collex 2)
 *                    修改了卡片出现位置逻辑
 *  25/12/01  v1.0.1  小改动, 增加词源的查询
任务

1. [功能]用户可以自定义查词的脚本
2. [优化](没什么用)给卡片的三个小方块加一点点特效, 鼠标悬浮时, 红方块颜色变深, 蓝方块移动, 黄方块改变形状
3. [优化]以后再说啦, 改写成浏览器的插件, 火狐和chrome.
4. [优化]也许总有无法提取出句子的时候, 可以加一个手动模式, 复制单词, 句子, 甚至截图.
5. [优化]将项目优化成更适合初见的样子, 变得一键可运行.

*/

(function () {
    'use strict';
    const API_KEY = ''
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
        window.trustedTypes.createPolicy('default', {
            createHTML: (string) => string 
        });
    }

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

        queryWord(range) {
            Utils.debug_log('[app] [query range]' + range.toString())
            const pos = this.rangeManager.getSelectionCorners()

            let info = {
                pre: null,
                word: null,
                post: null,
                dict_promise: null,
                lemma: null,
                reading: null,
                labels: null,
                examples: null,
                meaning: null,
                meaning_chinese: null,
                nuance: null,
                url: null,
                title: null,
                favicon: null,
            };
            Object.assign(info, this.rangeManager.extractContext(range))
            Object.assign(info, Utils.collectContext())
            info.dict_promise = this.dictManager.query(info)
            this.cardManager.createCard(pos, info)
        }
    };
    /**
     * 词典管理
     */
    class DictManager {
        constructor(getSetting) {
            this.getSetting = getSetting;
        }
        async query(context) {
            let query_result = {};

            // 从 ai 获取原词, 释义, 音标...
            const data = JSON.parse(this.cleanJson(await this.dict_ai(context)))

            query_result.lemma = data.lemma;
            query_result.reading = data.reading;
            query_result.labels = data.labels;
            query_result.examples = data.examples;
            query_result.meaning = data.meaning;
            query_result.meaning_chinese = data.meaning_chinese;
            query_result.nuance = data.nuance;

            // 从 mdx server 获取词源
            const lemma = query_result.lemma || context.word;
            const etymology = await new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `http://localhost:8000/${lemma}`,
                    onload: (response) => resolve(response.responseText),
                    onerror: () => resolve("词源获取失败")
                });
            });
            if (etymology.indexOf('server error occurred.') === -1) {
                query_result.etymology = this.cleanEtymologyHTML(etymology);
            }
            return query_result;
        }
        cleanJson(raw) {
            if (typeof raw !== "string") return raw;

            // 去掉 ```json 和 ```（包括可能有的空格）
            return raw
                .replace(/```json\s*/i, "")
                .replace(/```/g, "")
                .trim();
        }
        cleanEtymologyHTML(html) {
            return html
                .replace(/<link[^>]*>/g, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
                .replace(/<a[^>]*>([^<]*)<\/a>/g, '$1')
                .replace(/ class="[^"]*"/g, '');
        }
        dict_ai(context) {
            try {
                // 拼接语境句子
                const fullSentence = `${context.pre || ''} ${context.word} ${context.post || ''}`.trim();

                // 构造 prompt（使用你确认过的版本）
                const prompt = `
你是一名专业的英语词典编纂者，需要根据用户提供的单词与语境，返回一个结构化的 JSON，包含单词在该语境中的实际释义、原型、读音、词性与语域标签等信息。

用户会给出：
- 单词 word  
- 语境句子：由 pre + word + post 拼成  
- 可选：网页标题 title  

你的任务是根据语境推断该单词在句子中的含义，并按以下 JSON 格式输出：

{
  "labels": ["...", "...", "...", ...],  # (有多少写多少, 不用加)
  "examples": [
  {
    "en": "...",
    "zh": "..."
  }
],
  "lemma": "...",
  "reading": "...",
  "meaning": "...",
  "meaning_chinese": "...",
  "nuance": "...",
}

字段要求如下：

- lemma：单词的原型, 但不要改变它的词性.（如 reflected → reflect，memories → memory, 而moving出现为形容词时不要还原成move, 或者作为补语时的现在分词, 非谓语动词时则一定要还原成move. 或者moved作为形容词时是moved, 作为过去分词作补语时要还原成move）
- examples：数组形式，返回 ${this.getSetting('numExamples') ?? 3} 个例句。
    例句应使用 lemma 的该语境义项，难度自然，适合 Anki 记忆；如果数量为 0，则返回空数组 []。
    每个例句是对象：
    {
      "en": 英文例句，
      "zh": 中文翻译
    }
- reading：该词最常见的 IPA 音标，使用国际音标格式，例如 "/rɪˈflekt/", 记得要和lemma保持一致.
- labels：数组形式，依次包含：
    1. 词性标签（如 "v.", "n.", "adj."）
    2. 语域标签（formal / informal / slang / literary / technical 等，若无可省略）
    3. 语法标签（如 [T], [I], [C], [U]）
- meaning：根据句子语境选择该词的正确含义，但用通用、可泛用的英文表达该义项，不要包含具体语境信息（如专有名词、具体场景），保持简洁
- meaning_chinese: 简洁的中文释义, 一两个词.
- nuance: 用简短英文说明该词的语气、使用特点或与常见近义词的区别（不超过 10 个词）

请只返回 JSON，不要返回额外解释。

用户输入：
单词：${context.word}
句子："${fullSentence}"
例句数量：${this.getSetting('numExamples') ?? 3}
网页标题：${context.title || '（无）'}
        `;

                // 发送一次请求
                const messages = [
                    { role: "system", content: "你是一名专业英语词典编纂者。" },
                    { role: "user", content: prompt }
                ];

                const json_promise = Utils.askAI("deepseek-chat", messages, { max_tokens: 900 });

                return json_promise;

            } catch (error) {
                Utils.debug_log("[dict manager] 调用dict_ai出错:" + error);
                return `无法获取"${context.word}"的信息。错误: ${error.message}`
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
                enableDebugMode: false,
                numExamples: 3,
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
            GM_registerMenuCommand(`设置例句数量 (当前: ${this.get('numExamples')})`, () => {
                const value = prompt('请输入例句数量，例如 0 / 1 / 3 / 5', this.get('numExamples'));
                const num = Number(value);

                if (Number.isInteger(num) && num >= 0) {
                    this.set('numExamples', num);
                    this.registerMenus();
                } else {
                    alert('请输入非负整数');
                }
            }, { id: 'set-num-examples' });
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
        getSelectionCorners() {
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
            let html = `
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
        this.contentElement.innerHTML = html
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

            // const contentP = document.createElement('p');
            // contentP.innerText = "content"
            // container.appendChild(contentP)

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
            const data = await info.dict_promise;

            Utils.debug_log('[render parse]', data)

            info.lemma = data.lemma;
            info.reading = data.reading;
            info.labels = data.labels;
            info.examples = data.examples;
            info.meaning = data.meaning;
            info.meaning_chinese = data.meaning_chinese;
            info.nuance = data.nuance;
            info.etymology = data.etymology; // 直接保存 etymology HTML 内容

            Utils.debug_log("[card manager] [info]", info)
            let contentHTML = '';

            // ======= 基础词汇信息（lemma / reading / labels） =======
            if (info.lemma || info.reading || info.labels) {
                contentHTML += `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333;">词汇信息</div>
                        <div class="meta-section" style="color: #444; line-height: 1.6;">
                            ${info.lemma ? `<div><strong>原型：</strong>${this.escapeHtml(info.lemma)}</div>` : ""}
                            ${info.reading ? `<div><strong>读音：</strong>${this.escapeHtml(info.reading)}</div>` : ""}
                            ${info.labels ? `<div><strong>标签：</strong>${this.escapeHtml(info.labels)}</div>` : ""}
                        </div>
                    </div>
                `;
            }
            
            // ======= 释义（英文 / 中文） =======
            if (info.meaning || info.meaning_chinese || info.nuance) {
                contentHTML += `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333;">释义</div>
                        ${info.meaning ? `<div style="color: #555; margin-bottom: 6px;">${this.escapeHtml(info.meaning)}</div>` : ""}
                        ${info.meaning_chinese ? `<div style="color: #777;">${this.escapeHtml(info.meaning_chinese)}</div>` : ""}
                        ${info.nuance ? `<div style="color: #999;">${this.escapeHtml(info.nuance)}</div>` : ""}

                    </div>
                `;
            }

            // ======= 例句（英文 / 中文） =======
            if (info.examples && Array.isArray(info.examples) && info.examples.length > 0) {
                contentHTML += `
                    <div style="margin-bottom: 16px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333;">例句</div>
                        <ol style="color: #555; line-height: 1.6; padding-left: 20px;">
                            ${info.examples
                                .filter(e => e && e.trim())
                                .map(e =>  
`<li>
    <div>${this.escapeHtml(e.en)}</div>
    <div style="color:#999;font-size:12px;">
        ${this.escapeHtml(e.zh)}
    </div>
</li>`)
                                .join('')}
                        </ol>
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

            // ======= 原句区 =======
            contentHTML += `
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: bold; margin-bottom: 8px; color: #333;">原句</div>
                    ${info.pre ? `<span style="color: #666;">${this.escapeHtml(info.pre)}</span>` : ""}
                    <span style="font-weight: bold; color: #007cba; background: #f0f8ff; padding: 2px 4px; border-radius: 3px;">
                        ${this.escapeHtml(info.word || "")}
                    </span>
                    ${info.post ? `<span style="color: #666;">${this.escapeHtml(info.post)}</span>` : ""}
                </div>
            `;

            // ======= 词源信息 =======
            if (info.etymology) {
                contentHTML += `
        <div style="margin-bottom: 16px;">
            <div style="font-weight: bold; margin-bottom: 8px; color: #333;">词源</div>
            <div style="color: #555; font-size: 14px; line-height: 1.5;">
                ${info.etymology}
            </div>
        </div>
    `;
            }

            // ======= 网页信息（title + url + favicon） =======
            if (info.title || info.url || info.favicon) {
                contentHTML += `
                    <div style="margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 12px;">
                        <div style="font-weight: bold; margin-bottom: 8px; color: #333;">来源页面</div>

                        ${info.favicon ? `<img src="${this.escapeHtml(info.favicon)}" style="width:16px; height:16px; margin-right:6px;">` : ""}
                        ${info.title ? `<span style="font-weight: bold; font-size: 15px;">${this.escapeHtml(info.title)}</span>` : ""}

                        ${info.url ? `<div style="font-size: 12px; color: #007cba; margin-top: 4px;">${this.escapeHtml(info.url)}</div>` : ""}
                    </div>
                `;
            }

            // ======= 没内容时的兜底 =======
            if (!info.word && !info.meaning && !info.lemma) {
                contentHTML = `
                    <div style="display: flex; justify-content: center; align-items: center; height: 100%; color: #666;">
                        <div style="text-align: center;">
                            <div>暂无可用信息</div>
                        </div>
                    </div>
                `;
            }

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

                GM_xmlhttpRequest({
                    method: "POST",
                    url: "http://127.0.0.1:8765",
                    headers: { "Content-Type": "application/json" },
                    data: JSON.stringify(browsePayload),
                    onload: function (response) {
                        if (response.status === 200) {
                            try {
                                const result = JSON.parse(response.responseText);
                                if (result.error) {
                                    console.error("AnkiConnect guiBrowse Error:", result.error);
                                } else {
                                    console.log("Successfully opened Anki browser to note:", noteId);
                                }
                            } catch (err) {
                                console.error("JSON解析失败:", err);
                            }
                        } else {
                            console.error("AnkiConnect请求失败:", response.status, response.statusText);
                        }
                    },
                    onerror: function (error) {
                        console.error("AnkiConnect连接错误:", error);
                    }
                });
            };
            function renderLabels(labels) {
                if (!labels || !Array.isArray(labels)) return '';
                return labels
                    .filter(l => l && l.trim()) // 过滤掉空值
                    .map(l => `<span class="label">${l}</span>`)
                    .join(' ');
            }
            function renderExamples(examples) {
                if (!examples || !Array.isArray(examples)) return '';

                return examples
                    .filter(e => e && e.en && e.en.trim())
                    .map(e => `
                        <div class="example">
                            <div>📘<div class="example-en" style="display:inline">${e.en}</div></div>
                            <div>📙 ${e.zh ? `<div class="example-cn cn-text" style="display:none;">${e.zh}</div>` : ''}</div>
                        </div>
                    `)
                    .join('');
            }
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
                                modelName: "collex 2",
                                fields: {
                                    word: info.word || '',
                                    pre: info.pre || '',
                                    post: info.post || '',
                                    lemma: info.lemma || '',
                                    reading: info.reading || '',
                                    labels: renderLabels(info.labels),
                                    examples: renderExamples(info.examples),
                                    meaning: info.meaning || '',
                                    meaning_chinese: info.meaning_chinese || '',
                                    nuance: info.nuance || '',
                                    etymology: info.etymology || '', // 新增词源字段
                                    url: info.url || '',
                                    title: info.title || '',
                                    favicon: info.favicon || '',
                                },
                                "options": {
                                    "allowDuplicate": true
                                },
                            }
                        }
                    };

                    try {
                        // 修改：使用 GM_xmlhttpRequest 替代 fetch
                        const result = await new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method: "POST",
                                url: "http://127.0.0.1:8765",
                                headers: { "Content-Type": "application/json" },
                                data: JSON.stringify(payload),
                                onload: function (response) {
                                    if (response.status === 200) {
                                        try {
                                            const data = JSON.parse(response.responseText);
                                            resolve(data);
                                        } catch (err) {
                                            reject(new Error(`JSON解析失败: ${err.message}`));
                                        }
                                    } else {
                                        reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                                    }
                                },
                                onerror: function (error) {
                                    reject(new Error(`连接失败: ${error.statusText || error.message}`));
                                }
                            });
                        });

                        if (result.error) {
                            console.error("AnkiConnect Error:", result.error);
                            btn.style.backgroundColor = "#e74c3c"; // 红色：失败
                            btn.textContent = "添加失败";
                        } else {
                            const newNoteId = result.result;

                            btn.style.backgroundColor = "#2ecc71"; // 绿色：成功
                            btn.textContent = "添加成功, 点击查看";

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
        static debug_log(msg, ...args) {
            if (this.isDebugEnabled()) {
                console.log(`Collex Debug > ${msg}`);
                console.log(...args);
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

        static askAI(model, messages, options = {}) {
            const API_URL = "https://api.deepseek.com/chat/completions";

            const body = {
                model,
                messages,
                max_tokens: options.max_tokens ?? 500,
                temperature: options.temperature ?? 0.5,
                stream: false
            };

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: API_URL,
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${API_KEY}`
                    },
                    data: JSON.stringify(body),
                    onload: function (response) {
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText);
                                const content = data.choices[0]?.message?.content?.trim();

                                if (!content) {
                                    reject(new Error("响应内容为空"));
                                } else {
                                    resolve(content);
                                }
                            } catch (err) {
                                Utils.debug_log(`[Utils.askAI] JSON解析失败: ${err}`);
                                reject(new Error(`JSON解析失败: ${err.message}`));
                            }
                        } else {
                            const errorMsg = `API请求失败: ${response.status} ${response.statusText}`;
                            Utils.debug_log(`[Utils.askAI] ${errorMsg}`);
                            reject(new Error(errorMsg));
                        }
                    },
                    onerror: function (error) {
                        Utils.debug_log(`[Utils.askAI] 网络请求失败: ${error}`);
                        reject(new Error(`网络请求失败: ${error.statusText || error.message}`));
                    },
                    ontimeout: function () {
                        const errorMsg = "请求超时";
                        Utils.debug_log(`[Utils.askAI] ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }
                });
            }).catch(err => {
                Utils.debug_log(`[Utils.askAI] 调用AI接口失败: ${err}`);
                return `请求失败: ${err.message}`;
            });
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

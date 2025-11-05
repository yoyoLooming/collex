# Introduction

「采词」意为采集阅读中的词汇，「Collex」源自 Collect（收集）与 Lexis（词汇）的结合，象征高效的语言积累。

"采词" means harvesting words from texts, while "Collex" blends Collect + Lexis, embodying smart language accumulation.

采词是一个tampermonkey脚本. 以后有计划实现chrome和firefox浏览器扩展的版本.

# Usage

使用方法..balabala.

暂时懒得写, 安装这个脚本, 自己探索一下吧.

# Anki Integratation

这个插件可以向anki中添加卡片.

## Ankiconnect 安装与配置

安装

配置cors

## anki 卡片模板

效果图如下:

![collex 卡片模板 预览](/assets/collex_preview.png)

我放在 `/anki-models/collex.apkg` 这里了

# 更新日志

- 25/08/09  v0.1    增加监听事件.
- 25/08/09  v0.2    增加GM设置面板.
- 25/08/09  v0.3    优化代码, 将非必要的`let`声明修改为`const`.
- 25/08/09  v0.4    获取单词和语境.
- 25/08/10  v0.5    修复输入状态下触发脚本的bug;
                  修复在行内标签无法获取完整句子的bug;
                  修复裁剪句子的逻辑bug;
                  有关句子的bug应该告一段落了...吧.
- 25/08/10  v0.6    优化代码结构.
- 25/08/10  v0.7    开始实现查词卡片
- 25/08/11  v0.7.1  初步编写弹出卡片, 并显示内容.
- 25/08/11  v0.7.2  实现了一个后端的查词api;
                  调查了一些常见的英语学习词典
                  设计了查词前端api的结构: 一个中间件请求后端或网络api获取单词信息, 转换为json格式提供给前端卡片渲染.
- 25/08/17  v0.7.3  初步实现卡片的展示函数
- 25/08/17  v0.7.4  完成移除卡片和避免重复打开卡片的逻辑
- 25/11/04  v0.8    重构了代码结构. 现在是app + manageran: dict, range, card, event.
- 25/11/04  v0.9    粗略地完成了查词的功能, 完成了添anki卡片的功能, 添加了一个anki卡模板. 可以发布大版本了.

# 未来计划

- [优化] 优化卡片的外观
- [优化] 优化查词的prompt.
- [优化] 重写debug_log, 以及优化所有调用debug_l的地方地方
- [优化] (没什么卵用)给卡片的三个小方块加一点点特效, 鼠标悬浮时, 红方块颜色变深, 蓝方块移动, 黄方块改变形状
- [优化] 支持chrome和firefox的扩展/插件.
- [优化] 编写其他的查词来源(除了当前的deepseek)
- [功能] 支持用户自定义查词来源函数.
- [优化] 增加一个手动模式, 复制单词, 句子, 甚至截图, 以应对无法提取出句子的时候.

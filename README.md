# Introduction

「采词」意为采集阅读中的词汇，「Collex」源自 Collect（收集）与 Lexis（词汇）的结合，象征高效的语言积累。

"采词" means harvesting words from texts, while "Collex" blends Collect + Lexis, embodying smart language accumulation.

采词是一个tampermonkey脚本. 以后有计划实现chrome和firefox浏览器扩展的版本.

# 更新日志

- 25/08/09  v0.1    增加监听事件;
- 25/08/09  v0.2    增加GM设置面板;
- 25/08/09  v0.3    优化代码, 将非必要的`let`声明修改为`const`;
- 25/08/09  v0.4    获取单词和语境;
- 25/08/10  v0.5    修复输入状态下触发脚本的bug;
                    修复在行内标签无法获取完整句子的bug;
                    修复裁剪句子的逻辑bug;
                    有关句子的bug应该告一段落了...吧.
- 25/08/10  v0.6    优化代码结构;
- 25/08/10  v0.7    开始实现查词卡片;
- 25/08/11  v0.7.1  初步编写弹出卡片, 并显示内容;
- 25/08/11  v0.7.2  实现了一个后端的查词api;
                    调查了一些常见的英语学习词典;
                    设计了查词前端api的结构: 一个中间件请求后端或网络api获取单词信息, 转换为json格式提供给前端卡片渲染;
- 25/08/17  v0.7.3  初步实现卡片的展示函数;
- 25/08/17  v0.7.4  完成移除卡片和避免重复打开卡片的逻辑;
- 25/11/04  v0.8    重构了代码结构. 现在是app + manageran: dict, range, card, event;
- 25/11/04  v0.9    粗略地完成了查词的功能, 完成了添anki卡片的功能, 添加了一个anki卡模板, 可以发布大版本了;
- 25/11/29  v1.0    正式发布1.0版本;
                    修改了查词的prompt;
                    修改了anki卡片模板 (现在是使用 collex 2);
                    修改了卡片出现位置逻辑;
- 25/12/01  v1.0.1  小改动, 增加词源的查询
- 25/12/01  v1.0.1  小改动, 增加词源的查询
- 26/05/05  v1.0.2  小改动, 增加了Nuance和Example的查询
- 26/05/05  v1.0.3  小改动, 增加了例句中文
- 26/05/05  v1.0.4  增加了apikey的设置, 终于不用在代码中硬编码了.
- 26/05/05  v1.0.5  增加了开关词源查询的选项, 因为它依赖于一个本地服务. 用户不想弄的话可以不弄.



# 未来计划

- [优化] 将项目优化成更适合初见的样子, 变得一键可运行.
- [优化] 也许可以增加在卡片上编辑原句的功能, 可以修改pre和post, 至少可以增加.
- [优化] 支持chrome和firefox的扩展/插件.
- [优化] 编写其他的查词来源(除了当前的deepseek)
- [功能] 支持用户自定义查词来源函数.
- [优化] 增加一个手动模式, 复制单词, 句子, 甚至截图, 以应对无法提取出句子的时候.
- [功能] 支持PDF, 通过截图, 和手动输入原词来实现. 也许会集成文字识别.

# Usage

使用方法..balabala.

暂时懒得写, 安装这个脚本, 自己探索一下吧.

大概就是在chrome或firefox上安装一个tampermonkey/greasymonkey/violentmonkey, 并新建脚本, 粘贴collex.user.js, 或者从磁盘导入这个文件. 我的查词来源中还有一个是 词源. 这个来自于[github mdxserver](https://github.com/ninja33/mdx-server), 运行, 选取etym.mdx就好.


# Anki Integratation

这个插件可以向anki中添加卡片.

## Ankiconnect 安装与配置

安装

配置cors

## anki 卡片模板

卡片模板在 `/templates/` 里面

collex v2 效果图如下:

![collex 2 卡片模板 预览](/assets/collex_2_preview.png)

collex v1 效果图如下:

![collex 卡片模板 预览](/assets/collex_preview.png)

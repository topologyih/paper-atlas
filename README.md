# 论文星图 · Paper Atlas

写文献综述时，从一篇熟悉的论文出发，沿引用关系找文献，按发表年份梳理研究脉络。**引用网络**和**时间影响力**共用选中状态和筛选条件，切换视图时可以继续看同一篇论文。

[![论文星图的引用网络和时间影响力视图](docs/media/cover.png)](docs/media/walkthrough.mp4)

[下载 macOS 运行包](https://github.com/topologyih/paper-atlas/releases/latest) · [查看 30 秒实拍（MP4）](docs/media/walkthrough.mp4) · [使用与配置](docs/guide.md) · [示例抓取报告](docs/build_report.md)

## 本地运行

安装 Node.js 22 或更高的偶数版本，在终端运行：

```bash
git clone https://github.com/topologyih/paper-atlas.git
cd paper-atlas
npm ci
npm run dev
```

打开终端显示的本机地址，默认是 <http://127.0.0.1:5173>。页面会自动载入 *Attention Is All You Need* 的内置示例，含 120 篇论文和 827 条关系。浏览示例无需 API 密钥或 Python 服务。

## 用示例走一遍

1. 点击 **引用网络**，把鼠标移到圆点上查看标题。Transformer 引用了 Adam，后来 BERT 又引用了 Transformer。点选一篇论文，右侧会显示年份、作者、摘要和原文入口。
2. 切换到 **时间影响力**，刚选的论文仍会高亮。横轴是发表年份，默认纵轴按对数刻度显示引用数。同一年论文挤在一起时，可以滚轮放大。
3. 在左侧搜索 `BERT`，两个视图会同步缩小范围。用 **导出 CSV** 保存阅读清单，或用 **导出 SVG / PNG** 保存当前图。

要换一篇种子论文，可以输入 DOI、arXiv 编号、标题、论文链接，或上传 PDF，再联网生成图谱。图谱的覆盖范围和引用数取决于数据源及抓取时间。

## 项目结构

| 位置 | 内容 |
| --- | --- |
| [src/](src/) | React 前端、图谱布局、筛选与导出 |
| [server/](server/) | 可选 FastAPI 服务、数据查询与 PDF 解析 |
| [scripts/](scripts/) | 抓取示例、读取缓存、启动本地桌面窗口 |
| [macos/](macos/) | macOS 应用启动器 |
| [public/sample.json](public/sample.json) | 浏览器直接加载的 OpenAlex 示例数据 |
| [tests/](tests/) | JavaScript 和 Python 测试及共用样例 |

开发时用 `npm test` 运行前端测试，用 `python3 -m unittest discover -s tests -v` 运行 Python 测试，用 `npm run build` 生成静态页面。macOS 桌面启动、密钥配置、数据来源与相关度算法见[使用与配置](docs/guide.md)。

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

## 申请和配置 OpenAlex API 密钥

浏览内置示例可以跳过这一步。经常生成新图谱或扩展论文时，可以申请免费的 OpenAlex API 密钥，使用自己的查询额度。[OpenAlex API 官方说明](https://help.openalex.org/api/authentication/)

1. 用自己的邮箱注册 OpenAlex 账号，打开 OpenAlex 发来的邮件完成验证。已有账号可以直接登录。[注册 OpenAlex](https://openalex.org/signup)
2. 登录后打开 **Settings → API key**，复制个人密钥。[打开密钥设置](https://openalex.org/settings/api)
3. 完成上面的源码安装后，在与 `package.json` 同级的目录新建或编辑 `.env.local`，加入下面一行，把占位文字换成自己的密钥。

   ```dotenv
   VITE_OPENALEX_API_KEY=在这里粘贴自己的密钥
   ```

4. 如果 `npm run dev` 已在运行，按 `Ctrl+C` 停止后重新启动。打开终端显示的本机地址，在输入框里填一个 DOI，再点 **生成图谱**。可以用 `10.48550/arXiv.1706.03762` 试一次。

`.env.local` 已被 Git 忽略。上述配置用于从源码在本机运行，GitHub Release 下载包里的页面已提前构建。公开构建前端时请将 `VITE_OPENALEX_API_KEY` 留空，因为 Vite 会把它写进浏览器可下载的 JavaScript。也可以在本地 Python 服务中使用 `OPENALEX_API_KEY`。[本地 API 与密钥](docs/guide.md#本地-api-与密钥)

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

# 使用与配置

[返回项目首页](../README.md)

## 浏览与筛选

在顶部粘贴 DOI、arXiv 编号或链接、OpenAlex 的 `W` 编号、Semantic Scholar 链接、论文 URL 或标题，选择 50 / 100 / 200 / 300 / 500，再点「生成图谱」。PDF 只取前两页里的 DOI、arXiv 或标题，识别成功后走同一条抓取流程。

点一个圆只做选中：打开详情，画上白圈，时间图上标出它的年份，相关论文保持清晰，其余变淡。选中不会改中心，也不会重新抓数据。点详情里的「关闭」取消选中。

- 「设为中心」用当前这批论文在本地重算相关度和边，并切到网络图。
- 「扩展此论文」会再向 OpenAlex 抓它的参考文献和施引文献。
- 左侧可以搜索标题、作者、摘要、DOI，并按年份、影响力、主题、来源筛选。点来源图例会隐藏该来源。
- 「导出 CSV」「导出 SVG」「导出 PNG」导出的是当前筛选后的视图。
- 「数据说明」列出这次图谱的来源、缺失比例和警告。
- 「内置示例」回到 Attention Is All You Need。

地址栏会写成 `#q=查询&n=篇数`。同一台浏览器七天内再次打开这个链接时，使用本地保存的图谱。桌面窗口用的是单独的 Chrome 配置，和日常浏览器的本地保存互不相通。

## 示例数据

`public/sample.json` 抓取于 2026-11-21T15:17:08Z，来源是 OpenAlex。

| 项目 | 数量 |
| --- | ---: |
| 论文 | 120 |
| 边 | 827（引用 743，相似 84） |
| 种子 | 1 |
| 参考文献 | 42 |
| 施引 | 73 |
| OpenAlex 相关 | 4 |
| 年份 | 1971–2026（1 篇缺年份） |
| 去重去掉 | 26 |

种子被引 152270 次。一篇论文只记一种主要关系，优先级是种子、互引、参考文献、施引、相关、共引、同主题、文本相近。本次警告只有一条：部分论文的参考文献超过 200 条，Jaccard 用的是截断后的列表。字段缺失和更细的名单在[抓取报告](build_report.md)，页面里的「数据说明」读的是同一份元数据。

## 如何计算相关度

Python 和页面使用同一组权重，锁在 `tests/fixtures/weights.json`：

`0.30·直接引用 + 0.26·参考文献 Jaccard + 0.16·共引比例 + 0.14·主题重叠 + 0.10·标题与摘要词袋余弦 + 0.04·OpenAlex related_works`

种子为 1。共引比例的分母是本次抓到、且带有参考文献列表的施引论文；分母小于 5 时去掉这项并重新归一。影响力默认是 OpenAlex 的 `cited_by_count`，也可以改成年均引用。年均引用等于引用数除以 `max(1, 影响力年份 - 发表年)`。这份示例的影响力年份是 2026。

去重依次看 OpenAlex ID、DOI，以及长度不少于 12 且年份相差不超过 1 的标题。保留引用数更高的记录。若另一版本是期刊或会议，且引用数不低于一半，则采用那个来源名。会议论文、proceedings 和预印本都会保留。撤稿和空标题会跳过。

引用数来自 OpenAlex，不等于 Google Scholar。OpenAlex 的参考文献匹配并不完整。

## 本地 API 与密钥

浏览内置示例只需要前端。生成新图谱会请求数据源，实际可用额度和限流规则以服务商为准。要用自己的 OpenAlex 密钥，可在本地 Python 服务中配置。

在项目根目录复制环境变量模板，然后编辑 `.env`，填写 `OPENALEX_API_KEY`。可选变量 `OPENALEX_MAILTO` 用于联系邮箱，`SEMANTIC_SCHOLAR_API_KEY` 用于补充查询。

```bash
cp .env.example .env
```

以下以 macOS 或 Linux 为例。安装 Python 3.11 或更高版本，然后在项目根目录运行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r server/requirements.txt
set -a
source .env
set +a
npm run server
```

在另一个终端启动 `npm run dev`。开发服务器将 `/api` 转发到本机的 8787 端口。后端提供查询缓存、代理查询和 PDF 解析。

## 重新生成示例

在已加载环境变量的终端中运行：

```bash
python3 scripts/fetch_graph.py --query "10.48550/arXiv.1706.03762" --limit 120
```

`npm run fetch` 使用同一条命令，默认更新 [public/sample.json](../public/sample.json) 和 [docs/build_report.md](build_report.md)。如需保留现有示例，可通过 `--out` 和 `--report` 指定新文件。`scripts/build_from_cache.py` 则从已有缓存生成较小的示例，覆盖当前文件需要显式指定 `--force`。

## macOS 桌面窗口

在项目根目录运行 `npm ci` 和 `npm run build`，然后双击 `macos/论文星图.app`。启动器需要本机 Python 3，默认使用 Chrome 独立窗口，也可回退到默认浏览器。启动器在本机 47321 端口提供构建好的页面。修改前端代码后，重新构建并刷新窗口即可。

## 静态部署

在干净的检出目录中运行 `npm ci` 和 `npm run build`，发布目录为 `dist/`。构建使用相对路径，可托管在域名根目录或项目子路径。内置示例随页面一起发布。

**公开构建时将 `VITE_OPENALEX_API_KEY` 和 `VITE_OPENALEX_MAILTO` 留空。** 这两个变量用于浏览器直连，Vite 会把它们的值写入前端 JavaScript，包括托管平台在构建阶段注入的值。服务端使用 `OPENALEX_API_KEY`。如果单独配置了受控 API 服务，可用 `VITE_API_BASE` 指向其地址。

# 论文星图

输入一篇论文的 DOI、arXiv、标题、论文 URL，或上传 PDF。页面会识别种子论文，展开它的引用邻域，并画出两张联动的图：

- 时间影响力：横轴是发表年份，圆的面积按影响力的平方根缩放。默认纵轴是影响力的对数。蜂群模式只把圆错开，纵轴不表示数值。年份刻度会按跨度抽稀，避免挤在一起。
- 引用网络：当前中心在正中，相关度越高越靠近中心。默认只画与中心相连的引用线。点另一篇论文后，再亮出它自己的引用线，并最多补 12 条最强的相似虚线。

两个视图共用筛选、搜索和选中状态。论文名称不画在图上，把鼠标放在圆点上才会出现。滚轮放大后，挤在一起的圆会散开；重置缩放后回到原来的位置。缺失字段显示 Unknown。页面不会编造论文、期刊、引用数或摘要。

内置示例是 Attention Is All You Need（DOI `10.48550/arXiv.1706.03762`，OpenAlex `W2626778328`）。当前样例有 120 篇、827 条边，接口失败时仍可打开。

## 打开

日常使用不用开终端。双击桌面上的「论文星图」，或双击项目里的 `论文星图.app`。它用本机的 Chrome 打开一个没有地址栏的窗口，页面只在这台电脑上，地址是 http://127.0.0.1:47321 。桌面图标指向项目里的这个应用。应用会按自己所在的项目目录找 `dist/`，把整个文件夹挪走之后仍然可以从项目里双击打开。

这个窗口读的是已经构建好的 `dist/`。改完代码后要重新构建，再刷新窗口：

```bash
npm run build
```

开发时用热更新：

```bash
npm run dev
```

然后打开 http://127.0.0.1:5173 。输入框里已放着示例 DOI。点「生成图谱」才会按当前输入重新抓取。

## 安装

需要 Node.js 18 以上和 Python 3.11 以上。桌面应用还需要本机已安装 Google Chrome。

```bash
cd paper-atlas
npm install
npm run build
```

若 Vite 提示 esbuild 的安装脚本被拦住，在项目目录执行：

```bash
npm install-scripts approve esbuild
npm rebuild esbuild
```

## 页面

在顶部粘贴 DOI、arXiv 编号或链接、OpenAlex 的 `W` 编号、Semantic Scholar 链接、论文 URL 或标题，选择 50 / 100 / 200 / 300 / 500，再点「生成图谱」。PDF 只取前两页里的 DOI、arXiv 或标题，识别成功后走同一条抓取流程。

点一个圆只做选中：打开详情，画上白圈，时间图上标出它的年份，相关论文保持清晰，其余变淡。选中不会改中心，也不会重新抓数据。点详情里的「关闭」取消选中。

- 「设为中心」用当前这批论文在本地重算相关度和边，并切到网络图。
- 「扩展此论文」会再向 OpenAlex 抓它的参考文献和施引文献。
- 左侧可以搜索标题、作者、摘要、DOI，并按年份、影响力、主题、来源筛选。点来源图例会隐藏该来源。
- 「导出 CSV」「导出 SVG」「导出 PNG」导出的是当前筛选后的视图。
- 「数据说明」列出这次图谱的来源、缺失比例和警告。
- 「内置示例」回到 Attention Is All You Need。

地址栏会写成 `#q=查询&n=篇数`。同一台浏览器七天内再次打开这个链接时，使用本地保存的图谱。桌面窗口用的是单独的 Chrome 配置，和日常浏览器的本地保存互不相通。

## 内置示例

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

种子被引 152270 次。一篇论文只记一种主要关系，优先级是种子、互引、参考文献、施引、相关、共引、同主题、文本相近。本次警告只有一条：部分论文的参考文献超过 200 条，Jaccard 用的是截断后的列表。字段缺失和更细的名单在 `build_report.md`，页面里的「数据说明」读的是同一份元数据。

## 密钥

OpenAlex 匿名额度大约是每个 IP 每天 0.10 美元，并且按 IP 与别人共享。额度用完会返回 429，通常到次日零点（UTC）恢复。标题检索在高负载时会暂停，这时 DOI、arXiv 和 OpenAlex ID 仍然可用。配置自己的免费 key 后大约是 1 美元/天。

```bash
cp .env.example .env
```

在 `.env` 里填写自己的值。这个文件权限保持仅自己可读，并且已被 git 忽略。

| 变量 | 用在哪里 |
| --- | --- |
| `OPENALEX_API_KEY` | `scripts/fetch_graph.py` 和本地服务 |
| `OPENALEX_MAILTO` | 同上，礼貌池联系邮箱，可空 |
| `SEMANTIC_SCHOLAR_API_KEY` | 可选，用来补 Semantic Scholar |
| `VITE_OPENALEX_API_KEY` | 浏览器直接请求 OpenAlex 时 |
| `VITE_OPENALEX_MAILTO` | 同上 |
| `VITE_API_BASE` | 静态站要指向别处的 API 时设置，默认同源 |

Vite 构建时会把 `VITE_` 变量写进 `dist/` 的 JavaScript。因此 `dist/` 不进仓库，也不要把它公开发布。Python 不会自动读取 `.env`。命令行抓取前先导出：

```bash
set -a
source .env
set +a
python3 scripts/fetch_graph.py --query "10.48550/arXiv.1706.03762" --limit 120
```

`npm run fetch` 跑的是同一条命令，同样需要这些变量已经在环境里。结果写入 `public/sample.json` 和 `build_report.md`。清洗后若不足请求的篇数，不会用虚构论文填满。

`scripts/build_from_cache.py` 不访问网络，只用 `cache/` 里已经下载的种子和施引论文重写示例，参考文献不会成为节点。仓库里的示例是完整抓取，所以这个脚本默认拒绝覆盖，确认后才加 `--force`。

## 本地服务

可选。它负责缓存、代发请求，并用 pypdf 读 PDF。前端在 `/api/health` 可用时会走这个服务，否则浏览器直接请求 OpenAlex。

```bash
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
npm run server
```

服务监听 http://127.0.0.1:8787 。开发服务器把 `/api` 代理过去。

## 部署

`vite.config.js` 的 `base` 是 `./`，构建结果可以放在域名根目录或项目子路径。静态托管没有 `/api`，浏览器直接请求 OpenAlex。

发布前用不含密钥的环境重新构建。Netlify 和 Vercel 的发布目录都是 `dist`，构建命令是 `npm run build`。密钥放在托管平台的环境变量里，不要把本机 `dist/` 上传。

## 相关度与去重

Python 和页面使用同一组权重，锁在 `tests/fixtures/weights.json`：

`0.30·直接引用 + 0.26·参考文献 Jaccard + 0.16·共引比例 + 0.14·主题重叠 + 0.10·标题与摘要词袋余弦 + 0.04·OpenAlex related_works`

种子为 1。共引比例的分母是本次抓到、且带有参考文献列表的施引论文；分母小于 5 时去掉这项并重新归一。影响力默认是 OpenAlex 的 `cited_by_count`，也可以改成年均引用。年均引用等于引用数除以 `max(1, 影响力年份 - 发表年)`。这份示例的影响力年份是 2026。

去重依次看 OpenAlex ID、DOI，以及长度不少于 12 且年份相差不超过 1 的标题。保留引用数更高的记录。若另一版本是期刊或会议，且引用数不低于一半，则采用那个来源名。会议论文、proceedings 和预印本都会保留。撤稿和空标题会跳过。

引用数来自 OpenAlex，不等于 Google Scholar。OpenAlex 的参考文献匹配并不完整。

## 测试

```bash
npm test
python3 -m unittest tests.test_core -v
```

## 仓库里不包含

| 路径 | 原因 |
| --- | --- |
| `.env` | OpenAlex 密钥 |
| `dist/` | 构建时会写入 `VITE_OPENALEX_API_KEY` |
| `cache/` | OpenAlex 响应缓存 |
| `.run/` | 桌面窗口的本地服务和 Chrome 配置 |
| `node_modules/`、`.venv/` | 依赖，用安装命令恢复 |

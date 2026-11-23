# 抓取报告

种子论文：Attention Is All You Need
种子 ID：W2626778328
查询：10.48550/arXiv.1706.03762（识别为 doi / 10.48550/arxiv.1706.03762）
抓取时间：2026-11-21T15:17:08+00:00
影响力年份：2026
数据来源：OpenAlex

## 数量

| 项目 | 数量 |
| --- | ---: |
| 请求上限 | 120 |
| 清洗前记录（含重复） | 278 |
| 去重后 | 252 |
| 去掉的重复记录 | 26 |
| 因类型、撤稿或空标题跳过 | 1 |
| 写入图谱 | 120 |
| 边 | 827 |
| 实际请求 OpenAlex 次数 | 8 |
| 命中本地缓存 | 0 |
| 共引分母（有参考文献的施引论文） | 100 |

OpenAlex 返回的剩余额度（美元，匿名池按 IP 共享）：0.9992

## 与种子的主要关系

| 关系 | 篇数 |
| --- | ---: |
| citing | 73 |
| reference | 42 |
| related | 4 |
| seed | 1 |

一篇论文只计入一种主要关系。优先级是：种子、互引、参考文献、施引、OpenAlex 相关、共引、同主题、文本相近。

## 字段缺失比例

分母是写入图谱的论文。缺失指空值或来源名为 Unknown，不是字符串 "0"。

| 字段 | 缺失比例 |
| --- | ---: |
| authors | 0.0% |
| year | 0.8% |
| venue | 0.0% |
| cited_by_count | 0.0% |
| abstract | 5.0% |
| doi | 1.7% |
| oa_url | 7.5% |
| topics | 0.0% |

## 相关度最高的论文

| 标题 | 年份 | 引用 | 相关度 | 关系 | 来源 |
| --- | ---: | ---: | ---: | --- | --- |
| Attention Is All You Need | 2017 | 152270 | 1.0 | seed | arXiv |
| Weighted Transformer Network for Machine Translation | 2017 | 177 | 0.5584 | citing | arXiv |
| Parallel Attention Mechanisms in Neural Machine Translation | 2018 | 25 | 0.5468 | citing | International Conference on Machin… |
| Training Deeper Neural Machine Translation Models with Transparent Attention | 2018 | 165 | 0.5446 | citing | EMNLP |
| Pervasive Attention: 2D Convolutional Neural Networks for Sequence-to-Sequence Prediction | 2018 | 78 | 0.5386 | citing | arXiv |
| Attention Transformer Model for Translation of Similar Languages | 2020 | 5 | 0.5262 | citing | WMT |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | 2019 | 100291 | 0.5246 | citing | NAACL-HLT |
| Transformer-Based MUM-T Situation Awareness: Agent Status Prediction | 2023 | 0 | 0.507 | citing | The Journal of Korea Robotics Soci… |
| Neural Machine Translation by Jointly Learning to Align and Translate | 2014 | 32083 | 0.495 | reference | arXiv |
| Convolutional Sequence to Sequence Learning | 2017 | 4185 | 0.4939 | reference | International Conference on Machin… |
| Neural Machine Translation in Linear Time | 2016 | 694 | 0.4856 | reference | arXiv |
| Effective Approaches to Attention-based Neural Machine Translation | 2015 | 9717 | 0.4809 | reference | EMNLP |

## 引用数最高的论文

| 标题 | 年份 | 引用 | 相关度 | 关系 | 来源 |
| --- | ---: | ---: | ---: | --- | --- |
| Deep Residual Learning for Image Recognition | 2016 | 291600 | 0.3606 | reference | Proceedings |
| Attention Is All You Need | 2017 | 152270 | 1.0 | seed | arXiv |
| Adam: A Method for Stochastic Optimization | 2015 | 140163 | 0.363 | reference | UvA-DARE (University of Amsterdam) |
| Long Short-Term Memory | 1997 | 133191 | 0.3235 | reference | Neural Computation |
| BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding | 2019 | 100291 | 0.5246 | citing | NAACL-HLT |
| An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale | 2020 | 72151 | 0.368 | citing | arXiv |
| Language Models are Few-Shot Learners | 2020 | 62832 | 0.4607 | citing | neural information processing syst… |
| Learning Transferable Visual Models From Natural Language Supervision | 2021 | 62387 | 0.3312 | citing | arXiv |
| Dropout: a simple way to prevent neural networks from overfitting | 2014 | 51637 | 0.323 | reference | Journal of Machine Learning Research |
| Highly accurate protein structure prediction with AlphaFold | 2021 | 51551 | 0.3015 | citing | Nature |
| Swin Transformer: Hierarchical Vision Transformer using Shifted Windows | 2021 | 49008 | 0.3297 | citing | ICCV |
| Squeeze-and-Excitation Networks | 2018 | 44827 | 0.3265 | citing | Proceedings |

## 规则

去重：按 OpenAlex ID、DOI，以及长度不少于 12 的规范化标题合并；标题相同且年份相差不超过 1 年视为同一篇。保留引用数更高的记录。若另一版本是期刊或会议，且引用数不低于一半，则改用该来源名称。

扩展：从种子的参考文献、按引用数排序的施引论文、OpenAlex related_works、主主题下的高被引论文，以及施引论文参考文献里与种子共引最多的论文中选取。

影响力：impact_score 等于 OpenAlex cited_by_count。年均引用等于 cited_by_count / max(1, impact_year - year)。

相关度权重：direct 0.3、coupling 0.26、cocitation 0.16、topic 0.14、text 0.1、related 0.04。relevance = 0.30·直接引用 + 0.26·参考文献 Jaccard + 0.16·共引比例 + 0.14·主题重叠 + 0.10·标题与摘要词袋余弦 + 0.04·OpenAlex related_works。种子为 1。

## 本次警告

- 部分论文的参考文献超过 200 条，Jaccard 使用截断后的列表。

## 已知问题

- 引用数、参考文献和主题来自 OpenAlex，不等于 Google Scholar 的引用数。OpenAlex 说明其参考文献匹配并不完整。
- 相关度不是神经网络向量，而是直接引用、参考文献 Jaccard、共引比例、主题重叠和标题/摘要词袋余弦的加权和。
- 共引比例的分母是本次抓取到的施引论文，不是种子的全部施引文献，因此偏向被高被引后续论文一起引用的文献。
- 同一期刊的颜色只保证本次语料里引用量最高的来源各自一色；更少见的来源归入“其他”。
- 预印本经常只有 arXiv 作为主来源。若 OpenAlex 另有期刊或会议版本，且引用数不低于一半，则采用那个来源名称。
- 每篇论文最多保留 200 条已匹配参考文献。图中的相似边做了稀疏化：直接引用用实线，每篇论文再保留少量共引或文本近邻的虚线。
- 缺失的标题、作者、年份、期刊、DOI 或摘要不会被补写，界面显示 Unknown。

- 匿名 OpenAlex 额度大约是每个 IP 每天 0.10 美元，标题检索在高负载时会暂停。页面内置了这次抓取的样例，接口失败时仍可浏览。
- 配置 `OPENALEX_API_KEY` 后进入约 1 美元/天的免费额度。不要编造邮箱去申请 key。
- 期刊名称沿用 OpenAlex 的来源名，长名称会截成缩写只用于图例；详情里保留清洗后的全称。

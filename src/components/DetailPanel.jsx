import { RELATION_LABELS } from "../lib/score.js";
import { showNumber, showText, snippet } from "../lib/format.js";

const PART_LABELS = {
  direct: "直接引用",
  coupling: "共同参考文献",
  cocitation: "共引",
  topic: "主题重叠",
  text: "文本相近",
  related: "OpenAlex 相关",
};

export default function DetailPanel({ paper, busy, onClose, onCenter, onExpand }) {
  if (!paper) return null;
  if (paper.isAggregate) {
    return (
      <aside className="detail">
        <header>
          <p className="eyebrow">聚合</p>
          <h2>{paper.title}</h2>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </header>
        <ul className="member-list">
          {paper.members.map((member) => (
            <li key={member.id}>
              <button type="button" onClick={() => onCenter(member)}>
                <strong>{member.title}</strong>
                <span>{member.year ?? "Unknown"} · {showNumber(member.cited_by_count)} 次引用</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    );
  }
  const scholar = `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title || "")}`;
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : null;
  const arxivUrl = paper.arxiv_id ? `https://arxiv.org/${paper.arxiv_id.startsWith("abs/") ? "" : "abs/"}${paper.arxiv_id}` : null;
  const pdfUrl = paper.pdf_url || (paper.oa_url && /pdf/i.test(paper.oa_url) ? paper.oa_url : null);
  return (
    <aside className="detail">
      <header>
        <p className="eyebrow">{RELATION_LABELS[paper.relation] || paper.relation || "论文"}</p>
        <h2>{showText(paper.title)}</h2>
        <button type="button" className="text-button" onClick={onClose}>关闭</button>
      </header>
      <p className="authors">{showText(paper.author_string)}</p>
      <dl className="facts">
        <div><dt>年份</dt><dd>{paper.year ?? "Unknown"}</dd></div>
        <div><dt>来源</dt><dd>{showText(paper.venue)}</dd></div>
        <div><dt>引用</dt><dd>{showNumber(paper.cited_by_count)}</dd></div>
        <div><dt>年均引用</dt><dd>{showNumber(paper.impact_per_year)}</dd></div>
        <div><dt>相关度</dt><dd>{paper.relevance_score == null ? "Unknown" : paper.relevance_score.toFixed(3)}</dd></div>
        <div><dt>DOI</dt><dd>{showText(paper.doi)}</dd></div>
      </dl>
      {paper.relevance_parts && !paper.is_seed && (
        <div className="parts">
          {Object.entries(PART_LABELS).map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <b>{Number(paper.relevance_parts[key] || 0).toFixed(2)}</b>
            </div>
          ))}
        </div>
      )}
      <p className="abstract">{paper.abstract ? paper.abstract : "Unknown"}</p>
      {!!paper.topics?.length && (
        <p className="topic-line">{paper.topics.join(" · ")}</p>
      )}
      <div className="link-row">
        {doiUrl && <a href={doiUrl} target="_blank" rel="noreferrer">DOI</a>}
        {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
        {arxivUrl && <a href={arxivUrl} target="_blank" rel="noreferrer">arXiv</a>}
        <a href={scholar} target="_blank" rel="noreferrer">Google Scholar</a>
        {paper.id?.startsWith("W") && <a href={`https://openalex.org/${paper.id}`} target="_blank" rel="noreferrer">OpenAlex</a>}
        {!doiUrl && !pdfUrl && !arxivUrl && <span>链接 Unknown</span>}
      </div>
      <div className="action-row">
        <button type="button" onClick={() => onCenter(paper)}>设为中心</button>
        <button type="button" onClick={() => onExpand(paper)} disabled={busy || !paper.id?.startsWith("W")}>
          扩展此论文
        </button>
      </div>
      <p className="fine">摘要只显示数据源提供的原文。没有摘要时记为 Unknown。</p>
    </aside>
  );
}

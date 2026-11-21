export default function DataNotes({ meta, onClose }) {
  if (!meta) return null;
  const missing = meta.field_missing || {};
  return (
    <div className="modal-back" onClick={onClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>数据说明</h2>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </header>
        <dl className="facts">
          <div><dt>来源</dt><dd>{(meta.sources || ["OpenAlex"]).join("、")}</dd></div>
          <div><dt>抓取时间</dt><dd>{meta.fetched_at || "Unknown"}</dd></div>
          <div><dt>查询</dt><dd>{meta.seed_query || "Unknown"}</dd></div>
          <div><dt>论文数</dt><dd>{meta.paper_count ?? "Unknown"}</dd></div>
          <div><dt>去重去掉</dt><dd>{meta.deduped ?? "Unknown"}</dd></div>
          <div><dt>共引分母</dt><dd>{meta.cocitation_denominator ?? "Unknown"}</dd></div>
        </dl>
        <h3>去重</h3>
        <p>{meta.dedup_rule}</p>
        <h3>扩展</h3>
        <p>{meta.expansion}</p>
        <h3>影响力</h3>
        <p>{meta.impact_definition}</p>
        <h3>相关度</h3>
        <p>{meta.relevance_definition}</p>
        <h3>字段缺失比例</h3>
        <ul className="missing-list">
          {Object.entries(missing).map(([field, ratio]) => (
            <li key={field}><span>{field}</span><b>{typeof ratio === "number" ? `${(ratio * 100).toFixed(1)}%` : "Unknown"}</b></li>
          ))}
        </ul>
        <h3>本次警告</h3>
        <ul>{(meta.warnings || []).map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <h3>已知局限</h3>
        <ul>{(meta.limitations || []).map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  );
}

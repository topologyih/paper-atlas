export default function FilterBar({
  filters,
  setFilters,
  topics,
  legend,
  colorByGroup,
  onReset,
  layoutMode,
  setLayoutMode,
  aggregate,
  setAggregate,
  view,
  resultCount,
}) {
  if (!filters) return null;
  const patch = (partial) => setFilters((current) => ({ ...current, ...partial }));
  const toggleTopic = (topic) => {
    const next = new Set(filters.topics);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    patch({ topics: [...next] });
  };
  const toggleVenue = (group) => {
    const next = new Set(filters.hiddenVenues);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    patch({ hiddenVenues: [...next] });
  };

  return (
    <aside className="filters">
      <label>
        搜索
        <input
          value={filters.keyword}
          placeholder="标题、作者、摘要、DOI"
          onChange={(event) => patch({ keyword: event.target.value })}
        />
      </label>
      <div className="split">
        <label>
          起始年
          <input
            type="number"
            value={filters.yearMin}
            min={filters.dataYearMin}
            max={filters.yearMax}
            onChange={(event) => patch({ yearMin: Number(event.target.value) })}
          />
        </label>
        <label>
          结束年
          <input
            type="number"
            value={filters.yearMax}
            min={filters.yearMin}
            max={filters.dataYearMax}
            onChange={(event) => patch({ yearMax: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        影响力
        <select value={filters.impactMode} onChange={(event) => patch({ impactMode: event.target.value })}>
          <option value="citations">引用数</option>
          <option value="per_year">年均引用</option>
        </select>
      </label>
      <label>
        最低影响力
        <input
          type="number"
          min="0"
          value={filters.minImpact}
          onChange={(event) => patch({ minImpact: Number(event.target.value) || 0 })}
        />
      </label>
      <label>
        显示 Top N
        <select value={filters.topN} onChange={(event) => patch({ topN: Number(event.target.value) })}>
          <option value={0}>全部</option>
          {[50, 80, 100, 150, 200, 300, 500].map((count) => (
            <option key={count} value={count}>{count}</option>
          ))}
        </select>
      </label>
      {view === "timeline" && (
        <label>
          时间图布局
          <select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value)}>
            <option value="impact">影响力对数轴</option>
            <option value="beeswarm">蜂群防重叠</option>
          </select>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={aggregate} onChange={(event) => setAggregate(event.target.checked)} />
        时间图按年与来源聚合
      </label>
      <div className="topic-block">
        <p>主题</p>
        <div className="chips">
          {topics.map(([topic]) => (
            <button
              type="button"
              key={topic}
              className={filters.topics.includes(topic) ? "chip on" : "chip"}
              onClick={() => toggleTopic(topic)}
            >
              {topic}
            </button>
          ))}
        </div>
      </div>
      <div className="legend-block">
        <p>来源图例 · 点击隐藏</p>
        <ul>
          {legend.map(([group, count]) => {
            const hidden = filters.hiddenVenues.includes(group);
            return (
              <li key={group}>
                <button type="button" className={hidden ? "legend-row off" : "legend-row"} onClick={() => toggleVenue(group)}>
                  <i style={{ background: colorByGroup.get(group) || "#8B93A7" }} />
                  <span>{group === "其他" ? "其他来源" : group}</span>
                  <b>{count}</b>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <button type="button" className="reset" onClick={onReset}>重置筛选</button>
      <p className="fine">当前显示 {resultCount} 篇。两个视图使用同一组筛选。</p>
    </aside>
  );
}


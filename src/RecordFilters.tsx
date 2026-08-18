type RecordFiltersProps = {
  query: string;
  selectedType: string;
  typeOptions: string[];
  visibleCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
  onTypeChange: (type: string) => void;
  onClear: () => void;
};

export function RecordFilters({
  query,
  selectedType,
  typeOptions,
  visibleCount,
  totalCount,
  onQueryChange,
  onTypeChange,
  onClear,
}: RecordFiltersProps) {
  const hasFilters = Boolean(query.trim() || selectedType);

  return (
    <div className="record-filters" aria-label="解析记录搜索和过滤">
      <label className="record-search">
        <span className="visually-hidden">搜索主机或记录值</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="搜索主机或记录值"
          spellCheck={false}
        />
      </label>
      <label className="record-type-filter">
        <span className="visually-hidden">按记录类型过滤</span>
        <select
          value={selectedType}
          onChange={(event) => onTypeChange(event.currentTarget.value)}
          aria-label="按记录类型过滤"
        >
          <option value="">全部类型</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      {hasFilters && (
        <button className="clear-filters-button" type="button" onClick={onClear}>
          清除
        </button>
      )}
      <span className="filter-result" aria-live="polite">
        {hasFilters ? `${visibleCount} / ${totalCount} 条` : `${totalCount} 条`}
      </span>
    </div>
  );
}

"use client";

export interface FilterItemView {
  id: number;
  componentCode: string;
  rowNo: number;
  positionNo: number;
  isMandatory: boolean;
  labelOverride: string | null;
  defaultValue: string | null;
  dependsOnItemId: number | null;
  mappedColumn: string | null;
  component: {
    componentName: string;
    componentType: string;
    dataSourceType: string;
    staticOptionsJson: string | null;
  };
}

export interface SelectOption {
  value: string;
  label: string;
}

const fieldClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy disabled:opacity-50";

export default function DynamicFilterField({
  item,
  value,
  onChange,
  dynamicOptions,
  disabled,
}: {
  item: FilterItemView;
  value: string;
  onChange: (value: string) => void;
  dynamicOptions?: SelectOption[];
  disabled?: boolean;
}) {
  const label = item.labelOverride ?? item.component.componentName;
  const type = item.component.componentType;

  let options: SelectOption[] = [];
  if (item.component.dataSourceType === "STATIC" && item.component.staticOptionsJson) {
    try {
      options = JSON.parse(item.component.staticOptionsJson);
    } catch {
      options = [];
    }
  } else if (item.component.dataSourceType === "SQL") {
    options = dynamicOptions ?? [];
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground/80">
        {label}
        {item.isMandatory && <span className="text-danger"> *</span>}
      </label>
      {type === "DROPDOWN" ? (
        <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "MULTI_SELECT" ? (
        <select
          multiple
          value={value ? value.split(",") : []}
          disabled={disabled}
          onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value).join(","))}
          className={fieldClass}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "CHECKBOX" ? (
        <input
          type="checkbox"
          checked={value === "true"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="h-4 w-4"
        />
      ) : type === "RADIO" ? (
        <div className="flex flex-wrap gap-3">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-sm text-foreground/80">
              <input
                type="radio"
                name={`filter-item-${item.id}`}
                checked={value === o.value}
                disabled={disabled}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
        </div>
      ) : type === "DATE" ? (
        <input type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
      ) : type === "DATE_RANGE" ? (
        <div className="flex gap-2">
          <input
            type="date"
            value={value.split(",")[0] ?? ""}
            max={todayIso()}
            disabled={disabled}
            onChange={(e) => onChange(`${e.target.value},${value.split(",")[1] ?? ""}`)}
            className={fieldClass}
          />
          <input
            type="date"
            value={value.split(",")[1] ?? ""}
            min={dayAfter(value.split(",")[0])}
            disabled={disabled}
            onChange={(e) => onChange(`${value.split(",")[0] ?? ""},${e.target.value}`)}
            className={fieldClass}
          />
        </div>
      ) : type === "NUMBER" ? (
        <input type="number" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
      ) : (
        <input type="text" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
      )}
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayAfter(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

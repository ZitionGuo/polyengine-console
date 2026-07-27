import { Select, Tooltip } from "antd";
import { CheckCircle2 } from "lucide-react";

interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

interface AdaptiveSelectProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
}

export const AdaptiveSelect = ({
  id,
  value,
  onChange,
  options,
  placeholder,
  loading,
  disabled,
}: AdaptiveSelectProps) => {
  if (!loading && !disabled && options.length === 1) {
    const option = options.find((item) => item.value === value) ?? options[0];
    return (
      <div
        id={id}
        className="adaptive-single-select"
        role="textbox"
        aria-readonly="true"
        aria-label={`${option.label}, only available option`}
        title={option.label}
      >
        <span>{option.label}</span>
        <Tooltip title="Only available option">
          <CheckCircle2 size={16} aria-hidden="true" />
        </Tooltip>
      </div>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      loading={loading}
      disabled={disabled}
      showSearch={options.length > 6}
      optionFilterProp="label"
      popupMatchSelectWidth={options.some((item) => item.description) ? 280 : undefined}
      optionRender={(option) => {
        const item = options.find((entry) => entry.value === String(option.value));
        return (
          <div className="adaptive-select-option">
            <span>{item?.label ?? String(option.label)}</span>
            {item?.description ? <small>{item.description}</small> : null}
          </div>
        );
      }}
    />
  );
};

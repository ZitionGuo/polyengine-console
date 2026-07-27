import { Button, Space, Tooltip } from "antd";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import type { RelevanceJudgment } from "../services/relevance";

interface RelevanceButtonsProps {
  label: string;
  value?: RelevanceJudgment;
  onChange: (value?: RelevanceJudgment) => void;
}

export const RelevanceButtons = ({ label, value, onChange }: RelevanceButtonsProps) => (
  <Space.Compact size="small" className="relevance-buttons">
    <Tooltip title={value === "relevant" ? "Clear relevant judgment" : "Mark relevant"}>
      <Button
        type={value === "relevant" ? "primary" : "text"}
        icon={<ThumbsUp size={14} />}
        aria-label={`${value === "relevant" ? "Clear relevant judgment for" : "Mark relevant"} ${label}`}
        aria-pressed={value === "relevant"}
        onClick={() => onChange(value === "relevant" ? undefined : "relevant")}
      />
    </Tooltip>
    <Tooltip title={value === "irrelevant" ? "Clear not relevant judgment" : "Mark not relevant"}>
      <Button
        type={value === "irrelevant" ? "primary" : "text"}
        danger={value === "irrelevant"}
        icon={<ThumbsDown size={14} />}
        aria-label={`${value === "irrelevant" ? "Clear not relevant judgment for" : "Mark not relevant"} ${label}`}
        aria-pressed={value === "irrelevant"}
        onClick={() => onChange(value === "irrelevant" ? undefined : "irrelevant")}
      />
    </Tooltip>
  </Space.Compact>
);

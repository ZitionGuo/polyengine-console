import { Button, Drawer, Dropdown, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { SlidersHorizontal } from "lucide-react";

import type { ScoreProfile } from "../services/scoreProfile";

interface ScoreAnalysisDrawerProps {
  open: boolean;
  profiles: ScoreProfile[];
  thresholds: Record<string, number>;
  onApplyThreshold: (vectorField: string, threshold: number) => void;
  onClose: () => void;
}

const scoreText = (value: number) => value.toFixed(4);
const scorePosition = (score: number) => `${Math.max(0, Math.min(100, ((score + 1) / 2) * 100))}%`;

export const ScoreAnalysisDrawer = ({
  open,
  profiles,
  thresholds,
  onApplyThreshold,
  onClose,
}: ScoreAnalysisDrawerProps) => {
  const columns: ColumnsType<ScoreProfile> = [
    {
      title: "Vector field",
      dataIndex: "vector_field",
      key: "vector_field",
      width: 180,
      render: (field: string) => (
        <div className="score-field-name">
          <Typography.Text strong ellipsis={{ tooltip: field }}>{field}</Typography.Text>
          {thresholds[field] !== undefined ? <Tag color="cyan">≥ {thresholds[field]}</Tag> : null}
        </div>
      ),
    },
    { title: "Matches", dataIndex: "count", key: "count", width: 80 },
    {
      title: "Score distribution",
      key: "distribution",
      width: 240,
      render: (_, profile) => (
        <div className="score-distribution" aria-label={`${profile.vector_field} score distribution`}>
          <div className="score-distribution-track" />
          {profile.scores.map((score, index) => (
            <span
              className="score-distribution-point"
              key={`${score}-${index}`}
              style={{ left: scorePosition(score), top: `${5 + (index % 3) * 5}px` }}
            />
          ))}
          {thresholds[profile.vector_field] !== undefined ? (
            <span
              className="score-threshold-marker"
              style={{ left: scorePosition(thresholds[profile.vector_field]) }}
            />
          ) : null}
        </div>
      ),
    },
    {
      title: "Min",
      dataIndex: "minimum",
      key: "minimum",
      width: 84,
      render: scoreText,
    },
    {
      title: "Median",
      dataIndex: "median",
      key: "median",
      width: 84,
      render: scoreText,
    },
    {
      title: "Max",
      dataIndex: "maximum",
      key: "maximum",
      width: 84,
      render: scoreText,
    },
    {
      title: "Largest gap",
      dataIndex: "largest_gap_cutoff",
      key: "largest_gap_cutoff",
      width: 110,
      render: (value: number | null) => value === null ? "—" : scoreText(value),
    },
    {
      title: "",
      key: "actions",
      width: 132,
      fixed: "right",
      render: (_, profile) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "lower_quartile",
                label: `Keep top 75% · ${scoreText(profile.lower_quartile)}`,
              },
              {
                key: "median",
                label: `Keep top 50% · ${scoreText(profile.median)}`,
              },
              {
                key: "upper_quartile",
                label: `Keep top 25% · ${scoreText(profile.upper_quartile)}`,
              },
              ...(profile.largest_gap_cutoff === null ? [] : [{
                key: "largest_gap_cutoff",
                label: `Largest gap · ${scoreText(profile.largest_gap_cutoff)}`,
              }]),
            ],
            onClick: ({ key }) => {
              const value = profile[key as keyof Pick<
                ScoreProfile,
                "lower_quartile" | "median" | "upper_quartile" | "largest_gap_cutoff"
              >];
              if (typeof value === "number") onApplyThreshold(profile.vector_field, value);
            },
          }}
        >
          <Button size="small" icon={<SlidersHorizontal size={14} />}>
            Set threshold
          </Button>
        </Dropdown>
      ),
    },
  ];

  return (
    <Drawer
      title="Score analysis"
      open={open}
      onClose={onClose}
      width="min(1040px, 100vw)"
      className="score-analysis-drawer"
    >
      <Table
        rowKey="vector_field"
        columns={columns}
        dataSource={profiles}
        pagination={false}
        size="small"
        tableLayout="fixed"
        scroll={{ x: 992 }}
      />
    </Drawer>
  );
};

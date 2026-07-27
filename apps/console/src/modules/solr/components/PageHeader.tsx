import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) => (
  <div className="page-header">
    <div>
      <Typography.Title level={2}>{title}</Typography.Title>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </div>
    {actions ? <Space wrap>{actions}</Space> : null}
  </div>
);

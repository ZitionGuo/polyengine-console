import { Typography } from "antd";
import type { ReactNode } from "react";

interface PageToolbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export const PageToolbar = ({ title, subtitle, actions }: PageToolbarProps) => (
  <div className="page-toolbar">
    <div>
      <Typography.Title level={2}>{title}</Typography.Title>
      {subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : null}
    </div>
    {actions ? <div className="page-toolbar-actions">{actions}</div> : null}
  </div>
);

interface JsonViewProps {
  data: unknown;
  minHeight?: number;
}

export const JsonView = ({ data, minHeight = 180 }: JsonViewProps) => (
  <pre className="json-view" style={{ minHeight }}>
    {JSON.stringify(data, null, 2)}
  </pre>
);

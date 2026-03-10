interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: "teal" | "emerald" | "amber" | "rose";
}

const accents = {
  teal: { dot: "bg-zegy-400", text: "text-zegy-400" },
  emerald: { dot: "bg-emerald-400", text: "text-emerald-400" },
  amber: { dot: "bg-amber-400", text: "text-amber-400" },
  rose: { dot: "bg-rose-400", text: "text-rose-400" },
};

export default function StatCard({ title, value, subtitle, color = "teal" }: Props) {
  const accent = accents[color];
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>
      </div>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${accent.text}`}>{value}</p>
      {subtitle && <p className="mt-1.5 text-xs text-gray-600">{subtitle}</p>}
    </div>
  );
}

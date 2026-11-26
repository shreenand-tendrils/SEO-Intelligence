import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtShortDate, SEVERITY_HEX } from '../../utils/format';

const tip = { contentStyle: { borderRadius: 8, border: '1px solid #dde1e8', fontSize: 12 } };
const axis = { tick: { fontSize: 11, fill: '#8f98a8' }, axisLine: false, tickLine: false };

export function ScoreTrendChart({ data, height = 220 }) {
  const rows = data.map((d) => ({ ...d, label: fmtShortDate(d.finishedAt) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#337dff" stopOpacity={0.35} /><stop offset="100%" stopColor="#337dff" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb33" />
        <XAxis dataKey="label" {...axis} />
        <YAxis domain={[0, 100]} {...axis} />
        <Tooltip {...tip} formatter={(v) => [v, 'Site score']} labelFormatter={(_, p) => (p[0] ? p[0].payload.name : '')} />
        <Area isAnimationActive={false} type="monotone" dataKey="score" stroke="#1b5ef5" strokeWidth={2} fill="url(#g)" dot={{ r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({ data, x, y, color = '#337dff', height = 220, colors, layout = 'horizontal', onClick }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, left: vertical ? 0 : -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={vertical} horizontal={!vertical} stroke="#e5e7eb33" />
        {vertical ? <><XAxis type="number" {...axis} /><YAxis type="category" dataKey={x} width={130} {...axis} /></> : <><XAxis dataKey={x} {...axis} /><YAxis allowDecimals={false} {...axis} /></>}
        <Tooltip {...tip} cursor={{ fill: '#8f98a81a' }} />
        <Bar isAnimationActive={false} dataKey={y} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} fill={color} onClick={onClick} cursor={onClick ? 'pointer' : undefined}>
          {colors && data.map((d, i) => <Cell key={i} fill={colors(d, i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, nameKey, valueKey, colors, height = 220 }) {
  const total = data.reduce((a, d) => a + d[valueKey], 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie isAnimationActive={false} data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={colors(d, i)} />)}
        </Pie>
        <Tooltip {...tip} formatter={(v, n) => [`${v} (${total ? Math.round((v / total) * 100) : 0}%)`, n]} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export const severityColor = (d) => SEVERITY_HEX[d.severity] || '#94a3b8';
export const bucketColor = (d) => ({ '0-49': '#ef4444', '50-69': '#f59e0b', '70-89': '#84cc16', '90-100': '#10b981' }[d.bucket] || '#337dff');
export const codeColor = (d) => ({ '2xx': '#10b981', '3xx': '#38bdf8', '4xx': '#f97316', '5xx': '#dc2626', error: '#7f1d1d' }[d.code] || '#94a3b8');

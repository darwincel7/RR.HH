import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

/**
 * The two Recharts canvases of the dashboard, split into their own chunk.
 *
 * Recharts is by far the heaviest thing the dashboard pulls in (~500 KB of the route's
 * bundle). Keeping it here means the page — cards, counters, recent activity — paints
 * immediately and the charts stream in a moment later, instead of everything waiting on
 * the chart library. Dashboard.tsx loads this with React.lazy.
 *
 * Everything that does NOT need Recharts (the donut's centre label, the legend) stays in
 * Dashboard.tsx, so it renders with the rest of the page.
 */

const TOOLTIP_STYLE = {
  borderRadius: '16px',
  border: '1px solid #e2e8f0',
  boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  fontSize: '12px',
  fontWeight: 600,
} as const;

export function VacancyBarChart({ data, colors }: { data: any[]; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
        <RechartsTooltip cursor={{ fill: 'rgba(99, 102, 241, 0.04)' }} contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="candidatos" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={32}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageDonutChart({ data, colors }: { data: any[]; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={70}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
          stroke="none"
          cornerRadius={4}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <RechartsTooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 600 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

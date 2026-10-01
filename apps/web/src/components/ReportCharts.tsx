'use client'

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const GREEN = '#15803d'
const PALETTE = ['#15803d', '#0f766e', '#1d4ed8', '#7e22ce', '#b45309', '#be123c', '#475569', '#0369a1']

export function PhaseBarChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div className="h-72" role="img" aria-label="Nombre de marchés par phase">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" name="Marchés" fill={GREEN} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DelaysChart({ data }: { data: { label: string; moyen: number; max: number }[] }) {
  return (
    <div className="h-72" role="img" aria-label="Délais moyens par phase en jours">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11 }} unit=" j" />
          <Tooltip />
          <Legend />
          <Bar dataKey="moyen" name="Délai moyen" fill={GREEN} radius={[4, 4, 0, 0]} />
          <Bar dataKey="max" name="Délai maximal" fill="#b45309" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function SectorPie({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-72" role="img" aria-label="Répartition des montants par corps de métier">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={100} label={false}>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => `${v.toLocaleString('fr-FR')} FCFA`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

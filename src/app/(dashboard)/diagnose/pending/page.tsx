'use client'

// Shown when the AI produced a report but it could not be saved to the database.
// The diagnose page stashes the report in sessionStorage before redirecting here.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DiagnosisReport } from '@/types/diagnose'
import { AiNotice } from '@/components/ai-notice'

export default function PendingDiagnosisPage() {
  const [data, setData] = useState<{ report: DiagnosisReport; cropType: string } | null | undefined>(undefined)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pending_diagnosis')
      setData(raw ? JSON.parse(raw) : null)
    } catch {
      setData(null)
    }
  }, [])

  if (data === undefined) return null
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16 space-y-3">
        <p className="text-slate-600">No unsaved diagnosis found.</p>
        <Link href="/diagnose" className="text-emerald-600 font-medium hover:underline">Start a new diagnosis</Link>
      </div>
    )
  }

  const { report, cropType } = data
  const list = (title: string, items: string[] | undefined) =>
    items && items.length > 0 ? (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </CardContent>
      </Card>
    ) : null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <nav className="flex items-center text-sm text-slate-500 space-x-1">
        <Link href="/diagnose" className="hover:text-emerald-600">Diagnose</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-slate-700 font-medium">Result (not saved)</span>
      </nav>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This result could not be saved to your history. Take a screenshot if you need to keep it.
      </div>

      <Card>
        <CardContent className="p-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{cropType} · {report.severity} severity</p>
            <h1 className="text-2xl font-bold text-slate-800 mt-1">{report.disease_name}</h1>
            <p className="text-sm text-slate-500 mt-1">
              Confidence {report.confidence_pct}% · Act within {report.urgency_days} days · Est. yield loss {report.estimated_yield_loss_pct_if_untreated}%
            </p>
          </div>
          {report.is_diseased
            ? <AlertTriangle className="w-8 h-8 text-amber-500 flex-shrink-0" />
            : <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />}
        </CardContent>
      </Card>

      {report.cause && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Cause</CardTitle></CardHeader>
          <CardContent className="text-sm text-slate-700">{report.cause}</CardContent>
        </Card>
      )}
      {list('Symptoms', report.symptoms)}
      {list('Organic treatment', report.organic_treatment)}
      {list('Chemical treatment', report.chemical_treatment?.map((c) => `${c.product} — ${c.dosage}, ${c.frequency}`))}
      {list('Prevention', report.prevention_tips)}
      <AiNotice />
    </div>
  )
}

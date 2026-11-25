'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Activity, ArrowRight, CheckCircle2, ChevronDown, Clock, Cpu, Eye, KeyRound, Loader2, MessageSquareText, Play, RefreshCw, ShieldCheck, Timer, XCircle, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { modelInfo } from '@/lib/ai-models'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type StepHealth = { provider: 'openrouter' | 'gemini'; model: string; keyConfigured: boolean; coolingDownMs: number }
type Attempt = { provider: string; model: string; ok: boolean; ms: number; status?: number; error?: string }
type Recent = { at: string; label: string; ok: boolean; model?: string; latencyMs?: number; attempts: Attempt[] }
type Status = { chains: { text: StepHealth[]; vision: StepHealth[] }; recent: Recent[] }
type TestResult = { ok: boolean; text?: string; model?: string; latencyMs?: number; attempts: Attempt[]; simulated: number; error?: string }

const FEATURE_LABELS: Record<string, string> = {
  chat: 'Advisor chat',
  diagnose: 'Crop diagnosis',
  'crop-tasks': 'Task planner',
  ai: 'Community reply',
}

function featureLabel(label: string) {
  const sim = label.match(/^live-test \(simulated (\d)/)
  if (sim) return `Live test · ${sim[1]} simulated outage${sim[1] === '1' ? '' : 's'}`
  if (label === 'live-test') return 'Live test'
  return FEATURE_LABELS[label] ?? label
}

function stepState(s: StepHealth) {
  if (!s.keyConfigured) return { label: 'Key not set', dot: 'bg-slate-300', text: 'text-slate-500', ring: 'border-slate-200 bg-slate-50' }
  if (s.coolingDownMs > 0) return { label: `Cooling down · ${Math.ceil(s.coolingDownMs / 1000)}s`, dot: 'bg-amber-400', text: 'text-amber-700', ring: 'border-amber-200 bg-amber-50' }
  return { label: 'Ready', dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'border-emerald-200 bg-white' }
}

function ChainFlow({ title, icon: Icon, desc, steps }: { title: string; icon: React.ElementType; desc: string; steps: StepHealth[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="w-4 h-4 text-emerald-600" />{title}</CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col lg:flex-row lg:items-stretch gap-2">
          {steps.map((s, i) => {
            const st = stepState(s)
            const info = modelInfo(s.model)
            return (
              <Fragment key={s.model}>
                {i > 0 && (
                  <li aria-hidden className="flex items-center justify-center text-slate-300">
                    <ArrowRight className="w-4 h-4 hidden lg:block" />
                    <ChevronDown className="w-4 h-4 lg:hidden" />
                  </li>
                )}
                <li className={cn('flex-1 rounded-xl border p-3 min-w-0', st.ring)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {i === 0 ? 'Primary' : `Backup ${i}`}
                    </span>
                    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', s.provider === 'gemini' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700')}>
                      {info?.via}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-800 text-sm mt-1.5 truncate" title={s.model}>{info?.name}</p>
                  <p className="text-xs text-slate-500">{info?.vendor}</p>
                  <p className={cn('flex items-center gap-1.5 text-xs font-medium mt-2', st.text)}>
                    <span className={cn('w-2 h-2 rounded-full', st.dot)} />
                    {st.label}
                  </p>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export default function AiStatusPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState('')
  const [simulate, setSimulate] = useState(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [runError, setRunError] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/ai/status', { cache: 'no-store' })
      if (!r.ok) throw new Error()
      setStatus(await r.json())
      setLoadError('')
    } catch {
      setLoadError('Could not load AI engine status.')
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [load])

  // Reveal attempts one by one so the failover is easy to follow during a demo.
  useEffect(() => {
    if (!result || revealed >= result.attempts.length) return
    const t = setTimeout(() => setRevealed((n) => n + 1), 550)
    return () => clearTimeout(t)
  }, [result, revealed])

  const runTest = async () => {
    setRunning(true)
    setResult(null)
    setRevealed(0)
    setRunError('')
    try {
      const r = await fetch('/api/ai/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulate }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Live test failed')
      setResult(j)
      load()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Live test failed')
    } finally {
      setRunning(false)
    }
  }

  const textChain = status?.chains.text ?? []
  const configured = textChain.some((s) => s.keyConfigured)
  const allShown = result ? revealed >= result.attempts.length : false

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Cpu className="w-6 h-6 text-emerald-600" /> AI Engine
          </h1>
          <p className="text-slate-500 mt-1">
            Every AI feature runs on a multi-provider fallback chain. If one model is down, slow or rate-limited, the next one answers automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="self-start sm:self-auto">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}

      {status && !configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
          <KeyRound className="w-4 h-4 mt-0.5 flex-shrink-0" />
          No AI API keys are configured on this server yet. Add <code className="font-mono">OPENROUTER_API_KEY</code> and <code className="font-mono">GEMINI_API_KEY</code> (see docs/SETUP.md).
        </div>
      )}

      {!status && !loadError ? (
        <div className="grid gap-4">
          {[0, 1].map((i) => <div key={i} className="h-40 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : status && (
        <div className="grid gap-4">
          <ChainFlow title="Text chain" icon={MessageSquareText} desc="Advisor chat · AI task planner · community replies" steps={status.chains.text} />
          <ChainFlow title="Vision chain" icon={Eye} desc="Crop disease diagnosis from photos" steps={status.chains.vision} />
        </div>
      )}

      {/* Live failover test */}
      <Card className="border-emerald-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-600" /> Live failover test</CardTitle>
          <CardDescription>
            Sends a real prompt through the text chain. Use <strong>Simulate outage</strong> to make the first models fail on purpose and watch the next model take over.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div role="radiogroup" aria-label="Simulate outage" className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 self-start">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={simulate === n}
                  onClick={() => setSimulate(n)}
                  disabled={running}
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors', simulate === n ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700')}
                >
                  {n === 0 ? 'No outage' : `${n} model${n > 1 ? 's' : ''} down`}
                </button>
              ))}
            </div>
            <Button onClick={runTest} disabled={running} className="bg-emerald-600 hover:bg-emerald-700 self-start">
              {running ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Play className="w-4 h-4 mr-1.5" />}
              {running ? 'Running…' : 'Run live test'}
            </Button>
          </div>

          {runError && <p className="text-sm text-red-600">{runError}</p>}

          {result && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2" aria-live="polite">
              {result.attempts.slice(0, revealed).map((a, i) => {
                const info = modelInfo(a.model)
                return (
                  <div key={i} className="flex items-start gap-3 text-sm reveal-in">
                    {a.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">
                        {info?.name} <span className="text-slate-400 font-normal">· {info?.via}</span>
                      </p>
                      <p className={cn('text-xs', a.ok ? 'text-emerald-700' : 'text-red-600')}>
                        {a.ok ? `Answered in ${a.ms.toLocaleString('en-IN')} ms` : a.error?.includes('simulated') ? 'Simulated outage (HTTP 503) → failing over to next model' : `Failed${a.status ? ` (HTTP ${a.status})` : ''} → failing over to next model`}
                      </p>
                    </div>
                  </div>
                )
              })}
              {!allShown && <Loader2 className="w-4 h-4 text-slate-400 animate-spin ml-1" />}
              {allShown && (
                <div className={cn('mt-3 rounded-lg px-4 py-3 text-sm', result.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : 'bg-red-50 border border-red-200 text-red-800')}>
                  {result.ok ? (
                    <>
                      <p className="font-semibold flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" />
                        Answered by {modelInfo(result.model)?.name} in {result.latencyMs?.toLocaleString('en-IN')} ms
                        {result.attempts.length > 1 && ` after ${result.attempts.length - 1} failover${result.attempts.length > 2 ? 's' : ''}`}
                      </p>
                      <p className="mt-1 text-emerald-800">“{result.text}”</p>
                    </>
                  ) : (
                    <p className="font-semibold">All providers failed. {configured ? 'Check the server logs for details.' : 'No API keys are configured yet.'}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Timer, title: 'Timeouts', text: 'Each model gets a time limit; a hung model never blocks the farmer.' },
          { icon: Activity, title: 'Circuit breaker', text: 'Rate-limited or failing models sit out for a while, so later requests skip them.' },
          { icon: ShieldCheck, title: 'Validated output', text: 'Structured answers are checked; a malformed one is retried on a different model.' },
          { icon: Clock, title: 'Fair use', text: 'Per-farmer rate limits protect the shared AI quota.' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white p-4">
            <Icon className="w-5 h-5 text-emerald-600" />
            <p className="font-semibold text-slate-800 text-sm mt-2">{title}</p>
            <p className="text-xs text-slate-500 mt-1">{text}</p>
          </div>
        ))}
      </div>

      {/* Recent requests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent AI requests</CardTitle>
          <CardDescription>Handled by this server instance since it started.</CardDescription>
        </CardHeader>
        <CardContent>
          {!status?.recent.length ? (
            <p className="text-sm text-slate-500">No AI requests yet. Run a live test or use any AI feature.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                    <th className="px-2 py-2 font-medium">Time</th>
                    <th className="px-2 py-2 font-medium">Feature</th>
                    <th className="px-2 py-2 font-medium">Answered by</th>
                    <th className="px-2 py-2 font-medium text-right">Latency</th>
                    <th className="px-2 py-2 font-medium text-right">Failovers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {status.recent.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2 text-slate-500 whitespace-nowrap">{formatTime(r.at)}</td>
                      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{featureLabel(r.label)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {r.ok ? <span className="text-slate-800">{modelInfo(r.model)?.name}</span> : <span className="text-red-600">All failed</span>}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600 whitespace-nowrap">{r.latencyMs != null ? `${r.latencyMs.toLocaleString('en-IN')} ms` : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <span className={cn('inline-block min-w-6 px-1.5 rounded text-xs font-medium', r.attempts.length > 1 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500')}>
                          {Math.max(0, r.attempts.filter((a) => !a.ok).length)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

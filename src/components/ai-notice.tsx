import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Responsible-AI notice shown wherever the app gives treatment advice.
 * AI can be wrong; chemical use must follow the product label and local expert advice.
 */
export function AiNotice({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <p className={cn('text-[11px] text-slate-400 text-center', className)}>
        AI guidance can be wrong. Confirm pesticide use with your local agriculture officer or Krishi Vigyan Kendra, and always follow the product label.
      </p>
    )
  }
  return (
    <div role="note" className={cn('flex gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900', className)}>
      <Info className="w-5 h-5 flex-shrink-0 text-sky-600 mt-0.5" />
      <div>
        <p className="font-semibold">AI-generated guidance — please verify before spraying</p>
        <p className="text-sky-800 mt-0.5">
          This report is produced by AI from your photos and may be wrong. Before using any chemical, confirm the diagnosis and dosage
          with your local agriculture officer or Krishi Vigyan Kendra (KVK), follow the product label, and wear protective equipment.
        </p>
      </div>
    </div>
  )
}

import type { BenchmarkContinuationDecision } from '@shared/job-utils'
import { benchmarkContinuationPrompt } from '@shared/job-utils'
import type { ProfilerJob } from '@shared/types'

interface BenchmarkContinuationDialogProps {
  readonly job: ProfilerJob
  readonly onDecision: (decision: BenchmarkContinuationDecision) => void
}

export function BenchmarkContinuationDialog({
  job,
  onDecision
}: Readonly<BenchmarkContinuationDialogProps>): React.JSX.Element {
  return (
    <div className="update-dialog-backdrop">
      <section
        aria-labelledby="benchmark-continuation-title"
        aria-modal="true"
        className="update-dialog benchmark-continuation-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onDecision('cancel')
          }
        }}
        role="dialog"
      >
        <span className="update-dialog-eyebrow">Benchmark recovery</span>
        <h2 id="benchmark-continuation-title">Unfinished benchmark</h2>
        <p>{benchmarkContinuationPrompt(job)}</p>
        <p className="benchmark-continuation-note">
          Cancel closes this dialog without queuing benchmark recovery.
        </p>
        <div className="update-dialog-actions">
          <button
            autoFocus
            className="button secondary"
            onClick={() => onDecision('cancel')}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button secondary"
            onClick={() => onDecision('start-over')}
            type="button"
          >
            Start over
          </button>
          <button
            className="button primary"
            onClick={() => onDecision('continue')}
            type="button"
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  )
}

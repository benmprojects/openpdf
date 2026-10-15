import { useEffect, useState } from 'react'
import { appEnv, runBatch } from './batch'

/** The hidden window of a command-line run: does the job the main process describes, reports, and the program exits. */
export function CliRunner() {
  const [status, setStatus] = useState('Starting…')
  useEffect(() => {
    void (async () => {
      const job = await window.openpdf.cliJob()
      if (!job) return setStatus('No job.')
      const env = await appEnv()
      const results = await runBatch(
        job,
        { expand: (p, r) => window.openpdf.batchExpand(p, r), read: (p) => window.openpdf.batchRead(p), write: (s, d, x, data) => window.openpdf.batchWrite(s, d, x, data) },
        env,
        (done, total, current) => setStatus(current ? `Processing ${done + 1} of ${total}: ${current}` : 'Finishing…')
      )
      await window.openpdf.cliDone(results)
    })().catch(async (e) => {
      setStatus(String(e))
      await window.openpdf.cliDone([{ source: '(batch)', ok: false, error: e instanceof Error ? e.message : String(e) }])
    })
  }, [])
  return <p>{status}</p>
}

/**
 * Scanning through Windows Image Acquisition (WIA), which covers flatbed and sheet-fed scanners that have a Windows
 * driver, through PowerShell and the WIA COM objects. Either Windows' own scanning dialog is used (it picks the
 * scanner and shows a preview), or the chosen scanner is driven directly, one sheet at a time from a feeder.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ScannerInfo {
  id: string
  name: string
}

export interface ScanOptions {
  /** `dialog`: Windows' scanning dialog. `flatbed` and `feeder`: drive the scanner directly. */
  source: 'dialog' | 'flatbed' | 'feeder'
  dpi: 100 | 150 | 200 | 300 | 600
  color: 'color' | 'gray' | 'bw'
  /** Which scanner, for the direct sources; the first one when empty. */
  deviceId?: string
}

const SCRIPT = String.raw`
param([string]$Mode, [string]$Out, [int]$Dpi = 200, [string]$Color = 'color', [string]$Source = 'flatbed', [string]$DeviceId = '')
$ErrorActionPreference = 'Stop'
$png = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}'
function Set-Prop($props, [int]$id, $value) {
  foreach ($p in $props) { if ($p.PropertyID -eq $id) { try { $p.Value = $value } catch { } ; return } }
}
function Save-Image($img, [int]$n) {
  $img.SaveFile((Join-Path $Out ('scan{0:D3}.png' -f $n)))
}
switch ($Mode) {
  'list' {
    $dm = New-Object -ComObject WIA.DeviceManager
    $list = @()
    foreach ($d in $dm.DeviceInfos) {
      if ($d.Type -eq 1) { $list += [pscustomobject]@{ id = [string]$d.DeviceID; name = [string]$d.Properties.Item('Name').Value } }
    }
    ConvertTo-Json -InputObject $list -Compress
  }
  'dialog' {
    $cd = New-Object -ComObject WIA.CommonDialog
    $img = $cd.ShowAcquireImage(1, 0, 131072, $png, $false, $true, $false)
    if ($img) { Save-Image $img 1 }
  }
  'direct' {
    $dm = New-Object -ComObject WIA.DeviceManager
    $info = $null
    foreach ($d in $dm.DeviceInfos) { if ($d.Type -eq 1 -and ($DeviceId -eq '' -or $d.DeviceID -eq $DeviceId)) { $info = $d; break } }
    if (-not $info) { throw 'No scanner was found.' }
    $dev = $info.Connect()
    $item = $dev.Items.Item(1)
    $intent = @{ color = 1; gray = 2; bw = 4 }[$Color]
    $dtype = @{ color = 3; gray = 2; bw = 0 }[$Color]
    Set-Prop $item.Properties 6146 $intent
    Set-Prop $item.Properties 4103 $dtype
    Set-Prop $item.Properties 6147 $Dpi
    Set-Prop $item.Properties 6148 $Dpi
    if ($Source -eq 'feeder') {
      Set-Prop $dev.Properties 3088 1
      Set-Prop $dev.Properties 3096 0
    } else {
      Set-Prop $dev.Properties 3088 2
    }
    $n = 0
    while ($true) {
      try { $img = $item.Transfer($png) }
      catch {
        # Out of paper in the feeder: that is how the end of the stack is reported.
        if ($n -gt 0 -and $Source -eq 'feeder') { break }
        throw
      }
      $n++
      Save-Image $img $n
      if ($Source -ne 'feeder') { break }
    }
  }
}
`

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split(/\r?\n/).find((l) => l.trim()) || 'The scanner could not be used.'))
      else resolve(stdout)
    })
  })
}

async function withScript<T>(fn: (dir: string, script: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-scan-'))
  try {
    const script = join(dir, 'scan.ps1')
    await writeFile(script, SCRIPT, 'utf8')
    return await fn(dir, script)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Scanners Windows knows about. */
export function listScanners(): Promise<ScannerInfo[]> {
  return withScript(async (_d, script) => {
    const out = (await run([script, '-Mode', 'list'])).trim()
    return out ? (JSON.parse(out) as ScannerInfo[]) : []
  })
}

/** Scans and returns one PNG per sheet (none when the scanning dialog was cancelled). */
export function scan(o: ScanOptions): Promise<Uint8Array[]> {
  if (!['dialog', 'flatbed', 'feeder'].includes(o.source) || ![100, 150, 200, 300, 600].includes(o.dpi) || !['color', 'gray', 'bw'].includes(o.color)) throw new Error('Invalid scan settings')
  return withScript(async (dir, script) => {
    const out = join(dir, 'out')
    await mkdir(out)
    const args = [script, '-Mode', o.source === 'dialog' ? 'dialog' : 'direct', '-Out', out, '-Dpi', String(o.dpi), '-Color', o.color, '-Source', o.source]
    if (o.deviceId) args.push('-DeviceId', o.deviceId)
    await run(args)
    const files = (await readdir(out)).filter((f) => f.endsWith('.png')).sort()
    return Promise.all(files.map(async (f) => new Uint8Array(await readFile(join(out, f)))))
  })
}

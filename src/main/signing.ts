/**
 * Signing with certificates through Windows' own APIs (PowerShell and .NET's SignedCms), so keys in the Windows
 * certificate store (smart cards, non-exportable keys) work as well as .pfx files, and the system's trust decides
 * whether a signer's certificate is trusted. Passwords go in through the environment, never on the command line.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface CertInfo {
  thumbprint: string
  /** The name people know it by (common name). */
  name: string
  subject: string
  issuer: string
  notBefore: string
  notAfter: string
  hasKey: boolean
}

export type SignSource = { kind: 'store'; thumbprint: string } | { kind: 'pfx'; data: Uint8Array; password: string }

export interface ChainResult {
  trusted: boolean
  /** .NET chain status flags, e.g. UntrustedRoot, NotTimeValid, Revoked. */
  status: string[]
  /** The name of the root the chain ends at, when it got that far. */
  root?: string
}

const SCRIPT = String.raw`
param([string]$Mode, [string]$Data, [string]$Out, [string]$Pfx, [string]$Thumb)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$X509 = 'System.Security.Cryptography.X509Certificates'
function Get-Cert {
  if ($Pfx) { return New-Object "$X509.X509Certificate2" -ArgumentList $Pfx, $env:OPENPDF_PFX_PW, 'EphemeralKeySet' }
  return Get-Item "Cert:\CurrentUser\My\$Thumb"
}
function Describe($c) {
  [pscustomobject]@{
    thumbprint = $c.Thumbprint
    name = $c.GetNameInfo('SimpleName', $false)
    subject = $c.Subject
    issuer = $c.GetNameInfo('SimpleName', $true)
    notBefore = $c.NotBefore.ToUniversalTime().ToString('o')
    notAfter = $c.NotAfter.ToUniversalTime().ToString('o')
    hasKey = [bool]$c.HasPrivateKey
  }
}
switch ($Mode) {
  'list' {
    $list = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey } | ForEach-Object { Describe $_ })
    ConvertTo-Json -InputObject $list -Compress
  }
  'pfx' {
    $c = Get-Cert
    ConvertTo-Json -InputObject (Describe $c) -Compress
  }
  'sign' {
    $cert = Get-Cert
    $bytes = [System.IO.File]::ReadAllBytes($Data)
    $ci = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList (,$bytes)
    $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $ci, $true
    $signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner -ArgumentList $cert
    $signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid -ArgumentList '2.16.840.1.101.3.4.2.1'
    $signer.IncludeOption = 'WholeChain'
    $null = $signer.SignedAttributes.Add((New-Object System.Security.Cryptography.Pkcs.Pkcs9SigningTime))
    $cms.ComputeSignature($signer)
    [System.IO.File]::WriteAllBytes($Out, $cms.Encode())
  }
  'chain' {
    $lines = @(Get-Content -LiteralPath $Data | Where-Object { $_ })
    $leaf = New-Object "$X509.X509Certificate2" -ArgumentList (,[Convert]::FromBase64String($lines[0]))
    $chain = New-Object "$X509.X509Chain"
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $null = $chain.ChainPolicy.ExtraStore.Add((New-Object "$X509.X509Certificate2" -ArgumentList (,[Convert]::FromBase64String($lines[$i]))))
    }
    $chain.ChainPolicy.RevocationMode = 'NoCheck'
    $ok = $chain.Build($leaf)
    $status = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() })
    $root = $null
    if ($chain.ChainElements.Count -gt 0) { $root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate.GetNameInfo('SimpleName', $false) }
    ConvertTo-Json -InputObject ([pscustomobject]@{ trusted = $ok; status = $status; root = $root }) -Compress
  }
}
`

function run(args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split(/\r?\n/)[0] || 'The signing helper failed.'))
      else resolve(stdout)
    })
  })
}

/** Runs the helper script in a private temporary folder, which is removed afterwards. */
async function withScript<T>(fn: (dir: string, script: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'openpdf-sign-'))
  try {
    const script = join(dir, 'run.ps1')
    await writeFile(script, SCRIPT, 'utf8')
    return await fn(dir, script)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const THUMB = /^[0-9A-Fa-f]{40,64}$/

/** Certificates with a private key in the current user's personal store. */
export function listCertificates(): Promise<CertInfo[]> {
  return withScript(async (_d, script) => JSON.parse((await run([script, '-Mode', 'list'])).trim() || '[]') as CertInfo[])
}

/** Describes the certificate in a .pfx file (throws when the password is wrong). */
export function pfxInfo(data: Uint8Array, password: string): Promise<CertInfo> {
  return withScript(async (dir, script) => {
    const pfx = join(dir, 'c.pfx')
    await writeFile(pfx, data)
    return JSON.parse((await run([script, '-Mode', 'pfx', '-Pfx', pfx], { OPENPDF_PFX_PW: password })).trim()) as CertInfo
  })
}

/** A detached CMS (PKCS #7) signature over `data` with SHA-256 and the signer's whole chain included. */
export async function signCms(data: Uint8Array, source: SignSource): Promise<Uint8Array> {
  if (source.kind === 'store' && !THUMB.test(source.thumbprint)) throw new Error('Invalid certificate')
  return withScript(async (dir, script) => {
    const input = join(dir, 'data.bin')
    const out = join(dir, 'sig.der')
    await writeFile(input, data)
    if (source.kind === 'pfx') {
      const pfx = join(dir, 'c.pfx')
      await writeFile(pfx, source.data)
      await run([script, '-Mode', 'sign', '-Data', input, '-Out', out, '-Pfx', pfx], { OPENPDF_PFX_PW: source.password })
    } else await run([script, '-Mode', 'sign', '-Data', input, '-Out', out, '-Thumb', source.thumbprint])
    return new Uint8Array(await readFile(out))
  })
}

/** Whether Windows trusts the first certificate (the signer's), given the rest as intermediates. Revocation is not checked. */
export function chainStatus(certs: Uint8Array[]): Promise<ChainResult> {
  if (!certs.length) return Promise.resolve({ trusted: false, status: ['NoCertificate'] })
  return withScript(async (dir, script) => {
    const list = join(dir, 'certs.txt')
    await writeFile(list, certs.map((c) => Buffer.from(c).toString('base64')).join('\n'))
    return JSON.parse((await run([script, '-Mode', 'chain', '-Data', list])).trim()) as ChainResult
  })
}

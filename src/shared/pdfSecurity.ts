/**
 * PDF encryption settings: the permissions a document owner can restrict, the qpdf arguments that apply them, and
 * reading qpdf's description of an encrypted file back into the same terms. Pure, so both processes can use it.
 */

export interface Permissions {
  /** High quality, low resolution only, or no printing. */
  print: 'full' | 'low' | 'none'
  /** Copy text and graphics. */
  extract: boolean
  /** Read the text aloud or to a screen reader. */
  accessibility: boolean
  /** Add or change comments. */
  annotate: boolean
  /** Fill in form fields. */
  form: boolean
  /** Insert, delete, rotate and reorder pages. */
  assemble: boolean
  /** Change the content in any other way. */
  modifyOther: boolean
}

export const ALL_ALLOWED: Permissions = { print: 'full', extract: true, accessibility: true, annotate: true, form: true, assemble: true, modifyOther: true }

export interface EncryptOptions {
  /** Needed to open the file; empty means anyone can open it (the permissions still apply). */
  userPassword: string
  /** Lifts the permissions. */
  ownerPassword: string
  /** AES-256 (PDF 2.0) or AES-128. */
  keyLength: 128 | 256
  permissions: Permissions
}

const yn = (b: boolean) => (b ? 'y' : 'n')

/** qpdf arguments that encrypt a file as described (put the input and output files after them). */
export function encryptArgs(o: EncryptOptions): string[] {
  const p = o.permissions
  return [
    '--encrypt',
    o.userPassword,
    o.ownerPassword,
    String(o.keyLength),
    `--print=${p.print}`,
    `--extract=${yn(p.extract)}`,
    `--accessibility=${yn(p.accessibility)}`,
    `--annotate=${yn(p.annotate)}`,
    `--form=${yn(p.form)}`,
    `--assemble=${yn(p.assemble)}`,
    `--modify-other=${yn(p.modifyOther)}`,
    ...(o.keyLength === 128 ? ['--use-aes=y'] : []),
    '--'
  ]
}

export interface EncryptionInfo {
  /** none: not encrypted. open: encrypted but opens with the password given (or none). password: a password is needed. */
  state: 'none' | 'open' | 'password'
  /** Security handler revision (6 is AES-256). */
  revision?: number
  method?: 'AES-256' | 'AES-128' | 'RC4' | 'other'
  /** The password supplied was the owner password. */
  ownerPassword?: boolean
  permissions?: Permissions
}

interface QpdfEncryptJson {
  encrypt?: {
    capabilities?: Record<string, boolean>
    encrypted?: boolean
    ownerpasswordmatched?: boolean
    parameters?: { R?: number; method?: string }
  }
}

/**
 * Reads `qpdf --json --json-key=encrypt` (and its exit status) into terms the app uses. `json` is the file's text, or
 * undefined when qpdf wrote none (a password is needed).
 */
export function parseEncryptionJson(json: string | undefined, rc: number): EncryptionInfo {
  if (rc !== 0 || !json) return { state: 'password' }
  let e: QpdfEncryptJson['encrypt']
  try {
    e = (JSON.parse(json) as QpdfEncryptJson).encrypt
  } catch {
    return { state: 'password' }
  }
  if (!e || e.encrypted !== true) return { state: 'none' }
  const c = e.capabilities ?? {}
  const m = e.parameters?.method
  return {
    state: 'open',
    revision: e.parameters?.R,
    method: m === 'AESv3' ? 'AES-256' : m === 'AESv2' ? 'AES-128' : m === 'RC4' || m === 'RC4-40' || m === 'RC4-128' ? 'RC4' : 'other',
    ownerPassword: e.ownerpasswordmatched === true,
    permissions: {
      print: c.printhigh ? 'full' : c.printlow ? 'low' : 'none',
      extract: c.extract === true,
      accessibility: c.accessibility === true,
      annotate: c.modifyannotations === true,
      form: c.modifyforms === true,
      assemble: c.modifyassembly === true,
      modifyOther: c.modifyother === true
    }
  }
}

/** Whether the permissions stop the content, comments, forms or pages from being changed. */
export function restrictsEditing(p: Permissions): boolean {
  return !p.annotate || !p.form || !p.assemble || !p.modifyOther
}

/** A short description of what the permissions forbid, for a banner. */
export function describeRestrictions(p: Permissions): string {
  const no: string[] = []
  if (p.print === 'none') no.push('printing')
  else if (p.print === 'low') no.push('high quality printing')
  if (!p.extract) no.push('copying text and images')
  if (!p.annotate) no.push('commenting')
  if (!p.form) no.push('filling in forms')
  if (!p.assemble) no.push('changing pages')
  if (!p.modifyOther) no.push('editing')
  return no.join(', ')
}

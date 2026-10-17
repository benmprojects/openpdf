/**
 * Saved security policies: a name and the choices a Security dialog starts from (whether a password is needed to open the
 * document, whether printing, editing and copying are restricted, which are allowed, and the encryption strength).
 * Passwords are never part of a policy: they are typed each time. Kept in Settings, so cleaned on the way in. Pure.
 */
import { ALL_ALLOWED, type Permissions } from './pdfSecurity'

export interface SecurityPolicy {
  id: string
  name: string
  /** A password is needed to open the document (the policy does not hold it). */
  needOpen: boolean
  /** The permissions below apply (a permissions password is needed to lift them; it is not held either). */
  restrict: boolean
  permissions: Permissions
  level: 128 | 256
}

const MAX_POLICIES = 50
const MAX_NAME = 80

const PRINT: Permissions['print'][] = ['full', 'low', 'none']

export function cleanPermissions(raw: unknown): Permissions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flag = (k: keyof Permissions) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (ALL_ALLOWED[k] as boolean))
  return {
    print: PRINT.includes(r.print as Permissions['print']) ? (r.print as Permissions['print']) : 'full',
    extract: flag('extract'),
    accessibility: flag('accessibility'),
    annotate: flag('annotate'),
    form: flag('form'),
    assemble: flag('assemble'),
    modifyOther: flag('modifyOther')
  }
}

/** Valid policies only: an id and a name, no duplicate ids, at most 50. Anything that looks like a password is dropped. */
export function cleanSecurityPolicies(raw: unknown): SecurityPolicy[] {
  if (!Array.isArray(raw)) return []
  const out: SecurityPolicy[] = []
  const ids = new Set<string>()
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim()) continue
    const id = r.id.slice(0, 64)
    if (ids.has(id)) continue
    ids.add(id)
    out.push({
      id,
      name: r.name.trim().slice(0, MAX_NAME),
      needOpen: r.needOpen === true,
      restrict: r.restrict === true,
      permissions: cleanPermissions(r.permissions),
      level: r.level === 128 ? 128 : 256
    })
    if (out.length >= MAX_POLICIES) break
  }
  return out
}

/** Adds a policy, or replaces the one with the same name (compared without regard to case). */
export function savePolicy(list: SecurityPolicy[], policy: Omit<SecurityPolicy, 'id'>, newId: () => string): SecurityPolicy[] {
  const name = policy.name.trim().slice(0, MAX_NAME)
  const at = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase())
  const entry: SecurityPolicy = { ...policy, name, id: at >= 0 ? list[at].id : newId() }
  return at >= 0 ? list.map((p, i) => (i === at ? entry : p)) : [...list, entry].slice(0, MAX_POLICIES)
}

/** A line saying what a policy does, for the list. */
export function describePolicy(p: SecurityPolicy): string {
  const parts: string[] = []
  if (p.needOpen) parts.push('password to open')
  if (p.restrict) {
    const no: string[] = []
    if (p.permissions.print === 'none') no.push('no printing')
    else if (p.permissions.print === 'low') no.push('low-resolution printing')
    if (!p.permissions.extract) no.push('no copying')
    if (!p.permissions.modifyOther) no.push('no editing')
    if (!p.permissions.annotate) no.push('no comments')
    if (!p.permissions.form) no.push('no form filling')
    if (!p.permissions.assemble) no.push('no page changes')
    parts.push(no.length ? no.join(', ') : 'permissions password only')
  }
  if (!parts.length) parts.push('no protection')
  return `${parts.join('; ')}; AES-${p.level}`
}

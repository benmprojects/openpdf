import { useRef } from 'react'
import {
  defaultFloatPane,
  defaultIdentity,
  defaultPerformance,
  defaultPresentation,
  defaultRibbonLayout,
  defaultSearchProviders,
  defaultViewDefaults,
  DEFAULT_QUICK_ACCESS,
  type FloatPane,
  type Identity,
  type LaunchApp,
  type Performance,
  type PresentationPrefs,
  type RibbonLayout,
  type SearchProvider,
  type ViewDefaults
} from '../../shared/prefs'

/** The preferences the document view reads, gathered from Settings. `ready` is false until Settings have loaded. */
export interface AppPrefs {
  ready: boolean
  viewDefaults: ViewDefaults
  searchProviders: SearchProvider[]
  identity: Identity
  launchApps: LaunchApp[]
  performance: Performance
  quickAccess: string[]
  ribbonLayout: RibbonLayout
  presentation: PresentationPrefs
  floatPane: FloatPane
}

export type PrefsPatch = Partial<Omit<AppPrefs, 'ready'>>

export const DEFAULT_APP_PREFS: AppPrefs = {
  ready: false,
  viewDefaults: defaultViewDefaults(),
  searchProviders: defaultSearchProviders(),
  identity: defaultIdentity(),
  launchApps: [],
  performance: defaultPerformance(),
  quickAccess: [...DEFAULT_QUICK_ACCESS],
  ribbonLayout: defaultRibbonLayout(),
  presentation: defaultPresentation(),
  floatPane: defaultFloatPane()
}

export function prefsFrom(s: Partial<PrefsPatch> | null): AppPrefs {
  if (!s) return DEFAULT_APP_PREFS
  return {
    ready: true,
    viewDefaults: s.viewDefaults ?? DEFAULT_APP_PREFS.viewDefaults,
    searchProviders: s.searchProviders ?? DEFAULT_APP_PREFS.searchProviders,
    identity: s.identity ?? DEFAULT_APP_PREFS.identity,
    launchApps: s.launchApps ?? DEFAULT_APP_PREFS.launchApps,
    performance: s.performance ?? DEFAULT_APP_PREFS.performance,
    quickAccess: s.quickAccess ?? DEFAULT_APP_PREFS.quickAccess,
    ribbonLayout: s.ribbonLayout ?? DEFAULT_APP_PREFS.ribbonLayout,
    presentation: s.presentation ?? DEFAULT_APP_PREFS.presentation,
    floatPane: s.floatPane ?? DEFAULT_APP_PREFS.floatPane
  }
}

/** Keeps the same object while the content is equal, so effects keyed on it do not rerun on unrelated settings changes. */
export function useStable<T>(value: T): T {
  const ref = useRef(value)
  if (ref.current !== value && JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value
  return ref.current
}

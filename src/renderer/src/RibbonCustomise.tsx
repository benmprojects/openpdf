import { ArrowDown, ArrowUp } from 'lucide-react'
import { Modal } from './AppDialogs'
import { defaultRibbonLayout, groupKey, moveItem, type RibbonLayout } from '../../shared/prefs'
import { t } from './i18n'

interface Props {
  /** Every tab in its usual order: id and the name shown. */
  tabs: { id: string; name: string }[]
  /** The tab being shown now, and the names of its groups. */
  currentTab: string
  currentName: string
  groups: string[]
  layout: RibbonLayout
  onChange: (layout: RibbonLayout) => void
  onClose: () => void
}

/** Which ribbon tabs and groups are shown, and the order of the tabs. File always stays: it holds Open and Save. */
export function RibbonCustomise({ tabs, currentTab, currentName, groups, layout, onChange, onClose }: Props) {
  // The order as it is now: saved order first, the rest as they come.
  const ordered = [...tabs].sort((a, b) => {
    const rank = (id: string) => {
      const i = layout.tabOrder.indexOf(id)
      return i < 0 ? layout.tabOrder.length + tabs.findIndex((x) => x.id === id) : i
    }
    return rank(a.id) - rank(b.id)
  })
  const ids = ordered.map((x) => x.id)
  const move = (index: number, dir: -1 | 1) => onChange({ ...layout, tabOrder: moveItem(ids, index, dir) })
  const toggleTab = (id: string) => onChange({ ...layout, hiddenTabs: layout.hiddenTabs.includes(id) ? layout.hiddenTabs.filter((x) => x !== id) : [...layout.hiddenTabs, id] })
  const toggleGroup = (label: string) => {
    const key = groupKey(currentTab, label)
    onChange({ ...layout, hiddenGroups: layout.hiddenGroups.includes(key) ? layout.hiddenGroups.filter((x) => x !== key) : [...layout.hiddenGroups, key] })
  }
  return (
    <Modal title={t('Customise the ribbon')} onClose={onClose}>
      <div className="ribbon-custom">
        <section aria-label={t('Tabs')}>
          <h3>{t('Tabs')}</h3>
          <ul>
            {ordered.map((tab, i) => (
              <li key={tab.id}>
                <label>
                  <input type="checkbox" checked={tab.id === 'file' || !layout.hiddenTabs.includes(tab.id)} disabled={tab.id === 'file'} onChange={() => toggleTab(tab.id)} /> {tab.name}
                </label>
                <span className="qat-order">
                  <button type="button" className="icon-btn" aria-label={t('Move {name} earlier', { name: tab.name })} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} aria-hidden />
                  </button>
                  <button type="button" className="icon-btn" aria-label={t('Move {name} later', { name: tab.name })} disabled={i === ordered.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={t('Groups on the {tab} tab', { tab: currentName })}>
          <h3>{t('Groups on the {tab} tab', { tab: currentName })}</h3>
          <ul>
            {groups.map((g) => (
              <li key={g}>
                <label>
                  <input type="checkbox" checked={!layout.hiddenGroups.includes(groupKey(currentTab, g))} onChange={() => toggleGroup(g)} /> {g}
                </label>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('To change the groups of another tab, open that tab and choose Customise the ribbon again.')}</p>
        </section>
      </div>
      <div className="marks-actions" style={{ marginTop: 12 }}>
        <button type="button" onClick={() => onChange(defaultRibbonLayout())}>
          {t('Reset the ribbon')}
        </button>
        <button type="button" className="primary" onClick={onClose}>
          {t('Done')}
        </button>
      </div>
    </Modal>
  )
}

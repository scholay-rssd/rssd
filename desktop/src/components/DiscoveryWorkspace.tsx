import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {ACTIVE_SITE} from '../../../scripts/site-profile.mjs';
import TrendsWorkspace from '../hot/TrendsWorkspace';
import CalendarBoard from '../calendar/CalendarBoard';
import type {RssLibrarySection} from '../lib/rssLibrary';
import Icon, {type IconName} from './Icon';
import {tr} from '../uiText';

export type DiscoverySection = Exclude<RssLibrarySection, 'articles'>;
export const DISCOVERY_SECTION_KEY = 'scholay.discovery.section.v1';
export const discoverySection = (value: string | null | undefined): DiscoverySection =>
  value === 'labels' || value === 'calendar' || value === 'history' ? value : 'hot';

/** Each source view stays mounted so opening another feature preserves its tabs. */
export default function DiscoveryWorkspace({active, section, onChange}: {
  active: boolean; section: DiscoverySection; onChange: (section: DiscoverySection) => void;
}) {
  const {t} = useTranslation();
  const [sourceHost, setSourceHost] = useState<HTMLDivElement | null>(null);
  const [visited, setVisited] = useState<Set<DiscoverySection>>(() => new Set([section]));
  const [trends, setTrends] = useState<'hot' | 'labels'>(section === 'labels' ? 'labels' : 'hot');
  const [queries] = useState(() => new QueryClient({defaultOptions: {queries: {retry: 0, refetchOnWindowFocus: false, staleTime: 30_000}}}));
  useEffect(() => () => queries.clear(), [queries]);
  useEffect(() => {
    setVisited(previous => previous.has(section) ? previous : new Set([...previous, section]));
    if (section === 'hot' || section === 'labels') setTrends(section);
  }, [section]);
  const choices: {value: DiscoverySection; label: string; icon: IconName}[] = [
    {value: 'hot', label: t('sidebar.hotLibrary'), icon: 'globe'},
    {value: 'labels', label: t('sidebar.labelLibrary'), icon: 'tag'},
    {value: 'calendar', label: ACTIVE_SITE.legacy ? t('sidebar.calendarLibrary') : ACTIVE_SITE.columns[3], icon: 'grid'},
    {value: 'history', label: ACTIVE_SITE.legacy ? t('sidebar.historyLibrary') : ACTIVE_SITE.columns[4], icon: 'clock'},
  ];
  const trendsActive = active && (section === 'hot' || section === 'labels');
  return <div className="discovery-workspace">
    <aside className="discovery-sidebar">
      <header className="workspace-sidebar-heading"><strong>{tr('发现')}</strong></header>
      <nav className="discovery-navigation" aria-label={tr('发现栏目')}>
        {choices.map(choice => <button key={choice.value} type="button" aria-current={section === choice.value ? 'page' : undefined}
          onClick={() => onChange(choice.value)}><Icon name={choice.icon} size={16}/><span>{choice.label}</span></button>)}
      </nav>
      <div className="discovery-sources" ref={setSourceHost}/>
    </aside>
    <div className="discovery-content"><QueryClientProvider client={queries}>
      {(visited.has('hot') || visited.has('labels')) && <div className={'workspace-panel'+(!trendsActive?' is-inactive':'')} aria-hidden={!trendsActive} inert={!trendsActive}>
        <TrendsWorkspace active={trendsActive} section={section === 'hot' || section === 'labels' ? section : trends} sidebarHost={sourceHost} embedded/>
      </div>}
      {(['calendar', 'history'] as const).map(value => visited.has(value) && <div key={value} className={'workspace-panel'+(!(active&&section===value)?' is-inactive':'')} aria-hidden={!(active&&section===value)} inert={!(active&&section===value)}>
        <CalendarBoard active={active&&section===value} view={value==='calendar'?'year':'history'} sidebarHost={sourceHost} embedded/>
      </div>)}
    </QueryClientProvider></div>
  </div>;
}

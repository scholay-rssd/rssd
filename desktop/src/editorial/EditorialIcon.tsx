export default function EditorialIcon({name}: {name: 'folder' | 'refresh' | 'plus' | 'panel' | 'filter' | 'info' | 'more' | 'local' | 'cloud' | 'external'}) {
  const paths = {
    local: <><rect x="2.5" y="3" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13v4"/></>,
    cloud: <path d="M5.5 15.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-.5 4.25 4.25 0 0 1-.3 8.5z"/>,
    external: <><path d="M11 3h6v6M17 3l-8 8"/><path d="M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"/></>,
    folder: <><path d="M2.5 6h5l2 2h8v9h-15z"/><path d="M2.5 6V4h5l2 2h7v2"/></>,
    refresh: <><path d="M16.5 8a6.5 6.5 0 1 0-.3 5M16.5 3.5V8H12"/></>,
    plus: <path d="M10 3.5v13M3.5 10h13"/>,
    panel: <><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M12 3v14M14.5 7h1M14.5 10h1"/></>,
    filter: <><path d="M3 5h14M5.5 10h9M8 15h4"/></>,
    info: <><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6h.01"/></>,
    more: <><circle cx="4" cy="10" r=".75"/><circle cx="10" cy="10" r=".75"/><circle cx="16" cy="10" r=".75"/></>,
  };
  return <svg className="editorial-action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

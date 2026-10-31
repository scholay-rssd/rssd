import type {Category} from './contentLibrary';

export default function CategoryIcon({category}: {category: Category | 'all'}) {
  const paths = {
    all: <><rect x="2.5" y="2.5" width="6" height="6" rx="1.2"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.2"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.2"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.2"/></>,
    学界犀闻: <><rect x="2.5" y="3" width="15" height="14" rx="1.5"/><rect x="5.5" y="6" width="4" height="4" rx=".5"/><path d="M12 6h2.5M12 9h2.5M5.5 13h9"/></>,
    学者观察: <><path d="M2.5 10a8 8 0 0 1 15 0 8 8 0 0 1-15 0z"/><circle cx="10" cy="10" r="2.5"/></>,
    昔日学术: <><circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/></>,
    学术情报: <><rect x="2.5" y="4" width="15" height="13.5" rx="1.5"/><path d="M6 2.5v3M14 2.5v3M2.5 8h15M6 11h2M12 11h2M6 14h2"/></>,
    学术开源: <><path d="m6.5 6-4 4 4 4M13.5 6l4 4-4 4M11.5 3.5l-3 13"/></>,
  };
  return <svg className="category-icon" width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[category as keyof typeof paths]||paths.all}</svg>;
}

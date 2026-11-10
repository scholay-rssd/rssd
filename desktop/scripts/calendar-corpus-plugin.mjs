// Test-only Vite plugin: corpus tests read the private calendar overlay when it
// exists and are skipped against the synthetic public corpus.
import {readFileSync, realpathSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {CALENDAR_DIR, REPO_ROOT, overlayDirectory} from '../../scripts/data-overlay.mjs';

export function calendarCorpusPlugin(options) {
  const publicDir = resolve(REPO_ROOT, CALENDAR_DIR);
  const found = overlayDirectory(CALENDAR_DIR, options), overlay = found.overlay;
  // Vite compares real paths (macOS /tmp is a symlink to /private/tmp).
  const directory = realpathSync(found.directory);
  const history = JSON.parse(readFileSync(join(directory, 'historyEvents.json'), 'utf8'));
  const corpus = Array.isArray(history) && history.length > 0;
  return {
    name: 'rssd-calendar-corpus',
    enforce: 'pre',
    config: () => ({
      define: {__RSSD_CALENDAR_CORPUS__: JSON.stringify(corpus)},
      server: {fs: {allow: [directory]}},
    }),
    async resolveId(source, importer, resolveOptions) {
      if (!overlay || !importer || !source.endsWith('.json')) return null;
      const resolved = await this.resolve(source, importer, {...resolveOptions, skipSelf: true});
      if (!resolved || dirname(resolved.id) !== publicDir) return null;
      return join(directory, basename(resolved.id));
    },
  };
}

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';

/** The binding comes from the Center edition used to produce this export.
 * Its hash is the Center edition hash, distinct from the local export fingerprint. */
export async function uploadCardRendition({client, rendition, directory, binding}) {
  const workspaceId = protocol.id(rendition.workspaceId);
  protocol.id(binding.workId);
  protocol.locale(rendition.locale);
  protocol.integer(binding.revision, 'revision', 1);
  if (binding.exportHash !== rendition.source.hash) throw Error('Export binding mismatch');
  if (!/^[a-f0-9]{64}$/.test(binding.sourceHash)) throw Error('Invalid edition hash');
  const method = {'site':'algorithm','text':'algorithm','ai-code':'intelligent','ai-image':'image'}[rendition.style];
  if (!method) throw Error('Unknown generation method');
  const assets = new Map([...rendition.pages,rendition.cover].map(asset => [asset.mediaId, asset]));
  for (const [id, asset] of assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('Invalid asset hash');
    if (media.mediaId(workspaceId,asset.sha256) !== id) throw Error('Asset workspace mismatch');
    try {
      const saved = await client.request('/media/' + encodeURIComponent(id));
      if (saved.workspaceId !== workspaceId || saved.manifest.sha256 !== asset.sha256 || saved.manifest.bytes !== asset.bytes || saved.manifest.mime !== 'image/webp') throw Error('Remote asset mismatch');
      continue;
    } catch (error) { if (error.status !== 404) throw error; }
    const bytes = await readFile(join(directory,'article-media',asset.sha256+'.webp'));
    const manifest = media.imageManifest(bytes);
    if (manifest.sha256 !== asset.sha256 || manifest.bytes !== asset.bytes || manifest.mime !== 'image/webp') throw Error('Local asset mismatch');
    await client.request('/media',{method:'POST',body:{workspaceId,...manifest,data:bytes.toString('base64')}});
  }
  return client.request('/editorial/'+encodeURIComponent(workspaceId)+'/renditions', {
    method:'POST',body:{workId:binding.workId,locale:rendition.locale,revision:binding.revision,
      sourceHash:binding.sourceHash,method,title:rendition.title,cover:rendition.cover.mediaId,
      pages:rendition.pages.map(page=>page.mediaId)}
  });
}

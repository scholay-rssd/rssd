// Sync state between a local work and the website, computed and never stored. Every site a space publishes to
// is synchronized, so the state is kept per work per site: one baseline and one remote version per site.
// The local fingerprint excludes the file path, so moving a folder does not make a new publication.
export const SYNC_STATES=Object.freeze(['unknown','unpublished','unlinked','synced','local_changed','remote_changed','conflict','publishing','invalid']);

/** The state of one work on one site. `base` is the baseline of the last confirmed sync with that site. */
export function synchronizationState({base,local,remote,known=false,pending=false}){
 if(pending)return 'publishing';
 if(!known)return 'unknown';
 if(!base)return remote?.version||remote?.publishedVersion?'unlinked':'unpublished';
 const localChanged=base.fingerprint!==local;
 const remoteChanged=(remote?.version??remote?.publishedVersion??null)!==(base.cloudRevision??base.revision);
 if(localChanged&&remoteChanged)return 'conflict';
 if(remoteChanged)return 'remote_changed';
 if(localChanged)return 'local_changed';
 return 'synced';
}

/**
 * The state of one work on every site. `bases`, `remotes`, `known` and `pending` are keyed by site ID; a site
 * missing from `known` has not been queried yet. An unreadable local work is invalid everywhere.
 */
export function siteSyncStates({sites,local,bases={},remotes={},known={},pending={},invalid=false}){
 if(!Array.isArray(sites)||!sites.length)throw Error('At least one site is required');
 if(new Set(sites).size!==sites.length)throw Error('Sites must be unique');
 return Object.fromEntries(sites.map(site=>[site,invalid?'invalid':synchronizationState({
  base:bases[site]??null,local,remote:remotes[site]??null,known:known[site]===true,pending:pending[site]===true})]));
}

// Which state a combined badge shows: the one that most needs a person, then work still in flight.
const ATTENTION=['invalid','conflict','unlinked','remote_changed','local_changed','publishing','unknown','unpublished','synced'];
/** One state summarizing all sites, for a list badge. The per-site states stay the source of truth. */
export function overallSyncState(states){
 const values=Object.values(states||{});
 const unknown=values.find(v=>!SYNC_STATES.includes(v));
 if(unknown!==undefined)throw Error('Unknown sync state: '+unknown);
 if(!values.length)return 'unknown';
 return ATTENTION.find(state=>values.includes(state));
}

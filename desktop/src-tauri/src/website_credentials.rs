//! Process-local, per-site credentials. Persistence stays in the OS vault.
use std::{collections::HashMap, sync::{Arc, Mutex, TryLockError}};

type Slot = Arc<Mutex<Option<String>>>;
const CACHE_ERROR: &str = "官网凭证缓存不可用";

#[derive(Default)]
pub(crate) struct WebsiteCredentials {
    sites: Mutex<HashMap<String, Slot>>,
}

impl WebsiteCredentials {
    fn slot(&self, service: &str) -> Result<Slot, String> {
        Ok(self.sites.lock().map_err(|_| CACHE_ERROR)?
            .entry(service.to_owned()).or_default().clone())
    }

    // Local recovery must not wait behind a system authorization dialog.
    pub(crate) fn cached(&self, service: &str) -> Result<Option<String>, String> {
        let slot = self.slot(service)?;
        let result = match slot.try_lock() {
            Ok(token) => Ok(token.clone()),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Poisoned(_)) => Err(CACHE_ERROR.to_owned()),
        };
        result
    }

    pub(crate) fn read(&self, service: &str, load: impl FnOnce() -> Result<Option<String>, String>) -> Result<Option<String>, String> {
        let slot = self.slot(service)?;
        let mut token = slot.lock().map_err(|_| CACHE_ERROR)?;
        if token.is_none() {
            *token = load()?;
        }
        Ok(token.clone())
    }

    pub(crate) fn save(&self, service: &str, value: &str, persist: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        let slot = self.slot(service)?;
        let mut token = slot.lock().map_err(|_| CACHE_ERROR)?;
        persist()?;
        *token = Some(value.to_owned());
        Ok(())
    }

    pub(crate) fn forget(&self, service: &str, remove: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        let slot = self.slot(service)?;
        let mut token = slot.lock().map_err(|_| CACHE_ERROR)?;
        remove()?;
        *token = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::{AtomicUsize, Ordering}, mpsc, Barrier};

    #[test]
    fn concurrent_cloud_calls_load_once_and_keep_sites_separate() {
        let cache = WebsiteCredentials::default();
        let loads = AtomicUsize::new(0);
        let start = Barrier::new(8);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    start.wait();
                    assert_eq!(cache.read("site-a", || {
                        loads.fetch_add(1, Ordering::SeqCst);
                        Ok(Some("synthetic-a".into()))
                    }).unwrap().as_deref(), Some("synthetic-a"));
                });
            }
        });
        assert_eq!(loads.load(Ordering::SeqCst), 1);
        assert_eq!(cache.cached("site-b").unwrap(), None);
        assert_eq!(cache.read("site-b", || Ok(Some("synthetic-b".into()))).unwrap().as_deref(), Some("synthetic-b"));
        assert_eq!(cache.read("site-a", || panic!("must reuse authorized credential")).unwrap().as_deref(), Some("synthetic-a"));
    }

    #[test]
    fn local_recovery_does_not_wait_for_a_vault_prompt() {
        let cache = WebsiteCredentials::default();
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let cache_ref = &cache;
            scope.spawn(move || cache_ref.read("site-a", || {
                started_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
                Ok(Some("synthetic".into()))
            }));
            started_rx.recv().unwrap();
            assert_eq!(cache.cached("site-a").unwrap(), None);
            assert_eq!(cache.cached("site-b").unwrap(), None);
            finish_tx.send(()).unwrap();
        });
        assert_eq!(cache.cached("site-a").unwrap().as_deref(), Some("synthetic"));
    }

    #[test]
    fn import_rotation_and_forget_update_cache_only_after_vault_success() {
        let cache = WebsiteCredentials::default();
        cache.save("site-a", "old", || Ok(())).unwrap();
        assert!(cache.save("site-a", "new", || Err("denied".into())).is_err());
        assert_eq!(cache.cached("site-a").unwrap().as_deref(), Some("old"));
        cache.save("site-a", "new", || Ok(())).unwrap();
        assert_eq!(cache.read("site-a", || panic!("import already authorized")).unwrap().as_deref(), Some("new"));
        assert!(cache.forget("site-a", || Err("denied".into())).is_err());
        assert_eq!(cache.cached("site-a").unwrap().as_deref(), Some("new"));
        cache.forget("site-a", || Ok(())).unwrap();
        assert_eq!(cache.read("site-a", || Ok(None)).unwrap(), None);
    }

    #[test]
    fn failed_or_missing_read_is_not_treated_as_authorized() {
        let cache = WebsiteCredentials::default();
        assert!(cache.read("site-a", || Err("cancelled".into())).is_err());
        assert_eq!(cache.cached("site-a").unwrap(), None);
        assert_eq!(cache.read("site-a", || Ok(None)).unwrap(), None);
        assert_eq!(cache.read("site-a", || Ok(Some("retried".into()))).unwrap().as_deref(), Some("retried"));
    }
}

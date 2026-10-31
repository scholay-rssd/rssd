//! Small, public site-specific subscription packs. Embedded at build time;
//! authorization files cannot supply executable configuration or feed URLs.
use crate::{
    db,
    error::{AppError, AppResult},
    opml,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const CATALOG: &str = include_str!("../../../../sites/rss/packs/catalog.json");
// Deliberately not versioned in the key: upgrading a pack must not resurrect
// subscriptions the owner removed after the first import.
const RECEIPT: &str = "rss.site-pack.applied";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: u32,
    revision: String,
    packs: Vec<SitePack>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitePack {
    pub site_id: String,
    pub space_id: String,
    pub name: String,
    pub feeds: Vec<Subscription>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Subscription {
    pub title: String,
    pub url: String,
    pub folder: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub available: bool,
    pub already_applied: bool,
    pub added: usize,
    pub preserved: usize,
}

fn catalog() -> AppResult<Catalog> {
    let catalog: Catalog = serde_json::from_str(CATALOG)
        .map_err(|e| AppError::Other(format!("订阅配置无法读取：{e}")))?;
    if catalog.version != 1 || catalog.revision.is_empty() {
        return Err(AppError::Other("订阅配置版本无效".into()));
    }
    Ok(catalog)
}

pub fn packs() -> AppResult<Vec<SitePack>> {
    Ok(catalog()?.packs)
}

/// Only explicitly imported authorizations and a fresh default academic space
/// call this. Opening/upgrading an existing space does not add subscriptions.
/// Existing URLs (including archived feeds) and all their metadata are kept.
pub fn initialize(conn: &Connection, site_id: &str) -> AppResult<ImportResult> {
    let catalog = catalog()?;
    let Some(pack) = catalog.packs.into_iter().find(|p| p.site_id == site_id) else {
        return Ok(ImportResult::default());
    };
    let tx = conn.unchecked_transaction()?;
    if let Some(receipt) = db::get_setting(&tx, RECEIPT)? {
        let receipt: serde_json::Value = serde_json::from_str(&receipt)
            .map_err(|_| AppError::Other("订阅初始化记录损坏，请保留现有数据".into()))?;
        if receipt["siteId"] != site_id {
            return Err(AppError::Other(
                "订阅库已属于其他站点，原有数据未修改".into(),
            ));
        }
        return Ok(ImportResult {
            available: true,
            already_applied: true,
            ..Default::default()
        });
    }
    let mut seen = HashSet::new();
    let mut feeds = Vec::new();
    for feed in pack.feeds {
        let url = url::Url::parse(&feed.url).map_err(|_| AppError::Other("订阅地址无效".into()))?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || feed.title.trim().is_empty()
            || feed.folder.trim().is_empty()
            || !seen.insert(feed.url.clone())
        {
            return Err(AppError::Other("订阅配置存在无效或重复项目".into()));
        }
        feeds.push(opml::ImportedFeed {
            feed_url: feed.url,
            title: feed.title,
            folder: Some(feed.folder),
        });
    }
    let added = opml::merge(&tx, &feeds)?;
    db::set_setting(
        &tx,
        RECEIPT,
        &serde_json::json!({
            "siteId": site_id, "revision": catalog.revision, "added": added
        })
        .to_string(),
    )?;
    tx.commit()?;
    Ok(ImportResult {
        available: true,
        already_applied: false,
        added,
        preserved: feeds.len() - added,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SourceType;
    fn memory() -> Connection {
        db::open(std::path::Path::new(":memory:")).unwrap()
    }

    #[test]
    fn all_ten_packs_roundtrip_as_normal_opml_and_do_not_resurrect_deleted_feeds() {
        let packs = packs().unwrap();
        assert_eq!(packs.len(), 10);
        let mut ids = HashSet::new();
        for pack in packs {
            assert!(ids.insert(pack.site_id.clone()));
            assert!((4..=8).contains(&pack.feeds.len()));
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../sites/rss/packs")
                .join(format!("{}.opml", pack.site_id));
            let file = opml::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
            let mut actual = file
                .into_iter()
                .map(|f| (f.feed_url, f.title, f.folder.unwrap()))
                .collect::<Vec<_>>();
            let mut expected = pack
                .feeds
                .iter()
                .map(|f| (f.url.clone(), f.title.clone(), f.folder.clone()))
                .collect::<Vec<_>>();
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected);
            let conn = memory();
            assert_eq!(
                initialize(&conn, &pack.site_id).unwrap().added,
                pack.feeds.len()
            );
            let exported = db::feeds_for_export(&conn).unwrap();
            let xml = opml::build(&exported).unwrap();
            let other = memory();
            assert_eq!(opml::import(&other, &xml).unwrap(), exported.len());
            assert_eq!(opml::import(&other, &xml).unwrap(), 0);
            assert_eq!(db::feeds_for_export(&other).unwrap(), exported);
            conn.execute("DELETE FROM feeds", []).unwrap();
            assert!(initialize(&conn, &pack.site_id).unwrap().already_applied);
            assert_eq!(db::list_feeds(&conn).unwrap().len(), 0);
        }
    }

    #[test]
    fn existing_folders_titles_reading_state_and_archived_sources_are_preserved() {
        let conn = memory();
        let pack = packs()
            .unwrap()
            .into_iter()
            .find(|p| p.site_id == "pets")
            .unwrap();
        let folder = db::create_folder(&conn, "我的分组").unwrap();
        let original = db::insert_feed(
            &conn,
            &pack.feeds[0].url,
            None,
            "我的名称",
            None,
            SourceType::Rss,
            Some(folder),
        )
        .unwrap();
        conn.execute(
            "UPDATE feeds SET custom_title=1,refresh_interval_min=525600 WHERE id=?1",
            [original],
        )
        .unwrap();
        conn.execute("INSERT INTO articles(feed_id,guid,title,is_read,is_starred,read_later) VALUES(?1,'kept','保留记录',1,1,1)", [original]).unwrap();
        let archived = db::insert_feed(
            &conn,
            &pack.feeds[1].url,
            None,
            "归档名称",
            None,
            SourceType::Rss,
            Some(folder),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO library_archived_feeds(feed_id) VALUES(?1)",
            [archived],
        )
        .unwrap();
        let unrelated = db::insert_feed(
            &conn,
            "https://example.org/own.xml",
            None,
            "自有订阅",
            None,
            SourceType::Rss,
            Some(folder),
        )
        .unwrap();
        let result = initialize(&conn, "pets").unwrap();
        assert_eq!(result.added, pack.feeds.len() - 2);
        assert_eq!(result.preserved, 2);
        let preserved: (String, i64, i64, i64) = conn
            .query_row(
                "SELECT title,folder_id,custom_title,refresh_interval_min FROM feeds WHERE id=?1",
                [original],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(preserved, ("我的名称".into(), folder, 1, 525600));
        assert_eq!(
            conn.query_row(
                "SELECT is_read+is_starred+read_later FROM articles WHERE guid='kept'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            3
        );
        assert_eq!(
            conn.query_row("SELECT feed_id FROM library_archived_feeds", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            archived
        );
        assert_eq!(
            db::find_feed_by_url(&conn, "https://example.org/own.xml").unwrap(),
            Some(unrelated)
        );
        // Ordinary OPML import has the same merge semantics as authorization import.
        let xml = opml::build(
            &pack
                .feeds
                .iter()
                .map(|f| (f.title.clone(), f.url.clone(), Some(f.folder.clone())))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(opml::import(&conn, &xml).unwrap(), 0);
        assert_eq!(
            db::list_folders(&conn)
                .unwrap()
                .iter()
                .find(|f| f.id == folder)
                .unwrap()
                .name,
            "我的分组"
        );
    }

    #[test]
    fn failed_pack_import_rolls_back_both_subscriptions_and_receipt_and_can_retry() {
        let conn = memory();
        conn.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON settings WHEN NEW.key='rss.site-pack.applied' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;").unwrap();
        assert!(initialize(&conn, "metho").is_err());
        assert!(db::list_feeds(&conn).unwrap().is_empty());
        assert!(db::list_folders(&conn).unwrap().is_empty());
        assert!(db::get_setting(&conn, RECEIPT).unwrap().is_none());
        conn.execute_batch("DROP TRIGGER fail_receipt").unwrap();
        assert!(initialize(&conn, "metho").unwrap().added > 0);
        assert!(initialize(&conn, "legis").is_err());
        assert!(!initialize(&memory(), "custom-site").unwrap().available);
    }

    #[test]
    fn malformed_opml_leaves_existing_library_untouched() {
        let conn = memory();
        initialize(&conn, "study").unwrap();
        let before = db::feeds_for_export(&conn).unwrap();
        assert!(opml::import(&conn, "<opml><body>").is_err());
        assert_eq!(before, db::feeds_for_export(&conn).unwrap());
    }
}

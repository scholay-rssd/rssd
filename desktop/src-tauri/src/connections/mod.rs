//! Explicit, read-only source connections. No polling, subscriptions or publishing.
mod adapters;
use crate::{db, state::AppState, workbench_connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const KEY: &str = "source_connections_v1";
static CHANGES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    provider: String,
    configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    status: String,
    target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    checked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}
fn empty(id: &str) -> Connection {
    Connection {
        provider: id.into(),
        status: "unconfigured".into(),
        ..Default::default()
    }
}
fn manifest() -> Value {
    serde_json::from_str(include_str!("../../../src/connections/catalog.json"))
        .expect("bundled connection manifest")
}
fn credential_key(space: &str, provider: &str) -> String {
    use sha2::{Digest, Sha256};
    format!(
        "com.thomas.papr.sources.{:x}.{}",
        Sha256::digest(space.as_bytes()),
        provider
    )
}
fn read(conn: &rusqlite::Connection) -> Result<Vec<Connection>, String> {
    db::get_setting(conn, KEY)
        .map_err(|_| "无法读取连接设置")?
        .map(|v| {
            serde_json::from_str(&v).map_err(|_| "连接设置格式无效，请保留当前数据并重试".into())
        })
        .unwrap_or_else(|| Ok(vec![]))
}
fn write(conn: &rusqlite::Connection, value: &Connection) -> Result<(), String> {
    let mut values = read(conn)?;
    values.retain(|v| v.provider != value.provider);
    values.push(value.clone());
    db::set_setting(
        conn,
        KEY,
        &serde_json::to_string(&values).map_err(|_| "无法保存连接设置")?,
    )
    .map_err(|_| "无法保存连接设置".into())
}
fn set_enabled(
    conn: &rusqlite::Connection,
    previous: &Connection,
    enabled: bool,
) -> Result<Connection, String> {
    if !previous.configured {
        return Err("请先连接此来源，再在当前空间启用".into());
    }
    let mut next = previous.clone();
    next.enabled = Some(enabled);
    write(conn, &next)?;
    Ok(next)
}
fn require_enabled(connection: &Connection) -> Result<(), String> {
    if connection.enabled == Some(false) {
        return Err("此来源已在当前空间停用，请在连接中心启用".into());
    }
    Ok(())
}
async fn vault_read(key: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || workbench_connection::read_for(&key))
        .await
        .map_err(|_| "凭证读取中断")?
}
async fn vault_write(key: String, secret: Option<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || match secret {
        Some(v) => workbench_connection::save_for(&key, &v),
        None => workbench_connection::forget_for(&key),
    })
    .await
    .map_err(|_| "凭证保存中断")?
}

#[tauri::command]
pub async fn connection_center(
    _space: crate::spaces::Lease,
    webview: tauri::Webview,
    state: tauri::State<'_, AppState>,
    method: String,
    provider: Option<String>,
    secret: Option<String>,
    target: Option<String>,
    cursor: Option<String>,
    enabled: Option<bool>,
    expected_space: Option<String>,
) -> Result<Value, String> {
    crate::hot_board::require_main(&webview)?;
    let _change = CHANGES.lock().await;
    let space = crate::spaces::text("spaceId")?;
    if expected_space
        .as_ref()
        .is_some_and(|expected| expected != &space)
    {
        return Err("工作空间已切换，请重新打开连接中心".into());
    }
    if method == "list" {
        let values = read(&*state.db.lock().await)?;
        let connections: Vec<_> = manifest()["providers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| {
                let id = p["id"].as_str().unwrap();
                values
                    .iter()
                    .find(|v| v.provider == id)
                    .cloned()
                    .unwrap_or_else(|| empty(id))
            })
            .collect();
        let context = crate::spaces::context()?;
        return Ok(
            json!({"spaceId":space,"spaceName":context["spaces"].as_array().and_then(|v|v.iter().find(|s|s["id"].as_str()==Some(&space))).and_then(|s|s["name"].as_str()).unwrap_or(&space),"vault":if cfg!(windows){"Windows 凭据管理器"}else if cfg!(target_os="macos"){"macOS 钥匙串"}else{"此系统暂不支持凭证保存"},"connections":connections}),
        );
    }
    let id = provider.as_deref().ok_or("请选择来源")?;
    let adapter = adapters::Adapter::from_id(id)?;
    let key = credential_key(&space, id);
    let previous = read(&*state.db.lock().await)?
        .into_iter()
        .find(|v| v.provider == id)
        .unwrap_or_else(|| empty(id));
    match method.as_str() {
        "set_enabled" => Ok(json!(set_enabled(
            &*state.db.lock().await,
            &previous,
            enabled.ok_or("请选择启用状态")?
        )?)),
        "disconnect" => {
            let old = vault_read(key.clone()).await?;
            vault_write(key.clone(), None).await?;
            let next = empty(id);
            if let Err(e) = write(&*state.db.lock().await, &next) {
                vault_write(key, old)
                    .await
                    .map_err(|_| "连接记录保存失败，凭证恢复失败；请重新连接")?;
                return Err(e);
            }
            Ok(json!(next))
        }
        "save" | "verify" | "browse" => {
            if method == "browse" {
                require_enabled(&previous)?;
            }
            let old = vault_read(key.clone()).await?;
            let token = if method == "save" {
                secret
                    .filter(|v| !v.trim().is_empty())
                    .map(|v| v.trim().to_owned())
                    .or_else(|| old.clone())
            } else {
                old.clone()
            };
            let Some(token) = token else {
                if method != "save" {
                    write(&*state.db.lock().await, &empty(id))?;
                }
                return Err("请先输入连接凭证".into());
            };
            if token.len() > 2400 || token.len() < 8 || !token.chars().all(|c| c.is_ascii_graphic())
            {
                return Err("凭证格式无效；请粘贴令牌本身，不包含 Bearer 前缀".into());
            }
            let selected = if method == "save" {
                target.unwrap_or_default()
            } else {
                previous.target.clone()
            };
            let selected = adapter.normalize_target(&selected)?;
            if cursor
                .as_ref()
                .is_some_and(|v| v.len() > 2048 || v.chars().any(char::is_control))
            {
                return Err("分页标记无效".into());
            }
            // Probe the actual requested resource, not just the presence of a key.
            let proxy = db::get_setting(&*state.db.lock().await, "net_proxy")
                .map_err(|_| "无法读取网络设置")?
                .unwrap_or_else(|| "system".into());
            let response = adapter
                .browse(
                    &token,
                    &selected,
                    if method == "browse" {
                        cursor.as_deref()
                    } else {
                        None
                    },
                    &proxy,
                )
                .await;
            match response {
                Ok(page) => {
                    let next = Connection {
                        provider: id.into(),
                        configured: true,
                        enabled: Some(if previous.configured {
                            previous.enabled.unwrap_or(true)
                        } else {
                            true
                        }),
                        status: "verified".into(),
                        target: selected,
                        checked_at: Some(chrono::Utc::now().to_rfc3339()),
                        message: None,
                    };
                    if method == "save" {
                        vault_write(key.clone(), Some(token)).await?;
                    }
                    if let Err(e) = write(&*state.db.lock().await, &next) {
                        if method == "save" {
                            vault_write(key, old)
                                .await
                                .map_err(|_| "连接记录保存失败，旧凭证恢复失败；请重新连接")?;
                        }
                        return Err(e);
                    }
                    Ok(if method == "browse" {
                        json!(page)
                    } else {
                        json!(next)
                    })
                }
                Err(e) => {
                    // A failed replacement must never overwrite a working credential/config.
                    if method != "save" {
                        let mut next = previous;
                        next.status = e.status.into();
                        next.message = Some(e.message.into());
                        next.checked_at = Some(chrono::Utc::now().to_rfc3339());
                        write(&*state.db.lock().await, &next)?;
                        if method == "verify" {
                            return Ok(json!(next));
                        }
                    }
                    Err(e.message.into())
                }
            }
        }
        _ => Err("不支持的连接操作".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_enablement_preserves_connection_and_legacy_state() {
        let first = rusqlite::Connection::open_in_memory().unwrap();
        let other = rusqlite::Connection::open_in_memory().unwrap();
        for db in [&first, &other] {
            db.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
                .unwrap();
        }
        let legacy: Connection = serde_json::from_value(json!({"provider":"github","configured":true,"status":"verified","target":"owner/repo"})).unwrap();
        assert!(require_enabled(&legacy).is_ok());
        write(&first, &legacy).unwrap();
        write(&other, &legacy).unwrap();
        let disabled = set_enabled(&first, &legacy, false).unwrap();
        assert!(require_enabled(&disabled).is_err());
        assert!(disabled.configured);
        assert_eq!(disabled.target, "owner/repo");
        assert_eq!(disabled.status, "verified");
        assert_eq!(read(&first).unwrap()[0].enabled, Some(false));
        assert!(require_enabled(&read(&other).unwrap()[0]).is_ok());
        assert!(require_enabled(&set_enabled(&first, &disabled, true).unwrap()).is_ok());
        assert!(set_enabled(&first, &empty("figma"), true).is_err());
        assert_eq!(read(&first).unwrap().len(), 1);
    }
    #[test]
    fn catalog_and_native_adapters_match() {
        for p in manifest()["providers"].as_array().unwrap() {
            adapters::Adapter::from_id(p["id"].as_str().unwrap()).unwrap();
        }
        assert!(adapters::Adapter::from_id("arbitrary-url").is_err());
    }
    #[test]
    fn vault_names_are_isolated_and_metadata_contains_no_secret() {
        assert_ne!(
            credential_key("design", "github"),
            credential_key("academic", "github")
        );
        assert_ne!(
            credential_key("design", "figma"),
            credential_key("design", "github")
        );
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        let mut v = empty("github");
        v.target = "owner/repo".into();
        v.configured = true;
        write(&conn, &v).unwrap();
        v.target = "owner/changed".into();
        write(&conn, &v).unwrap();
        let values = read(&conn).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].target, "owner/changed");
        assert!(!serde_json::to_string(&values).unwrap().contains("secret"));
        db::set_setting(&conn, KEY, "not-json").unwrap();
        assert!(write(&conn, &empty("figma")).is_err());
    }
}

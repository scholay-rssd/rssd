//! File-based manuscripts live in the selected workspace, outside the RSS DB.
//! Only fixed operations are accepted; MCP cannot choose a path or run a command.
use serde_json::{json, Value};
use std::{path::{Component, Path, PathBuf}, process::Stdio};
use tauri::Webview;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_dialog::DialogExt;

pub async fn call(method: &str, params: Value) -> Result<Value, String> {
    if !["draft_list", "draft_read", "draft_private_notes", "draft_save", "draft_create", "draft_preview", "publication_status", "workspace_stamp"].contains(&method) {
        return Err("Unknown manuscript operation".into());
    }
    let mut input = serde_json::to_vec(&json!({"method":method,"params":params})).map_err(|e|e.to_string())?;
    if input.len()>700_000 { return Err("稿件请求过大".into()); }
    input.push(b'\n');
    let output=crate::workbench_process::output(
        &mut crate::workbench_runtime::command("scripts/editorial-workspace.mjs")?,
        &input, std::time::Duration::from_secs(20)).await
        .map_err(|error| if error.kind()==std::io::ErrorKind::TimedOut {"稿件操作超时，请检查文件状态".into()} else {error.to_string()})?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(1500).collect());}
    serde_json::from_slice(&output.stdout).map_err(|_| "稿件工作区返回格式错误".into())
}
#[tauri::command]
pub async fn editorial_call(_space: crate::spaces::Lease, webview: Webview, method: String, params: Value) -> Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    call(&method,params).await
}

#[tauri::command]
pub async fn editorial_location(_space: crate::spaces::Lease, webview: Webview, method: String, path: Option<String>) -> Result<Value,String>{
    crate::hot_board::require_main(&webview)?;
    if method == "pick" || method == "initialize_pick" {
        let mut picker = webview.dialog().file()
            .set_title("选择稿件工作目录")
            .set_parent(&webview.window());
        if let Ok(root) = selected_root().await {
            picker = picker.set_directory(root);
        }
        // The native panel stays responsive; cancellation never changes the saved root.
        let (send, receive) = tokio::sync::oneshot::channel();
        picker.pick_folder(move |folder| { let _ = send.send(folder); });
        let Some(folder) = receive.await.map_err(|_| "文件夹选择器已关闭")? else {
            return Ok(Value::Null);
        };
        let selected = folder.into_path().map_err(|_| "请选择本地文件夹")?;
        return crate::publications::run("workspace-location.mjs", if method == "initialize_pick" {"initialize"} else {"select"}, json!({"path": selected})).await;
    }
    if !["info", "select"].contains(&method.as_str()) { return Err("Unknown directory operation".into()); }
    crate::publications::run("workspace-location.mjs", &method, json!({"path": path})).await
}

pub(crate) async fn selected_root() -> Result<PathBuf,String> {
    let info=crate::publications::run("workspace-location.mjs", "info", json!({})).await?;
    info.get("path").and_then(Value::as_str).map(PathBuf::from).ok_or("稿件目录未配置".into())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorialOpenTarget {
    Finder,
    Cursor,
}

// Resolve again after reading the index: the renderer never supplies a file path.
// Canonicalization rejects both traversal and symlinks leaving the article tree.
fn manuscript_path(root: &Path, canonical_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(canonical_path)
        .strip_prefix("articles")
        .map_err(|_| "稿件路径不在文章目录中")?;
    if relative.as_os_str().is_empty()
        || !relative.components().all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("稿件路径无效".into());
    }
    let articles = root.join("articles").canonicalize()
        .map_err(|_| "找不到本地文章目录，请检查工作区是否仍在原位置")?;
    let path = articles.join(relative).canonicalize()
        .map_err(|_| "找不到这篇稿件的正文文件，请刷新稿件列表后重试")?;
    if !path.starts_with(&articles) || !path.is_file()
        || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
    {
        return Err("只能打开文章目录内的 Markdown 正文文件".into());
    }
    Ok(path)
}

// Directory actions accept a path relative to editorial/, including articles
// itself. Resolve the real target so a renderer-supplied path or symlink cannot
// make the file manager / editor open a directory outside the manuscript tree.
fn manuscript_directory(root: &Path, directory_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(directory_path)
        .strip_prefix("articles")
        .map_err(|_| "目录路径不在文章目录中")?;
    if !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return Err("稿件目录路径无效".into());
    }
    let articles = root.join("articles").canonicalize()
        .map_err(|_| "找不到本地文章目录，请检查工作区是否仍在原位置")?;
    let path = articles.join(relative).canonicalize()
        .map_err(|_| "找不到这个稿件目录，请刷新目录列表后重试")?;
    if !path.starts_with(&articles) || !path.is_dir() {
        return Err("只能打开文章目录内的文件夹".into());
    }
    Ok(path)
}

/// Opens the manuscript folder in Cursor; with `file`, that file is opened in the same call so the editor lands on it.
async fn open_in_cursor(path: &Path, file: Option<&Path>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = tokio::process::Command::new("/usr/bin/open");
        command.args(["-a", "Cursor"]).arg(path);
        if let Some(file) = file { command.arg(file); }
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let cursor = [
            std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("Programs/cursor/Cursor.exe")),
            std::env::var_os("ProgramFiles").map(|dir| PathBuf::from(dir).join("Cursor/Cursor.exe")),
        ].into_iter().flatten().find(|path| path.is_file())
            .ok_or("未找到 Cursor。请先安装 Cursor，再从稿件中重试。")?;
        let mut command = tokio::process::Command::new(cursor);
        command.arg(path);
        if let Some(file) = file { command.arg(file); }
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = {
        let mut command = tokio::process::Command::new("cursor");
        command.arg(path);
        if let Some(file) = file { command.arg(file); }
        command
    };
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "macos")]
    {
        // LaunchServices returns after dispatch, so failures can be reported
        // without waiting for the editor itself to exit.
        command.kill_on_drop(true);
        let status = tokio::time::timeout(std::time::Duration::from_secs(15), command.status()).await
            .map_err(|_| "Cursor 启动未及时返回，请查看 Cursor 后再重试")?
            .map_err(|_| "未能启动 Cursor。请先安装并启动一次 Cursor，然后重试。")?;
        if !status.success() {
            return Err("未能打开 Cursor。请先安装并启动一次 Cursor，然后重试打开稿件。".into());
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Some distributions launch a long-lived editor process instead of a
        // launcher. Reap it separately and never kill the user's editor.
        let mut child = command.spawn()
            .map_err(|_| "未能启动 Cursor。请先安装 Cursor；Linux 还需将 cursor 命令加入 PATH。")?;
        tokio::spawn(async move { let _ = child.wait().await; });
    }
    Ok(())
}

// This user-initiated desktop action is deliberately separate from the MCP API.
#[tauri::command]
pub async fn editorial_open_workspace(_space: crate::spaces::Lease, webview: Webview, target: EditorialOpenTarget) -> Result<(), String> {
    crate::hot_board::require_main(&webview)?;
    let root=selected_root().await?;
    match target {
        EditorialOpenTarget::Cursor => open_in_cursor(&root, None).await,
        EditorialOpenTarget::Finder => webview.opener().open_path(root.to_string_lossy().into_owned(),None::<&str>).map_err(|_|"无法打开稿件工作目录".into()),
    }
}

#[tauri::command]
pub async fn editorial_open(_space: crate::spaces::Lease, webview: Webview, id: String, target: EditorialOpenTarget) -> Result<(), String> {
    crate::hot_board::require_main(&webview)?;
    let draft = call("draft_read", json!({"id": id})).await?;
    let canonical_path = draft.get("canonicalPath").and_then(Value::as_str)
        .ok_or("稿件索引缺少正文路径，请刷新稿件列表后重试")?;
    let root = selected_root().await?;
    let path = manuscript_path(&root, canonical_path)?;
    match target {
        EditorialOpenTarget::Finder => webview.opener().reveal_item_in_dir(path)
            .map_err(|_| "无法在文件管理器中显示稿件，请检查正文文件是否仍然存在".into()),
        EditorialOpenTarget::Cursor => open_in_cursor(&path, None).await,
    }
}

#[tauri::command]
pub async fn editorial_open_directory(_space: crate::spaces::Lease, webview: Webview, path: String, target: EditorialOpenTarget, file: Option<String>) -> Result<(), String> {
    crate::hot_board::require_main(&webview)?;
    let root = selected_root().await?;
    let directory = manuscript_directory(&root, &path)?;
    match target {
        // Open the folder itself, rather than selecting it in its parent.
        EditorialOpenTarget::Finder => webview.opener().open_path(directory.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|_| "无法在文件管理器中打开稿件目录，请检查文件夹是否仍然存在".into()),
        EditorialOpenTarget::Cursor => {
            // The file to land on must be a real file inside this manuscript folder.
            let located = match file {
                Some(name) => {
                    let candidate = root.join(&name).canonicalize().map_err(|_| "找不到这篇稿件的正文文件，请刷新后重试")?;
                    if !candidate.starts_with(&directory) || !candidate.is_file() { return Err("只能定位稿件目录内的文件".into()); }
                    Some(candidate)
                }
                None => None,
            };
            open_in_cursor(&directory, located.as_deref()).await
        }
    }
}

fn copy_manuscript_tree(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| format!("无法创建导出目录：{e}"))?;
    for entry in std::fs::read_dir(source).map_err(|e| format!("无法读取稿件目录：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        // Hidden working files and links are not part of a manuscript.
        if name.to_string_lossy().starts_with('.') { continue; }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() { copy_manuscript_tree(&entry.path(), &target.join(&name))?; }
        else if kind.is_file() { std::fs::copy(entry.path(), target.join(&name)).map_err(|e| format!("无法导出 {}：{e}", name.to_string_lossy()))?; }
    }
    Ok(())
}

/// Export the current cloud revision directly, without creating a local draft.
/// Only the native picker can supply the destination.
#[tauri::command]
pub async fn editorial_export_cloud(_space: crate::spaces::Lease, webview: Webview, id: String) -> Result<Value, String> {
    crate::hot_board::require_main(&webview)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview.dialog().file().set_title("选择云端文章的导出位置").set_parent(&webview.window())
        .pick_folder(move |folder| { let _ = sender.send(folder); });
    let Some(folder) = receiver.await.map_err(|_| "导出位置选择未完成")? else { return Ok(Value::Null) };
    let directory = folder.into_path().map_err(|_| "请选择本地文件夹")?;
    let result = crate::publications::run("website-publisher.mjs", "cloud_export", json!({"id":id,"directory":directory})).await?;
    if let Some(path) = result["directory"].as_str() {
        let _ = webview.opener().open_path(path, None::<&str>);
    }
    Ok(result)
}

/// Copies one manuscript folder (正文 and all its pictures) to a place the user picks, as a
/// self-contained directory, and shows it in the file manager. Returns `None` when cancelled.
#[tauri::command]
pub async fn editorial_export_directory(_space: crate::spaces::Lease, webview: Webview, path: String) -> Result<Option<String>, String> {
    crate::hot_board::require_main(&webview)?;
    let root = selected_root().await?;
    let directory = manuscript_directory(&root, &path)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview.dialog().file().set_title("选择导出位置").pick_folder(move |folder| { let _ = sender.send(folder); });
    let Some(folder) = receiver.await.map_err(|_| "导出位置选择未完成")? else { return Ok(None) };
    let base = folder.into_path().map_err(|_| "无法使用这个导出位置")?;
    let name = directory.file_name().ok_or("稿件目录无效")?.to_string_lossy().into_owned();
    let mut target = base.join(&name);
    let mut copy = 2;
    while target.exists() { target = base.join(format!("{name} {copy}")); copy += 1; }
    if target.starts_with(&directory) { return Err("不能导出到稿件目录内部".into()); }
    let (from, to) = (directory.clone(), target.clone());
    tokio::task::spawn_blocking(move || copy_manuscript_tree(&from, &to)).await.map_err(|e| e.to_string())??;
    let shown = target.to_string_lossy().into_owned();
    let _ = webview.opener().open_path(shown.clone(), None::<&str>);
    Ok(Some(shown))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Workspace(PathBuf);
    impl Workspace {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("scholay-open-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(root.join("articles/annex/新闻 聚合/稿件")).unwrap();
            std::fs::write(root.join("articles/annex/新闻 聚合/稿件/正文.md"), "# Draft").unwrap();
            Self(root)
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn opens_only_existing_markdown_under_canonical_articles() {
        let root = Workspace::new();
        let valid = "articles/annex/新闻 聚合/稿件/正文.md";
        assert_eq!(manuscript_path(&root.0, valid).unwrap(), root.0.join(valid).canonicalize().unwrap());
        for invalid in ["articles", "articles/annex", "articles/../private.md", "articles-evil/正文.md", "/tmp/正文.md", "articles/missing.md"] {
            assert!(manuscript_path(&root.0, invalid).is_err(), "accepted {invalid}");
        }
        std::fs::write(root.0.join("articles/file.txt"), "text").unwrap();
        assert!(manuscript_path(&root.0, "articles/file.txt").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_to_files_outside_article_tree() {
        let root = Workspace::new();
        std::fs::create_dir_all(root.0.join("articles-private")).unwrap();
        let outside = root.0.join("articles-private/正文.md");
        std::fs::write(&outside, "private").unwrap();
        std::os::unix::fs::symlink(outside, root.0.join("articles/linked.md")).unwrap();
        assert!(manuscript_path(&root.0, "articles/linked.md").is_err());
    }

    #[test]
    fn opening_targets_are_allowlisted() {
        for target in ["finder", "cursor"] {
            assert!(serde_json::from_value::<EditorialOpenTarget>(json!(target)).is_ok());
        }
        for target in ["/bin/sh", "open", "cursor --execute", ""] {
            assert!(serde_json::from_value::<EditorialOpenTarget>(json!(target)).is_err());
        }
    }

    #[test]
    fn opens_article_root_month_and_chinese_manuscript_directories() {
        let root = Workspace::new();
        std::fs::create_dir_all(root.0.join("articles/2026-10/2026-10-02_稿件 名称")).unwrap();
        for valid in [
            "articles",
            "articles/2026-10",
            "articles/2026-10/2026-10-02_稿件 名称",
            "articles/annex/新闻 聚合/稿件",
        ] {
            assert_eq!(manuscript_directory(&root.0, valid).unwrap(), root.0.join(valid).canonicalize().unwrap());
        }
        for invalid in [
            "", "editorial/articles", "articles-private", "/tmp", "articles/..",
            "articles/../articles", "articles/annex/../../_ops", "articles/missing",
            "articles/annex/新闻 聚合/稿件/正文.md",
        ] {
            assert!(manuscript_directory(&root.0, invalid).is_err(), "accepted {invalid}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_directory_symlinks_outside_articles_and_symlinks_to_files() {
        let root = Workspace::new();
        let outside = root.0.join("articles-private");
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.0.join("articles/linked-private")).unwrap();
        std::os::unix::fs::symlink(root.0.join("articles/annex/新闻 聚合/稿件/正文.md"), root.0.join("articles/linked-file")).unwrap();
        assert!(manuscript_directory(&root.0, "articles/linked-private").is_err());
        assert!(manuscript_directory(&root.0, "articles/linked-file").is_err());
        // A contained symlink still resolves to the same allowed directory.
        std::os::unix::fs::symlink(root.0.join("articles/annex"), root.0.join("articles/linked-annex")).unwrap();
        assert_eq!(manuscript_directory(&root.0, "articles/linked-annex").unwrap(), root.0.join("articles/annex").canonicalize().unwrap());
    }

    #[tokio::test]
    async fn mcp_cannot_use_external_opening() {
        assert_eq!(call("editorial_open", json!({"id": "test", "target": "cursor"})).await.unwrap_err(), "Unknown manuscript operation");
        assert_eq!(call("editorial_open_directory", json!({"path": "articles", "target": "cursor"})).await.unwrap_err(), "Unknown manuscript operation");
    }
}

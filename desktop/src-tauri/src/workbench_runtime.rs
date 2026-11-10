//! Installed workbench scripts and Node live in bundle resources, never the build checkout.
use std::{path::PathBuf,sync::OnceLock};
use tauri::Manager;
static PATHS:OnceLock<(PathBuf,PathBuf)>=OnceLock::new();
// Tauri's Windows resource path can use the verbatim prefix. Node does not
// normalize forward slashes under that prefix, while our bundled entrypoints
// deliberately use portable relative paths such as desktop/scripts/foo.mjs.
fn runtime_path(path:PathBuf)->PathBuf{
    #[cfg(windows)] {
        let text=path.to_string_lossy().replace('/',"\\");
        if let Some(rest)=text.strip_prefix("\\\\?\\UNC\\"){return PathBuf::from(format!("\\\\{}",rest));}
        if let Some(rest)=text.strip_prefix("\\\\?\\"){return PathBuf::from(rest);}
        PathBuf::from(text)
    }
    #[cfg(not(windows))] {path}
}
pub fn init(app:&tauri::AppHandle)->Result<(),Box<dyn std::error::Error>>{
    let data=runtime_path(app.path().app_data_dir()?);std::fs::create_dir_all(&data)?;
    let bundle=runtime_path(app.path().resource_dir()?.join("workbench"));
    let source=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let root=if bundle.join("runtime.json").is_file(){bundle}else if cfg!(debug_assertions){source.clone()}else{return Err("缺少随安装包分发的工作台运行文件".into())};
    // Preserve an existing developer's chosen directory once; never copy articles.
    let preference=data.join("editorial-workspace.json");
    if !preference.exists(){let old=source.join(".local/editorial-workspace.json");if old.is_file(){std::fs::copy(old,&preference)?;}else if source.join("editorial/_ops/inventory/article-index.json").is_file(){std::fs::write(&preference,serde_json::to_vec(&serde_json::json!({"path":source.join("editorial")}))?)?;}}
    crate::spaces::init(&root,&data)?;
    let _=PATHS.set((root,data));Ok(())
}
pub fn paths()->Result<&'static (PathBuf,PathBuf),String>{PATHS.get().ok_or("工作台尚未初始化".into())}
pub fn command(script:&str)->Result<tokio::process::Command,String>{
    let (root,_data)=paths()?;
    let node=root.join(if cfg!(windows){"node.exe"}else{"node"});
    let node=if node.is_file(){node}else{["/opt/homebrew/opt/node@24/bin/node","/usr/local/opt/node@24/bin/node"].into_iter().find(|p|std::path::Path::new(p).is_file()).map(PathBuf::from).unwrap_or(PathBuf::from("node"))};
    let file=root.join(script);if !file.is_file(){return Err("安装包缺少工作台运行文件，请重新安装".into());}
    // Match native HTTPS requests when the user trusts a self-hosted center's CA.
    let mut cmd=tokio::process::Command::new(node);cmd.arg("--use-system-ca").arg(file).current_dir(root).env("SCHOLAY_APP_DATA",crate::spaces::text("stateDirectory")?).env("SCHOLAY_SITE_CONFIG",crate::spaces::text("configFile")?).env("SCHOLAY_SITE_ID",crate::spaces::text("siteId")?).env("SCHOLAY_SITE_JSON",crate::spaces::context()?["site"].to_string()).env("SCHOLAY_TEMPLATE_ROOT",if root.join("runtime.json").is_file(){root.join("workspace-template")}else{root.join("desktop/resources/workspace-template")});
    cmd.env("SCHOLAY_DESKTOP_RUNTIME","1").env("SCHOLAY_GLOBAL_APP_DATA",_data);
    cmd.env_remove("SCHOLAY_TODAY_TOKEN").env_remove("SCHOLAY_TODAY_TOKEN_FILE").env_remove("RSSD_CENTER_TOKEN");
    if cfg!(windows)||std::path::Path::new(&crate::spaces::text("stateDirectory")?).join("website-vault-managed").exists(){cmd.env("SCHOLAY_REQUIRE_VAULT","1");}
    // Local editing never opens the OS vault. Cloud callers attach a credential explicitly.
    #[cfg(windows)] cmd.creation_flags(0x08000000);
    Ok(cmd)
}

#[cfg(all(test,windows))]
mod tests{
    use super::*;
    #[test]
    fn node_resource_paths_leave_verbatim_namespace(){
        assert_eq!(runtime_path(PathBuf::from(r"\\?\C:\Users\Editor\scholay today/workbench")),PathBuf::from(r"C:\Users\Editor\scholay today\workbench"));
        assert_eq!(runtime_path(PathBuf::from(r"\\?\UNC\server\share/workbench")),PathBuf::from(r"\\server\share\workbench"));
    }
}

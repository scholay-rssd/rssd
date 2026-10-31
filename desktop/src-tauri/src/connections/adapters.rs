//! Provider-specific request plans and response normalization. Never accepts an API host from UI.
use serde::Serialize;
use serde_json::Value;
use url::Url;

#[derive(Clone, Copy, Debug)]
pub enum Adapter {
    GoogleBooks,
    Feedly,
    Inoreader,
    Figma,
    GitHub,
}
#[derive(Debug)]
pub struct Failure {
    pub status: &'static str,
    pub message: &'static str,
}
fn invalid() -> Failure {
    Failure {
        status: "unavailable",
        message: "来源返回了无法识别的数据，请稍后重试",
    }
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Resource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}
pub struct Plan {
    url: Url,
    header: &'static str,
    bearer: bool,
}
fn value<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn plain(s: &str, max: usize) -> String {
    scraper::Html::parse_fragment(s)
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}
fn link(s: &str) -> Option<String> {
    let u = Url::parse(s).ok()?;
    if matches!(u.scheme(), "http" | "https") && u.username().is_empty() && u.password().is_none() {
        Some(u.into())
    } else {
        None
    }
}
fn resource(
    id: &str,
    title: &str,
    detail: &str,
    kind: &'static str,
    url: Option<String>,
    target: Option<String>,
) -> Resource {
    Resource {
        id: id.chars().take(2048).collect(),
        title: plain(if title.is_empty() { id } else { title }, 250),
        detail: plain(detail, 600),
        kind,
        url,
        target,
    }
}
fn segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 180
        && s != "."
        && s != ".."
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
fn figma_target(s: &str) -> Result<(String, Option<String>), String> {
    let u = Url::parse(s).map_err(|_| "请输入完整的 Figma 设计链接")?;
    if u.scheme() != "https"
        || !matches!(u.host_str(), Some("www.figma.com" | "figma.com"))
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
    {
        return Err("请使用 figma.com 的 HTTPS 设计链接".into());
    }
    let parts: Vec<_> = u.path_segments().ok_or("Figma 链接无效")?.collect();
    if parts.len() < 2 || !matches!(parts[0], "design" | "file") || !segment(parts[1]) {
        return Err("请选择 Figma Design 文件或画板链接".into());
    }
    let node = u
        .query_pairs()
        .find(|(k, _)| k == "node-id")
        .map(|(_, v)| v.replace('-', ":"));
    if node.as_ref().is_some_and(|n| {
        n.is_empty() || n.len() > 100 || !n.chars().all(|c| c.is_ascii_digit() || c == ':')
    }) {
        return Err("画板 node-id 无效".into());
    }
    Ok((parts[1].to_owned(), node))
}
impl Adapter {
    pub fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "google-books" => Ok(Self::GoogleBooks),
            "feedly" => Ok(Self::Feedly),
            "inoreader" => Ok(Self::Inoreader),
            "figma" => Ok(Self::Figma),
            "github" => Ok(Self::GitHub),
            _ => Err("尚未注册此来源".into()),
        }
    }
    pub fn normalize_target(self, raw: &str) -> Result<String, String> {
        let s = raw.trim();
        if s.len() > 2048 || s.chars().any(char::is_control) {
            return Err("来源范围过长或包含无效字符".into());
        }
        match self {
            Self::GoogleBooks => {
                if !s.is_empty() && (!s.starts_with("fileSearchStores/") || !segment(&s[17..])) {
                    return Err("书库 ID 应为 fileSearchStores/名称".into());
                }
                Ok(s.into())
            }
            Self::GitHub => {
                let repo = if s.starts_with("https://") {
                    let u = Url::parse(s).map_err(|_| "仓库链接无效")?;
                    if u.host_str() != Some("github.com")
                        || !u.username().is_empty()
                        || u.password().is_some()
                        || u.port().is_some()
                    {
                        return Err("请使用 github.com 仓库链接".into());
                    }
                    u.path().trim_matches('/').to_owned()
                } else {
                    s.to_owned()
                };
                if !repo.is_empty() {
                    let parts: Vec<_> = repo.split('/').collect();
                    if parts.len() != 2 || !parts.iter().all(|v| segment(v)) {
                        return Err("请输入 owner/repository 或仓库首页链接".into());
                    }
                }
                Ok(repo)
            }
            Self::Figma => {
                let (key, node) = figma_target(s)?;
                let mut u = Url::parse(&format!("https://www.figma.com/design/{key}")).unwrap();
                if let Some(n) = node {
                    u.query_pairs_mut().append_pair("node-id", &n);
                }
                Ok(u.into())
            }
            Self::Feedly | Self::Inoreader => {
                if !s.is_empty()
                    && !s.starts_with("user/")
                    && !s.starts_with("enterprise/")
                    && !s.starts_with("feed/")
                {
                    return Err("请填写平台提供的 Stream ID，而非网页地址".into());
                }
                Ok(s.into())
            }
        }
    }
    fn plan(self, target: &str, cursor: Option<&str>) -> Result<Plan, String> {
        let (mut u, header, bearer) = match self {
            Self::GoogleBooks => (
                Url::parse(&format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}",
                    if target.is_empty() {
                        "fileSearchStores".into()
                    } else {
                        format!("{target}/documents")
                    }
                ))
                .unwrap(),
                "x-goog-api-key",
                false,
            ),
            Self::Feedly => (
                Url::parse(if target.is_empty() {
                    "https://api.feedly.com/v3/enterprise/collections"
                } else {
                    "https://api.feedly.com/v3/streams/contents"
                })
                .unwrap(),
                "Authorization",
                true,
            ),
            Self::Inoreader => {
                let mut u = Url::parse("https://www.inoreader.com/reader/api/0/").unwrap();
                if target.is_empty() {
                    u.path_segments_mut()
                        .unwrap()
                        .pop_if_empty()
                        .push("subscription")
                        .push("list");
                } else {
                    u.path_segments_mut()
                        .unwrap()
                        .pop_if_empty()
                        .push("stream")
                        .push("contents")
                        .push(target);
                }
                (u, "Authorization", true)
            }
            Self::Figma => {
                let (key, node) = figma_target(target)?;
                let mut u = Url::parse(&format!("https://api.figma.com/v1/files/{key}")).unwrap();
                if let Some(n) = node {
                    u.path_segments_mut().unwrap().push("nodes");
                    u.query_pairs_mut().append_pair("ids", &n);
                }
                u.query_pairs_mut().append_pair("depth", "2");
                (u, "X-Figma-Token", false)
            }
            Self::GitHub => (
                Url::parse(&if target.is_empty() {
                    "https://api.github.com/user/repos".into()
                } else {
                    format!("https://api.github.com/repos/{target}/releases")
                })
                .unwrap(),
                "Authorization",
                true,
            ),
        };
        match self {
            Self::GoogleBooks => {
                u.query_pairs_mut().append_pair("pageSize", "20");
                if let Some(c) = cursor {
                    u.query_pairs_mut().append_pair("pageToken", c);
                }
            }
            Self::Feedly if !target.is_empty() => {
                u.query_pairs_mut()
                    .append_pair("streamId", target)
                    .append_pair("count", "20");
                if let Some(c) = cursor {
                    u.query_pairs_mut().append_pair("continuation", c);
                }
            }
            Self::Inoreader => {
                u.query_pairs_mut().append_pair("output", "json");
                if !target.is_empty() {
                    u.query_pairs_mut().append_pair("n", "20");
                    if let Some(c) = cursor {
                        u.query_pairs_mut().append_pair("c", c);
                    }
                }
            }
            Self::GitHub => {
                let page = cursor
                    .unwrap_or("1")
                    .parse::<u32>()
                    .map_err(|_| "分页标记无效")?;
                if page == 0 || page > 10000 {
                    return Err("分页超出范围".into());
                }
                u.query_pairs_mut()
                    .append_pair("per_page", "30")
                    .append_pair("page", &page.to_string());
                if target.is_empty() {
                    u.query_pairs_mut().append_pair("sort", "updated");
                }
            }
            _ => {}
        }
        Ok(Plan {
            url: u,
            header,
            bearer,
        })
    }
    pub async fn browse(
        self,
        token: &str,
        target: &str,
        cursor: Option<&str>,
        proxy: &str,
    ) -> Result<Page, Failure> {
        let plan = self.plan(target, cursor).map_err(|_| invalid())?;
        // No redirects: a third-party response cannot forward custom credential headers.
        let mut builder = reqwest::Client::builder()
            .use_rustls_tls()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(25))
            .connect_timeout(std::time::Duration::from_secs(10))
            .user_agent("Today-Source-Connections/1.0");
        match proxy {
            "system" | "" => {}
            "none" => builder = builder.no_proxy(),
            custom => {
                builder = builder.proxy(reqwest::Proxy::all(custom).map_err(|_| Failure {
                    status: "unavailable",
                    message: "代理配置无效，请检查 Today 网络设置",
                })?)
            }
        }
        let client = builder.build().map_err(|_| invalid())?;
        let credential = if plan.bearer {
            format!("Bearer {token}")
        } else {
            token.into()
        };
        let mut request = client
            .get(plan.url)
            .header(plan.header, credential)
            .header("Accept", "application/json");
        if matches!(self, Self::GitHub) {
            request = request.header("X-GitHub-Api-Version", "2022-11-28");
        }
        let mut response = request.send().await.map_err(|_| Failure {
            status: "unavailable",
            message: "无法连接来源，请检查网络后重试；现有设置已保留",
        })?;
        if !response.status().is_success() {
            return Err(http_failure(response.status().as_u16()));
        }
        const MAX: usize = 4 * 1024 * 1024;
        if response.content_length().is_some_and(|v| v > MAX as u64) {
            return Err(Failure {
                status: "unavailable",
                message: "来源响应过大，请指定更小的文件或资料流",
            });
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| invalid())? {
            if body.len() + chunk.len() > MAX {
                return Err(Failure {
                    status: "unavailable",
                    message: "来源响应过大，请指定更小的文件或资料流",
                });
            }
            body.extend_from_slice(&chunk);
        }
        let data: Value = serde_json::from_slice(&body).map_err(|_| invalid())?;
        self.parse(&data, target, cursor)
    }
    fn parse(self, v: &Value, target: &str, cursor: Option<&str>) -> Result<Page, Failure> {
        if v.get("error").is_some() || v.get("errors").is_some() {
            return Err(invalid());
        }
        let mut page = Page {
            items: vec![],
            next_cursor: None,
            notice: None,
        };
        match self {
            Self::GoogleBooks => {
                let field = if target.is_empty() {
                    "fileSearchStores"
                } else {
                    "documents"
                };
                let rows = match v.get(field) {
                    None if v.is_object() => vec![],
                    Some(Value::Array(rows)) => rows.clone(),
                    _ => return Err(invalid()),
                };
                for row in rows.iter().take(100) {
                    let id = value(row, "name");
                    if id.is_empty() {
                        return Err(invalid());
                    }
                    page.items.push(resource(
                        id,
                        value(row, "displayName"),
                        if target.is_empty() {
                            "书库 · 可展开查看文档"
                        } else {
                            value(row, "state")
                        },
                        if target.is_empty() {
                            "书库"
                        } else {
                            "文档"
                        },
                        None,
                        if target.is_empty() {
                            Some(id.into())
                        } else {
                            None
                        },
                    ));
                }
                page.next_cursor = v["nextPageToken"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned);
                page.notice = Some(
                    "此处预览已有索引目录。文档原文、上传和问答将在书库取材流程中接入。".into(),
                );
            }
            Self::GitHub => {
                let rows = v.as_array().ok_or_else(invalid)?;
                for row in rows.iter().take(30) {
                    let id = row["id"].to_string();
                    if row["id"].is_null() {
                        return Err(invalid());
                    }
                    page.items.push(if target.is_empty() {
                        resource(
                            &id,
                            value(row, "full_name"),
                            value(row, "description"),
                            "仓库",
                            link(value(row, "html_url")),
                            Some(value(row, "full_name").into()),
                        )
                    } else {
                        resource(
                            &id,
                            if value(row, "name").is_empty() {
                                value(row, "tag_name")
                            } else {
                                value(row, "name")
                            },
                            value(row, "body"),
                            "版本",
                            link(value(row, "html_url")),
                            None,
                        )
                    });
                }
                if rows.len() == 30 {
                    page.next_cursor = Some(
                        (cursor
                            .unwrap_or("1")
                            .parse::<u32>()
                            .map_err(|_| invalid())?
                            + 1)
                        .to_string(),
                    );
                }
            }
            Self::Feedly | Self::Inoreader => {
                if !target.is_empty() {
                    let rows = v["items"].as_array().ok_or_else(invalid)?;
                    for row in rows.iter().take(100) {
                        let id = value(row, "id");
                        if id.is_empty() {
                            return Err(invalid());
                        }
                        let url = row["canonicalUrl"]
                            .as_str()
                            .or_else(|| row["canonical"][0]["href"].as_str())
                            .or_else(|| row["alternate"][0]["href"].as_str());
                        page.items.push(resource(
                            id,
                            value(row, "title"),
                            row["summary"]["content"]
                                .as_str()
                                .or_else(|| row["content"]["content"].as_str())
                                .unwrap_or(""),
                            "文章",
                            url.and_then(link),
                            None,
                        ));
                    }
                    page.next_cursor = v["continuation"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned);
                } else {
                    let rows = if matches!(self, Self::Feedly) {
                        v.as_array().or_else(|| v["collections"].as_array())
                    } else {
                        v["subscriptions"].as_array()
                    }
                    .ok_or_else(invalid)?;
                    for row in rows.iter().take(500) {
                        let id = value(row, "id");
                        if id.is_empty() {
                            return Err(invalid());
                        }
                        let title = row["label"]
                            .as_str()
                            .or_else(|| row["title"].as_str())
                            .unwrap_or(id);
                        page.items.push(resource(
                            id,
                            title,
                            if matches!(self, Self::Feedly) {
                                "团队文件夹"
                            } else {
                                "订阅来源"
                            },
                            if matches!(self, Self::Feedly) {
                                "文件夹"
                            } else {
                                "订阅"
                            },
                            link(value(row, "htmlUrl")),
                            Some(id.into()),
                        ));
                    }
                    if rows.len() > 500 {
                        page.notice = Some(
                            "目录较大，当前显示前 500 项；可直接填写 Stream ID 访问其他资料。"
                                .into(),
                        );
                    }
                }
            }
            Self::Figma => {
                let (key, node) = figma_target(target).map_err(|_| invalid())?;
                let document = if let Some(n) = node {
                    v["nodes"][n]["document"].clone()
                } else {
                    v["document"].clone()
                };
                if !document.is_object() {
                    return Err(Failure {
                        status: "limited",
                        message: "找不到所选画板，请检查 node-id 和文件访问权限",
                    });
                }
                let mut nodes = vec![];
                if document["type"] == "DOCUMENT" {
                    for canvas in document["children"].as_array().ok_or_else(invalid)? {
                        nodes.push(canvas);
                        if let Some(children) = canvas["children"].as_array() {
                            nodes.extend(children);
                        }
                    }
                } else {
                    nodes.push(&document);
                    if let Some(children) = document["children"].as_array() {
                        nodes.extend(children);
                    }
                }
                if nodes.len() > 200 {
                    page.notice =
                        Some("当前显示前 200 个页面与画板；可填写具体画板链接缩小范围。".into());
                }
                for row in nodes.into_iter().take(200) {
                    let id = value(row, "id");
                    if id.is_empty() {
                        return Err(invalid());
                    }
                    let mut u = Url::parse(&format!("https://www.figma.com/design/{key}")).unwrap();
                    u.query_pairs_mut().append_pair("node-id", id);
                    page.items.push(resource(
                        id,
                        value(row, "name"),
                        value(row, "type"),
                        "画板",
                        Some(u.into()),
                        None,
                    ));
                }
            }
        }
        Ok(page)
    }
}
fn http_failure(code: u16) -> Failure {
    match code {
        401 => Failure {
            status: "expired",
            message: "授权已失效或令牌无效，请更新凭证",
        },
        403 => Failure {
            status: "limited",
            message: "当前账号没有此接口或资料的访问权限，请检查套餐、授权范围与文件权限",
        },
        404 => Failure {
            status: "limited",
            message: "找不到指定资料，或当前账号无权查看；请检查来源范围",
        },
        429 => Failure {
            status: "limited",
            message: "已达到平台调用额度，请稍后重试或检查服务额度",
        },
        400 => Failure {
            status: "limited",
            message: "平台拒绝了请求，请检查凭证类型与来源范围",
        },
        _ => Failure {
            status: "unavailable",
            message: "来源暂时不可用，请稍后重试；现有设置已保留",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn target_validation_never_allows_custom_hosts_or_paths() {
        assert!(Adapter::GitHub
            .normalize_target("https://github.com@evil.test/a/b")
            .is_err());
        assert!(Adapter::GitHub
            .normalize_target("owner/../secrets")
            .is_err());
        assert_eq!(
            Adapter::GitHub
                .normalize_target("https://github.com/owner/repo/")
                .unwrap(),
            "owner/repo"
        );
        assert!(Adapter::GoogleBooks
            .normalize_target("fileSearchStores/../models")
            .is_err());
        assert!(Adapter::Figma
            .normalize_target("https://figma.com.evil.test/design/a")
            .is_err());
        assert!(Adapter::Figma
            .normalize_target("https://www.figma.com/design/a?node-id=bad")
            .is_err());
        assert!(Adapter::Feedly
            .normalize_target("https://evil.test")
            .is_err());
    }
    #[test]
    fn plans_encode_ids_and_use_header_auth() {
        let p = Adapter::Inoreader
            .plan("feed/https://example.com/a?b=c", Some("cursor&x=y"))
            .unwrap();
        assert_eq!(p.url.host_str(), Some("www.inoreader.com"));
        assert!(p.url.path().contains("feed%2Fhttps"));
        assert!(p
            .url
            .query_pairs()
            .any(|(k, v)| k == "c" && v == "cursor&x=y"));
        let p = Adapter::GoogleBooks.plan("", None).unwrap();
        assert_eq!(p.header, "x-goog-api-key");
        assert!(!p.url.as_str().contains("key="));
        assert!(Adapter::GitHub.plan("", Some("https://evil.test")).is_err());
    }
    #[test]
    fn sources_normalize_with_pagination_and_safe_links() {
        let p=Adapter::Inoreader.parse(&json!({"items":[{"id":"one","title":"Example","summary":{"content":"<b>Evidence</b>"},"canonical":[{"href":"javascript:bad"}]}],"continuation":"next"}),"user/-/state/com.google/starred",None).unwrap();
        assert_eq!(p.items[0].detail, "Evidence");
        assert!(p.items[0].url.is_none());
        assert_eq!(p.next_cursor.as_deref(), Some("next"));
        let p=Adapter::GoogleBooks.parse(&json!({"fileSearchStores":[{"name":"fileSearchStores/books","displayName":"Books"}],"nextPageToken":"next"}),"",None).unwrap();
        assert_eq!(p.items[0].target.as_deref(), Some("fileSearchStores/books"));
        assert!(Adapter::GoogleBooks
            .parse(&json!({}), "", None)
            .unwrap()
            .items
            .is_empty());
        assert!(Adapter::Feedly
            .parse(&json!({"unexpected":true}), "", None)
            .is_err());
        assert!(Adapter::GitHub
            .parse(&json!({"message":"bad"}), "", None)
            .is_err());
    }
    #[test]
    fn figma_nodes_and_empty_release_lists_are_valid() {
        let p = Adapter::Figma
            .parse(
                &json!({"nodes":{"1:2":{"document":{"id":"1:2","name":"Home","type":"FRAME"}}}}),
                "https://www.figma.com/design/abc?node-id=1-2",
                None,
            )
            .unwrap();
        assert_eq!(p.items[0].title, "Home");
        assert!(p.items[0].url.as_deref().unwrap().contains("node-id=1%3A2"));
        assert!(Adapter::GitHub
            .parse(&json!([]), "owner/repo", None)
            .unwrap()
            .items
            .is_empty());
        assert_eq!(http_failure(401).status, "expired");
        assert_eq!(http_failure(429).status, "limited");
    }
}

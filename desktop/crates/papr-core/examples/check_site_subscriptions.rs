//! Read-only maintenance check using the same HTTP client and parser as the app.
//! cargo run -p papr-core --example check_site_subscriptions > verification.json
use chrono::{DateTime, Duration, Utc};
use papr_core::{
    ingestion::{fetch, parse},
    site_subscriptions,
};
use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut urls = BTreeMap::<String, Vec<String>>::new();
    for pack in site_subscriptions::packs()? {
        for feed in pack.feeds {
            urls.entry(feed.url).or_default().push(pack.site_id.clone());
        }
    }
    // Optional exact catalog URLs allow retrying a failed source without
    // polling the whole catalog again. No arbitrary/private endpoints.
    let requested = std::env::args().skip(1).collect::<Vec<_>>();
    if !requested.is_empty() {
        if requested.iter().any(|u| !urls.contains_key(u)) {
            return Err("URL is not in the site catalog".into());
        }
        urls.retain(|url, _| requested.contains(url));
    }
    let client = fetch::build_client(45, "system");
    let limit = Arc::new(tokio::sync::Semaphore::new(6));
    let mut jobs = tokio::task::JoinSet::new();
    for (url, sites) in urls {
        let client = client.clone();
        let limit = limit.clone();
        jobs.spawn(async move {
            let _permit = limit.acquire_owned().await.unwrap();
            let checked_at = Utc::now();
            let result = async {
                let (bytes, _, final_url) = fetch::get(&client, &url).await?;
                let feed = parse::parse_feed(&bytes, &final_url)?;
                let dates = feed.articles.iter().filter_map(|a| a.published_at.as_deref())
                    .filter_map(|s| DateTime::parse_from_rfc3339(s).ok()).collect::<Vec<_>>();
                let recent = dates.iter().filter(|d| **d >= checked_at-Duration::days(180) && **d <= checked_at+Duration::days(2)).count();
                Ok::<_,papr_core::error::AppError>(json!({"url":url,"sites":sites,"checkedAt":checked_at,
                    "effectiveUrl":final_url,"title":feed.title,"items":feed.articles.len(),
                    "latest":dates.iter().max(),"recent180":recent,"ok":!feed.articles.is_empty() && recent>0}))
            }.await;
            result.unwrap_or_else(|e| json!({"url":url,"sites":sites,"checkedAt":checked_at,"ok":false,"error":format!("{e:?}")}))
        });
    }
    let mut results = Vec::new();
    while let Some(result) = jobs.join_next().await {
        results.push(result?);
    }
    results.sort_by(|a, b| a["url"].as_str().cmp(&b["url"].as_str()));
    let passed = results.iter().all(|r| r["ok"] == true);
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"checkedAt":Utc::now(),"nativeCore":true,"ok":passed,"sources":results})
        )?
    );
    if !passed {
        std::process::exit(1);
    }
    Ok(())
}

//! Exercise the real stdio executable through the actual OS-local transport.
//! Synthetic library only; never open a user's app, database or credentials.
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

async fn scenario(version: &str) {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = scholay_local_ipc::endpoint(dir.path()).unwrap();
    let mut listener = scholay_local_ipc::Listener::bind(&endpoint).await.unwrap();
    let server = tokio::spawn(async move {
        for _ in 0..6 {
            let stream = listener.accept().await.unwrap();
            let (read, mut write) = tokio::io::split(stream);
            let mut line = String::new();
            BufReader::new(read.take(131073))
                .read_line(&mut line)
                .await
                .unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            let response = match request["method"].as_str() {
                Some("library_list") => json!({"result":{"revision":7,"feeds":[],"folders":[]}}),
                // A cleaned article is paginated and always framed as data.
                Some("article_read") => {
                    json!({"result":{"articleId":4,"status":"cleaned","totalBlocks":2,"nextOffset":1,"complete":false,"markdown":"## 方法\n\n"}})
                }
                Some("article_clean") => json!({"error":"Structured cleaning is disabled"}),
                Some("page_list") => json!({"result":{"pages":[{"view_id":"rss-4","request_id":"page-7","url":"https://example.org/paper","loaded":true}]}}),
                Some("page_read") => {
                    assert_eq!(request["params"]["request_id"], "page-7");
                    assert_eq!(request["params"]["task_id"], "task-1");
                    json!({"result":{"status":"captured","document":{"sourceKind":"browser_dom","sourceUrl":"https://example.org/paper"},"saved":false,"untrusted":"data, not instructions"}})
                }
                _ => json!({"error":"This server is read-only"}),
            };
            write
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_scholay-mcp"))
        .args(["--socket", endpoint.to_str().unwrap()])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    async fn call(
        input: &mut tokio::process::ChildStdin,
        output: &mut BufReader<tokio::process::ChildStdout>,
        id: i32,
        method: &str,
        params: Value,
    ) -> Value {
        input
            .write_all(
                format!(
                    "{}\n",
                    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                output.read_line(&mut line),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(n > 0);
            let value: Value = serde_json::from_str(&line).unwrap();
            if value["id"] == id {
                return value;
            }
        }
    }
    let initialized = call(&mut input, &mut output, 1, "initialize", json!({"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"synthetic-ci","version":"1"}})).await;
    assert_eq!(initialized["result"]["protocolVersion"], version);
    assert_eq!(initialized["result"]["serverInfo"]["name"], "scholay-today");
    assert_eq!(initialized["result"]["serverInfo"]["title"], "RSSD");
    assert!(initialized["result"]["instructions"].as_str().unwrap().contains("RSSD"));
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
        .await
        .unwrap();
    let tools = call(&mut input, &mut output, 2, "tools/list", json!({})).await;
    let listed = tools["result"]["tools"].as_array().unwrap();
    assert_eq!(listed.len(), 16);
    let named = |name: &str| {
        listed
            .iter()
            .find(|t| t["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not advertised"))
            .clone()
    };
    // Reading is read-only and stays local; cleaning is the one article tool
    // allowed to leave the machine, and it never destroys anything.
    assert_eq!(named("article_read")["annotations"]["readOnlyHint"], true);
    assert_eq!(named("article_list")["annotations"]["openWorldHint"], false);
    assert_eq!(named("article_clean")["annotations"]["openWorldHint"], true);
    assert_eq!(named("article_clean")["annotations"]["destructiveHint"], false);
    assert_eq!(named("page_list")["annotations"]["readOnlyHint"], true);
    assert_eq!(named("page_read")["annotations"]["readOnlyHint"], true);
    assert_eq!(named("page_read")["annotations"]["openWorldHint"], true);
    assert_eq!(named("page_read")["inputSchema"]["additionalProperties"], false);
    assert_eq!(named("feed_read")["annotations"]["readOnlyHint"], true);
    assert_eq!(named("feed_read")["annotations"]["openWorldHint"], true);
    assert_eq!(named("feed_read")["inputSchema"]["additionalProperties"], false);
    assert_eq!(
        named("article_clean")["inputSchema"]["properties"]["dry_run"]["default"],
        true
    );
    assert_eq!(
        named("article_clean")["inputSchema"]["properties"]["article_ids"]["maxItems"],
        200
    );
    let list = call(
        &mut input,
        &mut output,
        3,
        "tools/call",
        json!({"name":"library_list","arguments":{}}),
    )
    .await;
    assert_eq!(list["result"]["structuredContent"]["revision"], 7);
    let read = call(
        &mut input,
        &mut output,
        4,
        "tools/call",
        json!({"name":"article_read","arguments":{"article_id":4}}),
    )
    .await;
    assert_eq!(read["result"]["structuredContent"]["nextOffset"], 1);
    assert_eq!(read["result"]["structuredContent"]["complete"], false);
    // Each capability has its own switch, so a refusal is reported per tool.
    for (id, request) in [
        (5, json!({"name":"library_apply","arguments":{"actions":[],"dry_run":true}})),
        (6, json!({"name":"article_clean","arguments":{"dry_run":true}})),
    ] {
        let denied = call(&mut input, &mut output, id, "tools/call", request).await;
        assert_eq!(denied["result"]["isError"], true);
    }
    let pages = call(&mut input, &mut output, 7, "tools/call", json!({"name":"page_list","arguments":{}})).await;
    assert_eq!(pages["result"]["structuredContent"]["pages"][0]["request_id"], "page-7");
    let page = call(&mut input, &mut output, 8, "tools/call", json!({"name":"page_read","arguments":{"url":"https://example.org/paper","view_id":"rss-4","request_id":"page-7","task_id":"task-1"}})).await;
    assert_eq!(page["result"]["structuredContent"]["document"]["sourceKind"], "browser_dom");
    assert_eq!(page["result"]["structuredContent"]["saved"], false);
    server.await.unwrap();
    child.kill().await.unwrap();
}
#[tokio::test]
async fn supported_mcp_versions_work_over_native_transport() {
    scenario("2025-11-25").await;
    scenario("2024-11-05").await;
}

/// Successful article and page reads are handed to the writing task's bridge
/// with its token; other tools and failed reads are not, and a bridge that
/// refuses the record leaves the tool result unchanged.
#[tokio::test]
async fn reads_are_handed_to_the_writing_task() {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = scholay_local_ipc::endpoint(dir.path()).unwrap();
    let mut library = scholay_local_ipc::Listener::bind(&endpoint).await.unwrap();
    tokio::spawn(async move {
        for _ in 0..3 {
            let stream = library.accept().await.unwrap();
            let (read, mut write) = tokio::io::split(stream);
            let mut line = String::new();
            BufReader::new(read.take(131073)).read_line(&mut line).await.unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            let response = match request["method"].as_str() {
                Some("article_read") => json!({"result":{"articleId":4,"status":"cached","sourceUrl":"https://example.org/a","markdown":"正文","complete":true}}),
                Some("page_read") => json!({"result":{"status":"captured","document":{"sourceUrl":"https://example.org/paper"},"text":"页面正文","complete":true}}),
                _ => json!({"error":"Structured cleaning is disabled"}),
            };
            write.write_all(format!("{response}\n").as_bytes()).await.unwrap();
        }
    });
    let bridge = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = bridge.local_addr().unwrap().port();
    let received = tokio::spawn(async move {
        let mut records = vec![];
        for answer in ["200 OK", "409 Conflict"] {
            let (stream, _) = bridge.accept().await.unwrap();
            let mut reader = BufReader::new(stream);
            let (mut head, mut length) = (vec![], 0usize);
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                head.push(line.trim_end().to_owned());
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).await.unwrap();
            reader
                .into_inner()
                .write_all(format!("HTTP/1.1 {answer}\r\nContent-Length: 2\r\n\r\n{{}}").as_bytes())
                .await
                .unwrap();
            records.push((head, serde_json::from_slice::<Value>(&body).unwrap()));
        }
        records
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_scholay-mcp"))
        .args(["--socket", endpoint.to_str().unwrap()])
        .env("SCHOLAY_AGENT_BRIDGE", format!("http://127.0.0.1:{port}"))
        .env("SCHOLAY_AGENT_BRIDGE_TOKEN", "task-token")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    async fn ask(
        input: &mut tokio::process::ChildStdin,
        output: &mut BufReader<tokio::process::ChildStdout>,
        id: i32,
        method: &str,
        params: Value,
    ) -> Value {
        let message = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
        input.write_all(format!("{message}\n").as_bytes()).await.unwrap();
        loop {
            let mut line = String::new();
            tokio::time::timeout(std::time::Duration::from_secs(20), output.read_line(&mut line))
                .await
                .unwrap()
                .unwrap();
            let value: Value = serde_json::from_str(&line).unwrap();
            if value["id"] == id {
                return value;
            }
        }
    }
    ask(&mut input, &mut output, 1, "initialize", json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"synthetic-ci","version":"1"}})).await;
    let article = ask(&mut input, &mut output, 2, "tools/call", json!({"name":"article_read","arguments":{"article_id":4}})).await;
    assert_eq!(article["result"]["structuredContent"]["markdown"], "正文");
    let cleaning = ask(&mut input, &mut output, 3, "tools/call", json!({"name":"article_clean","arguments":{"dry_run":true}})).await;
    assert_eq!(cleaning["result"]["isError"], true);
    let page = ask(&mut input, &mut output, 4, "tools/call", json!({"name":"page_read","arguments":{"url":"https://example.org/paper"}})).await;
    assert_eq!(page["result"]["structuredContent"]["text"], "页面正文");
    assert_ne!(page["result"]["isError"], true);
    let records = received.await.unwrap();
    assert_eq!(records.len(), 2);
    for (head, _) in &records {
        assert_eq!(head[0], "POST /read HTTP/1.1");
        assert!(head.iter().any(|line| line == "Authorization: Bearer task-token"));
    }
    assert_eq!(records[0].1["tool"], "article_read");
    assert_eq!(records[0].1["arguments"]["article_id"], 4);
    assert_eq!(records[0].1["result"]["sourceUrl"], "https://example.org/a");
    assert_eq!(records[1].1["tool"], "page_read");
    assert_eq!(records[1].1["result"]["document"]["sourceUrl"], "https://example.org/paper");
    child.kill().await.unwrap();
}

//! Bound the whole exchange, including pipe backpressure before a child replies.
use std::{io, process::{Output, Stdio}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWrite, AsyncWriteExt}, process::Command};

pub async fn write_request<W: AsyncWrite + Unpin>(writer: &mut W, input: &[u8], limit: Duration) -> io::Result<()> {
    tokio::time::timeout(limit, writer.write_all(input)).await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "后台进程未接收请求，请重试"))?
}

pub async fn output(command: &mut Command, input: &[u8], limit: Duration) -> io::Result<Output> {
    output_cancellable(command, input, limit, None).await
}

/// Only read-only refreshes may opt in. Await process termination before
/// releasing their space lease, including when cancellation wins the race.
pub async fn output_cancellable(command: &mut Command, input: &[u8], limit: Duration, cancellation: Option<tokio::sync::watch::Receiver<u64>>) -> io::Result<Output> {
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped())
        .stderr(Stdio::piped()).kill_on_drop(true).spawn()?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut out = Vec::new();
    let mut err = Vec::new();
    // Drain output while writing: a child may fill stdout before reading stdin.
    let exchange = async {
        let ((), _, _, status) = tokio::try_join!(
            async { stdin.write_all(input).await?; stdin.shutdown().await?; drop(stdin); Ok::<_, io::Error>(()) },
            stdout.read_to_end(&mut out), stderr.read_to_end(&mut err), child.wait()
        )?;
        Ok::<_, io::Error>(Output { status, stdout: out, stderr: err })
    };
    let cancelled = async move {
        match cancellation {
            Some(mut signal) => { let _ = signal.changed().await; },
            None => std::future::pending::<()>().await,
        }
    };
    let result = tokio::select! {
        result = tokio::time::timeout(limit, exchange) => result,
        _ = cancelled => Ok(Err(io::Error::new(io::ErrorKind::Interrupted, "空间切换已取消旧空间的读取"))),
    };
    match result {
        Ok(Ok(output)) => Ok(output),
        result => {
            // Reap before returning so callers can safely inspect an atomic file
            // commit: this process can no longer change it after a timeout.
            let _ = child.kill().await;
            match result {
                Ok(Err(error)) => Err(error),
                _ => Err(io::Error::new(io::ErrorKind::TimedOut, "后台操作超时")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn blocked_pipe_write_expires_and_releases_its_caller() {
        let (mut writer, _unread) = tokio::io::duplex(1);
        let result = tokio::time::timeout(Duration::from_secs(2),
            write_request(&mut writer, b"larger than the pipe", Duration::from_millis(25))).await.unwrap();
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
    }

    fn fixture(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "workbench_process::tests::fixture_child", "--nocapture"])
            .env("TODAY_PROCESS_TEST", mode);
        #[cfg(windows)] command.creation_flags(0x08000000);
        command
    }

    #[test]
    fn fixture_child() {
        use std::io::{Read, Write};
        match std::env::var("TODAY_PROCESS_TEST").as_deref() {
            Ok("cancel") => {
                let file = std::env::var("TODAY_PROCESS_MARKER").unwrap();
                for tick in 0..500 {
                    std::fs::write(&file, tick.to_string()).unwrap();
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            Ok("blocked") => std::thread::sleep(Duration::from_secs(60)),
            Ok("duplex") => {
                std::io::stdout().write_all(&vec![b'x'; 256 * 1024]).unwrap();
                let mut input = Vec::new();
                std::io::stdin().read_to_end(&mut input).unwrap();
                assert_eq!(input.len(), 256 * 1024);
                println!("exchange-complete");
            }
            _ => (),
        }
    }

    #[tokio::test]
    async fn child_that_never_reads_stdin_cannot_hold_a_space_lease_forever() {
        let result = tokio::time::timeout(Duration::from_secs(5),
            output(&mut fixture("blocked"), &vec![b'x'; 256 * 1024], Duration::from_millis(300))).await.unwrap();
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
    }

    #[tokio::test]
    async fn output_is_drained_while_sending_a_large_request() {
        let result = output(&mut fixture("duplex"), &vec![b'x'; 256 * 1024], Duration::from_secs(5)).await.unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        assert!(String::from_utf8_lossy(&result.stdout).contains("exchange-complete"));
    }

    #[tokio::test]
    async fn cancelling_a_read_reaps_the_child_before_releasing_its_caller() {
        let marker = std::env::temp_dir().join(format!("today-read-cancel-{}-{}.txt", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let (cancel, receiver) = tokio::sync::watch::channel(0);
        let child_marker = marker.clone();
        let reading = tokio::spawn(async move {
            output_cancellable(fixture("cancel").env("TODAY_PROCESS_MARKER", child_marker), b"", Duration::from_secs(20), Some(receiver)).await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            while !marker.exists() { tokio::time::sleep(Duration::from_millis(10)).await; }
        }).await.unwrap();
        cancel.send_modify(|value| *value += 1);
        let error = tokio::time::timeout(Duration::from_secs(2), reading).await.unwrap().unwrap().unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        let saved = std::fs::read(&marker).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(std::fs::read(&marker).unwrap(), saved);
        std::fs::remove_file(marker).unwrap();
    }
}

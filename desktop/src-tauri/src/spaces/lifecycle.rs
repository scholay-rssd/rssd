//! Every command owns a lease until its future completes. Detached jobs and
//! external IPC own one too, so no old IDs can be written into a new database.
use std::sync::{LazyLock, Mutex, atomic::{AtomicU64,Ordering}};
use tauri::{ipc::{CommandArg, CommandItem, InvokeError}, Runtime};

static STATE: Mutex<(bool, usize)> = Mutex::new((false, 0));
static REFRESH_CANCEL:LazyLock<tokio::sync::watch::Sender<u64>>=LazyLock::new(||tokio::sync::watch::channel(0).0);
pub fn cancel_refresh(){REFRESH_CANCEL.send_modify(|value|*value+=1);}
pub fn refresh_cancellation()->tokio::sync::watch::Receiver<u64>{REFRESH_CANCEL.subscribe()}
static EPOCH:AtomicU64=AtomicU64::new(0);
pub fn epoch()->u64{EPOCH.load(Ordering::Acquire)}
pub fn advance(){EPOCH.fetch_add(1,Ordering::AcqRel);}
pub struct Lease;
impl Lease {
    pub fn acquire() -> Result<Self, String> {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if state.0 { return Err("正在切换空间，请稍候".into()); }
        state.1 += 1;
        Ok(Self)
    }
}
impl Drop for Lease {
    fn drop(&mut self) { STATE.lock().unwrap_or_else(|e| e.into_inner()).1 -= 1; }
}
impl<'de, R: Runtime> CommandArg<'de, R> for Lease {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let lease=Self::acquire().map_err(InvokeError::from)?;
        if let Some(value)=command.message.headers().get("x-today-space-epoch") {
            if value.to_str().ok().and_then(|v|v.parse::<u64>().ok())!=Some(epoch()) {
                return Err(InvokeError::from("该请求属于已离开的空间"));
            }
        }
        Ok(lease)
    }
}
pub struct Switch;
impl Drop for Switch {
    fn drop(&mut self) { STATE.lock().unwrap_or_else(|e| e.into_inner()).0 = false; }
}
pub async fn begin_switch() -> Result<Switch, String> {
    {
        let mut state = STATE.lock().unwrap_or_else(|e| e.into_inner());
        if state.0 { return Err("已有空间正在切换".into()); }
        state.0 = true;
    }
    cancel_refresh();
    let guard = Switch;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        if STATE.lock().unwrap_or_else(|e| e.into_inner()).1 == 0 { return Ok(guard); }
        if tokio::time::Instant::now() >= deadline {
            return Err("当前空间仍有任务正在处理，请等任务完成后再切换；原空间已保留".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn switch_drains_existing_work_and_rejects_new_work() {
        let lease = Lease::acquire().unwrap();
        let switching = tokio::spawn(begin_switch());
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        assert!(Lease::acquire().is_err());
        assert!(!switching.is_finished());
        drop(lease);
        let guard = switching.await.unwrap().unwrap();
        assert!(Lease::acquire().is_err());
        drop(guard);
        assert!(Lease::acquire().is_ok());
    }
}

use crate::lifetime::{Close, Lifetime};
use std::sync::{Condvar, Mutex, MutexGuard};
use tauri::{Window, WindowEvent};

static LIFETIME: Mutex<Lifetime> = Mutex::new(Lifetime::new());
static FINISHED: Condvar = Condvar::new();

fn state() -> MutexGuard<'static, Lifetime> {
    LIFETIME.lock().unwrap_or_else(|err| err.into_inner())
}

#[tauri::command]
pub fn outlook_batch(active: bool) -> Result<(), String> {
    if active {
        state().start_batch().map_err(str::to_string)
    } else {
        end_batch();
        Ok(())
    }
}

pub fn end_batch() {
    state().end_batch();
    FINISHED.notify_all();
}

pub struct WriteGuard;

impl WriteGuard {
    pub fn for_command(command: Option<&String>) -> Result<Option<Self>, String> {
        match command.map(String::as_str) {
            Some(
                "--move" | "--undo" | "--status" | "--field" | "--tags" | "--draft"
                | "--folder-create" | "--folder-rename" | "--folder-move" | "--sync-colors",
            ) => {
                state().start_write().map_err(str::to_string)?;
                Ok(Some(Self))
            }
            _ => Ok(None),
        }
    }
}

impl Drop for WriteGuard {
    fn drop(&mut self) {
        state().end_write();
        FINISHED.notify_all();
    }
}

pub fn window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let decision = state().close();
        if decision == Close::Now {
            return;
        }
        api.prevent_close();
        if decision == Close::Wait {
            let _ = window.set_title("Mail-Board – Outlook-Änderung abschließen …");
            let window = window.clone();
            std::thread::spawn(move || {
                let guard = FINISHED
                    .wait_while(state(), |s| s.busy())
                    .unwrap_or_else(|err| err.into_inner());
                drop(guard);
                let _ = window.close();
            });
        }
    }
}

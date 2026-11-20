/// State shared by window close requests, the renderer batch and native helpers.
/// Individual helper guards also cover project writes started outside a board batch.
#[derive(Default)]
pub struct Lifetime {
    writes: usize,
    batch: bool,
    closing: bool,
}

#[derive(Debug, PartialEq)]
pub enum Close {
    Now,
    Wait,
    AlreadyWaiting,
}

impl Lifetime {
    pub const fn new() -> Self {
        Self {
            writes: 0,
            batch: false,
            closing: false,
        }
    }

    pub fn busy(&self) -> bool {
        self.batch || self.writes > 0
    }

    pub fn close(&mut self) -> Close {
        let was_closing = self.closing;
        self.closing = true;
        if !self.busy() {
            Close::Now
        } else if was_closing {
            Close::AlreadyWaiting
        } else {
            Close::Wait
        }
    }

    pub fn start_batch(&mut self) -> Result<(), &'static str> {
        if self.closing {
            return Err("Das Mail-Board wird geschlossen.");
        }
        if self.batch {
            return Err("Eine Änderung wird bereits ausgeführt.");
        }
        self.batch = true;
        Ok(())
    }

    pub fn end_batch(&mut self) {
        self.batch = false;
    }

    pub fn start_write(&mut self) -> Result<(), &'static str> {
        if self.closing && !self.batch {
            return Err("Das Mail-Board wird geschlossen.");
        }
        self.writes += 1;
        Ok(())
    }

    pub fn end_write(&mut self) {
        self.writes -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_between_writes_waits_for_entire_batch() {
        let mut state = Lifetime::new();
        state.start_batch().unwrap();
        state.start_write().unwrap();
        state.end_write();
        assert_eq!(state.close(), Close::Wait);
        assert_eq!(state.close(), Close::AlreadyWaiting);
        assert!(state.start_batch().is_err());
        state.start_write().unwrap();
        state.end_write();
        assert!(state.busy());
        state.end_batch();
        assert_eq!(state.close(), Close::Now);
        assert!(state.start_write().is_err());
    }

    #[test]
    fn helper_remains_protected_after_renderer_reload() {
        let mut state = Lifetime::new();
        state.start_batch().unwrap();
        state.start_write().unwrap();
        state.end_batch();
        assert_eq!(state.close(), Close::Wait);
        state.end_write();
        assert_eq!(state.close(), Close::Now);
    }

    #[test]
    fn idle_window_can_close_immediately() {
        let mut state = Lifetime::new();
        assert_eq!(state.close(), Close::Now);
        assert!(state.start_write().is_err());
    }
}

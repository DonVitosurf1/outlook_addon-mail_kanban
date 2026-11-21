use super::{cosine, eligible, unit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_ID: AtomicU64 = AtomicU64::new(0);
static LAST_PRUNE: AtomicU64 = AtomicU64::new(0);
#[derive(Clone)]
pub struct VectorCache(PathBuf);
pub fn token(namespace: &str, model: &str, text: &str) -> String {
    let mut hash = Sha256::new();
    for s in [namespace, model, text] {
        hash.update(s.len().to_be_bytes());
        hash.update(s);
    }
    format!("{:x}", hash.finalize())
}
fn valid(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit())
}
impl VectorCache {
    pub fn new(root: PathBuf) -> Self {
        Self(root)
    }
    pub fn load(&self, key: &str) -> Option<Vec<f64>> {
        if !valid(key) {
            return None;
        }
        let path = self.0.join(key);
        let bytes = fs::read(path).ok()?;
        if bytes.is_empty() || bytes.len() > 128 * 1024 || bytes.len() % 4 != 0 {
            return None;
        }
        let v = bytes
            .chunks_exact(4)
            .map(|n| f32::from_le_bytes(n.try_into().unwrap()) as f64)
            .collect();
        unit(v).ok()
    }
    pub fn save(&self, key: &str, v: &[f64]) {
        if !valid(key) || fs::create_dir_all(&self.0).is_err() {
            return;
        }
        self.prune();
        let tmp = self.0.join(format!(
            ".{}-{}.tmp",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let bytes = v
            .iter()
            .flat_map(|n| (*n as f32).to_le_bytes())
            .collect::<Vec<_>>();
        if fs::write(&tmp, bytes).is_ok() {
            let _ = fs::rename(&tmp, self.0.join(key));
        }
        let _ = fs::remove_file(tmp);
    }
    fn prune(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let last = LAST_PRUNE.load(Ordering::Relaxed);
        if now.saturating_sub(last) < 900
            || LAST_PRUNE
                .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_err()
        {
            return;
        }
        let Ok(files) = fs::read_dir(&self.0) else {
            return;
        };
        let mut entries = files
            .flatten()
            .filter_map(|file| {
                if !valid(&file.file_name().to_string_lossy()) {
                    return None;
                }
                let meta = file.metadata().ok()?;
                Some((meta.modified().ok()?, file.path(), meta.len()))
            })
            .collect::<Vec<_>>();
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        let mut total = 0;
        for (i, (_, path, size)) in entries.into_iter().enumerate() {
            total += size;
            if i >= 16000 || total > 160 * 1024 * 1024 {
                let _ = fs::remove_file(path);
            }
        }
    }
}
#[derive(Serialize, Deserialize)]
pub struct Member {
    pub token: String,
    pub weight: f64,
}
#[derive(Deserialize, Serialize)]
pub struct SampleIndex {
    pub members: Vec<Member>,
    pub description: Option<String>,
}
#[derive(Deserialize)]
pub struct EvaluationFolder {
    pub key: String,
    pub index: SampleIndex,
    // Folder-local indices explicitly matched to the canonical Bayes holdout by Outlook ID.
    pub held: std::collections::HashMap<usize, String>,
}
#[derive(Serialize, Default)]
pub struct ResultCount {
    pub shown: usize,
    pub correct: usize,
}
#[derive(Serialize)]
pub struct Prediction {
    pub truth: String,
    pub id: String,
    pub folder: String,
    pub gap: f64,
}
#[derive(Serialize, Default)]
pub struct Evaluation {
    pub predictions: Vec<Prediction>,
    pub tested: usize,
    pub missing: usize,
    pub plain: ResultCount,
    pub profiled: ResultCount,
}
fn mean(cache: &VectorCache, members: &[&Member]) -> Option<Vec<f64>> {
    let mut sum = Vec::new();
    for row in members {
        let v = cache.load(&row.token)?;
        if sum.is_empty() {
            sum = vec![0.0; v.len()];
        }
        if sum.len() != v.len() {
            return None;
        }
        for (s, n) in sum.iter_mut().zip(v) {
            *s += n * row.weight.clamp(0.01, 1.0);
        }
    }
    unit(sum).ok()
}
pub fn holdout(
    root: &Path,
    folders: &[EvaluationFolder],
    weight: f64,
    threshold: f64,
    margin: f64,
) -> Evaluation {
    let cache = VectorCache::new(root.into());
    let mut centers = Vec::new();
    let mut queries = Vec::new();
    let mut result = Evaluation::default();
    for f in folders.iter().filter(|f| eligible(&f.key)) {
        let mut train = Vec::new();
        for (i, member) in f.index.members.iter().enumerate() {
            if let Some(id) = f.held.get(&i) {
                if let Some(vector) = cache.load(&member.token) {
                    queries.push((&f.key, id, vector));
                } else {
                    result.missing += 1;
                }
            } else {
                train.push(member);
            }
        }
        let Some(base) = mean(&cache, &train) else {
            continue;
        };
        let mut profiled = base.clone();
        if let Some(desc) = f.index.description.as_deref().and_then(|k| cache.load(k)) {
            if desc.len() == base.len() && weight > 0.0 {
                let share = weight.max(3.0 / (3 + train.len()) as f64).min(0.5);
                profiled = desc
                    .iter()
                    .zip(&base)
                    .map(|(d, b)| share * d + (1.0 - share) * b)
                    .collect();
            }
        }
        centers.push((&f.key, base, profiled));
    }
    for (truth, id, v) in queries {
        result.tested += 1;
        for plain in [true, false] {
            let mut rank = centers
                .iter()
                .filter_map(|(key, a, b)| Some((key, cosine(&v, if plain { a } else { b })?)))
                .collect::<Vec<_>>();
            rank.sort_by(|a, b| b.1.total_cmp(&a.1));
            if let Some((winner, score)) = rank.first() {
                let gap = rank.get(1).map_or(f64::INFINITY, |r| score - r.1);
                if *score > threshold && gap > 0.0 && gap >= margin {
                    if !plain {
                        result.predictions.push(Prediction {
                            truth: truth.clone(),
                            id: id.clone(),
                            folder: (**winner).clone(),
                            gap: if gap.is_infinite() { 1.0 } else { gap },
                        });
                    }
                    let bucket = if plain {
                        &mut result.plain
                    } else {
                        &mut result.profiled
                    };
                    bucket.shown += 1;
                    if *winner == &truth {
                        bucket.correct += 1;
                    }
                }
            }
        }
    }
    result
}

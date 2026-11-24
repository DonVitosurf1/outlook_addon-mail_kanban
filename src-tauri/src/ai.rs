use mailboard_ollama::cache::{Evaluation, EvaluationFolder, SampleIndex};
use mailboard_ollama::index::{Cluster, Group, GroupMatch, Item, Outlier};
use mailboard_ollama::{Analysis, Choice, Folder, Mail, ModelInfo, Ollama, Sample, Score};
use tauri::Manager;

#[tauri::command]
pub async fn ai_models(url: String) -> Result<Vec<String>, String> {
    Ollama::new(&url)?.models().await
}

#[tauri::command]
pub async fn ai_analyze(
    url: String,
    model: String,
    mail: Mail,
    folders: Vec<Folder>,
) -> Result<Analysis, String> {
    Ollama::new(&url)?.analyze(&model, &mail, &folders).await
}

/// Größe, Quantisierung, Kontextlänge und Ladezustand eines lokalen Modells (A1). Sendet nur den Modellnamen.
#[tauri::command]
pub async fn ai_model_info(url: String, model: String) -> Result<ModelInfo, String> {
    Ollama::new(&url)?.model_info(&model).await
}

/// Schnelle Stichwahl zwischen zwei Ordnern (C2).
#[tauri::command]
pub async fn ai_choose(
    url: String,
    model: String,
    mail: Mail,
    candidates: Vec<Folder>,
) -> Result<Option<Choice>, String> {
    Ollama::new(&url)?.choose(&model, &mail, &candidates).await
}

#[tauri::command]
pub async fn ai_suggest(
    app: tauri::AppHandle,
    url: String,
    model: String,
    text: String,
    folders: Vec<Folder>,
    centroids: std::collections::HashMap<String, Vec<f64>>,
) -> Result<Vec<Score>, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .scores(&model, &text, &folders, &centroids)
        .await
}

#[tauri::command]
pub async fn ai_centroid(
    app: tauri::AppHandle,
    url: String,
    model: String,
    samples: Vec<Sample>,
    description: String,
    description_weight: f64,
) -> Result<TrainingResult, String> {
    let client = Ollama::new(&url)?.with_cache(vector_path(&app)?);
    let vector = client
        .centroid(&model, &samples, &description, description_weight)
        .await?;
    Ok(TrainingResult {
        vector,
        index: client.sample_index(&model, &samples, &description),
    })
}

#[tauri::command]
pub async fn ai_embed(
    app: tauri::AppHandle,
    url: String,
    model: String,
    items: Vec<Item>,
) -> Result<usize, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .embed(&model, &items)
        .await
}

#[tauri::command]
pub async fn ai_rank(
    app: tauri::AppHandle,
    url: String,
    model: String,
    query: String,
    items: Vec<Item>,
) -> Result<Vec<mailboard_ollama::index::Score>, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .rank(&model, &query, &items)
        .await
}

#[tauri::command]
pub async fn ai_groups(
    app: tauri::AppHandle,
    url: String,
    model: String,
    groups: Vec<Group>,
    items: Vec<Item>,
) -> Result<Vec<GroupMatch>, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .groups(&model, &groups, &items)
        .await
}

/// Ausreißer der Lernordner (E3) auf Basis des Vektor-Caches.
#[tauri::command]
pub async fn ai_outliers(
    app: tauri::AppHandle,
    url: String,
    model: String,
    folders: Vec<mailboard_ollama::index::Folder>,
    threshold: f64,
    margin: f64,
) -> Result<Vec<Outlier>, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .outliers(&model, &folders, threshold, margin)
        .await
}

#[derive(serde::Serialize)]
pub struct TrainingResult {
    vector: Vec<f64>,
    index: SampleIndex,
}
fn vector_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Lokaler Cachepfad nicht verfügbar.")?
        .join("embeddings-v1"))
}
#[tauri::command]
pub async fn ai_holdout(
    app: tauri::AppHandle,
    folders: Vec<EvaluationFolder>,
    weight: f64,
    threshold: f64,
    margin: f64,
) -> Result<Evaluation, String> {
    let root = vector_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        mailboard_ollama::cache::holdout(&root, &folders, weight, threshold, margin)
    })
    .await
    .map_err(|_| "Semantik-Testlauf abgebrochen.".into())
}

#[tauri::command]
pub async fn ai_profile(
    url: String,
    model: String,
    key: String,
    samples: Vec<Mail>,
) -> Result<String, String> {
    Ollama::new(&url)?.profile(&model, &key, &samples).await
}

#[tauri::command]
pub async fn ai_reply(
    url: String,
    model: String,
    mail: Mail,
    profile: String,
) -> Result<String, String> {
    Ollama::new(&url)?.reply(&model, &mail, &profile).await
}

#[tauri::command]
pub async fn ai_subfolders(
    url: String,
    model: String,
    area: String,
    examples: Vec<mailboard_ollama::StructureExample>,
    existing: Vec<String>,
) -> Result<Vec<mailboard_ollama::Subfolder>, String> {
    Ollama::new(&url)?
        .subfolders(&model, &area, &examples, &existing)
        .await
}

/// Namensvorschlag für einen Ordner mit unklarem Namen (E4).
#[tauri::command]
pub async fn ai_folder_name(
    url: String,
    model: String,
    key: String,
    profile: String,
    subjects: Vec<String>,
) -> Result<String, String> {
    Ollama::new(&url)?
        .folder_name(&model, &key, &profile, &subjects)
        .await
}

/// Namensvorschlag für eine Gruppe ähnlicher Posteingangsmails (E4).
#[tauri::command]
pub async fn ai_cluster_name(
    url: String,
    model: String,
    subjects: Vec<String>,
) -> Result<String, String> {
    Ollama::new(&url)?.cluster_name(&model, &subjects).await
}

/// Gruppen ähnlicher Mails auf Basis des Vektor-Caches (E4, neue Ordner aus dem Posteingang).
#[tauri::command]
pub async fn ai_clusters(
    app: tauri::AppHandle,
    url: String,
    model: String,
    items: Vec<Item>,
    min_size: usize,
    threshold: f64,
) -> Result<Vec<Cluster>, String> {
    Ollama::new(&url)?
        .with_cache(vector_path(&app)?)
        .clusters(&model, &items, min_size, threshold)
        .await
}

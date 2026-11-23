//! Hintergrund-Einbettung geladener Mails. Die Vektoren bleiben im lokalen `VectorCache`;
//! nach außen gehen nur Kennungen und Ähnlichkeitswerte.
use super::{clip, cosine, unit, Ollama, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Neue Einträge werden in Stapeln dieser Größe beim Modellserver angefragt.
pub const BATCH: usize = 16;
/// Gleiche Kürzung wie bei Lernbeispielen, damit deren Vektoren im Cache wiederverwendet werden.
const TEXT_LIMIT: usize = 2200;

/// Eine Mail mit stabiler Kennung des Aufrufers und fertig aufbereitetem Einbettungstext.
#[derive(Deserialize, Clone, Debug)]
pub struct Item {
    pub id: String,
    pub text: String,
}

/// Kosinus-Ähnlichkeit eines Eintrags zur Suchanfrage.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Score {
    pub id: String,
    pub score: f64,
}

/// Benannte Gruppe, deren Profil der Mittelwert der Vektoren ihrer Einträge ist.
#[derive(Deserialize, Clone, Debug)]
pub struct Group {
    pub name: String,
    pub items: Vec<Item>,
}

/// Beste Gruppe für einen Eintrag. `margin` ist der Abstand zur zweitbesten Gruppe,
/// ohne zweite Gruppe 1.0 (wie beim Semantik-Testlauf).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GroupMatch {
    pub id: String,
    pub best: String,
    pub score: f64,
    pub margin: f64,
}

impl Ollama {
    /// Lädt Vektoren aus dem Cache und fragt nur fehlende, doppelte Texte einmal, in Stapeln an.
    /// Liefert die Vektoren in Eingabereihenfolge und die Zahl neu eingebetteter Texte.
    async fn embedded(&self, model: &str, texts: &[String]) -> Result<(Vec<Vec<f64>>, usize)> {
        let clipped = texts
            .iter()
            .map(|t| clip(t, TEXT_LIMIT))
            .collect::<Vec<_>>();
        let keys = clipped
            .iter()
            .map(|t| self.vector_token(model, t))
            .collect::<Vec<_>>();
        let mut output = keys
            .iter()
            .map(|k| self.cache.as_ref().and_then(|cache| cache.load(k)))
            .collect::<Vec<_>>();
        let mut first = HashMap::new();
        let missing = (0..keys.len())
            .filter(|&i| output[i].is_none() && *first.entry(&keys[i]).or_insert(i) == i)
            .collect::<Vec<_>>();
        for batch in missing.chunks(BATCH) {
            let texts = batch
                .iter()
                .map(|&i| clipped[i].clone())
                .collect::<Vec<_>>();
            for (&i, v) in batch.iter().zip(self.vectors(model, &texts).await?) {
                output[i] = Some(v);
            }
        }
        let vectors = (0..keys.len())
            .map(|i| {
                output[i]
                    .clone()
                    .or_else(|| output[first[&keys[i]]].clone())
                    .ok_or_else(|| "Fehlender Vektor.".to_string())
            })
            .collect::<Result<Vec<_>>>()?;
        Ok((vectors, missing.len()))
    }

    /// Füllt den Cache für alle Einträge und gibt die Zahl neu eingebetteter Einträge zurück.
    pub async fn embed(&self, model: &str, items: &[Item]) -> Result<usize> {
        self.check_local_model(model).await?;
        let texts = items.iter().map(|i| i.text.clone()).collect::<Vec<_>>();
        Ok(self.embedded(model, &texts).await?.1)
    }

    /// Ähnlichkeit jedes Eintrags zur Anfrage, absteigend sortiert.
    pub async fn rank(&self, model: &str, query: &str, items: &[Item]) -> Result<Vec<Score>> {
        self.check_local_model(model).await?;
        let mut texts = vec![query.to_string()];
        texts.extend(items.iter().map(|i| i.text.clone()));
        let (vectors, _) = self.embedded(model, &texts).await?;
        let mut rank = items
            .iter()
            .zip(&vectors[1..])
            .filter_map(|(item, v)| {
                Some(Score {
                    id: item.id.clone(),
                    score: cosine(&vectors[0], v)?,
                })
            })
            .collect::<Vec<_>>();
        rank.sort_by(|a, b| b.score.total_cmp(&a.score));
        Ok(rank)
    }

    /// Beste Gruppe je Eintrag mit Abstand zur zweitbesten. Leere Gruppen zählen nicht.
    pub async fn groups(
        &self,
        model: &str,
        groups: &[Group],
        items: &[Item],
    ) -> Result<Vec<GroupMatch>> {
        self.check_local_model(model).await?;
        let texts = groups
            .iter()
            .flat_map(|g| &g.items)
            .chain(items)
            .map(|i| i.text.clone())
            .collect::<Vec<_>>();
        let (vectors, _) = self.embedded(model, &texts).await?;
        let (members, queries) = vectors.split_at(vectors.len() - items.len());
        let mut centers = Vec::new();
        let mut offset = 0;
        for group in groups {
            let own = &members[offset..offset + group.items.len()];
            offset += group.items.len();
            let Some(dim) = own.first().map(Vec::len) else {
                continue;
            };
            if own.iter().any(|v| v.len() != dim) {
                return Err("Dimensionen der Embeddings stimmen nicht überein.".into());
            }
            let sum = (0..dim).map(|d| own.iter().map(|v| v[d]).sum()).collect();
            if let Ok(center) = unit(sum) {
                centers.push((&group.name, center));
            }
        }
        let mut result = Vec::new();
        for (item, v) in items.iter().zip(queries) {
            let mut rank = centers
                .iter()
                .filter_map(|(name, c)| Some((*name, cosine(v, c)?)))
                .collect::<Vec<_>>();
            rank.sort_by(|a, b| b.1.total_cmp(&a.1));
            if let Some((best, score)) = rank.first() {
                result.push(GroupMatch {
                    id: item.id.clone(),
                    best: (*best).clone(),
                    score: *score,
                    margin: rank.get(1).map_or(1.0, |second| score - second.1),
                });
            }
        }
        Ok(result)
    }
}

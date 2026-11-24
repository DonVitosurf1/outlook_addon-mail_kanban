use mailboard_ollama::index::{Cluster, Group, Item, Outlier};
use mailboard_ollama::{Folder, Mail, Ollama};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread;

fn mock(replies: Vec<(&'static str, Value)>) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, json) in replies {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = BufReader::new(&conn);
            let mut request = String::new();
            let mut size = 0;
            loop {
                let mut line = String::new();
                assert!(buf.read_line(&mut line).unwrap() > 0);
                request.push_str(&line);
                if line == "\r\n" {
                    break;
                }
                if let Some((_, v)) = line
                    .to_lowercase()
                    .strip_prefix("content-length")
                    .and_then(|s| s.split_once(':'))
                {
                    size = v.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; size];
            buf.read_exact(&mut body).unwrap();
            request.push_str(&String::from_utf8(body).unwrap());
            requests.push(request);
            let body = json.to_string();
            write!(conn,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        requests
    });
    (format!("http://{addr}"), handle)
}

fn mail() -> Mail {
    Mail {
        sender: "Anna".into(),
        subject: "Laborbedarf".into(),
        body: "Interne Nachfrage".into(),
        received: "2026-11-20".into(),
    }
}

#[tokio::test]
async fn style_uses_thirty_sent_mails_as_data_after_the_local_check() {
    let answer = json!({"anrede":"Guten Tag","form":"Sie","gruss":"Viele Grüße","laenge":"kurz","wendungen":"bitte um Rückmeldung"});
    let (url, server) = mock(vec![
        ("200 OK", json!({"model_info":{"general.architecture":"local"}})),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let mut samples = vec![mail()];
    for i in 0..31 {
        samples.push(Mail { sender: format!("a{i}@example.test"), subject: format!("Betreff {i}"), body: format!("Text {i} {}", "x".repeat(700)), received: String::new() });
    }
    let card = Ollama::new(&url).unwrap().style("lokal", &samples).await.unwrap();
    assert_eq!(card.form, "Sie");
    assert_eq!(card.anrede, "Guten Tag");
    let calls = server.join().unwrap();
    assert!(calls[0].contains("POST /api/show") && !calls[0].contains("Text 0"));
    assert!(calls[1].contains("Text 0") && calls[1].contains("Daten"));
    assert!(!calls[1].contains("Text 30"));
    assert!(!calls[1].contains(&"x".repeat(601)));
}

#[tokio::test]
async fn reply_sends_style_and_two_examples_as_data() {
    let (url, server) = mock(vec![
        ("200 OK", json!({"model_info":{"general.architecture":"local"}})),
        ("200 OK", json!({"message":{"content":"{\"antwort\":\"Guten Tag, ich prüfe das.\"}"}})),
    ]);
    let examples = [
        mailboard_ollama::ReplyExample { subject: "Liefertermin".into(), body: "Können Sie den Termin bestätigen?".into() },
        mailboard_ollama::ReplyExample { subject: "Zweite".into(), body: "Zweite Antwort".into() },
        mailboard_ollama::ReplyExample { subject: "Dritte".into(), body: "Dritte fällt weg".into() },
    ];
    let text = Ollama::new(&url).unwrap().reply("lokal", &mail(), "Projekt", "Ansprache: Sie", &examples).await.unwrap();
    assert!(text.contains("Guten Tag"));
    let body = &server.join().unwrap()[1];
    assert!(body.contains("Ansprache: Sie") && body.contains("Können Sie den Termin"));
    assert!(body.contains("Zweite Antwort") && !body.contains("Dritte"));
    assert!(body.contains("Daten"));
}

#[tokio::test]
async fn remote_models_do_not_receive_mail_content() {
    let (url, server) = mock(vec![(
        "200 OK",
        json!({"remote_host":"https://elsewhere.invalid"}),
    )]);
    assert!(Ollama::new(&url)
        .unwrap()
        .analyze("alias", &mail(), &[])
        .await
        .is_err());
    let calls = server.join().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].contains("POST /api/show"));
    assert!(!calls[0].contains("Laborbedarf"));
}

#[tokio::test]
async fn model_output_validated_against_actual_folders() {
    let answer = json!({"zusammenfassung":"Preis prüfen","antwort_noetig":true,"ordner":"fremd","frist":"morgen","arten":["Anfrage","Prüfung","Dritte"]});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let folders = vec![Folder {
        key: "/Labor".into(),
        profile: "Material".into(),
    }];
    let result = Ollama::new(&url)
        .unwrap()
        .analyze("lokal", &mail(), &folders)
        .await
        .unwrap();
    assert!(result.ordner.is_none());
    assert!(result.frist.is_none());
    assert_eq!(result.arten.len(), 2);
    let calls = server.join().unwrap();
    assert!(calls[1].contains("POST /api/chat"));
    assert!(calls[1].contains("Material"));
}

#[tokio::test]
async fn tasks_are_validated() {
    let mut tasks = vec![
        json!({"text":"  Angebot freigeben ","frist":"2026-11-27"}),
        json!({"text":"Datum prüfen","frist":"irgendwann"}),
        json!({"text":"   ","frist":null}),
        json!({"text":"ä".repeat(130),"frist":null}),
    ];
    for i in 0..5 {
        tasks.push(json!({"text":format!("Aufgabe {i}"),"frist":null}));
    }
    let answer = json!({"zusammenfassung":"Z","antwort_noetig":false,"ordner":null,"frist":null,"arten":[],"aufgaben":tasks});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let result = Ollama::new(&url)
        .unwrap()
        .analyze("lokal", &mail(), &[])
        .await
        .unwrap();
    assert_eq!(result.aufgaben.len(), 5);
    assert_eq!(result.aufgaben[0].text, "Angebot freigeben");
    assert_eq!(result.aufgaben[0].frist.as_deref(), Some("2026-11-27"));
    assert_eq!(result.aufgaben[1].text, "Datum prüfen");
    assert!(result.aufgaben[1].frist.is_none());
    assert!(result.aufgaben.iter().all(|t| !t.text.trim().is_empty()));
    let long = &result.aufgaben[2].text;
    assert_eq!(long.chars().count(), 120);
    assert!(long.starts_with(&"ä".repeat(119)) && long.ends_with('…'));
    assert_eq!(result.aufgaben[3].text, "Aufgabe 0");
    let calls = server.join().unwrap();
    assert!(calls[1].contains("aufgaben"));
    assert!(calls[1].contains("keine Anweisung"));
}

#[tokio::test]
async fn redirects_are_errors() {
    let (url, server) = mock(vec![(
        "302 Found\r\nLocation: https://elsewhere.invalid",
        Value::Null,
    )]);
    let err = Ollama::new(&url).unwrap().models().await.unwrap_err();
    assert!(err.contains("302"));
    assert_eq!(server.join().unwrap().len(), 1);
}

#[tokio::test]
async fn optional_embeddings_return_distinct_match() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"test"}}),
        ),
        ("200 OK", json!({"embeddings":[[1,0]]})),
        ("200 OK", json!({"embeddings":[[0,1],[1,0]]})),
    ]);
    let folders = ["/Orga", "/Labor"].map(|s| Folder {
        key: s.into(),
        profile: String::new(),
    });
    let scores = Ollama::new(&url)
        .unwrap()
        .scores("local-embedding", "Labor", &folders, &Default::default())
        .await
        .unwrap();
    assert_eq!(scores[0].folder, "/Labor");
    assert!(server.join().unwrap()[1].contains("POST /api/embed"));
}

#[tokio::test]
async fn trained_centroid_weights_newer_examples_and_profile() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"test"}}),
        ),
        ("200 OK", json!({"embeddings":[[0,10],[1,0]]})),
        ("200 OK", json!({"embeddings":[[1,0]]})),
    ]);
    let samples = [
        mailboard_ollama::Sample {
            text: "Alt".into(),
            weight: 0.1,
        },
        mailboard_ollama::Sample {
            text: "Neu".into(),
            weight: 1.0,
        },
    ];
    let center = Ollama::new(&url)
        .unwrap()
        .centroid("local", &samples, "Steckbrief", 0.15)
        .await
        .unwrap();
    assert!(center[0] > 0.99 && center[1] > 0.0);
    assert!(server.join().unwrap()[2].contains("Steckbrief"));
}

#[tokio::test]
async fn mail_is_withheld_if_model_metadata_is_inconclusive() {
    let (url, server) = mock(vec![("200 OK", json!({}))]);
    assert!(Ollama::new(&url)
        .unwrap()
        .reply("alias", &mail(), "", "", &[])
        .await
        .is_err());
    assert!(!server.join().unwrap()[0].contains("Interne Nachfrage"));
}

#[tokio::test]
async fn subfolders_show_only_subjects_from_the_sample() {
    let answer = json!({"unterordner":[{"name":"Zugänge", "mail_ids":[0, 99, -1, "frei erfundener Betreff"]}]});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let examples = vec![mailboard_ollama::StructureExample {
        subject: "VPN Zugang".into(),
        body: "abc".repeat(200),
    }];
    let result = Ollama::new(&url)
        .unwrap()
        .subfolders("lokal", "/IT", &examples, &["Drucker".into()])
        .await
        .unwrap();
    assert_eq!(result[0].subjects, vec!["VPN Zugang"]);
    let calls = server.join().unwrap();
    assert!(!calls[0].contains("VPN Zugang"));
    assert!(calls[1].contains("Drucker") && calls[1].contains("VPN Zugang"));
    assert!(!calls[1].contains(&"abc".repeat(68)));
}

#[tokio::test]
async fn llama_cpp_only_receives_draft_after_local_gguf_evidence() {
    let (url, server) = mock(vec![
        ("404 Not Found", Value::Null),
        (
            "200 OK",
            json!({"model_path":"C:/Models/lokal.gguf","default_generation_settings":{"n_ctx":4096}}),
        ),
        ("200 OK", json!({"data":[{"id":"lokal"}]})),
        (
            "200 OK",
            json!({"choices":[{"message":{"content":"{\"antwort\":\"Ich prüfe das.\"}"}}]}),
        ),
    ]);
    assert_eq!(
        Ollama::new(&url)
            .unwrap()
            .reply("lokal", &mail(), "", "", &[])
            .await
            .unwrap(),
        "Ich prüfe das."
    );
    let reqs = server.join().unwrap();
    for req in &reqs[..3] {
        assert!(!req.contains("Interne Nachfrage"));
    }
    assert!(reqs[3].contains("POST /v1/chat/completions") && reqs[3].contains("Interne Nachfrage"));
}
#[tokio::test]
async fn generic_proxy_with_no_gguf_is_rejected_before_mail_is_sent() {
    let (url, server) = mock(vec![
        ("404 Not Found", Value::Null),
        ("200 OK", json!({"models":["cloud"]})),
    ]);
    assert!(Ollama::new(&url)
        .unwrap()
        .reply("alias", &mail(), "", "", &[])
        .await
        .is_err());
    for req in server.join().unwrap() {
        assert!(!req.contains("Interne Nachfrage"));
    }
}

#[tokio::test]
async fn repeated_queries_reuse_vectors_after_client_restart() {
    let info = json!({"model_info":{"general.architecture":"test"}});
    let (url, server) = mock(vec![
        ("200 OK", info.clone()),
        ("200 OK", json!({"embeddings":[[1,0]]})),
        ("200 OK", json!({"embeddings":[[1,0]]})),
        ("200 OK", info),
    ]);
    let root = std::env::temp_dir().join(format!(
        "mailboard-vector-test-{}-{}",
        std::process::id(),
        url.split(':').next_back().unwrap()
    ));
    let folders = [Folder {
        key: "/Labor".into(),
        profile: "Laborbedarf".into(),
    }];
    for _ in 0..2 {
        let client = Ollama::new(&url).unwrap().with_cache(root.clone());
        assert_eq!(
            client
                .scores("test", "Interne Nachfrage", &folders, &Default::default())
                .await
                .unwrap()[0]
                .folder,
            "/Labor"
        );
    }
    assert_eq!(server.join().unwrap().len(), 4);
    for entry in std::fs::read_dir(&root).unwrap().flatten() {
        assert_eq!(entry.file_name().to_string_lossy().len(), 64);
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn semantic_holdout_excludes_all_held_out_examples_before_ranking() {
    use mailboard_ollama::cache::{
        holdout, token, EvaluationFolder, Member, SampleIndex, VectorCache,
    };
    let root = std::env::temp_dir().join(format!("mailboard-holdout-test-{}", std::process::id()));
    let cache = VectorCache::new(root.clone());
    let mut folders = Vec::new();
    for (name, own, other) in [("A", [1.0, 0.0], [0.0, 1.0]), ("B", [0.0, 1.0], [1.0, 0.0])] {
        let mut members = Vec::new();
        for i in 0..13 {
            let key = token("local", "model", &format!("{name}{i}"));
            cache.save(&key, if i < 10 { &other } else { &own });
            members.push(Member {
                token: key,
                weight: 1.0,
            });
        }
        folders.push(EvaluationFolder {
            held: (0..10).map(|i| (i, format!("{name}-{i}"))).collect(),
            key: name.into(),
            index: SampleIndex {
                members,
                description: None,
            },
        });
    }
    let result = holdout(&root, &folders, 0.15, 0.78, 0.03);
    assert_eq!(result.tested, 20);
    assert_eq!(result.predictions.len(), 20);
    assert!(result
        .predictions
        .iter()
        .all(|p| p.folder != p.truth && p.id.starts_with(&p.truth)));
    assert_eq!(result.missing, 0);
    assert_eq!(result.plain.shown, 20);
    assert_eq!(result.plain.correct, 0);
    assert!(cache.load("../outside").is_none());
    std::fs::remove_dir_all(root).unwrap();
}

fn unexpected(endpoint: &str) -> Value {
    json!({ "error": format!("Unexpected endpoint or method. ({endpoint})") })
}

#[tokio::test]
async fn lm_studio_only_receives_draft_after_local_model_evidence() {
    let (url, server) = mock(vec![
        ("200 OK", unexpected("POST /api/show")),
        ("200 OK", unexpected("GET /props")),
        (
            "200 OK",
            json!({"data":[
                {"id":"qwen2.5-7b-instruct","type":"llm","compatibility_type":"gguf","state":"not-loaded"},
                {"id":"gpt-remote","type":"llm","compatibility_type":"api"}
            ]}),
        ),
        (
            "200 OK",
            json!({"choices":[{"message":{"content":"{\"antwort\":\"Ich prüfe das.\"}"}}]}),
        ),
    ]);
    assert_eq!(
        Ollama::new(&url)
            .unwrap()
            .reply("qwen2.5-7b-instruct", &mail(), "", "", &[])
            .await
            .unwrap(),
        "Ich prüfe das."
    );
    let reqs = server.join().unwrap();
    for req in &reqs[..3] {
        assert!(!req.contains("Interne Nachfrage"));
    }
    assert!(reqs[2].contains("GET /api/v0/models"));
    assert!(reqs[3].contains("POST /v1/chat/completions") && reqs[3].contains("Interne Nachfrage"));
    // LM Studio verlangt ein Schema statt eines freien JSON-Objekts.
    assert!(reqs[3].contains("json_schema") && !reqs[3].contains("json_object"));
}

#[tokio::test]
async fn lm_studio_models_without_local_weights_do_not_receive_mail() {
    let (url, server) = mock(vec![
        ("200 OK", unexpected("POST /api/show")),
        ("200 OK", unexpected("GET /props")),
        (
            "200 OK",
            json!({"data":[{"id":"gpt-remote","type":"llm","compatibility_type":"api"}]}),
        ),
    ]);
    let err = Ollama::new(&url)
        .unwrap()
        .reply("gpt-remote", &mail(), "", "", &[])
        .await
        .unwrap_err();
    assert!(err.contains("LM-Studio"));
    for req in server.join().unwrap() {
        assert!(!req.contains("Interne Nachfrage"));
    }
}

#[tokio::test]
async fn lm_studio_lists_only_local_models_and_embeds_via_openai_api() {
    let listing = json!({"data":[
        {"id":"nomic-embed-text-v1.5","type":"embeddings","compatibility_type":"gguf"},
        {"id":"mlx-chat","type":"llm","compatibility_type":"mlx"},
        {"id":"lokal:cloud","type":"llm","compatibility_type":"gguf"}
    ]});
    let (url, server) = mock(vec![
        ("200 OK", unexpected("GET /api/tags")),
        ("200 OK", unexpected("GET /props")),
        ("200 OK", listing.clone()),
        ("200 OK", unexpected("POST /api/show")),
        ("200 OK", unexpected("GET /props")),
        ("200 OK", listing),
        ("200 OK", json!({"data":[{"index":0,"embedding":[1,0]}]})),
        ("200 OK", json!({"data":[{"index":1,"embedding":[1,0]},{"index":0,"embedding":[0,1]}]})),
    ]);
    let client = Ollama::new(&url).unwrap();
    assert_eq!(client.models().await.unwrap(), vec!["nomic-embed-text-v1.5", "mlx-chat"]);
    let folders = ["/Orga", "/Labor"].map(|s| Folder {
        key: s.into(),
        profile: String::new(),
    });
    let scores = client
        .scores("nomic-embed-text-v1.5", "Labor", &folders, &Default::default())
        .await
        .unwrap();
    assert_eq!(scores[0].folder, "/Labor");
    let reqs = server.join().unwrap();
    assert!(reqs[6].contains("POST /v1/embeddings"));
}

fn items(texts: &[&str]) -> Vec<Item> {
    texts
        .iter()
        .map(|t| Item {
            id: format!("id-{t}"),
            text: t.to_string(),
        })
        .collect()
}

#[tokio::test]
async fn background_embedding_batches_missing_items_and_reuses_cache() {
    let info = json!({"model_info":{"general.architecture":"test"}});
    let rows = |range: std::ops::Range<usize>| json!({"embeddings":range.map(|i|[i as f64+1.0,1.0]).collect::<Vec<_>>()});
    let (url, server) = mock(vec![
        ("200 OK", info.clone()),
        ("200 OK", rows(0..16)),
        ("200 OK", rows(16..20)),
        ("200 OK", info),
    ]);
    let root = std::env::temp_dir().join(format!(
        "mailboard-embed-test-{}-{}",
        std::process::id(),
        url.split(':').next_back().unwrap()
    ));
    let texts = (0..20).map(|i| format!("Mail-{i:02}")).collect::<Vec<_>>();
    let list = items(&texts.iter().map(String::as_str).collect::<Vec<_>>());
    for expected in [20, 0] {
        let client = Ollama::new(&url).unwrap().with_cache(root.clone());
        assert_eq!(client.embed("test", &list).await.unwrap(), expected);
    }
    let calls = server.join().unwrap();
    assert_eq!(calls.len(), 4);
    assert!(calls[1].contains("POST /api/embed") && calls[1].contains("Mail-15"));
    assert!(!calls[1].contains("Mail-16"));
    assert!(calls[2].contains("Mail-16") && calls[2].contains("Mail-19"));
    assert!(!calls[2].contains("Mail-15"));
    assert!(calls[3].contains("POST /api/show") && !calls[3].contains("Mail-"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn rank_sorts_items_by_similarity_to_query() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"test"}}),
        ),
        ("200 OK", json!({"embeddings":[[1,0],[0,1],[1,0],[1,1]]})),
    ]);
    let ranked = Ollama::new(&url)
        .unwrap()
        .rank(
            "test",
            "Pipetten",
            &items(&["Urlaub", "Pipettenspitzen", "Labor"]),
        )
        .await
        .unwrap();
    let ids = ranked.iter().map(|s| s.id.as_str()).collect::<Vec<_>>();
    assert_eq!(ids, ["id-Pipettenspitzen", "id-Labor", "id-Urlaub"]);
    assert!((ranked[0].score - 1.0).abs() < 1e-9 && ranked[2].score.abs() < 1e-9);
    assert!(server.join().unwrap()[1].contains("Pipetten"));
}

#[tokio::test]
async fn groups_return_best_group_with_margin_to_second() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"test"}}),
        ),
        (
            "200 OK",
            json!({"embeddings":[[1,0],[1,0.2],[0,1],[1,0.1],[0.2,1]]}),
        ),
    ]);
    let groups = [
        Group {
            name: "Labor".into(),
            items: items(&["Proben", "Messung"]),
        },
        Group {
            name: "Leer".into(),
            items: vec![],
        },
        Group {
            name: "Personal".into(),
            items: items(&["Urlaub"]),
        },
    ];
    let matches = Ollama::new(&url)
        .unwrap()
        .groups("test", &groups, &items(&["Probenversand", "Urlaubsantrag"]))
        .await
        .unwrap();
    assert_eq!(matches.len(), 2);
    assert_eq!(
        (matches[0].id.as_str(), matches[0].best.as_str()),
        ("id-Probenversand", "Labor")
    );
    assert_eq!(matches[1].best, "Personal");
    for m in &matches {
        assert!(m.margin > 0.5 && m.margin < m.score);
    }
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn embedding_index_refuses_cloud_and_remote_models() {
    let list = items(&["Interne Nachfrage"]);
    let group = [Group {
        name: "Labor".into(),
        items: list.clone(),
    }];
    let (url, server) = mock(vec![]);
    let client = Ollama::new(&url).unwrap();
    assert!(client.embed("embed:cloud", &list).await.is_err());
    assert!(client.rank("embed:cloud", "Labor", &list).await.is_err());
    assert!(client.groups("embed:cloud", &group, &list).await.is_err());
    assert!(server.join().unwrap().is_empty());
    let remote = json!({"model_info":{"general.architecture":"x"},"remote_host":"https://elsewhere.invalid"});
    let (url, server) = mock(vec![
        ("200 OK", remote.clone()),
        ("200 OK", remote.clone()),
        ("200 OK", remote),
    ]);
    let client = Ollama::new(&url).unwrap();
    assert!(client.embed("alias", &list).await.is_err());
    assert!(client.rank("alias", "Labor", &list).await.is_err());
    assert!(client.groups("alias", &group, &list).await.is_err());
    let calls = server.join().unwrap();
    assert_eq!(calls.len(), 3);
    for call in calls {
        assert!(call.contains("POST /api/show") && !call.contains("Interne Nachfrage"));
    }
}

#[tokio::test]
async fn outliers_compare_own_profile_without_mail_to_best_foreign_profile() {
    let info = json!({"model_info":{"general.architecture":"test"}});
    let (url, server) = mock(vec![
        ("200 OK", info.clone()),
        (
            "200 OK",
            json!({"embeddings":[[1,0],[1,0.1],[0,1],[0,1],[0.1,1],[-1,0]]}),
        ),
        ("200 OK", info.clone()),
        ("200 OK", info),
    ]);
    let root = std::env::temp_dir().join(format!(
        "mailboard-outlier-test-{}-{}",
        std::process::id(),
        url.split(':').next_back().unwrap()
    ));
    let folder = |key: &str, texts: &[&str]| mailboard_ollama::index::Folder {
        key: key.into(),
        items: items(texts),
    };
    let folders = [
        folder("Labor", &["Proben", "Messung", "Urlaubsantrag Labor"]),
        folder("Personal", &["Urlaub", "Krankmeldung"]),
        folder("Einzeln", &["Einzelstück"]),
        folder("/_Alt", &["Urlaub alt"]),
    ];
    let client = Ollama::new(&url).unwrap().with_cache(root.clone());
    let found = client.outliers("test", &folders, 0.78, 0.05).await.unwrap();
    assert_eq!(found.len(), 1, "{found:?}");
    let Outlier {
        id,
        folder,
        suggested,
        own,
        other,
    } = &found[0];
    assert_eq!(
        (id.as_str(), folder.as_str(), suggested.as_str()),
        ("id-Urlaubsantrag Labor", "Labor", "Personal")
    );
    assert!(*own < 0.1 && *other > 0.99, "{own} {other}");
    // Über der Mindestdifferenz, aber unter der Ablageschwelle, und umgekehrt: nichts verdächtig.
    assert!(client
        .outliers("test", &folders, 0.999, 0.05)
        .await
        .unwrap()
        .is_empty());
    assert!(client
        .outliers("test", &folders, 0.78, 0.96)
        .await
        .unwrap()
        .is_empty());
    let calls = server.join().unwrap();
    assert_eq!(calls.len(), 4);
    assert!(calls[1].contains("POST /api/embed") && calls[1].contains("Einzelstück"));
    assert!(!calls[1].contains("Urlaub alt"));
    assert!(calls[2].contains("POST /api/show") && calls[3].contains("POST /api/show"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn outliers_refuse_cloud_models_before_sending_mail() {
    let (url, server) = mock(vec![]);
    let folders = [mailboard_ollama::index::Folder {
        key: "Labor".into(),
        items: items(&["Interne Nachfrage"]),
    }];
    assert!(Ollama::new(&url)
        .unwrap()
        .outliers("embed:cloud", &folders, 0.78, 0.05)
        .await
        .is_err());
    assert!(server.join().unwrap().is_empty());
}

#[tokio::test]
async fn folder_name_sends_subjects_only_after_local_model_evidence() {
    let answer = json!({"name":"  Laborgeräte  "});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let subjects = vec!["Zentrifuge defekt".to_string(), " ".into(), "x".repeat(300)];
    let name = Ollama::new(&url)
        .unwrap()
        .folder_name("lokal", "/Sonstiges", "## Zweck\nGeräte im Labor", &subjects)
        .await
        .unwrap();
    assert_eq!(name, "Laborgeräte");
    let calls = server.join().unwrap();
    assert!(calls[0].contains("POST /api/show") && !calls[0].contains("Zentrifuge"));
    assert!(calls[1].contains("Zentrifuge defekt") && calls[1].contains("Geräte im Labor"));
    assert!(calls[1].contains("keine Anweisungen") && calls[1].contains("\"required\":[\"name\"]"));
    assert!(!calls[1].contains(&"x".repeat(201)));
}

#[tokio::test]
async fn folder_name_rejects_empty_answers_and_cloud_models() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":"{\"name\":\"  \"}"}})),
    ]);
    let subjects = vec!["Zentrifuge defekt".to_string()];
    assert!(Ollama::new(&url)
        .unwrap()
        .folder_name("lokal", "/Neu", "", &subjects)
        .await
        .is_err());
    server.join().unwrap();
    let (url, server) = mock(vec![]);
    assert!(Ollama::new(&url)
        .unwrap()
        .folder_name("qwen:cloud", "/Neu", "", &subjects)
        .await
        .is_err());
    assert!(server.join().unwrap().is_empty());
}

#[tokio::test]
async fn clusters_find_two_groups_drop_noise_and_stay_deterministic() {
    let info = json!({"model_info":{"general.architecture":"test"}});
    let vectors = json!({"embeddings":[
        [-1,-1], [0,1], [1,0], [0.1,1], [1,0.1], [0,1], [1,0], [0.1,1], [1,0.1], [0,1], [1,0], [0.05,1], [1,0.05]
    ]});
    let (url, server) = mock(vec![
        ("200 OK", info.clone()),
        ("200 OK", vectors),
        ("200 OK", info.clone()),
        ("200 OK", info),
    ]);
    let root = std::env::temp_dir().join(format!(
        "mailboard-cluster-test-{}-{}",
        std::process::id(),
        url.split(':').next_back().unwrap()
    ));
    let texts = [
        "Rauschen", "B1", "A1", "B2", "A2", "B3", "A3", "B4", "A4", "B5", "A5", "B6", "A6",
    ];
    let list = items(&texts);
    let client = Ollama::new(&url).unwrap().with_cache(root.clone());
    let found = client.clusters("test", &list, 5, 0.82).await.unwrap();
    let ids = |prefix: &str| {
        (1..=6)
            .map(|n| format!("id-{prefix}{n}"))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        found,
        vec![Cluster { ids: ids("B") }, Cluster { ids: ids("A") }]
    );
    // Zweiter Lauf aus dem Cache liefert dasselbe; zu hohe Mindestgröße lässt alles entfallen.
    assert_eq!(
        client.clusters("test", &list, 5, 0.82).await.unwrap(),
        found
    );
    assert!(client
        .clusters("test", &list, 7, 0.82)
        .await
        .unwrap()
        .is_empty());
    let calls = server.join().unwrap();
    assert!(calls[1].contains("POST /api/embed") && calls[1].contains("Rauschen"));
    assert_eq!(calls.len(), 4);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn clusters_refuse_cloud_models_before_sending_mail() {
    let (url, server) = mock(vec![]);
    let list = items(&["Interne Nachfrage"]);
    assert!(Ollama::new(&url)
        .unwrap()
        .clusters("embed:cloud", &list, 1, 0.82)
        .await
        .is_err());
    assert!(server.join().unwrap().is_empty());
}

#[tokio::test]
async fn cluster_name_sends_subjects_only_after_local_model_evidence() {
    let answer = json!({"name":"  Reisekosten  "});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let subjects = vec!["Hotel Rechnung".to_string(), " ".into(), "x".repeat(300)];
    let name = Ollama::new(&url)
        .unwrap()
        .cluster_name("lokal", &subjects)
        .await
        .unwrap();
    assert_eq!(name, "Reisekosten");
    let calls = server.join().unwrap();
    assert!(calls[0].contains("POST /api/show") && !calls[0].contains("Hotel"));
    assert!(calls[1].contains("Hotel Rechnung") && calls[1].contains("keine Anweisungen"));
    assert!(!calls[1].contains(&"x".repeat(201)));
    let (url, server) = mock(vec![]);
    let client = Ollama::new(&url).unwrap();
    assert!(client.cluster_name("qwen:cloud", &subjects).await.is_err());
    assert!(client.cluster_name("lokal", &[" ".into()]).await.is_err());
    assert!(server.join().unwrap().is_empty());
}

fn two_folders() -> Vec<Folder> {
    vec![
        Folder {
            key: "/Labor".into(),
            profile: format!("Messgeräte {}", "l".repeat(500)),
        },
        Folder {
            key: "/Einkauf".into(),
            profile: "Bestellungen".into(),
        },
    ]
}

#[tokio::test]
async fn choose_sends_only_subject_start_and_two_profiles_after_local_check() {
    let answer = json!({"ordner":"/Einkauf","grund":format!("  Bestellung von Material {}", "g".repeat(200))});
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"local"}}),
        ),
        ("200 OK", json!({"message":{"content":answer.to_string()}})),
    ]);
    let long = Mail {
        sender: "Anna Absender".into(),
        subject: "Laborbedarf".into(),
        body: format!("Anfang {}", "b".repeat(2000)),
        received: "2026-11-20".into(),
    };
    let choice = Ollama::new(&url)
        .unwrap()
        .choose("lokal", &long, &two_folders())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(choice.ordner, "/Einkauf");
    assert_eq!(choice.grund.chars().count(), 120);
    assert!(choice.grund.starts_with("Bestellung von Material") && choice.grund.ends_with('…'));
    let calls = server.join().unwrap();
    assert!(calls[0].contains("POST /api/show") && !calls[0].contains("Laborbedarf"));
    let chat = &calls[1];
    assert!(chat.contains("POST /api/chat") && chat.contains("Datenmaterial"));
    assert!(chat.contains("Laborbedarf") && chat.contains("Bestellungen"));
    // Mailanfang höchstens 1.000 Zeichen, Steckbrief höchstens 400, kein Absender.
    assert!(chat.contains(&"b".repeat(990)) && !chat.contains(&"b".repeat(1000)));
    assert!(chat.contains(&"l".repeat(380)) && !chat.contains(&"l".repeat(400)));
    assert!(!chat.contains("Anna Absender"));
    assert!(chat.contains("\"num_predict\":256") && chat.contains("\"enum\""));
    // Ohne die Fähigkeit „thinking“ bekommt Ollama kein `think`.
    assert!(!chat.contains("\"think\""));
}

#[tokio::test]
async fn choose_turns_off_thinking_for_thinking_models() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"capabilities":["completion","thinking"],"model_info":{"general.architecture":"qwen3"}}),
        ),
        (
            "200 OK",
            json!({"message":{"content":"{\"ordner\":\"/Labor\",\"grund\":\"Messgerät\"}"}}),
        ),
    ]);
    let choice = Ollama::new(&url)
        .unwrap()
        .choose("qwen3:8b", &mail(), &two_folders())
        .await
        .unwrap();
    assert_eq!(choice.unwrap().ordner, "/Labor");
    let calls = server.join().unwrap();
    assert!(calls[1].contains("\"think\":false"), "{}", calls[1]);
}

#[tokio::test]
async fn choose_ignores_answers_outside_the_two_candidates() {
    for answer in [
        json!({"ordner":"/Personal","grund":"passt besser"}),
        json!({"ordner":null,"grund":"unklar"}),
    ] {
        let (url, server) = mock(vec![
            (
                "200 OK",
                json!({"model_info":{"general.architecture":"local"}}),
            ),
            ("200 OK", json!({"message":{"content":answer.to_string()}})),
        ]);
        let choice = Ollama::new(&url)
            .unwrap()
            .choose("lokal", &mail(), &two_folders())
            .await
            .unwrap();
        assert!(choice.is_none());
        server.join().unwrap();
    }
}

#[tokio::test]
async fn choose_refuses_cloud_models_and_wrong_candidate_lists_before_sending_mail() {
    let (url, server) = mock(vec![]);
    let client = Ollama::new(&url).unwrap();
    assert!(client.choose("qwen:cloud", &mail(), &two_folders()).await.is_err());
    let mut three = two_folders();
    three.push(Folder {
        key: "/Personal".into(),
        profile: String::new(),
    });
    assert!(client.choose("lokal", &mail(), &three).await.is_err());
    assert!(client.choose("lokal", &mail(), &two_folders()[..1]).await.is_err());
    assert!(server.join().unwrap().is_empty());
}

#[tokio::test]
async fn choose_limits_tokens_on_openai_compatible_servers() {
    let (url, server) = mock(vec![
        ("404 Not Found", Value::Null),
        (
            "200 OK",
            json!({"model_path":"C:/Models/lokal.gguf","default_generation_settings":{"n_ctx":4096}}),
        ),
        ("200 OK", json!({"data":[{"id":"lokal"}]})),
        (
            "200 OK",
            json!({"choices":[{"message":{"content":"{\"ordner\":\"/Labor\",\"grund\":\"Messgerät\"}"}}]}),
        ),
    ]);
    let choice = Ollama::new(&url)
        .unwrap()
        .choose("lokal", &mail(), &two_folders())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(choice.ordner, "/Labor");
    let calls = server.join().unwrap();
    assert!(calls[3].contains("POST /v1/chat/completions") && calls[3].contains("\"max_tokens\":256"));
}

#[tokio::test]
async fn model_info_reads_ollama_show_and_ps() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"details":{"parameter_size":"8.0B","quantization_level":"Q4_K_M"},
                "model_info":{"general.architecture":"llama","llama.context_length":8192}}),
        ),
        (
            "200 OK",
            json!({"models":[{"name":"anderes:7b","size":10,"size_vram":10},
                {"name":"lokal:latest","model":"lokal:latest","size":8000,"size_vram":6000,"context_length":4096}]}),
        ),
    ]);
    let info = Ollama::new(&url).unwrap().model_info("lokal").await.unwrap();
    assert_eq!(info.parameters, Some(8e9));
    assert_eq!(info.quantization.as_deref(), Some("Q4_K_M"));
    assert_eq!(info.context, Some(8192));
    assert_eq!(info.loaded, Some(true));
    assert_eq!(info.loaded_context, Some(4096));
    assert_eq!(info.gpu, Some(0.75));
    let calls = server.join().unwrap();
    assert!(calls[0].contains("POST /api/show"));
    assert!(calls[1].contains("GET /api/ps"));
}

#[tokio::test]
async fn model_info_omits_missing_details_and_reports_unloaded_models() {
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"llama","general.parameter_count":4022468096u64}}),
        ),
        ("200 OK", json!({"models":[]})),
    ]);
    let info = Ollama::new(&url).unwrap().model_info("lokal").await.unwrap();
    assert_eq!(info.parameters, Some(4022468096.0));
    assert_eq!(info.quantization, None);
    assert_eq!(info.context, None);
    assert_eq!(info.loaded, Some(false));
    assert_eq!(info.gpu, None);
    let value = serde_json::to_value(&info).unwrap();
    assert!(value.get("quantization").is_none() && value.get("gpu").is_none());
    server.join().unwrap();
    // Ein fehlendes /api/ps ist kein Fehler.
    let (url, server) = mock(vec![
        (
            "200 OK",
            json!({"model_info":{"general.architecture":"llama"}}),
        ),
        ("404 Not Found", Value::Null),
    ]);
    let info = Ollama::new(&url).unwrap().model_info("lokal").await.unwrap();
    assert_eq!(info.loaded, None);
    server.join().unwrap();
}

#[tokio::test]
async fn model_info_refuses_remote_models() {
    let (url, server) = mock(vec![(
        "200 OK",
        json!({"remote_host":"https://elsewhere.invalid","model_info":{"x":1}}),
    )]);
    assert!(Ollama::new(&url).unwrap().model_info("alias").await.is_err());
    assert_eq!(server.join().unwrap().len(), 1);
    let (url, server) = mock(vec![]);
    assert!(Ollama::new(&url).unwrap().model_info("qwen:cloud").await.is_err());
    assert!(server.join().unwrap().is_empty());
}

#[tokio::test]
async fn model_info_for_lm_studio_and_llama_cpp() {
    let listing = json!({"data":[
        {"id":"qwen2.5-7b-instruct","type":"llm","compatibility_type":"gguf","quantization":"Q4_K_M","state":"loaded","max_context_length":32768}
    ]});
    let (url, server) = mock(vec![
        ("200 OK", unexpected("POST /api/show")),
        ("200 OK", unexpected("GET /props")),
        ("200 OK", listing.clone()),
        ("200 OK", listing),
    ]);
    let info = Ollama::new(&url)
        .unwrap()
        .model_info("qwen2.5-7b-instruct")
        .await
        .unwrap();
    assert_eq!(info.quantization.as_deref(), Some("Q4_K_M"));
    assert_eq!(info.context, Some(32768));
    assert_eq!(info.loaded, Some(true));
    assert_eq!(info.gpu, None);
    server.join().unwrap();
    let props = json!({"model_path":"C:/Models/Qwen2.5-7B-Instruct-Q5_K_M.gguf","default_generation_settings":{"n_ctx":4096}});
    let models = json!({"data":[{"id":"lokal","meta":{"n_params":7615616512u64,"n_ctx_train":32768}}]});
    let (url, server) = mock(vec![
        ("404 Not Found", Value::Null),
        ("200 OK", props.clone()),
        ("200 OK", models.clone()),
        ("200 OK", props),
        ("200 OK", models),
    ]);
    let info = Ollama::new(&url).unwrap().model_info("lokal").await.unwrap();
    assert_eq!(info.quantization.as_deref(), Some("Q5_K_M"));
    assert_eq!(info.loaded_context, Some(4096));
    assert_eq!(info.context, Some(32768));
    assert_eq!(info.parameters, Some(7615616512.0));
    assert_eq!(info.loaded, Some(true));
    server.join().unwrap();
}

#[tokio::test]
async fn uninstalled_ollama_model_is_named_as_such() {
    let (url, server) = mock(vec![(
        "404 Not Found",
        json!({"error":"model 'fehlt:7b' not found"}),
    )]);
    let err = Ollama::new(&url).unwrap().model_info("fehlt:7b").await.unwrap_err();
    assert_eq!(err, "Modell „fehlt:7b“ ist in Ollama nicht installiert.");
    // Keine weiteren Anfragen an /props oder LM Studio.
    assert_eq!(server.join().unwrap().len(), 1);
    let (url, server) = mock(vec![(
        "404 Not Found",
        json!({"error":"model 'fehlt:7b' not found"}),
    )]);
    assert!(Ollama::new(&url)
        .unwrap()
        .reply("fehlt:7b", &mail(), "", "", &[])
        .await
        .unwrap_err()
        .contains("nicht installiert"));
    server.join().unwrap();
}

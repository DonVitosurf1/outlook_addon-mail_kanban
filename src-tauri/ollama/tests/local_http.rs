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
        .reply("alias", &mail(), "")
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
            .reply("lokal", &mail(), "")
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
        .reply("alias", &mail(), "")
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
            .reply("qwen2.5-7b-instruct", &mail(), "")
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
        .reply("gpt-remote", &mail(), "")
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

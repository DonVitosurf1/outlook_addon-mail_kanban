use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build();
    let helper = "../outlook-test/Mail-Board-Outlook.exe";
    println!("cargo:rerun-if-changed={helper}");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let profile = out.ancestors().find(|dir| dir.file_name().is_some_and(|name| name == "build")).and_then(|dir| dir.parent()).expect("Cargo-Profilverzeichnis");
    // Der Helfer entsteht mit `npm run helper` (nur unter Windows). Ohne ihn baut die App trotzdem,
    // findet dann aber kein Outlook. `npm run portable` baut ihn immer zuerst.
    if std::path::Path::new(helper).exists() {
        fs::copy(helper, profile.join("Mail-Board-Outlook.exe")).expect("Outlook-Helfer kopieren");
    } else {
        println!("cargo:warning=Outlook-Helfer fehlt ({helper}). Unter Windows zuerst `npm run helper` ausführen.");
    }
}

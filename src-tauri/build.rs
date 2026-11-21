use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build();
    let helper = "../outlook-test/Mail-Board-Outlook.exe";
    println!("cargo:rerun-if-changed={helper}");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let profile = out.ancestors().find(|dir| dir.file_name().is_some_and(|name| name == "build")).and_then(|dir| dir.parent()).expect("Cargo-Profilverzeichnis");
    fs::copy(helper, profile.join("Mail-Board-Outlook.exe")).expect("Outlook-Helfer kopieren");
}

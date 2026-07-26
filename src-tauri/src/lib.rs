mod engine;
mod error;
mod export;
mod importers;
mod lan;
mod model;
mod ollama_client;
mod store;
mod types;

use engine::ProfilerEngine;
use error::AppError;
use store::{ProfilerStore, migrate_legacy_data};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, State};
use types::{
    AppSettings, AppSettingsPatch, ImportCommitOptions, ImportCommitResult, ImportPreview,
    ProfilerSnapshot, ServerExportOptions, ServerExportResult,
};

type CommandResult<T> = Result<T, String>;

#[tauri::command]
fn get_snapshot(engine: State<'_, ProfilerEngine>) -> CommandResult<ProfilerSnapshot> {
    engine.get_snapshot().map_err(command_error)
}

#[tauri::command]
fn preview_file(
    engine: State<'_, ProfilerEngine>,
    file_path: String,
) -> CommandResult<ImportPreview> {
    engine.preview_file(file_path).map_err(command_error)
}

#[tauri::command]
fn preview_text(
    engine: State<'_, ProfilerEngine>,
    contents: String,
) -> CommandResult<ImportPreview> {
    engine.preview_text(contents).map_err(command_error)
}

#[tauri::command]
fn commit_import(
    engine: State<'_, ProfilerEngine>,
    options: ImportCommitOptions,
) -> CommandResult<ImportCommitResult> {
    engine.commit_import(options).map_err(command_error)
}

#[tauri::command]
fn test_localhost(engine: State<'_, ProfilerEngine>) -> CommandResult<String> {
    engine.test_localhost().map_err(command_error)
}

#[tauri::command]
fn scan_local_network(engine: State<'_, ProfilerEngine>) -> CommandResult<String> {
    engine.scan_local_network().map_err(command_error)
}

#[tauri::command]
fn profile_all_servers(engine: State<'_, ProfilerEngine>) -> CommandResult<String> {
    engine.profile_all_servers().map_err(command_error)
}

#[tauri::command]
fn set_benchmark_approval(
    engine: State<'_, ProfilerEngine>,
    server_id: String,
    approved: bool,
) -> CommandResult<()> {
    engine
        .set_benchmark_approval(server_id, approved)
        .map_err(command_error)
}

#[tauri::command]
fn update_settings(
    engine: State<'_, ProfilerEngine>,
    settings: AppSettingsPatch,
) -> CommandResult<AppSettings> {
    engine.update_settings(settings).map_err(command_error)
}

#[tauri::command]
fn remove_server(engine: State<'_, ProfilerEngine>, server_id: String) -> CommandResult<()> {
    engine.remove_server(server_id).map_err(command_error)
}

#[tauri::command]
fn remove_servers(engine: State<'_, ProfilerEngine>, server_ids: Vec<String>) -> CommandResult<()> {
    engine.remove_servers(server_ids).map_err(command_error)
}

#[tauri::command]
fn export_servers(
    engine: State<'_, ProfilerEngine>,
    options: ServerExportOptions,
    file_path: String,
) -> CommandResult<ServerExportResult> {
    engine
        .export_servers(options, file_path)
        .map_err(command_error)
}

fn command_error(error: AppError) -> String {
    error.to_string()
}

fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    let import = MenuItemBuilder::with_id("import", "Import Discovery File…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let overview = MenuItemBuilder::with_id("overview", "Overview")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let servers = MenuItemBuilder::with_id("servers", "Servers")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let local = MenuItemBuilder::with_id("local", "Local Discovery")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&import)
        .separator()
        .close_window()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .items(&[&overview, &servers, &local])
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(app, "Ollama Profiler")
            .about(None)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
            .build()?
    };
    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &window_menu, &settings])
        .quit()
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let target = match event.id().as_ref() {
            "import" => Some("imports"),
            "settings" => Some("settings"),
            "overview" => Some("overview"),
            "servers" => Some("servers"),
            "local" => Some("local"),
            _ => None,
        };
        if let Some(target) = target {
            let _ = app.emit("profiler:navigate", target);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let store_path = migrate_legacy_data(&app_data_dir)?;
            let store = ProfilerStore::load(store_path)?;
            let engine = ProfilerEngine::new(app.handle().clone(), store);
            engine.start_monitoring();
            app.manage(engine);
            install_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            preview_file,
            preview_text,
            commit_import,
            test_localhost,
            scan_local_network,
            profile_all_servers,
            set_benchmark_approval,
            update_settings,
            remove_server,
            remove_servers,
            export_servers
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Ollama Profiler")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                app.state::<ProfilerEngine>().shutdown();
            }
        });
}

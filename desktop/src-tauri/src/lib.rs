use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

const PORT: &str = "3141";

/// The one thing this whole app manages: the Next.js server's own child process. Killing it is
/// how "Quit" ends the app's actual work -- there is no separate background service (no
/// launchd agent, no second process tree) for this to leak into once the window closes.
struct ServerProcess(Mutex<Option<Child>>);

/// Guards `start_bringup` against running twice: both `frontend_ready` (the normal path) and the
/// setup watchdog (in case the webview never loads) can call it, and only the first call should
/// actually do anything -- a second would race the first to install the code directory and spawn
/// a second server fighting the first one for the same port.
struct BringupStarted(Mutex<bool>);

/// `dist/index.html`'s own loading screen listens for these two events: `setup-log` appends a
/// line to what it shows while `prepare` and the server start up, `setup-ready` is the signal to
/// navigate the window to the real app once the server answers.
fn emit_log(app: &AppHandle, line: impl AsRef<str>) {
    let _ = app.emit("setup-log", line.as_ref());
    log::info!("{}", line.as_ref());
}

/// Where the *code* (the standalone server build, brain.sh, the migrations it needs) lives --
/// deliberately not the data directory (`~/Library/Application Support/second-brain/`, brain.sh's
/// own default): code and data are two different things this app should never conflate, the same
/// rule `set-data-dir` exists to enforce for the CLI-managed install.
fn code_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("current")
}

/// Copies the bundled resources (the standalone server build and brain.sh) into `code_dir` the
/// first time this app runs, or whenever the bundled version is newer than what is already
/// there. Nothing here touches the data directory or any model -- that is `brain.sh prepare`'s
/// job, run after this returns.
fn ensure_code_installed(app: &AppHandle) -> std::io::Result<PathBuf> {
    let dest = code_dir(app);
    let marker = dest.join(".version");
    let bundled_version = app.package_info().version.to_string();
    let already_current = std::fs::read_to_string(&marker)
        .map(|v| v.trim() == bundled_version)
        .unwrap_or(false);
    if already_current && dest.join("server.js").exists() {
        return Ok(dest);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("resource dir")
        .join("server");
    if dest.exists() {
        std::fs::remove_dir_all(&dest)?;
    }
    copy_dir_recursive(&resource_dir, &dest)?;
    std::fs::write(&marker, &bundled_version)?;
    Ok(dest)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if file_type.is_symlink() {
            // The standalone build symlinks Next's own bundled node_modules packages back into
            // node_modules/.bin and similar; a plain copy would just recreate an equally valid
            // symlink's *target* file instead of failing on it.
            if let Ok(real) = std::fs::read_link(entry.path()) {
                let _ = std::fs::copy(src.join(&real), &target);
            }
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Runs `scripts/brain.sh prepare` (Homebrew's llama.cpp, every model, the Swift helper and
/// recorder -- everything `cmd_setup` does except building the app and installing a launch
/// agent, since this app is already built and owns its own process instead) from the freshly
/// installed code directory, streaming each line to the loading screen as it happens rather than
/// waiting silently for the whole thing to finish.
fn run_prepare(app: &AppHandle, dir: &Path) -> std::io::Result<bool> {
    emit_log(app, "Checking dependencies and models (this can take a while the first time)...");
    let mut child = Command::new("bash")
        .arg("scripts/brain.sh")
        .arg("prepare")
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                emit_log(&app, line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                emit_log(&app, line);
            }
        });
    }
    let status = child.wait()?;
    Ok(status.success())
}

/// A GUI-launched app (double-clicked from Finder / opened at login) inherits `launchd`'s minimal
/// `PATH`, not the user's shell `PATH` -- so a `node` installed via nvm, Homebrew, or similar (all
/// of which only extend `PATH` from shell startup files like `.zshrc`) is invisible to us even
/// though it works fine from Terminal. Both `brain.sh`'s own `command -v node` check and our own
/// `node server.js` spawn below would fail identically without this. Resolve the user's real PATH
/// once, by asking their actual login shell for it (`-ilc`, not just `-lc`: nvm's installer adds
/// its `PATH` line to `.zshrc`, which only an *interactive* shell sources), and adopt it for the
/// rest of this process so every child process we spawn inherits it.
fn adopt_user_shell_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    const START: &str = "__SB_PATH_START__";
    const END: &str = "__SB_PATH_END__";
    let output = Command::new(&shell)
        .arg("-ilc")
        .arg(format!("echo {START}$PATH{END}"))
        .stdin(Stdio::null())
        .output();
    let mut path = std::env::var("PATH").unwrap_or_default();
    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(start) = stdout.find(START) {
            let rest = &stdout[start + START.len()..];
            if let Some(end) = rest.find(END) {
                let resolved = rest[..end].trim();
                if !resolved.is_empty() {
                    path = resolved.to_string();
                }
            }
        }
    }
    // Belt and suspenders: a broken shell startup file (a bad plugin, a failing update check
    // that `exit`s early) can make the resolution above come back empty or short. Directly check
    // the handful of places Node actually lives on a Mac and append any that exist and aren't
    // already covered, rather than depending entirely on shell startup succeeding cleanly.
    for extra in common_node_dirs() {
        if !path.split(':').any(|p| p == extra) {
            path = format!("{path}:{extra}");
        }
    }
    std::env::set_var("PATH", path);
}

fn common_node_dirs() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut candidates = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    if !home.is_empty() {
        // nvm doesn't symlink a stable "current" path -- each version gets its own directory, so
        // pick the newest installed one rather than needing to parse its alias/default file.
        let nvm_versions = Path::new(&home).join(".nvm/versions/node");
        if let Ok(mut versions) = std::fs::read_dir(&nvm_versions).map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .collect::<Vec<_>>()
        }) {
            versions.sort();
            if let Some(latest) = versions.last() {
                candidates.push(latest.join("bin").to_string_lossy().to_string());
            }
        }
        candidates.push(format!("{home}/.volta/bin"));
        candidates.push(format!("{home}/.fnm"));
    }
    candidates
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .collect()
}

fn port_is_open(port: &str) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().expect("valid addr"),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// Spawns the standalone server as this app's own child process -- not through launchd, not
/// detached: `ServerProcess` holds the handle for as long as the app runs, and Quit kills it by
/// that handle rather than leaving it to keep running on its own.
fn spawn_server(app: &AppHandle, dir: &Path) -> std::io::Result<Child> {
    emit_log(app, "Starting the server...");
    Command::new("node")
        .arg("server.js")
        .current_dir(dir)
        .env("PORT", PORT)
        .env("HOSTNAME", "127.0.0.1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Everything from "get the code onto disk" to "the server answers" -- run only once the
/// frontend has confirmed it is actually listening (see `frontend_ready` below), never from
/// `setup()` directly: that races the webview's own page load, and a `setup-log`/`setup-ready`
/// event emitted before `dist/index.html`'s `listen()` calls have registered is simply gone --
/// Tauri does not buffer events for a listener that shows up late. Found this the hard way: the
/// very first end-to-end run sat on "Starting." forever despite the Rust side finishing cleanly.
fn start_bringup(handle: AppHandle) {
    {
        let state = handle.state::<BringupStarted>();
        let mut started = state.0.lock().unwrap();
        if *started {
            return;
        }
        *started = true;
    }
    std::thread::spawn(move || {
        let dir = match ensure_code_installed(&handle) {
            Ok(dir) => dir,
            Err(e) => {
                emit_log(&handle, format!("Could not install the app's files: {e}"));
                return;
            }
        };

        if !port_is_open(PORT) {
            match run_prepare(&handle, &dir) {
                Ok(true) => {}
                Ok(false) => {
                    emit_log(&handle, "Setup reported a problem -- check the log above. Trying to start the server anyway.");
                }
                Err(e) => emit_log(&handle, format!("Could not run setup: {e}")),
            }

            match spawn_server(&handle, &dir) {
                Ok(child) => {
                    handle.state::<ServerProcess>().0.lock().unwrap().replace(child);
                }
                Err(e) => {
                    emit_log(&handle, format!("Could not start the server: {e}"));
                    return;
                }
            }
        }

        emit_log(&handle, "Waiting for the server to answer...");
        for _ in 0..600 {
            if port_is_open(PORT) {
                let _ = handle.emit("setup-ready", format!("http://127.0.0.1:{PORT}"));
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        emit_log(&handle, "The server did not answer within 5 minutes. Check the log above.");
    });
}

/// Called by `dist/index.html` the instant its `listen()` calls are registered -- the handshake
/// that makes the ordering above safe instead of hopeful.
#[tauri::command]
fn frontend_ready(app: AppHandle) {
    start_bringup(app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    adopt_user_shell_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch (double-clicking the app again, or a login-item relaunch racing
            // one already running) means "bring the existing window forward", never a second
            // server process fighting the first one for the same port.
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(ServerProcess(Mutex::new(None)))
        .manage(BringupStarted(Mutex::new(false)))
        .setup(|app| {
            let handle = app.handle().clone();

            let open_item = MenuItem::with_id(app, "open", "Open Second Brain", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // The autostart plugin manages its own login-item registration; enabling it here
            // (rather than leaving it off until asked) matches the always-on behaviour the
            // CLI-managed launchd install already has -- the whole point of owning the process
            // directly instead of quitting when the window closes.
            use tauri_plugin_autostart::ManagerExt;
            let _ = app.autolaunch().enable();

            // A watchdog, not the primary trigger: `frontend_ready` (called from dist/index.html)
            // is what normally starts bringup, right after the page's listeners are registered.
            // This just guards against a webview that never finishes loading for some reason,
            // so the app doesn't sit doing nothing forever with no log line to explain why.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                start_bringup(handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![frontend_ready])
        .on_window_event(|window, event| {
            // Closing the window is not quitting the app: the server (and, once minimised,
            // activity tracking and auto-recording) keeps running from the tray, exactly the
            // always-on behaviour the CLI-managed launchd install already has -- just owned by
            // this one process instead of a second, independent one.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}

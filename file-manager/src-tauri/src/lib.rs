use chrono::{DateTime, Local};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub extension: String,
}

#[derive(Serialize)]
pub struct DirListing {
    pub path: String,
    pub label: String,
    pub files: Vec<FileEntry>,
    pub file_count: usize,
    pub folder_count: usize,
}

#[derive(Serialize)]
pub struct QuickAccessItem {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub file_count: usize,
    pub folder_count: usize,
}

#[derive(Serialize)]
pub struct PreviewData {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: String,
    pub modified: String,
    pub extension: String,
    pub content: String,
    pub children: Vec<FileEntry>,
}

fn format_time(time: SystemTime) -> String {
    match time.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs() as i64;
            if let Some(dt) = DateTime::<Local>::from_timestamp(secs, 0) {
                dt.format("%b %d, %Y %H:%M").to_string()
            } else {
                "Unknown".to_string()
            }
        }
        Err(_) => "Unknown".to_string(),
    }
}

fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{:.1} {}", size, UNITS[unit])
    }
}

fn entry_from_path(path: &Path) -> Option<FileEntry> {
    let meta = fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let extension = if meta.is_dir() {
        String::new()
    } else {
        path.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    };
    let modified = meta
        .modified()
        .map(format_time)
        .unwrap_or_else(|_| "Unknown".to_string());

    Some(FileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
        extension,
    })
}

fn list_directory(path: &Path, label: &str) -> Result<DirListing, String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    let mut entries: Vec<FileEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| entry_from_path(&e.path()))
        .collect();

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    let folder_count = entries.iter().filter(|e| e.is_dir).count();
    let file_count = entries.len() - folder_count;

    Ok(DirListing {
        path: path.to_string_lossy().to_string(),
        label: label.to_string(),
        files: entries,
        file_count,
        folder_count,
    })
}

fn desktop_path() -> PathBuf {
    dirs::desktop_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("C:\\"))
            .join("Desktop")
    })
}

fn count_dir(path: &Path) -> (usize, usize) {
    if !path.is_dir() {
        return (0, 0);
    }
    let entries: Vec<_> = fs::read_dir(path)
        .ok()
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default();
    let folders = entries
        .iter()
        .filter(|e| e.path().is_dir())
        .count();
    let files = entries.len() - folders;
    (files, folders)
}

#[tauri::command]
pub fn get_desktop_contents() -> Result<DirListing, String> {
    let path = desktop_path();
    list_directory(&path, "Desktop")
}

#[tauri::command]
pub fn get_quick_access() -> Result<Vec<QuickAccessItem>, String> {
    let locations: Vec<(&str, &str, fn() -> Option<PathBuf>)> = vec![
        ("Desktop", "desktop", || dirs::desktop_dir()),
        ("Documents", "documents", || dirs::document_dir()),
        ("Downloads", "downloads", || dirs::download_dir()),
        ("Pictures", "pictures", || dirs::picture_dir()),
        ("Music", "music", || dirs::audio_dir()),
        ("Videos", "videos", || dirs::video_dir()),
        ("Home", "home", || dirs::home_dir()),
    ];

    let items = locations
        .into_iter()
        .filter_map(|(name, icon, path_fn)| {
            let path = path_fn()?;
            if !path.exists() {
                return None;
            }
            let (file_count, folder_count) = count_dir(&path);
            Some(QuickAccessItem {
                name: name.to_string(),
                path: path.to_string_lossy().to_string(),
                icon: icon.to_string(),
                file_count,
                folder_count,
            })
        })
        .collect();

    Ok(items)
}

#[tauri::command]
pub fn get_recent_files(limit: Option<usize>) -> Result<Vec<FileEntry>, String> {
    let limit = limit.unwrap_or(20);
    let search_roots: Vec<PathBuf> = [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
        dirs::picture_dir(),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut all_files: Vec<(FileEntry, SystemTime)> = Vec::new();

    for root in search_roots {
        collect_recent_files(&root, 3, &mut all_files);
    }

    all_files.sort_by(|a, b| b.1.cmp(&a.1));
    all_files.truncate(limit);

    Ok(all_files.into_iter().map(|(e, _)| e).collect())
}

fn collect_recent_files(dir: &Path, depth: u32, out: &mut Vec<(FileEntry, SystemTime)>) {
    if depth == 0 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return,
    };

    for entry in entries {
        let path = entry.path();
        if path
            .file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }

        if path.is_dir() {
            collect_recent_files(&path, depth - 1, out);
        } else if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if let Some(entry) = entry_from_path(&path) {
                    out.push((entry, modified));
                }
            }
        }
    }
}

#[tauri::command]
pub fn browse_directory(path: String) -> Result<DirListing, String> {
    let p = PathBuf::from(&path);
    let label = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    list_directory(&p, &label)
}

#[tauri::command]
pub fn get_preview(path: String) -> Result<PreviewData, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let extension = p
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let modified = meta
        .modified()
        .map(format_time)
        .unwrap_or_else(|_| "Unknown".to_string());
    let is_dir = meta.is_dir();
    let size = if is_dir {
        "—".to_string()
    } else {
        format_size(meta.len())
    };

    let (content, children) = if is_dir {
        let listing = list_directory(&p, &name)?;
        (
            format!(
                "Folder containing {} files and {} folders",
                listing.file_count, listing.folder_count
            ),
            listing.files,
        )
    } else {
        let text = read_text_preview(&p, &extension);
        (text, Vec::new())
    };

    Ok(PreviewData {
        name,
        path,
        is_dir,
        size,
        modified,
        extension,
        content,
        children,
    })
}

fn read_text_preview(path: &Path, extension: &str) -> String {
    const TEXT_EXTENSIONS: &[&str] = &[
        "txt", "md", "json", "xml", "html", "css", "js", "ts", "jsx", "tsx", "py", "rs", "toml",
        "yaml", "yml", "ini", "cfg", "log", "csv", "bat", "ps1", "sh", "c", "cpp", "h", "java",
        "go", "sql",
    ];

    let ext_lower = extension.to_lowercase();
    if !TEXT_EXTENSIONS.contains(&ext_lower.as_str()) {
        return format!(
            "Preview not available for .{ext_lower} files.\nDouble-click to open with the default application."
        );
    }

    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) => return format!("Could not read file: {e}"),
    };

    let mut buffer = vec![0u8; 8192];
    let bytes_read = match file.read(&mut buffer) {
        Ok(n) => n,
        Err(e) => return format!("Could not read file: {e}"),
    };

    let text = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
    if bytes_read == 8192 {
        format!("{text}\n\n… (truncated)")
    } else {
        text
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_desktop_contents,
            get_quick_access,
            get_recent_files,
            browse_directory,
            get_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

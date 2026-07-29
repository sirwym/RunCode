fn main() {
    // macOS: 链接 libproc（proc_pid_rusage 所在库，用于按 PID 采集子进程内存）
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=dylib=proc");
    tauri_build::build()
}

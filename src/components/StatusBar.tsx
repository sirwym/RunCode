import { useRunManager, type RunStatus } from "../hooks/useRunManager";
import { useSettings } from "../hooks/useSettings";
import { useI18n } from "../hooks/useI18n";
import { Play, Square, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StatusBarProps {
  onRun: () => void;
  onFormat: () => void;
  cursorLine: number;
  cursorColumn: number;
}

// 内存格式化：KB → MB
function formatMem(kb: number): string {
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function StatusBar({ onRun, onFormat, cursorLine, cursorColumn }: StatusBarProps) {
  const t = useI18n((s) => s.t);
  const status = useRunManager((s) => s.status);
  const stop = useRunManager((s) => s.stop);
  const runResult = useRunManager((s) => s.runResult);
  const ptyExitInfo = useRunManager((s) => s.ptyExitInfo);
  const error = useRunManager((s) => s.error);
  const settings = useSettings((s) => s.settings);

  const isRunning = status === "running";

  // 状态点 class
  const statusDotClass =
    status === "error" ? "error"
    : status === "done" ? "done"
    : status === "running" ? "running"
    : "idle";

  // 状态文字
  const statusLabel: Record<RunStatus, string> = {
    idle: t("status.idle"),
    running: t("status.running"),
    done: t("status.done"),
    error: t("status.error"),
  };

  // 缩进显示
  const indentText = settings?.editor.indent_style === "tab"
    ? t("status.indentTab", { n: settings.editor.indent_size })
    : t("status.indentSpace", { n: settings?.editor.indent_size ?? 4 });

  // 编译参数
  const compilerText = settings?.compiler.compiler_path || "clang++";
  const argsText = settings
    ? `-std=${settings.compiler.cpp_standard} -${settings.compiler.opt_level}` +
      (settings.compiler.warnings === "wall" ? " -Wall"
       : settings.compiler.warnings === "wall_extra" ? " -Wall -Wextra" : "")
    : "";

  return (
    <footer className="status-bar status-bar-merged">
      {/* 左侧：状态点 + 状态文字 + 时间 + 内存 */}
      <span className={`status-item status-${statusDotClass}`}>
        <span className={`status-dot status-dot-${statusDotClass}`} />
        {error ? t("status.callFailed") : statusLabel[status]}
      </span>

      {runResult && (
        <span className="status-item status-item-low-priority">
          <span className="status-label">{t("status.duration")}:</span>
          {runResult.duration_ms} ms
        </span>
      )}

      {!runResult && ptyExitInfo && ptyExitInfo.durationMs !== null && (
        <span className="status-item status-item-low-priority">
          <span className="status-label">{t("status.duration")}:</span>
          {ptyExitInfo.durationMs} ms
        </span>
      )}

      {!runResult && ptyExitInfo && ptyExitInfo.maxRssKb !== null && ptyExitInfo.maxRssKb > 0 && (
        <span className="status-item status-item-low-priority">
          <span className="status-label">{t("status.memory")}:</span>
          {formatMem(ptyExitInfo.maxRssKb)}
        </span>
      )}

      {runResult && runResult.max_rss_kb > 0 && (
        <span className="status-item status-item-low-priority">
          <span className="status-label">{t("status.memory")}:</span>
          {formatMem(runResult.max_rss_kb)}
        </span>
      )}

      {/* 测试通过率已删除（右半面板 testcases-header 已有显示，避免重复） */}

      <span className="status-spacer" />

      {/* 中间偏右：操作按钮（视觉上在编辑器右边缘正下方） */}
      <div className="status-actions">
        <Button
          variant={isRunning ? "destructive" : "default"}
          size="icon-sm"
          onClick={isRunning ? () => void stop() : onRun}
          title={isRunning ? t("toolbar.stop") : t("toolbar.run")}
        >
          {isRunning ? <Square size={14} /> : <Play size={14} />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onFormat}
          disabled={isRunning}
          title={t("menu.format")}
        >
          <Wand2 size={14} />
        </Button>
      </div>

      <span className="status-divider" />

      {/* 右侧：光标位置 + 缩进 + 编译器 + 参数
          窄窗口优先保留运行状态、运行/格式化、光标、编译器；
          缩进/参数等低优先级信息在 900px 以下隐藏（见 global.css .status-item-low-priority） */}
      <span className="status-item">
        {t("status.cursorPos", { line: cursorLine, col: cursorColumn })}
      </span>
      <span className="status-item status-item-low-priority">{indentText}</span>
      <span className="status-item">
        <span className="status-label">{t("status.compiler")}</span>
        {compilerText}
      </span>
      {argsText && (
        <span className="status-item status-item-low-priority">
          <span className="status-label">{t("status.args")}</span>
          {argsText}
        </span>
      )}
    </footer>
  );
}

export default StatusBar;

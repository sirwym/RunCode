import { useCallback, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTestSuite } from "../hooks/useTestSuite";
import { useRunManager } from "../hooks/useRunManager";
import { useTestOptions } from "../hooks/useTestOptions";
import { useI18n } from "../hooks/useI18n";
import { getT } from "../hooks/useI18n";
import { X, FolderOpen, FileArchive, Plus, Square, Play, Upload, Check, AlertTriangle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { CasePreview, TestCaseResult, KillReason, AppErrorPayload } from "../types";

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 标准化输出（与 Rust 端一致）
function normalize(s: string, strict: boolean): string {
  const lf = s.replace(/\r\n/g, "\n");
  return strict ? lf : lf.replace(/\n+$/, "");
}

interface CardProps {
  index: number;
  preview: CasePreview;
  result: TestCaseResult | undefined;
  strict: boolean;
  isCurrent: boolean; // 是否为当前正在运行的用例
  onUpdate: (patch: { name?: string; input?: string; expected?: string; strict?: boolean }) => void;
  onRemove: () => void;
}

function TestCaseCard({
  index,
  preview,
  result,
  strict,
  isCurrent,
  onUpdate,
  onRemove,
}: CardProps) {
  const t = useI18n((s) => s.t);
  const isLarge = preview.is_large;

  // 编辑用 preview 的值（小样例）；大样例只读
  const expectedNorm = normalize(preview.expected_preview, strict);
  const actualNorm = result ? normalize(result.stdout, strict) : "";
  const diffPos = result?.first_diff ?? null;

  return (
    <div
      className={
        "testcase-card" +
        (result ? (result.passed ? " passed" : " failed") : "") +
        (isCurrent ? " running" : "")
      }
    >
      <div className="testcase-card-header">
        <span className="testcase-index">#{index + 1}</span>
        <input
          className="testcase-name-input"
          value={preview.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          disabled={isLarge}
          placeholder={t("tests.namePlaceholder")}
        />
        {result && (
          <span className={"testcase-badge " + (result.passed ? "badge-pass" : "badge-fail")}>
            {result.passed ? <><Check size={12} /> {t("tests.badgePass")}</> : <><X size={12} /> {t("tests.badgeFail")}</>}
          </span>
        )}
        {result && (
          <span className="testcase-duration">{result.duration_ms} ms</span>
        )}
        {isCurrent && <span className="testcase-running-dot" />}
        <span className="testcase-spacer" />
        <button className="btn-icon" onClick={onRemove} title={t("tests.remove")}>
          <X size={12} />
        </button>
      </div>

      {isLarge ? (
        // 大样例：只读摘要
        <div className="testcase-large-summary">
          <span className="large-badge">{t("tests.largeFile")}</span>
          <span className="large-size">
            {t("tests.inputLabel")}: {formatSize(preview.input_size)}
          </span>
          <span className="large-size">
            {t("tests.expectedLabel")}: {formatSize(preview.expected_size)}
          </span>
        </div>
      ) : (
        // 小样例：inline 编辑
        <div className="testcase-fields">
          <label className="testcase-field">
            <span className="field-label">{t("tests.input")}</span>
            <textarea
              className="field-textarea"
              value={preview.input_preview}
              onChange={(e) => onUpdate({ input: e.target.value })}
              placeholder={t("tests.inputPlaceholder")}
              spellCheck={false}
            />
          </label>
          <label className="testcase-field">
            <span className="field-label">{t("tests.expected")}</span>
            <textarea
              className="field-textarea"
              value={preview.expected_preview}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder={t("tests.expectedPlaceholder")}
              spellCheck={false}
            />
          </label>
        </div>
      )}

      {result && !result.passed && (
        <div className="testcase-diff">
          <div className="diff-row">
            <span className="diff-label diff-expected">{t("tests.diffExpected")}</span>
            <pre className="diff-pre">
              {isLarge ? preview.expected_preview : expectedNorm || t("tests.emptyValue")}
            </pre>
          </div>
          <div className="diff-row">
            <span className="diff-label diff-actual">{t("tests.diffActual")}</span>
            <pre className="diff-pre">{actualNorm || t("tests.emptyValue")}</pre>
          </div>
          {diffPos !== null && (
            <div className="diff-position">
              {t("tests.diffPosition", { pos: diffPos + 1 })}
              {actualNorm[diffPos] !== undefined
                ? " " + t("tests.diffPositionActual", {
                    char: actualNorm[diffPos] === "\n" ? "\\n" : actualNorm[diffPos],
                  })
                : " " + t("tests.diffPositionShorter")}
            </div>
          )}
          {result.stderr && (
            <div className="diff-row">
              <span className="diff-label diff-stderr">{t("tests.diffStderr")}</span>
              <pre className="diff-pre">{result.stderr}</pre>
            </div>
          )}
          {result.killed_by && (
            <div className="diff-killed">
              <AlertTriangle size={12} /> {t("tests.diffKilled", {
                reason: t(`killed.${result.killed_by as KillReason}`),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PanelProps {
  onRunTests: () => void;
}

function TestCasesPanel({ onRunTests }: PanelProps) {
  const t = useI18n((s) => s.t);
  const previews = useTestSuite((s) => s.previews);
  const addCase = useTestSuite((s) => s.addCase);
  const updateCase = useTestSuite((s) => s.updateCase);
  const removeCase = useTestSuite((s) => s.removeCase);
  const importCases = useTestSuite((s) => s.importCases);

  const status = useRunManager((s) => s.status);
  const result = useRunManager((s) => s.testResult);
  const error = useRunManager((s) => s.error);
  const stop = useRunManager((s) => s.stop);
  const testProgress = useRunManager((s) => s.testProgress);
  const strict = useTestOptions((s) => s.strict);
  const toggleStrict = useTestOptions((s) => s.toggleStrict);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const resultMap = useMemo(() => {
    const m = new Map<string, TestCaseResult>();
    if (result) {
      for (const r of result.results) {
        m.set(r.id, r);
      }
    }
    return m;
  }, [result]);

  const isRunning = status === "running";
  const hasCases = previews.length > 0;

  // 当前进度
  const progressInfo = useMemo(() => {
    if (!testProgress) return null;
    return { index: testProgress.index, total: testProgress.total, status: testProgress.status };
  }, [testProgress]);

  // 导入文件夹
  const handleImportDir = useCallback(async () => {
    setImportMsg(null);
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      const r = await importCases(selected, strict);
      const tt = getT();
      if (r.skipped.length > 0) {
        setImportMsg(tt("tests.importResultWithSkip", { imported: r.imported, skipped: r.skipped.length }));
      } else {
        setImportMsg(tt("tests.importResult", { imported: r.imported }));
      }
    } catch (e) {
      const tt = getT();
      const err = e as AppErrorPayload;
      const msg = err && typeof err === "object" && typeof err.code === "string"
        ? tt(`errors.${err.code}`, err.params)
        : typeof e === "string" ? e : String(e);
      setImportMsg(tt("tests.importFailed", { detail: msg }));
    } finally {
      setImporting(false);
    }
  }, [importCases, strict]);

  // 导入 ZIP 文件
  const handleImportZip = useCallback(async () => {
    setImportMsg(null);
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      const r = await importCases(selected, strict);
      const tt = getT();
      if (r.skipped.length > 0) {
        setImportMsg(tt("tests.importResultWithSkip", { imported: r.imported, skipped: r.skipped.length }));
      } else {
        setImportMsg(tt("tests.importResult", { imported: r.imported }));
      }
    } catch (e) {
      const tt = getT();
      const err = e as AppErrorPayload;
      const msg = err && typeof err === "object" && typeof err.code === "string"
        ? tt(`errors.${err.code}`, err.params)
        : typeof e === "string" ? e : String(e);
      setImportMsg(tt("tests.importFailed", { detail: msg }));
    } finally {
      setImporting(false);
    }
  }, [importCases, strict]);

  return (
    <section className="testcases-panel">
      <div className="testcases-header">
        {result && result.stage === "ran" && (
          <span className={"test-summary " + (result.success ? "summary-pass" : "summary-fail")}>
            {result.passed}/{result.total} {t("tests.passed")}
          </span>
        )}
        <span className="testcases-spacer" />
        <label
          className={"strict-toggle" + (strict ? " active" : "")}
          title={strict ? t("tests.strictHint") : t("tests.looseHint")}
        >
          <input
            type="checkbox"
            checked={strict}
            onChange={toggleStrict}
            disabled={isRunning}
          />
          <span className="strict-toggle-label">{t("tests.strict")}</span>
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="btn btn-secondary btn-sm btn-icon-only"
              disabled={isRunning || importing}
              title={t("tests.import")}
            >
              <Upload size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void handleImportDir()}>
              <FolderOpen size={14} />
              {t("tests.importDir")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleImportZip()}>
              <FileArchive size={14} />
              {t("tests.importZip")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          className="btn btn-secondary btn-sm btn-icon-only"
          onClick={() => void addCase(t("tests.defaultName", { n: previews.length + 1 }), "", "", strict)}
          disabled={isRunning}
          title={t("tests.add")}
        >
          <Plus size={14} />
        </button>
        {isRunning ? (
          <button
            className="btn btn-danger btn-sm btn-icon-only"
            onClick={() => void stop()}
            title={t("tests.stop")}
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm btn-icon-only"
            onClick={onRunTests}
            disabled={!hasCases}
            title={t("tests.run")}
          >
            <Play size={14} />
          </button>
        )}
      </div>

      {importMsg && (
        <div className="testcases-import-msg">{importMsg}</div>
      )}

      {/* 逐例进度条 */}
      {isRunning && progressInfo && (
        <div className="test-progress-bar">
          <div
            className="test-progress-fill"
            style={{ width: `${((progressInfo.index) / progressInfo.total) * 100}%` }}
          />
          <span className="test-progress-text">
            {progressInfo.index} / {progressInfo.total}
          </span>
        </div>
      )}

      {error && (
        <div className="testcases-error">{t("tests.callFailed")}{error}</div>
      )}

      {result && result.stage === "compile_failed" && (
        <div className="testcases-compile-error">
          <div className="compile-error-title">{t("tests.compileFailedTitle")}</div>
          <pre className="compile-error-body">{result.compile_stderr}</pre>
        </div>
      )}

      <div className="testcases-list">
        {!hasCases ? (
          <div className="testcases-empty">{t("tests.empty")}</div>
        ) : (
          previews.map((pv, idx) => (
            <TestCaseCard
              key={pv.id}
              index={idx}
              preview={pv}
              result={resultMap.get(pv.id)}
              strict={strict}
              isCurrent={
                isRunning &&
                testProgress?.status === "running" &&
                testProgress.case_id === pv.id
              }
              onUpdate={(patch) => updateCase(pv.id, patch)}
              onRemove={() => removeCase(pv.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default TestCasesPanel;

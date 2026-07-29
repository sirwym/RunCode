import { useCallback, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTestSuite } from "../hooks/useTestSuite";
import { useRunManager } from "../hooks/useRunManager";
import { useTestOptions } from "../hooks/useTestOptions";
import { useI18n } from "../hooks/useI18n";
import { getT } from "../hooks/useI18n";
import { X, FolderOpen, FileArchive, Plus, Square, Play, Upload, Check, AlertTriangle, GitCompare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import DiffDialog from "./DiffDialog";
import type { CasePreview, TestCaseResult, KillReason, AppErrorPayload } from "../types";

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CardProps {
  index: number;
  preview: CasePreview;
  result: TestCaseResult | undefined;
  isCurrent: boolean; // 是否为当前正在运行的用例
  onUpdate: (patch: { name?: string; input?: string; expected?: string; strict?: boolean }) => void;
  onRemove: () => void;
  onCompare: () => void;
}

function TestCaseCard({
  index,
  preview,
  result,
  isCurrent,
  onUpdate,
  onRemove,
  onCompare,
}: CardProps) {
  const t = useI18n((s) => s.t);
  const isLarge = preview.is_large;

  const diffPos = result?.first_diff ?? null;

  // 实际列摘要：stdout 前 1KB
  const actualExcerpt = result ? result.stdout.slice(0, 1024) : "";
  const actualTruncatedInCard = result ? result.stdout.length > 1024 : false;

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

      {/* 始终 3 列：输入 / 期望 / 实际 */}
      <div className="testcase-fields testcase-fields-3">
        <label className="testcase-field">
          <span className="field-label">{t("tests.input")}</span>
          {isLarge ? (
            <div className="field-readonly">
              {preview.input_preview.slice(0, 1024)}
              {preview.input_size > 1024 && (
                <span className="field-truncated">
                  …（{t("tests.expectedLabel")}: {formatSize(preview.input_size)}）
                </span>
              )}
            </div>
          ) : (
            <textarea
              className="field-textarea"
              value={preview.input_preview}
              onChange={(e) => onUpdate({ input: e.target.value })}
              placeholder={t("tests.inputPlaceholder")}
              spellCheck={false}
            />
          )}
        </label>
        <label className="testcase-field">
          <span className="field-label">{t("tests.expected")}</span>
          {isLarge ? (
            <div className="field-readonly">
              {preview.expected_preview.slice(0, 1024)}
              {preview.expected_size > 1024 && (
                <span className="field-truncated">
                  …（{formatSize(preview.expected_size)}）
                </span>
              )}
            </div>
          ) : (
            <textarea
              className="field-textarea"
              value={preview.expected_preview}
              onChange={(e) => onUpdate({ expected: e.target.value })}
              placeholder={t("tests.expectedPlaceholder")}
              spellCheck={false}
            />
          )}
        </label>
        <div className="testcase-field">
          <span className="field-label">{t("tests.diffActual")}</span>
          {result ? (
            <pre className="field-readonly field-actual">
              {actualExcerpt || t("tests.emptyValue")}
              {actualTruncatedInCard && (
                <span className="field-truncated">
                  …（{t("tests.compareDiff")}）
                </span>
              )}
            </pre>
          ) : (
            <div className="field-readonly field-actual-placeholder">—</div>
          )}
        </div>
      </div>

      {result && !result.passed && (
        <div className="testcase-diff-trigger">
          {diffPos !== null && (
            <span className="diff-first-pos">
              {t("tests.diffPosition", { pos: diffPos + 1 })}
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={onCompare}
            title={t("tests.compareDiff")}
          >
            <GitCompare size={12} />
            {t("tests.compareDiff")}
          </button>
          {result.killed_by && (
            <div className="diff-killed">
              <AlertTriangle size={12} /> {t("tests.diffKilled", {
                reason: t(`killed.${result.killed_by as KillReason}`),
              })}
            </div>
          )}
          {result.stderr && (
            <details className="testcase-stderr-details">
              <summary>{t("tests.diffStderr")}</summary>
              <pre className="diff-pre">{result.stderr}</pre>
            </details>
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

  // Diff Modal 状态：按需加载完整 expected
  const [diffState, setDiffState] = useState<{
    open: boolean;
    caseId: string | null;
    caseName: string;
    expectedFull: string;
    loading: boolean;
    error: string | null;
  }>({ open: false, caseId: null, caseName: "", expectedFull: "", loading: false, error: null });

  const resultMap = useMemo(() => {
    const m = new Map<string, TestCaseResult>();
    if (result) {
      for (const r of result.results) {
        m.set(r.id, r);
      }
    }
    return m;
  }, [result]);

  const handleCompare = useCallback(async (caseId: string, caseName: string) => {
    setDiffState({ open: true, caseId, caseName, expectedFull: "", loading: true, error: null });
    try {
      const full = await useTestSuite.getState().getFullExpected(caseId);
      setDiffState((s) => ({ ...s, expectedFull: full, loading: false }));
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      setDiffState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const handleCloseDiff = useCallback(() => {
    setDiffState({ open: false, caseId: null, caseName: "", expectedFull: "", loading: false, error: null });
  }, []);

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
        {result && result.stage === "ran" && (
          <span className="test-opt-level-badge">
            {t("tests.optLevelBadge", { level: result.used_opt_level })}
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
              isCurrent={
                isRunning &&
                testProgress?.status === "running" &&
                testProgress.case_id === pv.id
              }
              onUpdate={(patch) => updateCase(pv.id, patch)}
              onRemove={() => removeCase(pv.id)}
              onCompare={() => void handleCompare(pv.id, pv.name)}
            />
          ))
        )}
      </div>

      <DiffDialog
        open={diffState.open}
        onClose={handleCloseDiff}
        caseName={diffState.caseName}
        expectedFull={diffState.expectedFull}
        actual={diffState.caseId ? resultMap.get(diffState.caseId)?.stdout ?? "" : ""}
        truncated={diffState.caseId ? resultMap.get(diffState.caseId)?.truncated ?? false : false}
        strict={strict}
        loading={diffState.loading}
        error={diffState.error}
      />
    </section>
  );
}

export default TestCasesPanel;

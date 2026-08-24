import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTestSuite } from "../hooks/useTestSuite";
import { useRunManager } from "../hooks/useRunManager";
import { useTestOptions } from "../hooks/useTestOptions";
import { useI18n } from "../hooks/useI18n";
import { getT } from "../hooks/useI18n";
import { X, FolderOpen, FileArchive, Plus, Square, Play, Upload, Check, AlertTriangle, GitCompare, Clock, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import DiffDialog from "./DiffDialog";
import type { CasePreview, TestCaseResult, KillReason, AppErrorPayload, Verdict } from "../types";
import type { TestJudgeInfo } from "../hooks/useRunManager";

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// verdict → {className, icon, labelKey, shortLabelKey} 映射
function verdictBadge(verdict: Verdict): { className: string; icon: React.ReactNode; labelKey: string; shortLabelKey: string } {
  switch (verdict) {
    case "ac":  return { className: "badge-ac",  icon: <Check size={12} />,         labelKey: "tests.verdictAc",  shortLabelKey: "tests.verdictAcShort" };
    case "wa":  return { className: "badge-wa",  icon: <X size={12} />,             labelKey: "tests.verdictWa",  shortLabelKey: "tests.verdictWaShort" };
    case "tle": return { className: "badge-tle", icon: <Clock size={12} />,         labelKey: "tests.verdictTle", shortLabelKey: "tests.verdictTleShort" };
    case "re":  return { className: "badge-re",  icon: <AlertTriangle size={12} />, labelKey: "tests.verdictRe",  shortLabelKey: "tests.verdictReShort" };
    case "ole": return { className: "badge-ole", icon: <AlertTriangle size={12} />, labelKey: "tests.verdictOle", shortLabelKey: "tests.verdictOleShort" };
    case "uke": return { className: "badge-uke", icon: <AlertTriangle size={12} />, labelKey: "tests.verdictUke", shortLabelKey: "tests.verdictUkeShort" };
  }
}

// 构造单例失败诊断文本（一键复制用）。
// 技术字段（verdict/exit/diff 等）保持 OI 通用缩写原样，标签走 i18n。
export function formatCaseDiagnostic(
  result: TestCaseResult,
  judge: TestJudgeInfo | undefined,
  index: number,
  name: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const pos = judge ? `[${judge.index + 1}/${judge.total}]` : `#${index + 1}`;
  const head = judge
    ? `${pos} ${name} ${result.verdict.toUpperCase()} strict=${judge.case_strict} exit=${judge.exit_code} ${judge.duration_ms}/${judge.time_limit_ms}ms diff=${judge.first_diff} len=${judge.expected_len}/${judge.actual_len}`
    : `${pos} ${name} ${result.verdict.toUpperCase()} exit=${result.exit_code} ${result.duration_ms}ms diff=${result.first_diff}`;
  const lines = [head];
  if (judge?.expected_esc != null && judge.actual_esc != null) {
    lines.push(`${t("tests.expected")}: [${judge.expected_esc}]`);
    lines.push(`${t("tests.diffActual")}: [${judge.actual_esc}]`);
  } else {
    // 无转义视图（输出较大）时附带实际输出摘录，期望值请走「对比差异」
    const excerpt = result.stdout.slice(0, 512);
    lines.push(`${t("tests.diffActual")}: ${excerpt}${result.stdout.length > 512 ? "…" : ""}`);
  }
  if (result.stderr) {
    lines.push(`stderr: ${result.stderr.slice(0, 512)}${result.stderr.length > 512 ? "…" : ""}`);
  }
  return lines.join("\n");
}

interface CardProps {
  index: number;
  preview: CasePreview;
  result: TestCaseResult | undefined;
  /** 本例判定诊断（仅当 judgeInfo 与当前 testResult 同 run 时传入） */
  judge: TestJudgeInfo | undefined;
  isCurrent: boolean; // 是否为当前正在运行的用例
  selected: boolean; // 是否选中参与多样例测试
  onToggleSelected: (id: string) => void;
  selectionDisabled: boolean; // 运行中禁用选中切换
  onUpdate: (id: string, patch: { name?: string; input?: string; expected?: string; strict?: boolean }) => void;
  onRemove: (id: string) => void;
  onCompare: (id: string, name: string) => void;
}

const TestCaseCard = memo(function TestCaseCard({
  index,
  preview,
  result,
  judge,
  isCurrent,
  selected,
  onToggleSelected,
  selectionDisabled,
  onUpdate,
  onRemove,
  onCompare,
}: CardProps) {
  const t = useI18n((s) => s.t);
  const isLarge = preview.is_large;

  // 本地编辑 state：避免每次 onChange 都触发 invoke + refresh 导致竞态
  // （连续编辑时多个 refresh 请求乱序完成，旧请求会覆盖新内容）
  // 策略：onChange 只改本地 state；500ms 防抖后或 onBlur 时才触发 onUpdate
  const [localName, setLocalName] = useState(preview.name);
  const [localInput, setLocalInput] = useState(preview.input_preview);
  const [localExpected, setLocalExpected] = useState(preview.expected_preview);

  // 防抖 timer + 待提交 patch
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ name?: string; input?: string; expected?: string }>({});

  // 组件卸载时清理 timer 并 flush 未提交编辑，避免切换 tab 丢数据
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const patch = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(patch).length > 0) {
        onUpdate(preview.id, patch);
      }
    };
  }, [onUpdate, preview.id]);

  // 防抖提交：500ms 内无新输入才触发 onUpdate
  const scheduleUpdate = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const patch = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(patch).length > 0) {
        onUpdate(preview.id, patch);
      }
    }, 500);
  }, [onUpdate, preview.id]);

  // blur 时立即提交（不等防抖），保证切走焦点后后端尽快同步
  const flushUpdate = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length > 0) {
      onUpdate(preview.id, patch);
    }
  }, [onUpdate, preview.id]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalName(e.target.value);
    pendingRef.current.name = e.target.value;
    scheduleUpdate();
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalInput(e.target.value);
    pendingRef.current.input = e.target.value;
    scheduleUpdate();
  };
  const handleExpectedChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalExpected(e.target.value);
    pendingRef.current.expected = e.target.value;
    scheduleUpdate();
  };

  // 复制诊断反馈：ok / fail / null（1.5s 自动复位）
  const [copyState, setCopyState] = useState<"ok" | "fail" | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);
  const handleCopyDiag = async () => {
    if (!result) return;
    const text = formatCaseDiagnostic(result, judge, index, preview.name, t);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("ok");
    } catch {
      setCopyState("fail");
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState(null), 1500);
  };

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
        <label className="testcase-select-toggle" title={t("tests.toggleSelect")}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(preview.id)}
            disabled={selectionDisabled}
          />
        </label>
        <span className="testcase-index">#{index + 1}</span>
        <input
          className="testcase-name-input"
          value={localName}
          onChange={handleNameChange}
          onBlur={flushUpdate}
          disabled={isLarge}
          placeholder={t("tests.namePlaceholder")}
        />
        {result && result.verdict && (
          (() => {
            const v = verdictBadge(result.verdict);
            const tipKey = "tests.verdict" + result.verdict.charAt(0).toUpperCase() + result.verdict.slice(1) + "Tip";
            return (
              <span className={"testcase-badge " + v.className} title={t(tipKey)}>
                {v.icon} {t(v.labelKey)} {t(v.shortLabelKey)}
              </span>
            );
          })()
        )}
        {result && (
          <span className="testcase-duration" title={t("tests.cpuTimeTip")}>{result.duration_ms} ms</span>
        )}
        {isCurrent && <span className="testcase-running-dot" />}
        <span className="testcase-spacer" />
        <button className="btn-icon" onClick={() => onRemove(preview.id)} title={t("tests.remove")}>
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
              value={localInput}
              onChange={handleInputChange}
              onBlur={flushUpdate}
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
              value={localExpected}
              onChange={handleExpectedChange}
              onBlur={flushUpdate}
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
            onClick={() => onCompare(preview.id, preview.name)}
            title={t("tests.compareDiff")}
          >
            <GitCompare size={12} />
            {t("tests.compareDiff")}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void handleCopyDiag()}
            title={copyState ? t(copyState === "ok" ? "tests.copyDiagOk" : "tests.copyDiagFail") : t("tests.copyDiagnosis")}
          >
            {copyState === "ok" ? <Check size={12} /> : copyState === "fail" ? <AlertTriangle size={12} /> : <Copy size={12} />}
            {copyState ? t(copyState === "ok" ? "tests.copyDiagOk" : "tests.copyDiagFail") : t("tests.copyDiagnosis")}
          </button>
          {result.killed_by && (
            <div className="diff-killed">
              <AlertTriangle size={12} /> {t("tests.diffKilled", {
                reason: t(`killed.${result.killed_by as KillReason}`),
              })}
            </div>
          )}
          {/* 转义诊断：空格=· 换行=\n 等，让不可见字符差异肉眼可见 */}
          {judge && judge.expected_esc != null && judge.actual_esc != null && (
            <details className="testcase-judge-details">
              <summary>{t("tests.diagnosis")}</summary>
              <div className="judge-esc-row">
                <span className="judge-esc-label">{t("tests.expected")}</span>
                <pre className="diff-pre judge-esc-pre">{judge.expected_esc}</pre>
              </div>
              <div className="judge-esc-row">
                <span className="judge-esc-label">{t("tests.diffActual")}</span>
                <pre className="diff-pre judge-esc-pre">{judge.actual_esc}</pre>
              </div>
              <div className="judge-esc-legend">{t("tests.diagLegend")}</div>
            </details>
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
});

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
  const deselectedIds = useTestSuite((s) => s.deselectedIds);
  const toggleCaseSelection = useTestSuite((s) => s.toggleCaseSelection);
  const selectAll = useTestSuite((s) => s.selectAll);
  const deselectAll = useTestSuite((s) => s.deselectAll);

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

  const judgeInfo = useRunManager((s) => s.judgeInfo);
  // 仅当诊断与展示的 testResult 属同一次运行时才配套（防旧快照串新诊断）
  const judgeMap = useMemo(() => {
    if (!judgeInfo || !result || judgeInfo.runId !== result.run_id) return null;
    return judgeInfo.byCase;
  }, [judgeInfo, result]);

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
  // 选中状态派生：反向集合，deselectedIds 为空即全选
  const deselectedSet = useMemo(() => new Set(deselectedIds), [deselectedIds]);
  const isAllSelected = deselectedIds.length === 0;
  const selectedCount = previews.length - deselectedIds.length;
  const handleToggleAll = () => {
    if (isAllSelected) deselectAll();
    else selectAll();
  };

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

  // 稳定回调：传给 TestCaseCard，配合 React.memo 避免不必要的重渲染
  const handleToggleSelected = useCallback((id: string) => toggleCaseSelection(id), [toggleCaseSelection]);
  const handleUpdate = useCallback((id: string, patch: { name?: string; input?: string; expected?: string; strict?: boolean }) => updateCase(id, patch), [updateCase]);
  const handleRemove = useCallback((id: string) => removeCase(id), [removeCase]);
  const handleCompareCard = useCallback((id: string, name: string) => { void handleCompare(id, name); }, [handleCompare]);

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
          className={"strict-toggle select-all-toggle" + (isAllSelected ? " active" : "")}
          title={isAllSelected ? t("tests.deselectAllHint") : t("tests.selectAllHint")}
        >
          <input
            type="checkbox"
            checked={isAllSelected}
            onChange={handleToggleAll}
            disabled={isRunning || !hasCases}
          />
          <span className="strict-toggle-label">{t("tests.selectAll")}</span>
        </label>
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
            disabled={!hasCases || selectedCount === 0}
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
              judge={judgeMap ? judgeMap[pv.id] : undefined}
              isCurrent={
                isRunning &&
                testProgress?.status === "running" &&
                testProgress.case_id === pv.id
              }
              selected={!deselectedSet.has(pv.id)}
              onToggleSelected={handleToggleSelected}
              selectionDisabled={isRunning}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              onCompare={handleCompareCard}
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

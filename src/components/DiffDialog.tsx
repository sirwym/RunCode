import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../hooks/useI18n";
import { computeLineDiff, countDiffs } from "../utils/diff";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DiffDialogProps {
  open: boolean;
  onClose: () => void;
  caseName: string;
  /** 后端按需加载的完整 expected */
  expectedFull: string;
  /** 来自 result.stdout（1MB 截断） */
  actual: string;
  /** result.truncated */
  truncated: boolean;
  /** 是否严格模式（true=精确比较；false=忽略末尾换行） */
  strict: boolean;
  /** 加载中 */
  loading: boolean;
  /** 加载错误 */
  error: string | null;
}

function DiffDialog({
  open,
  onClose,
  caseName,
  expectedFull,
  actual,
  truncated,
  strict,
  loading,
  error,
}: DiffDialogProps) {
  const t = useI18n((s) => s.t);

  const diffLines = useMemo(
    () => (loading || error ? [] : computeLineDiff(actual, expectedFull)),
    [actual, expectedFull, loading, error],
  );
  const diffCount = useMemo(() => countDiffs(diffLines), [diffLines]);

  // 左右两栏同步滚动：左栏滚动时右栏跟随，反之亦然
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const rightBodyRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const left = leftBodyRef.current;
    const right = rightBodyRef.current;
    if (!left || !right) return;

    const sync = (src: HTMLElement, dst: HTMLElement) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      dst.scrollTop = src.scrollTop;
      syncingRef.current = false;
    };

    const onLeftScroll = () => sync(left, right);
    const onRightScroll = () => sync(right, left);
    left.addEventListener("scroll", onLeftScroll, { passive: true });
    right.addEventListener("scroll", onRightScroll, { passive: true });
    return () => {
      left.removeEventListener("scroll", onLeftScroll);
      right.removeEventListener("scroll", onRightScroll);
    };
  }, [open]);

  // 渲染单栏的行列表
  const renderColumn = (
    side: "left" | "right",
    bodyRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    return (
      <div className="diff-column">
        <div
          className={`diff-column-header ${side === "left" ? "actual" : "expected"}`}
        >
          {side === "left" ? t("tests.diffActual") : t("tests.diffExpected")}
        </div>
        <div className="diff-column-body" ref={bodyRef}>
          {diffLines.map((line, idx) => {
            const lineNo = side === "left" ? line.leftLineNo : line.rightLineNo;
            const content =
              side === "left" ? line.leftContent : line.rightContent;
            const isEmptySide =
              (side === "left" && line.type === "added") ||
              (side === "right" && line.type === "removed");
            return (
              <div
                key={idx}
                className={`diff-line ${line.type} ${isEmptySide ? "empty-side" : ""}`}
              >
                <span className="diff-line-no">
                  {lineNo ?? ""}
                </span>
                <span className="diff-line-content">
                  {content}
                </span>
              </div>
            );
          })}
          {diffLines.length === 0 && (
            <div className="diff-empty-hint">
              {t("tests.diffLoading")}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="diff-dialog-content">
        <DialogHeader>
          <DialogTitle>
            {t("tests.diffDialogTitle", { name: caseName })}
            {diffCount > 0 && (
              <span className="diff-dialog-count">
                {" "}· {diffCount} {t("tests.diffLegendModified")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!strict && !loading && !error && (
          <div className="diff-dialog-hint">
            {t("tests.diffNormalizedHint")}
          </div>
        )}

        {loading && (
          <div className="diff-dialog-loading">
            {t("tests.diffLoading")}
          </div>
        )}

        {error && (
          <div className="diff-dialog-error">
            {t("tests.diffLoadFailed", { detail: error })}
          </div>
        )}

        {!loading && !error && (
          <div className="diff-dialog-body">
            {renderColumn("left", leftBodyRef)}
            {renderColumn("right", rightBodyRef)}
          </div>
        )}

        {truncated && !loading && !error && (
          <div className="diff-dialog-footer">
            {t("tests.diffTruncated")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DiffDialog;
